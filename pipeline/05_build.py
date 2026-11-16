# BUILD.PY IS STEP 5. IT BUILDS THE SMALL READY MADE TABLES THE WEB APP SERVES, ALL INTO data/
# RUN IT WITH python -m pipeline.05_build
# IT WRITES grid, months, weights, state_month, cell_state, globe, top_hotspots, diurnal AND meta FILES

# WHAT EACH FILE HOLDS
# grid.parquet has one row per country, 0.25 degree square and month, with raw counts and harmonized values
# months.parquet has each country's satellite pass times and drift correction numbers for each month
# weights.parquet has how many VIIRS detections one detection is worth, per country, month, satellite and day or night
# state_month.parquet has each state's harmonized count and anomaly score for each month
# cell_state.parquet has the state each grid square belongs to
# globe.parquet has the harmonized count per half degree square and month, for the globe and the map
# top_hotspots.parquet has the most powerful fires of each month that the harmonized record counts
# diurnal.json has the share of detections at each time of day, per country and satellite, before and after the drift
# meta.json has the countries, their states and the first and last month

import json
import numpy as np
import polars as pl
from shapely import STRtree, points
from shapely.geometry import shape
from pipeline.common import WORK, DATA, AQUA_START, VIIRS_START, SEASONS
from importlib import import_module

# 04_calibrate starts with a number, so it has to be loaded by name
_calibrate = import_module("pipeline.04_calibrate")
wide, corrections = _calibrate.wide, _calibrate.corrections

# Every country's calibration numbers from calibrate.py
CAL = json.loads((DATA / "calibration.json").read_text())["regions"]


# For one country, find each month's drift corrections, conversion factors and which VIIRS satellite has data
# Each month is split into day and night
def month_factors(region):
    c = CAL[region]

    # Load the country's monthly counts and pass times, and work out each month's drift correction
    rm = pl.read_parquet(WORK / "region_month.parquet").filter(pl.col("region") == region)
    w = corrections(wide(rm), c["b_adj"], c["b_aqua"], c.get("fire_curve"))
    F = c["factors"]

    # Look up the factors by day or night and season, like "D_JJA"
    key = pl.when(pl.col("day")).then(pl.lit("D")).otherwise(pl.lit("N")) + "_" + pl.col("season")
    return w.with_columns(
        key.replace_strict({k: v["k"] for k, v in F.items()}, return_dtype=pl.Float64).alias("k"),
        key.replace_strict({k: v["kT"] for k, v in F.items()}, return_dtype=pl.Float64).alias("kT"),
        key.replace_strict({k: v["sigma"] for k, v in F.items()}, return_dtype=pl.Float64).alias("sigma"),
        pl.when(pl.col("day")).then(c["noaa20_to_snpp"]["D"]).otherwise(c["noaa20_to_snpp"]["N"]).alias("kN"),
        (pl.col("S").fill_null(0) > 0).alias("has_S"), (pl.col("N").fill_null(0) > 0).alias("has_N"),
    ).pipe(use_learned_factors).select("region", "day", "ym", "hT", "hA", "hS", "hN", "cT", "cA", "k", "kT", "sigma", "kN", "has_S", "has_N")


# If 04b_learned_conversion.py has run, swap in its month by month factors for the years before VIIRS
# Its factor applies to raw MODIS counts, so it is rescaled here to sit on top of the drift corrections
def use_learned_factors(w):
    path = DATA / "learned_factors.parquet"
    if not path.exists():
        return w
    lk = pl.read_parquet(path).select("region", "day", "ym", "learned_k")
    w = w.join(lk, on=["region", "day", "ym"], how="left")
    early = (pl.col("ym") < VIIRS_START) & pl.col("learned_k").is_not_null()
    two = pl.col("T").fill_null(0) * pl.col("cT") + pl.col("A").fill_null(0) * pl.col("cA")
    return w.with_columns(
        pl.when(early & (two > 0)).then(pl.col("learned_k") * (pl.col("T").fill_null(0) + pl.col("A").fill_null(0)) / two).otherwise(pl.col("k")).alias("k"),
        pl.when(early).then(pl.col("learned_k") / pl.col("cT")).otherwise(pl.col("kT")).alias("kT")).drop("learned_k")


