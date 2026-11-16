# LEARNED_CONVERSION.PY IS STEP 4B. IT TRAINS A MACHINE LEARNING MODEL THAT TURNS MODIS COUNTS INTO VIIRS UNITS
# IT SAVES ONE FACTOR PER COUNTRY, DAY OR NIGHT AND MONTH, FOR THE YEARS BEFORE VIIRS
# RUN IT WITH python -m pipeline.04b_learned_conversion    IT WRITES data/learned_factors.parquet

# WHY
# The ratio table in calibrate.py gives one MODIS to VIIRS factor per country, season and day or night
# Real months differ. A month of big fires looks different to MODIS than a month of small ones
# This model learns that from what MODIS itself saw (counts, fire power, pixel size, confidence),
# using the 2012 to 2019 months when MODIS and VIIRS both flew and nothing had drifted

# HOW IT IS TESTED
# Trained on 2012 to 2015 it predicts 2016 to 2019, and the other way round, on all 182 countries
# It is only kept if it beats the ratio table both ways, on monthly and yearly totals

# WHERE IT IS USED
# Only for 2000 to 2011, before VIIRS. From 2012 the record uses VIIRS itself
# Not after 2019, since the Terra to Aqua count ratio is one of its inputs and that ratio changes once the orbits drift

import numpy as np
import polars as pl
from sklearn.ensemble import HistGradientBoostingRegressor
from pipeline.common import WORK, DATA, SEASONS

# Same settings as in the test, fixed before the test was run
PARAMS = dict(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40, l2_regularization=1.0)
SEEDS = 3


# Count MODIS detections and describe them, per country, day or night and month
def monthly_features(region):
    files = [str(p) for p in (WORK / "hotspots" / region).glob("*.parquet")]
    lf = pl.scan_parquet(files)
    modis = (lf.filter(pl.col("sat").is_in([0, 1])).group_by(["day", "ym"]).agg(
        (pl.col("sat") == 0).sum().cast(pl.Float64).alias("T"), (pl.col("sat") == 1).sum().cast(pl.Float64).alias("A"),
        pl.col("frp").log1p().mean().alias("lfrp"), (pl.col("frp") < 10).mean().alias("small"),
        pl.col("scan").mean().alias("scan"), (pl.col("conf").cast(pl.Int32, strict=False) < 50).mean().alias("low")).collect())
    viirs = lf.filter(pl.col("sat") == 2).group_by(["day", "ym"]).agg(pl.len().cast(pl.Float64).alias("S")).collect()
    return modis.join(viirs, on=["day", "ym"], how="left").with_columns(pl.lit(region).alias("region"))


# Turn a table of months into the numbers the model reads
def features(df, codes, terra_only):
    m = (df["ym"] % 100).to_numpy()
    total = df["T"].to_numpy() if terra_only else (df["T"] + df["A"]).to_numpy()
    cols = [df["region"].replace_strict(codes, return_dtype=pl.Int32).to_numpy(), df["day"].cast(pl.Int8).to_numpy(),
            np.sin(2 * np.pi * m / 12), np.cos(2 * np.pi * m / 12), np.log1p(total)]
    if not terra_only:
        cols.append(np.log((df["A"] + 1) / (df["T"] + 1)).to_numpy())
    cols += [df["lfrp"].to_numpy(), df["small"].to_numpy(), df["scan"].to_numpy(), df["low"].fill_null(0).to_numpy()]
    return np.column_stack(cols)


# Train on 2012 to 2019 and return the models, averaged over a few seeds
def train(D, codes, terra_only):
    tr = D.filter((pl.col("ym") >= 201202) & (pl.col("ym") <= 201912) & pl.col("S").is_not_null())
    total = tr["T"] if terra_only else tr["T"] + tr["A"]
    tr = tr.filter(total >= 3); total = tr["T"] if terra_only else tr["T"] + tr["A"]
    y = np.log(tr["S"].to_numpy() + 1) - np.log(total.to_numpy() + 1)
    return [HistGradientBoostingRegressor(**PARAMS, categorical_features=[0], random_state=s)
            .fit(features(tr, codes, terra_only), y, sample_weight=np.sqrt(total.to_numpy())) for s in range(SEEDS)]


def main():
    regions = sorted(p.name for p in (WORK / "hotspots").iterdir() if p.is_dir())
    codes = {r: i for i, r in enumerate(regions)}
    D = pl.concat([monthly_features(r) for r in regions])

    # One model for months with Terra and Aqua, one for the Terra alone months before July 2002
    both, alone = train(D, codes, False), train(D, codes, True)
    early = D.filter(pl.col("ym") <= 201112)
    two = early.filter(pl.col("A") > 0); one = early.filter(pl.col("A") == 0)
    rows = []
    for part, models, terra_only in ((two, both, False), (one, alone, True)):
        if part.height == 0:
            continue
        lp = np.mean([m.predict(features(part, codes, terra_only)) for m in models], axis=0)
        total = (part["T"] if terra_only else part["T"] + part["A"]).to_numpy()
        factor = (np.exp(lp) * (total + 1) - 1) / np.maximum(total, 1)
        rows.append(part.select("region", "day", "ym").with_columns(pl.Series("learned_k", factor), pl.lit(terra_only).alias("terra_only")))

    # Save one factor per country, day or night and month. build.py multiplies MODIS counts by it before 2012
    pl.concat(rows).write_parquet(DATA / "learned_factors.parquet")
    print("learned factors saved for", len(regions), "countries")


if __name__ == "__main__":
    main()
