"""Build the example datasets for training your own models: frontend/data/examples/.

Run from the repo root (Python 3.9+, standard library only):
    python frontend/tools/build_examples.py

It reads the website's own static files (frontend/data/*.json, series/*.json), so it needs no pipeline run and no
network. Every number comes from the harmonized record; nothing here is simulated. Re-running gives identical files.

Writes, next to a README.md and a manifest.json that the website reads to list the files:
    country_month_panel.csv   one row per country and month: the whole harmonized record and its raw ingredients
    forecast_features.csv     ready-made supervised table: predict next month's fire count from its own past
    harmonizer_pairs.csv      MODIS counts + pass times next to what VIIRS saw: learn a better harmonizer
    grid_seasonal.csv         the 0.5 degree world grid: twelve monthly means per cell, for spatial models
    daily_curves.csv          detections by local hour for each satellite: learn the daily fire rhythm
    country_scorecard.csv     one row per country: calibration, held-out checks and trend: learn where the fix fails
"""
import csv
import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
OUT = DATA / "examples"
SATS = ["terra", "aqua", "suomi_npp", "noaa20"]
SPLITS = (201912, 202212)        # train up to Dec 2019, validate 2020 to 2022, test from Jan 2023


def load(name):
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f)


def num(v, nd=4):
    """A CSV cell: blank for missing, short for floats."""
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return ""
    if isinstance(v, float):
        s = f"{v:.{nd}f}".rstrip("0").rstrip(".")
        return s if s not in ("", "-0") else "0"
    return v


def write(name, header, rows):
    path = OUT / name
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(header)
        n = 0
        for r in rows:
            w.writerow([num(v) for v in r])
            n += 1
    return n, path.stat().st_size