# Count one country's detections and add up their fire power, per grid square, month, day or night and satellite
def cell_counts(region):
    files = [str(p) for p in (WORK / "hotspots" / region).glob("*.parquet")]
    g = (pl.scan_parquet(files).group_by(["cy", "cx", "ym", "day", "sat"])
         .agg(pl.len().alias("n"), pl.col("frp").sum().alias("frp")).collect())

    # Give each satellite its own column. T, A, S, N are counts and fT, fA, fS, fN are fire power
    p = g.pivot(index=["cy", "cx", "ym", "day"], on="sat", values=["n", "frp"], aggregate_function="first")
    ren = {"n_0": "T", "n_1": "A", "n_2": "S", "n_3": "N", "frp_0": "fT", "frp_1": "fA", "frp_2": "fS", "frp_3": "fN"}
    p = p.rename({k: v for k, v in ren.items() if k in p.columns})

    # Add any satellite column that is missing, and fill gaps with 0
    for col in ren.values():
        if col not in p.columns:
            p = p.with_columns(pl.lit(None, pl.Float64).alias(col))
    return p.with_columns(*[pl.col(c).fill_null(0).cast(pl.Float64) for c in ren.values()])


# Turn the raw counts into harmonized values for every grid square and month
def harmonize(cc, mf):

    # Before Aqua, MODIS is Terra alone. From Feb 2012 the record uses VIIRS
    # It uses Suomi NPP when it has data that month, and NOAA-20 when it doesn't
    terra_only = pl.col("ym") < AQUA_START
    viirs_era = pl.col("ym") >= VIIRS_START
    use_S = viirs_era & pl.col("has_S")
    use_N = viirs_era & ~pl.col("has_S") & pl.col("has_N")

    # Attach each month's factors. Months with none get neutral values
    x = cc.join(mf, on=["ym", "day"], how="left").with_columns(
        pl.col(c).fill_null(1.0) for c in ("cT", "cA", "k", "kT", "kN")).with_columns(
        pl.col("sigma").fill_null(0.5), pl.col("has_S").fill_null(False), pl.col("has_N").fill_null(False))

    # MODIS in VIIRS units. Undo each satellite's drift, then multiply by the conversion factor
    modis_vu = pl.when(terra_only).then(pl.col("kT") * pl.col("T") * pl.col("cT")) \
        .otherwise(pl.col("k") * (pl.col("T") * pl.col("cT") + pl.col("A") * pl.col("cA")))

    # How much that MODIS value can wobble from random chance alone
    modis_var = pl.when(terra_only).then(pl.col("kT") ** 2 * pl.col("T") * pl.col("cT") ** 2) \
        .otherwise(pl.col("k") ** 2 * (pl.col("T") * pl.col("cT") ** 2 + pl.col("A") * pl.col("cA") ** 2))

    # VIIRS in Suomi NPP units. NOAA-20 counts are scaled to match Suomi NPP
    viirs_vu = pl.when(use_S).then(pl.col("S")).when(use_N).then(pl.col("kN") * pl.col("N"))
    x = x.with_columns(modis_vu.alias("modis_vu"), modis_var.alias("modis_var"), viirs_vu.alias("viirs_vu"))

    # Build every column the app shows
    # harm is the harmonized count, VIIRS in VIIRS years and converted MODIS before
    # harm_var is random wobble and harm_sys is the uncertainty from the conversion factor itself
    # naive is the glued record, raw MODIS before 2012 and raw VIIRS after
    # terra_vu and terra_raw_vu are Terra alone with and without the drift fix, for the drift comparison
    # modis_raw_vu is MODIS converted without the drift fix
    x = x.with_columns(
        pl.when(use_S | use_N).then(pl.col("viirs_vu")).otherwise(pl.col("modis_vu")).alias("harm"),
        pl.when(use_S).then(pl.col("S")).when(use_N).then(pl.col("kN") ** 2 * pl.col("N"))
        .otherwise(pl.col("modis_var")).alias("harm_var"),
        pl.when(use_S).then(0.0).when(use_N).then(0.03 * pl.col("viirs_vu"))
        .otherwise(pl.col("sigma") * pl.col("modis_vu")).alias("harm_sys"),
        pl.when(~viirs_era).then(pl.col("T") + pl.col("A")).when(pl.col("has_S")).then(pl.col("S"))
        .otherwise(pl.col("N")).alias("naive"),
        (pl.col("kT") * pl.col("T") * pl.col("cT")).alias("terra_vu"),
        (pl.col("kT") * pl.col("T")).alias("terra_raw_vu"),
        pl.when(terra_only).then(pl.col("kT") * pl.col("T")).otherwise(pl.col("k") * (pl.col("T") + pl.col("A"))).alias("modis_raw_vu"),
        pl.when(~viirs_era).then(pl.col("fT") + pl.col("fA")).when(pl.col("has_S")).then(pl.col("fS"))
        .otherwise(pl.col("fN")).alias("frp"),
    )

    # Add day and night together for each grid square and month
    # viirs_vu stays empty before VIIRS, not 0, so the app can tell "no VIIRS" from "no fire"
    num = ["T", "A", "S", "N", "harm", "harm_var", "harm_sys", "naive", "modis_vu", "viirs_vu",
           "terra_vu", "terra_raw_vu", "modis_raw_vu", "frp"]
    g = x.group_by(["cy", "cx", "ym"]).agg(*[pl.col(c).sum() for c in num if c != "viirs_vu"],
                                          pl.col("viirs_vu").sum().alias("viirs_vu"),
                                          pl.col("viirs_vu").is_not_null().any().alias("has_viirs"))
    g = g.with_columns(pl.when(pl.col("has_viirs")).then(pl.col("viirs_vu")).alias("viirs_vu")).drop("has_viirs")

    # Store values as small number types so the file stays small
    return g.with_columns(*[pl.col(c).cast(pl.Float32) for c in num if c not in ("T", "A", "S", "N")],
                          *[pl.col(c).cast(pl.Int32) for c in ("T", "A", "S", "N")])


