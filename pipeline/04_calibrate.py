# CALIBRATE.PY IS STEP 4. IT MEASURES EVERYTHING THE HARMONIZATION NEEDS, ONE COUNTRY AT A TIME
# RUN IT WITH python -m pipeline.04_calibrate    IT WRITES work/region_month.parquet AND data/calibration.json

# WHAT IT MEASURES
# 1. Each satellite's pass time per month, as the average local solar time of its detections
# 2. The swath slope, which is how fast daytime fire counts change per hour, from MODIS alone
#    It compares east edge and west edge pixels of the same size
#    Adding Terra's and Aqua's slopes, b_adj = b_Terra + b_Aqua, cancels the sun angle error
#    since Terra and Aqua fly in opposite directions
# 3. Aqua's drift slope, measured against the steady VIIRS record
#    Aqua sits near the top of the daily fire curve, where the swath method can't see a slope
# 4. Factors that turn MODIS counts into VIIRS units, from 2012 to 2019, per season and day or night
#    Plus a Terra alone factor for 2000 to 2002 and a NOAA-20 to Suomi NPP factor
# 5. The tests for the accuracy scoreboard

import json
import numpy as np
import polars as pl
from pipeline.common import WORK, DATA, SEASONS, CALIB_YEARS, VIIRS_START, NOMINAL_HOUR

# MODIS pixel width groups in km, for comparing east and west pixels of the same size
BINS = [(1.05, 1.5), (1.5, 2.0), (2.0, 3.0), (3.0, 4.8)]

# Detections a season needed for its own factor in the older fixed cutoff method
MIN_SEASON = 300

# DATA THRESHOLDS
# Every estimate is blended with a pooled one from all countries, weighted by how much data backs it
# This replaces hard cutoffs, so small countries lean on the pool instead of being dropped

# Pretend detections that pull a country's MODIS to VIIRS ratio toward the pooled ratio
PRIOR_N = 300

# A country needs at least this many VIIRS detections in total
MIN_VIIRS_TOTAL = 400

# Spread over at least this many months, or it has too little data to harmonize at all
MIN_VIIRS_MONTHS = 36

# A country is "measured" when its own swath slope carries at least 60% of the weight
TIER_MEASURED_W = 0.6

# and it has at least 2000 MODIS detections in 2012 to 2019
TIER_MEASURED_N = 2000

# Otherwise it is "blended" when its own weight is at least 20%
TIER_BLENDED_W = 0.2

# or it has at least 300 MODIS detections in 2012 to 2019. Below both it is "borrowed" and uses pooled values
TIER_BLENDED_N = 300


# Open one country's cleaned files for the given sources without loading them yet
def scan(region, sources):
    files = [str(p) for s in sources for p in (WORK / "hotspots" / region).glob(f"{s}_*.parquet")]
    return pl.scan_parquet(files)


# Count detections and find the average pass time for each satellite, day or night, and month
def region_month(region):
    lf = scan(region, ["modis", "viirs-snpp", "viirs-jpss1"])
    return (lf.group_by(["sat", "day", "ym"]).agg(pl.len().alias("n"), pl.col("lst").mean().alias("h"))
            .with_columns(pl.lit(region).alias("region")).collect())