def mindex(ym):
    return (ym // 100) * 12 + ym % 100 - 1


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = load("meta.json")
    countries = sorted(meta["countries"], key=lambda c: c["id"])
    score = {r["country"]: r for r in load("scoreboard.json")["rows"]}
    trends = load("trends.json")["rows"]
    series = {c["id"]: load(f"series/{c['id']}.json") for c in countries}
    files = []

    # 1. the panel
    head = ["country", "ym", "year", "month", "harmonized", "lower_95", "upper_95", "anomaly_z", "source", "glued",
            "terra_n", "aqua_n", "suomi_npp_n", "noaa20_n", "terra_raw_viirs_units", "terra_corrected_viirs_units", "frp_total"]

    def panel():
        for c in countries:
            s = series[c["id"]]
            for i, ym in enumerate(s["months"]):
                yield [c["id"], ym, ym // 100, ym % 100, s["harm"][i], s["lo"][i], s["hi"][i], s["z"][i], s["source"][i], s["naive"][i],
                       s["T"][i], s["A"][i], s["S"][i], s["N"][i], s["terra_raw_vu"][i], s["terra_vu"][i], s["frp"][i]]
    n, b = write("country_month_panel.csv", head, panel())
    files.append(dict(
        file="country_month_panel.csv", rows=n, cols=len(head), bytes=b, title="Country-month panel",
        use="Time series, anomaly detection, trend models. The full harmonized record with its raw ingredients.",
        target="harmonized (VIIRS-equivalent fires per month)",
        notes="source says which camera carries the month: modis before 2012, snpp (Suomi NPP) after. glued is the uncorrected splice of MODIS and VIIRS."))

    # 2. forecast features: only information from before the month being predicted (no leakage)
    head = ["country", "ym", "split", "y", "y_log1p", "lag1", "lag2", "lag3", "lag6", "lag12", "mean3", "mean12", "same_month_before",
            "month_sin", "month_cos", "year", "viirs_era", "lat", "lon", "tier"]

    def forecast():
        for c in countries:
            s = series[c["id"]]
            val = {ym: h for ym, h in zip(s["months"], s["harm"]) if h is not None}
            by_month = {}
            idx = {mindex(q): v for q, v in val.items()}
            for ym in sorted(val):
                m = ym % 100
                prior = by_month.get(m, [])      # this calendar month in earlier years only
                t = mindex(ym)
                g = lambda k: idx.get(t - k)
                last12 = [idx[t - k] for k in range(1, 13) if (t - k) in idx]
                if g(1) is not None and g(12) is not None and len(last12) >= 10 and prior:
                    last3 = [idx[t - k] for k in (1, 2, 3) if (t - k) in idx]
                    split = "train" if ym <= SPLITS[0] else "valid" if ym <= SPLITS[1] else "test"
                    src = s["source"][s["months"].index(ym)]
                    yield [c["id"], ym, split, val[ym], math.log1p(val[ym]), g(1), g(2), g(3), g(6), g(12),
                           sum(last3) / len(last3), sum(last12) / len(last12), sum(prior) / len(prior),
                           math.sin(2 * math.pi * (m - 1) / 12), math.cos(2 * math.pi * (m - 1) / 12), ym // 100,
                           0 if src == "modis" else 1, c["centroid"][1], c["centroid"][0], c["tier"]]
                by_month.setdefault(m, []).append(val[ym])
    n, b = write("forecast_features.csv", head, forecast())
    files.append(dict(
        file="forecast_features.csv", rows=n, cols=len(head), bytes=b, title="Next-month forecast table",
        use="Gradient boosting, neural nets, anything tabular. Train in seconds on a laptop.",
        target="y (or y_log1p): the month's harmonized fire count",
        notes="Every feature uses only months before the target (lags, rolling means, the same calendar month in earlier years), so there is no leakage. split is time-ordered: train to 2019, valid 2020 to 2022, test 2023 on."))

    # 3. harmonizer pairs
    head = ["country", "ym", "month", "lat", "lon", "terra_n", "aqua_n", "terra_pass_h", "aqua_pass_h", "noaa20_n", "suomi_npp_n"]

    def pairs():
        for c in countries:
            s = series[c["id"]]
            for i, ym in enumerate(s["months"]):
                if ym < 201201 or s["S"][i] is None or s["T"][i] is None or s["A"][i] is None:
                    continue
                if s["S"][i] + s["T"][i] + s["A"][i] <= 0:
                    continue
                hours = s.get("hours") or {}      # mean local solar time of each satellite's daytime pass over this country that month
                yield [c["id"], ym, ym % 100, c["centroid"][1], c["centroid"][0], s["T"][i], s["A"][i],
                       (hours.get("hT") or [None] * len(s["months"]))[i], (hours.get("hA") or [None] * len(s["months"]))[i], s["N"][i], s["S"][i]]
    n, b = write("harmonizer_pairs.csv", head, pairs())
    files.append(dict(
        file="harmonizer_pairs.csv", rows=n, cols=len(head), bytes=b, title="MODIS to VIIRS pairs",
        use="Learn a better harmonizer: raw Terra and Aqua counts and their drifting pass times in, VIIRS counts out.",
        target="suomi_npp_n (what the stable VIIRS camera counted)",
        notes="Months from 2012, when both camera families fly. Pass hours are each satellite's mean daytime local solar time over that country that month. Counts are raw detections, not harmonized."))

    # 4. seasonal grid
    cl = load("climo.json")
    mnames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    head = ["lon", "lat"] + mnames + ["annual_mean", "peak_month"]

    def grid():
        for lon, lat, v in sorted(cl["cells"], key=lambda r: (r[1], r[0])):
            mx = max(v)
            yield [lon, lat] + list(v) + [sum(v) / 12, v.index(mx) + 1 if mx > 0 else ""]
    n, b = write("grid_seasonal.csv", head, grid())
    files.append(dict(
        file="grid_seasonal.csv", rows=n, cols=len(head), bytes=b, title="World grid, seasonal means",
        use="Spatial models, clustering fire regimes, predicting the burning season from where a cell is.",
        target="peak_month (classification) or any month column (regression)",
        notes=f"Mean harmonized detections per month, {cl.get('years', '2012-2025')}, on a {cl.get('cell_deg', 0.5)} degree grid. Cells whose busiest month averages under four detections are left out."))

    # 5. daily curves
    di = load("diurnal.json")
    head = ["country", "satellite", "period", "local_hour", "detections"]

    def curves():
        for c in countries:
            rec = di.get(c["id"]) or {}
            for key in sorted(rec):
                sid, period = key.split("|")
                for h in sorted(rec[key], key=float):
                    yield [c["id"], SATS[int(sid)], period, float(h), rec[key][h]]
    n, b = write("daily_curves.csv", head, curves())
    files.append(dict(
        file="daily_curves.csv", rows=n, cols=len(head), bytes=b, title="Daily fire rhythm",
        use="Learn when in the day fires burn, per country, from where each satellite happened to look.",
        target="detections by local_hour",
        notes="Raw detections per local solar half-hour, per satellite, before the drift (2012-2019) and after (2022-2025). Terra and Aqua moved; Suomi NPP did not."))

    # 6. scorecard
    head = ["country", "tier", "calib_n", "lat", "lon", "b_terra", "b_aqua_swath", "b_adj", "b_adj_se",
            "holdout_median_abs_err_pct", "terra_drift_gap_closed_pct", "raw_terra_change_pct", "corrected_terra_change_pct", "viirs_change_pct",
            "glued_trend_pct_per_year", "fair_trend_pct_per_year", "trend_kind", "total_detections"]

    def card():
        for c in countries:
            r = score.get(c["id"], {})
            t = trends.get(c["id"]) or {}
            yield [c["id"], c["tier"], c["calib_n"], c["centroid"][1], c["centroid"][0], r.get("b_terra"), r.get("b_aqua_swath"),
                   r.get("b_adj"), r.get("b_adj_se"), r.get("V1_holdout.median_abs_err_pct"), r.get("V2_terra_drift.gap_closed_pct"),
                   r.get("V2_terra_drift.raw_terra_change_pct"), r.get("V2_terra_drift.corrected_terra_change_pct"), r.get("V2_terra_drift.viirs_change_pct"),
                   (t.get("n") or {}).get("pct"), (t.get("h") or {}).get("pct"), t.get("k"), series[c["id"]]["summary"]["total"]]
    n, b = write("country_scorecard.csv", head, card())
    files.append(dict(
        file="country_scorecard.csv", rows=n, cols=len(head), bytes=b, title="Country scorecard",
        use="Tiny and instant: predict where the correction works, or where gluing flips the trend.",
        target="terra_drift_gap_closed_pct, or trend_kind",
        notes="One row per country: calibration slopes, held-out error, how much of Terra's false trend the fix removed, and the glued against fair yearly trend."))

    (OUT / "manifest.json").write_text(json.dumps({
        "about": "Example datasets built from the SUNDIAL harmonized record. Source: NASA FIRMS (MODIS and VIIRS active fire detections).",
        "first_month": meta["first_month"], "last_month": meta["last_month"], "countries": len(countries), "files": files,
    }, indent=1) + "\n", encoding="utf-8")
    for f in files:
        print(f"{f['file']:28s} {f['rows']:>7,} rows  {f['cols']:>2} cols  {f['bytes'] / 1e6:5.2f} MB")


if __name__ == "__main__":
    main()