# Find the state each grid square's middle point falls in
# Coastal squares whose middle is in the sea get the nearest state within 0.3 degrees
def assign_states(cells):

    # Load the states and put them in a search tree for fast lookups
    feats = json.loads((DATA / "states.geojson").read_text())["features"]
    geoms = [shape(f["geometry"]) for f in feats]
    ids = np.array([f["properties"]["id"] for f in feats])
    ctry = np.array([f["properties"]["country"] for f in feats])
    tree = STRtree(geoms)

    # Find the state that holds each square's middle point
    pts = points((cells["cx"].to_numpy() + 0.5) * 0.25, (cells["cy"].to_numpy() + 0.5) * 0.25)
    pi, gi = tree.query(pts, predicate="within")
    out = np.full(len(pts), None, dtype=object)
    out[pi] = ids[gi]

    # For squares with no state, take the nearest state within 0.3 degrees
    miss = np.where(out == None)[0]  # noqa: E711
    if len(miss):
        mi, mg = tree.query_nearest(pts[miss], max_distance=0.3, all_matches=False)
        out[miss[mi]] = ids[mg]
    reg = cells["region"].to_numpy()

    # Keep a match only if the state is in the square's own country, since border squares can land in a neighbor
    sc = dict(zip(ids, ctry))
    ok = np.array([o is not None and sc[o] == r for o, r in zip(out, reg)])
    return cells.with_columns(pl.Series("state", np.where(ok, out, None), dtype=pl.Utf8))