# Measure the swath slope for Terra and for Aqua over 2003 to 2019, plus one slope per year for the chart
def swath_slopes(region):

    # Load daytime MODIS detections from before the drift, with their year, month and 2 degree latitude band
    d = (scan(region, ["modis"])
         .filter(pl.col("day") & (pl.col("ym") >= 200301) & (pl.col("ym") < 202001))
         .select("sat", "scan", "lst", (pl.col("ym") // 100).alias("year"), (pl.col("ym") % 100).alias("month"),
                 (pl.col("lat") / 2).floor().cast(pl.Int16).alias("band"))
         .collect())

    # Find the pass time straight down (the smallest pixels) for each satellite, year, month and band
    nad = (d.filter(pl.col("scan") <= 1.05).group_by(["sat", "year", "month", "band"])
           .agg(pl.col("lst").median().alias("nadir"), pl.len().alias("nn")).filter(pl.col("nn") >= 5))

    # Find how much later or earlier each edge pixel was seen than straight down
    # Positive means east of the path, seen later
    d = (d.join(nad, on=["sat", "year", "month", "band"]).with_columns((pl.col("lst") - pl.col("nadir")).alias("delta"))
         .filter((pl.col("delta").abs() <= 1.0) & (pl.col("scan") > 1.05)))

    # Put each pixel in its size group
    bins = pl.lit(None, pl.Int8)
    for i, (a, b) in enumerate(BINS):
        bins = pl.when((pl.col("scan") > a) & (pl.col("scan") <= b)).then(pl.lit(i, pl.Int8)).otherwise(bins)

    # Count east and west pixels and add up their time differences, per satellite, year and size group
    g = (d.with_columns(bins.alias("bin"), (pl.col("delta") > 0).alias("east")).drop_nulls("bin")
         .group_by(["sat", "year", "bin", "east"]).agg(pl.len().alias("n"), pl.col("delta").sum().alias("ds")))

    # Find one slope from a set of rows, and how sure it is
    def fit(rows):
        num = den = 0.0
        for b in range(len(BINS)):

            # Compare the east and west pixels of one size group, skipping groups with under 20 on either side
            e = rows.filter((pl.col("bin") == b) & pl.col("east"))
            w = rows.filter((pl.col("bin") == b) & ~pl.col("east"))
            ne, nw = e["n"].sum(), w["n"].sum()
            if ne < 20 or nw < 20:
                continue

            # The slope is the log of east count over west count, divided by the time between them
            dd = e["ds"].sum() / ne - w["ds"].sum() / nw
            bb = np.log(ne / nw) / dd
            v = (1 / ne + 1 / nw) / dd ** 2

            # Average the groups, giving groups with more pixels more weight
            num += bb / v; den += 1 / v
        return (num / den, den ** -0.5) if den else (None, None)

    # Find each satellite's slope over all years and for each single year
    out = {}
    for sat, name in ((0, "Terra"), (1, "Aqua")):
        x = g.filter(pl.col("sat") == sat)
        b, se = fit(x.filter(pl.col("year").is_between(2003, 2019)))
        out[name] = {"b": b, "se": se,
                     "by_year": {int(y): fit(x.filter(pl.col("year") == y))[0] for y in range(2003, 2020)}}

    # Add the two slopes to cancel the sun angle error, or use 0 with a wide error if either is missing
    bT, bA = out["Terra"]["b"], out["Aqua"]["b"]
    if bT is None or bA is None:
        out["b_adj"], out["b_adj_se"] = 0.0, 0.5
    else:
        out["b_adj"] = bT + bA
        out["b_adj_se"] = float(np.hypot(out["Terra"]["se"], out["Aqua"]["se"]))
    return out


# Make one row per month and day or night, with counts T, A, S, N and pass times hT, hA, hS, hN as columns
def wide(rm):
    p = rm.pivot(index=["region", "day", "ym"], on="sat", values=["n", "h"], aggregate_function="first")
    ren = {"n_0": "T", "n_1": "A", "n_2": "S", "n_3": "N", "h_0": "hT", "h_1": "hA", "h_2": "hS", "h_3": "hN"}
    p = p.rename({k: v for k, v in ren.items() if k in p.columns})

    # Add any satellite column that is missing
    for c in ren.values():
        if c not in p.columns:
            p = p.with_columns(pl.lit(None, pl.Float64).alias(c))
    return p.with_columns(*[pl.col(c).cast(pl.Float64) for c in ("T", "A", "S", "N")]).sort(["day", "ym"])


# Measure Aqua's drift slope against VIIRS, in daytime
# It compares the log of Aqua's count over VIIRS's count, with each month of the year's normal taken out,
# against how far Aqua's pass time has moved from 1:30 pm
def aqua_slope(w):

    # Keep daytime months from the VIIRS years where both have at least 30 detections
    x = w.filter(pl.col("day") & (pl.col("ym") >= VIIRS_START) & (pl.col("A") >= 30) & (pl.col("S") >= 30)
                 & pl.col("hA").is_not_null()).with_columns(
        (pl.col("A") / pl.col("S")).log().alias("lr"), (pl.col("ym") % 100).alias("m"))

    # With under 2 years of months, return 0 with a wide error
    if x.height < 24:
        return 0.0, 0.5

    # Take out each month of the year's normal ratio, and find the hours since 1:30 pm
    x = x.with_columns((pl.col("lr") - pl.col("lr").mean().over("m")).alias("y"),
                       (pl.col("hA") - NOMINAL_HOUR["Aqua"]).alias("dh"))

    # Fit a straight line and return its slope and how sure it is
    X = np.c_[np.ones(x.height), x["dh"].to_numpy()]
    y = x["y"].to_numpy()
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coef
    cov = resid.var(ddof=2) * np.linalg.inv(X.T @ X)
    return float(coef[1]), float(np.sqrt(cov[1, 1]))


# Add the numbers that undo each month's drift when multiplied by the raw counts, and each month's season
# Only daytime is corrected, so night stays at 1
def corrections(w, b_adj, b_aq):
    return w.with_columns(
        pl.when(pl.col("day")).then((-b_adj * (pl.col("hT") - NOMINAL_HOUR["Terra"])).exp()).otherwise(1.0)
        .fill_null(1.0).alias("cT"),
        pl.when(pl.col("day")).then((-b_aq * (pl.col("hA") - NOMINAL_HOUR["Aqua"])).exp()).otherwise(1.0)
        .fill_null(1.0).alias("cA"),
        (pl.col("ym") % 100).replace_strict(SEASONS, return_dtype=pl.Utf8).alias("season"))


# Find num over den, pulled toward prior by a pretend detections
# Big samples keep their own ratio, tiny ones lean on the prior, and a country with no data gets the prior
def shrink_ratio(num, den, prior, a=PRIOR_N):
    return (num + a * prior) / (den + a)


# Find the MODIS to VIIRS factors for each season and day or night, from the given years
# k is for Terra and Aqua together, kT is for Terra alone, and sigma is how much single months scatter
def factors(w, years=CALIB_YEARS, prior=None):

    # Keep the chosen years, starting no earlier than Feb 2012
    lo, hi = years
    c = w.filter((pl.col("ym") >= max(lo * 100 + 2, VIIRS_START)) & (pl.col("ym") <= hi * 100 + 12)).fill_null(0)

    # M is drift corrected MODIS and Tc is drift corrected Terra
    c = c.with_columns((pl.col("T") * pl.col("cT") + pl.col("A") * pl.col("cA")).alias("M"),
                       (pl.col("T") * pl.col("cT")).alias("Tc"))
    out = {}
    for day in (True, False):
        cd = c.filter(pl.col("day") == day)

        # Find the all season factor, blended with the pooled one when a pool is given
        pk = prior["D" if day else "N"] if prior else None
        if pk:
            allk = {"k": shrink_ratio(cd["S"].sum(), cd["M"].sum(), pk["k"]), "kT": shrink_ratio(cd["S"].sum(), cd["Tc"].sum(), pk["kT"])}
        else:
            allk = {"k": cd["S"].sum() / max(cd["M"].sum(), 1), "kT": cd["S"].sum() / max(cd["Tc"].sum(), 1)}
        for s in ("DJF", "MAM", "JJA", "SON"):
            cs = cd.filter(pl.col("season") == s)

            # Find how much single months scatter around the ratio, from months with at least 10 on both sides
            good = cs.filter((pl.col("M") >= 10) & (pl.col("S") >= 10))
            sig = float(np.std(np.log((good["S"] / good["M"]).to_numpy()), ddof=1)) if good.height >= 4 else 0.5

            # Find the season's factor, blended toward the all season one
            # Without a pool, a season with too little data uses the all season factor
            if pk:
                k, kT = shrink_ratio(cs["S"].sum(), cs["M"].sum(), allk["k"]), shrink_ratio(cs["S"].sum(), cs["Tc"].sum(), allk["kT"])
            elif cs["M"].sum() >= MIN_SEASON:
                k, kT = cs["S"].sum() / cs["M"].sum(), cs["S"].sum() / max(cs["Tc"].sum(), 1)
            else:
                k, kT = allk["k"], allk["kT"]
            out[f"{'D' if day else 'N'}_{s}"] = {"k": float(k), "kT": float(kT), "sigma": min(sig, 1.0)}
    return out


# Find the factor that turns NOAA-20 counts into Suomi NPP counts, from months where both have data
# It stops before Nov 2026, when Suomi NPP stopped sending data
def noaa20_factor(w):
    out = {}
    for day in (True, False):
        c = w.filter((pl.col("day") == day) & (pl.col("S") > 0) & (pl.col("N") > 0) & (pl.col("ym") < 202611))
        out["D" if day else "N"] = float(c["S"].sum() / c["N"].sum()) if c.height else 1.0
    return out


# Turn MODIS counts into VIIRS units month by month, with and without the drift fix
def apply_modis(w, F, era_terra_only=None):

    # Look up each month's factors by day or night and season
    key = (pl.when(pl.col("day")).then(pl.lit("D")).otherwise(pl.lit("N")) + "_" + pl.col("season"))
    k = key.replace_strict({k: v["k"] for k, v in F.items()}, return_dtype=pl.Float64)
    kT = key.replace_strict({k: v["kT"] for k, v in F.items()}, return_dtype=pl.Float64)

    # M is Terra and Aqua together, T is Terra alone. _raw columns skip the drift fix
    return w.with_columns(
        (k * (pl.col("T").fill_null(0) * pl.col("cT") + pl.col("A").fill_null(0) * pl.col("cA"))).alias("M_vu"),
        (k * (pl.col("T").fill_null(0) + pl.col("A").fill_null(0))).alias("M_raw_vu"),
        (kT * pl.col("T").fill_null(0) * pl.col("cT")).alias("T_vu"),
        (kT * pl.col("T").fill_null(0)).alias("T_raw_vu"))


# Find the percent change from the average of the base years to the average of the late years
def pct_change(series_by_year, base=(2012, 2019), late=(2021, 2025)):
    b = np.mean([series_by_year.get(y, np.nan) for y in range(base[0], base[1] + 1)])
    l = np.mean([series_by_year.get(y, np.nan) for y in range(late[0], late[1] + 1)])
    return float((l / b - 1) * 100)


# Run the scoreboard tests. They use day and night yearly totals unless a test says otherwise
def validate(w, F_full, b_adj, b_aq, prior=None):
    out = {}

    # TEST 1, HOLDOUT IN TIME
    # Fit the factors on 2012 to 2015 only, then predict VIIRS in 2016 to 2019 from MODIS
    F_early = factors(w, (2012, 2015), prior)
    m = apply_modis(w, F_early)
    yr = (m.filter((pl.col("ym") >= 201601) & (pl.col("ym") <= 201912))
          .group_by(pl.col("ym") // 100).agg(pl.col("M_vu").sum(), pl.col("S").sum(), pl.col("M_raw_vu").sum()))
    err = (yr["M_vu"] / yr["S"] - 1).abs() * 100

    # Compare with one single ratio, with no seasons, no day and night split and no drift fix
    tr = w.filter((pl.col("ym") >= VIIRS_START) & (pl.col("ym") <= 201512)).fill_null(0)
    k1 = tr["S"].sum() / (tr["T"].sum() + tr["A"].sum())
    mraw = (w.filter((pl.col("ym") >= 201601) & (pl.col("ym") <= 201912)).fill_null(0)
            .group_by(pl.col("ym") // 100).agg((pl.col("T") + pl.col("A")).sum().alias("R"), pl.col("S").sum()))

    # Find monthly errors too, since the calendar is monthly, for months with at least 50 VIIRS fires
    mm = (m.filter((pl.col("ym") >= 201601) & (pl.col("ym") <= 201912)).fill_null(0)
          .group_by("ym").agg(pl.col("M_vu").sum(), pl.col("S").sum(), (pl.col("T") + pl.col("A")).sum().alias("R"))
          .filter(pl.col("S") >= 50))
    out["V1_holdout"] = {"median_abs_err_pct": float(err.median()),
                         "single_ratio_abs_err_pct": float(((mraw["R"] * k1 / mraw["S"] - 1).abs() * 100).median()),
                         "monthly_median_abs_err_pct": float(((mm["M_vu"] / mm["S"] - 1).abs() * 100).median()),
                         "monthly_single_ratio_abs_err_pct": float(((mm["R"] * k1 / mm["S"] - 1).abs() * 100).median())}

    # TEST 2, DRIFT TEST FOR TERRA IN DAYTIME
    # The swath slope comes from MODIS before 2020 only, so VIIRS is an independent check
    m = apply_modis(w, F_full).filter(pl.col("day"))
    by = lambda col: {int(r[0]): r[1] for r in m.group_by(pl.col("ym") // 100).agg(pl.col(col).sum()).iter_rows()}
    S = by("S"); Traw = by("T_raw_vu"); Tc = by("T_vu"); Mraw = by("M_raw_vu"); Mc = by("M_vu")
    v, r, c = pct_change(S), pct_change(Traw), pct_change(Tc)

    # The gap is how far raw Terra's change is from VIIRS's change
    # Gap closed is only given when the gap is at least 3 points, since smaller gaps are mostly noise
    gap = abs(r - v)
    out["V2_terra_drift"] = {"viirs_change_pct": v, "raw_terra_change_pct": r, "corrected_terra_change_pct": c,
                             "gap_closed_pct": (gap - abs(c - v)) / gap * 100 if gap >= 3 else None,
                             "fake_trend_pts_before": r - v, "fake_trend_pts_after": c - v}

    # TEST 3, TERRA AND AQUA TOGETHER WITH BOTH CORRECTIONS
    # Aqua's slope is measured against VIIRS, so this test is not independent
    rr, cc = pct_change(Mraw), pct_change(Mc)
    out["V3_combined"] = {"raw_change_pct": rr, "corrected_change_pct": cc, "viirs_change_pct": v,
                          "fake_trend_pts_before": rr - v, "fake_trend_pts_after": cc - v}

    # TEST 4, PLACEBO
    # The same correction applied to 2012 to 2019 should change almost nothing, since nothing drifted then
    pv, pr, pc = (pct_change(x, (2012, 2015), (2016, 2019)) for x in (S, Traw, Tc))
    out["V4_placebo"] = {"raw_vs_viirs_pts": pr - pv, "corrected_vs_viirs_pts": pc - pv}
    return out


# Empty test results for a country whose tests can't run
EMPTY_VAL = {"V1_holdout": dict.fromkeys(["median_abs_err_pct", "single_ratio_abs_err_pct", "monthly_median_abs_err_pct", "monthly_single_ratio_abs_err_pct"]),
             "V2_terra_drift": dict.fromkeys(["viirs_change_pct", "raw_terra_change_pct", "corrected_terra_change_pct", "gap_closed_pct", "fake_trend_pts_before", "fake_trend_pts_after"]),
             "V3_combined": dict.fromkeys(["raw_change_pct", "corrected_change_pct", "viirs_change_pct", "fake_trend_pts_before", "fake_trend_pts_after"]),
             "V4_placebo": dict.fromkeys(["raw_vs_viirs_pts", "corrected_vs_viirs_pts"])}


# Average every country's slope, giving surer slopes more weight
# Also find how much the true slopes really differ between countries, beyond random error
def pooled_slope(pairs, floor=0.02):

    # Keep slopes that exist and are finite
    pairs = [(b, se) for b, se in pairs if b is not None and se and np.isfinite(b) and np.isfinite(se)]
    if not pairs:
        return 0.0, 0.25
    b = np.array([p[0] for p in pairs]); se = np.array([p[1] for p in pairs])
    mean = float(np.sum(b / se ** 2) / np.sum(1 / se ** 2))

    # The spread between countries is their total spread minus the part random error explains, at least floor
    tau2 = max(float(np.var(b, ddof=1)) - float(np.mean(se ** 2)), floor) if len(b) > 2 else 0.25
    return mean, tau2


# Blend a country's own slope with the pooled one, giving the surer one more weight
# Returns the blended slope, the weight on the country's own slope, and how sure the blend is
def shrink_slope(b, se, prior, tau2):

    # A country with no slope of its own takes the pooled slope
    if b is None or not se or not np.isfinite(b):
        return prior, 0.0, float(np.sqrt(tau2))
    po, pp = 1 / se ** 2, 1 / tau2
    return float((b * po + prior * pp) / (po + pp)), float(po / (po + pp)), float((po + pp) ** -0.5)


# Find the MODIS to VIIRS ratio across every country together, for day and for night
# Small countries lean on this ratio
def pooled_ratios(ws):
    tot = {True: [0.0, 0.0, 0.0], False: [0.0, 0.0, 0.0]}
    for w in ws:
        c = w.filter((pl.col("ym") >= VIIRS_START) & (pl.col("ym") <= CALIB_YEARS[1] * 100 + 12)).fill_null(0)

        # Add up VIIRS, MODIS and Terra counts
        for day in (True, False):
            cd = c.filter(pl.col("day") == day)
            tot[day][0] += float(cd["S"].sum()); tot[day][1] += float((cd["T"] + cd["A"]).sum()); tot[day][2] += float(cd["T"].sum())
    return {("D" if d else "N"): {"k": t[0] / max(t[1], 1), "kT": t[0] / max(t[2], 1)} for d, t in tot.items()}


# Calibrate every country and save the results
def main():
    regions = sorted(p.name for p in (WORK / "hotspots").iterdir() if p.is_dir())

    # PASS 1, MEASURE EVERY COUNTRY ON ITS OWN
    P, excluded = {}, {}
    for r in regions:
        rm = region_month(r)

        # Leave out countries with too little VIIRS data
        v = rm.filter(pl.col("sat").is_in([2, 3])).group_by("ym").agg(pl.col("n").sum())
        vt, vm = int(v["n"].sum()) if v.height else 0, int((v["n"] >= 3).sum()) if v.height else 0
        if vt < MIN_VIIRS_TOTAL or vm < MIN_VIIRS_MONTHS:
            excluded[r] = {"viirs_total": vt, "viirs_months_with_3": vm}
            print(r, "EXCLUDED (too sparse): viirs", vt, "months", vm, flush=True)
            continue

        # Measure the swath slopes, or mark them missing if that fails
        try:
            sw = swath_slopes(r)
        except Exception as e:  # noqa: BLE001
            print(r, "swath failed:", e, flush=True)
            sw = {"Terra": {"b": None, "se": None, "by_year": {}}, "Aqua": {"b": None, "se": None, "by_year": {}}, "b_adj": 0.0, "b_adj_se": 0.5}
        w = wide(rm)
        b_aq, b_aq_se = aqua_slope(w)
        P[r] = {"rm": rm, "sw": sw, "w": w, "b_aq": b_aq, "b_aq_se": b_aq_se}

    # Find the pooled slopes and ratios from every country that has its own
    own_adj = {r: (p["sw"]["b_adj"], p["sw"]["b_adj_se"]) for r, p in P.items() if p["sw"]["Terra"]["b"] is not None and p["sw"]["Aqua"]["b"] is not None}
    own_aq = {r: (p["b_aq"], p["b_aq_se"]) for r, p in P.items() if not (p["b_aq"] == 0.0 and p["b_aq_se"] == 0.5)}
    adj_mean, adj_tau2 = pooled_slope(list(own_adj.values()))
    aq_mean, aq_tau2 = pooled_slope(list(own_aq.values()))
    KG = pooled_ratios([p["w"] for p in P.values()])
    print("pooled: b_adj", round(adj_mean, 3), "tau2", round(adj_tau2, 3), "| b_aqua", round(aq_mean, 3), "tau2", round(aq_tau2, 3), "| k", {k: round(v["k"], 2) for k, v in KG.items()}, flush=True)

    # PASS 2, BLEND EACH COUNTRY WITH THE POOL, THEN CORRECT, CONVERT AND TEST
    rms, cal = [], {"regions": {}, "pooled": {"b_adj": adj_mean, "b_adj_tau2": adj_tau2, "b_aqua": aq_mean, "b_aqua_tau2": aq_tau2, "ratios": KG},
                    "excluded": excluded, "thresholds": {"PRIOR_N": PRIOR_N, "MIN_VIIRS_TOTAL": MIN_VIIRS_TOTAL, "MIN_VIIRS_MONTHS": MIN_VIIRS_MONTHS}}
    for r, p in P.items():
        rm, sw, w = p["rm"], p["sw"], p["w"]
        rms.append(rm)

        # Blend the country's own slopes with the pooled ones
        ob, ose = own_adj.get(r, (None, None))
        b_adj, w_adj, se_adj = shrink_slope(ob, ose, adj_mean, adj_tau2)
        ab, ase = own_aq.get(r, (None, None))
        b_aq, w_aq, se_aq = shrink_slope(ab, ase, aq_mean, aq_tau2)
        sw["b_adj"], sw["b_adj_se"] = b_adj, se_adj

        # Work out the drift corrections and factors, then run the tests
        w = corrections(w, b_adj, b_aq)
        F = factors(w, prior=KG)
        kN = noaa20_factor(w)
        try:
            val = validate(w, F, b_adj, b_aq, KG)
        except Exception as e:  # noqa: BLE001
            print(r, "validation failed:", e, flush=True)
            val = EMPTY_VAL

        # Give the country its quality level from its own slope weight and its daytime MODIS detections in 2012 to 2019
        cw = w.filter(pl.col("day") & (pl.col("ym") >= VIIRS_START) & (pl.col("ym") <= CALIB_YEARS[1] * 100 + 12)).fill_null(0)
        n_cal = int((cw["T"] + cw["A"]).sum())
        tier = ("measured" if (w_adj >= TIER_MEASURED_W and n_cal >= TIER_MEASURED_N)
                else "blended" if (w_adj >= TIER_BLENDED_W or n_cal >= TIER_BLENDED_N) else "borrowed")

        # Find each satellite's average daytime pass time per year
        hours = (rm.filter(pl.col("day") & pl.col("sat").is_in([0, 1, 2, 3]))
                 .group_by(["sat", pl.col("ym") // 100]).agg(((pl.col("h") * pl.col("n")).sum() / pl.col("n").sum()).alias("h"))
                 .sort(["sat", "ym"]))

        # Store everything about the country
        cal["regions"][r] = {
            "swath": sw, "b_adj": b_adj, "b_adj_se": se_adj, "b_aqua": b_aq, "b_aqua_se": se_aq,
            "quality": {"tier": tier, "weight_own_slope": round(w_adj, 3), "weight_own_aqua": round(w_aq, 3), "calibration_detections": n_cal},
            "factors": F, "noaa20_to_snpp": kN, "validation": val,
            "day_hour_by_year": {int(s): {int(y): round(float(h), 3) for _, y, h in hours.filter(pl.col("sat") == s).iter_rows()}
                                 for s in (0, 1, 2, 3)}}
        print(r, tier, "w", round(w_adj, 2), "n_cal", n_cal, "b_adj", round(b_adj, 3), "b_aqua", round(b_aq, 3),
              "V2", {k: (round(v, 1) if isinstance(v, float) else v) for k, v in val["V2_terra_drift"].items()}, flush=True)

    # Save the monthly counts for build.py and the calibration for the app
    pl.concat(rms).write_parquet(WORK / "region_month.parquet")
    DATA.mkdir(exist_ok=True)
    (DATA / "calibration.json").write_text(json.dumps(cal, default=float, indent=1))
    print("calibrate done:", len(cal["regions"]), "countries,", len(excluded), "excluded as too sparse")


# Calibrate when the file is run
if __name__ == "__main__":
    main()