# Score how unusual each month is against the same month in every other year
# It uses the log of 1 plus the count, and leaves the month itself out of its own normal
def anomaly(df, key):
    d = df.with_columns((pl.col("ym") % 100).alias("m"), pl.col("harm").log1p().alias("x"))

    # Add up the values and their squares for each place and month of the year
    d = d.with_columns(pl.col("x").sum().over([key, "m"]).alias("sx"), (pl.col("x") ** 2).sum().over([key, "m"]).alias("sxx"),
                       pl.len().over([key, "m"]).alias("n"))

    # Find the average and spread of the other years, then how far this month sits from them
    # The spread has a floor of 0.3 so quiet places don't flag tiny changes
    mu = (pl.col("sx") - pl.col("x")) / (pl.col("n") - 1)
    var = (pl.col("sxx") - pl.col("x") ** 2 - (pl.col("n") - 1) * mu ** 2) / (pl.col("n") - 2)
    sd = pl.max_horizontal(var.clip(lower_bound=0).sqrt(), pl.lit(0.3))
    return d.with_columns(((pl.col("x") - mu) / sd).alias("z")).drop(["m", "x", "sx", "sxx", "n"])


# List every month from lo to hi, written like 202009
def all_months(lo, hi):
    out, y, m = [], lo // 100, lo % 100
    while y * 100 + m <= hi:
        out.append(y * 100 + m)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


# Build and save every table the app reads
def main():

    # GRID

    # Harmonize every country and put them in one table
    regions = sorted(CAL)
    grids, mfs = [], []
    for r in regions:
        mf = month_factors(r)
        g = harmonize(cell_counts(r), mf).with_columns(pl.lit(r).alias("region"))
        grids.append(g)
        mfs.append(mf)
        print(r, "cells x months:", g.height, flush=True)
    grid = pl.concat(grids, how="diagonal_relaxed")
    mf = pl.concat(mfs)
    first, last = int(grid["ym"].min()), int(grid["ym"].max())

    # Save which state each square is in, and the grid sorted by country and month for fast reads
    cells = grid.select("region", "cy", "cx").unique()
    cs = assign_states(cells)
    cs.write_parquet(DATA / "cell_state.parquet")
    grid.sort(["region", "ym", "cy", "cx"]).write_parquet(DATA / "grid.parquet", compression="zstd", row_group_size=200_000)

    # MONTHS AND WEIGHTS

    # Save the daytime pass times and drift corrections. Night corrections are always 1
    mf.filter(pl.col("day")).select("region", "ym", "hT", "hA", "hS", "hN", "cT", "cA").sort(["region", "ym"]) \
        .write_parquet(DATA / "months.parquet")

    # Save how many VIIRS detections one detection is worth, and whether the harmonized record counts it
    # MODIS counts before Feb 2012, Suomi NPP after, and NOAA-20 only when Suomi NPP has no data
    rows = []
    for d in mf.iter_rows(named=True):
        ym, era_v = d["ym"], d["ym"] >= VIIRS_START
        modis_k = d["kT"] if ym < AQUA_START else d["k"]
        rows += [
            (d["region"], ym, 0, d["day"], modis_k * d["cT"], not era_v),
            (d["region"], ym, 1, d["day"], d["k"] * d["cA"], not era_v and ym >= AQUA_START),
            (d["region"], ym, 2, d["day"], 1.0, era_v and d["has_S"]),
            (d["region"], ym, 3, d["day"], d["kN"], era_v and not d["has_S"]),
        ]
    pl.DataFrame(rows, schema=["region", "ym", "sat", "day", "weight", "in_record"], orient="row") \
        .with_columns(pl.col("sat").cast(pl.UInt8), pl.col("weight").cast(pl.Float32)).write_parquet(DATA / "weights.parquet")

    # STATES

    # Add up each state's monthly total, fill months with no fire with 0, then score unusual months
    months = pl.DataFrame({"ym": all_months(first, last)}, schema={"ym": pl.Int32})
    sg = grid.join(cs, on=["region", "cy", "cx"]).drop_nulls("state").group_by(["state", "ym"]).agg(pl.col("harm").sum())
    full = sg.select("state").unique().join(months, how="cross").join(sg, on=["state", "ym"], how="left") \
        .with_columns(pl.col("harm").fill_null(0))
    anomaly(full, "state").with_columns(pl.col("harm").cast(pl.Float32), pl.col("z").cast(pl.Float32)) \
        .sort(["ym", "state"]).write_parquet(DATA / "state_month.parquet")

    # GLOBE

    # Add up the grid into half degree squares for the globe and the map
    grid.group_by([pl.col("ym"), (pl.col("cy") // 2).alias("gy"), (pl.col("cx") // 2).alias("gx")]) \
        .agg(pl.col("harm").sum().cast(pl.Float32)).filter(pl.col("harm") > 0.5).sort("ym") \
        .write_parquet(DATA / "globe.parquet")

    # Keep the 80 most powerful fires of each month, from the detections the harmonized record counts
    w = pl.read_parquet(DATA / "weights.parquet").filter(pl.col("in_record")).select("region", "ym", "sat", "day")
    tops = []
    for r in regions:
        files = [str(p) for p in (WORK / "hotspots" / r).glob("*.parquet")]
        h = (pl.scan_parquet(files).select("lat", "lon", "frp", "sat", "day", "ym", "date")
             .join(w.filter(pl.col("region") == r).lazy(), on=["ym", "sat", "day"])
             .filter(pl.col("frp").is_not_null()).sort("frp", descending=True)
             .group_by("ym").head(60).collect())
        tops.append(h.with_columns(pl.lit(r).alias("region")))
    pl.concat(tops).sort("frp", descending=True).group_by("ym").head(80).sort(["ym", "frp"], descending=[False, True]) \
        .write_parquet(DATA / "top_hotspots.parquet")

    # TIME OF DAY

    # Count detections in each half hour of local solar time, for 2012 to 2019 and for 2022 to 2025
    diurnal = {}
    for r in regions:
        files = [str(p) for p in (WORK / "hotspots" / r).glob("*.parquet")]
        h = (pl.scan_parquet(files).with_columns(
            pl.when(pl.col("ym").is_between(201201, 201912)).then(pl.lit("2012-2019"))
            .when(pl.col("ym") >= 202201).then(pl.lit("2022-2025")).otherwise(None).alias("period"),
            ((pl.col("lst") * 2).floor() / 2).alias("bin"))
            .drop_nulls("period").group_by(["sat", "period", "bin"]).agg(pl.len().alias("n")).collect())
        diurnal[r] = {f"{s}|{p}": {str(b): int(n) for _, _, b, n in grp.sort("bin").iter_rows()}
                      for (s, p), grp in h.group_by(["sat", "period"])}
    (DATA / "diurnal.json").write_text(json.dumps(diurnal))

    # COUNTRY LIST

    # Save each country's name, box and states, and the first and last month
    ctry = {f["properties"]["id"]: f for f in json.loads((DATA / "countries.geojson").read_text())["features"]}
    states = json.loads((DATA / "states.geojson").read_text())["features"]
    meta = {"first_month": first, "last_month": last, "countries": []}
    for r in regions:
        g = shape(ctry[r]["geometry"]) if r in ctry else None
        meta["countries"].append({
            "id": r, "name": ctry[r]["properties"]["name"] if r in ctry else r.replace("_", " "),
            "bbox": [round(v, 2) for v in g.bounds] if g else None,
            "states": sorted([[s["properties"]["id"], s["properties"]["name"]] for s in states
                              if s["properties"]["country"] == r], key=lambda x: x[1])})
    (DATA / "meta.json").write_text(json.dumps(meta))
    print("build done:", first, "to", last, "grid rows", grid.height)


# Build everything when the file is run
if __name__ == "__main__":
    main()
