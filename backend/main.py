# MAIN.PY IS THE SUNDIAL API. IT SERVES THE READY MADE HARMONIZED FIRE RECORD AND THE WEBSITE
# RUN IT FROM THE PROJECT FOLDER WITH uvicorn backend.main:app --reload    THE API DOCS ARE AT /docs
# AN AREA IS ONE TEXT LIKE country:Argentina, state:ARG-1309, bbox:west,south,east,north OR poly:lon lat;lon lat;...

import csv
import io
import json
import math
from functools import lru_cache
from pathlib import Path

import duckdb
import numpy as np
import polars as pl
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from shapely import contains_xy
from shapely.geometry import MultiPolygon, Polygon, shape

# The project folder and its data folder
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

# Folders that can hold single detection files
# work/ is where the pipeline writes them, and data/hotspots holds the copy we ship (Argentina)
HOTSPOT_DIRS = [ROOT / "work" / "hotspots", ROOT / "data" / "hotspots"]

# Each satellite's number and the name shown to people
SAT_NAMES = {0: "Terra", 1: "Aqua", 2: "Suomi NPP", 3: "NOAA-20"}

# The most detections one hotspot download can hold
MAX_HOTSPOT_ROWS = 300_000

# The web app, which zips any reply bigger than 2000 bytes
app = FastAPI(title="SUNDIAL API", description="Harmonized MODIS + VIIRS fire record")
app.add_middleware(GZipMiddleware, minimum_size=2000)

# LOADED ONCE AT START

# Countries, calibration and time of day data
META = json.loads((DATA / "meta.json").read_text())
CAL = json.loads((DATA / "calibration.json").read_text())["regions"]
DIURNAL = json.loads((DATA / "diurnal.json").read_text())

# Each grid square's country and state
CELLS = pl.read_parquet(DATA / "cell_state.parquet")

# Each country's pass times and drift corrections per month
MONTHS = pl.read_parquet(DATA / "months.parquet")

# Detection weights, state anomalies, globe squares and the most powerful fires
WEIGHTS = pl.read_parquet(DATA / "weights.parquet")
STATE_MONTH = pl.read_parquet(DATA / "state_month.parquet")
GLOBE = pl.read_parquet(DATA / "globe.parquet")
TOPS = pl.read_parquet(DATA / "top_hotspots.parquet")

# Names for states and countries, looked up by id
STATE_NAMES = {s[0]: (s[1], c["name"]) for c in META["countries"] for s in c["states"]}
COUNTRY_NAMES = {c["id"]: c["name"] for c in META["countries"]}

# The big grid stays on disk and DuckDB reads only the parts each request needs
GRID = str(DATA / "grid.parquet")


# List every month from the first to the last, written like 202009
def all_months():
    lo, hi = META["first_month"], META["last_month"]
    out, y, m = [], lo // 100, lo % 100
    while y * 100 + m <= hi:
        out.append(y * 100 + m)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


# Every month the record covers
MONTH_LIST = all_months()


# READING AN AREA

# Find the grid squares inside an area, remembering the last 256 areas asked for
@lru_cache(maxsize=256)
def area_cells(area: str) -> pl.DataFrame:
    kind, _, val = area.partition(":")

    # A country or state is a plain lookup
    if kind == "country":
        sel = CELLS.filter(pl.col("region") == val)
    elif kind == "state":
        sel = CELLS.filter(pl.col("state") == val)

    # A box or drawn shape is turned into a shape first
    elif kind in ("bbox", "poly"):
        try:
            if kind == "bbox":
                w, s, e, n = (float(v) for v in val.split(","))

                # A box with west bigger than east crosses the 180 degree line (Fiji, the Aleutians), so it is
                # two boxes: west to 180 and -180 to east. One box from west to east would wrap the long way round
                if w > e:
                    geom = MultiPolygon([Polygon([(w, s), (180, s), (180, n), (w, n)]),
                                         Polygon([(-180, s), (e, s), (e, n), (-180, n)])])
                else:
                    geom = Polygon([(w, s), (e, s), (e, n), (w, n)])
            else:
                pts = [tuple(float(v) for v in p.split()) for p in val.split(";") if p.strip()]
                geom = Polygon(pts)

                # Fix a shape whose sides cross
                if not geom.is_valid:
                    geom = geom.buffer(0)
        except (ValueError, TypeError):
            raise HTTPException(400, "Could not read the area. Use bbox:w,s,e,n or poly:lon lat;lon lat;...")

        # Take squares near the shape's box, then keep those whose middle point is inside the shape
        w, s, e, n = geom.bounds
        cand = CELLS.filter(((pl.col("cy") + 1) * 0.25 >= s) & (pl.col("cy") * 0.25 <= n)
                            & ((pl.col("cx") + 1) * 0.25 >= w) & (pl.col("cx") * 0.25 <= e))
        inside = contains_xy(geom, (cand["cx"].to_numpy() + 0.5) * 0.25, (cand["cy"].to_numpy() + 0.5) * 0.25)
        sel = cand.filter(pl.Series(inside))
    else:
        raise HTTPException(400, "Area must start with country:, state:, bbox: or poly:")
    return sel.select("region", "cy", "cx")


# Make a name for an area that people can read
def area_label(area: str) -> str:
    kind, _, val = area.partition(":")
    if kind == "country":
        return COUNTRY_NAMES.get(val, val)
    if kind == "state":
        s, c = STATE_NAMES.get(val, (val, ""))
        return f"{s}, {c}"
    return "Drawn area"


# THE HARMONIZED SERIES

# Turn a DuckDB result into a polars table
# DuckDB 1.x has .pl() and DuckDB 2.x has .to_arrow_table(), so this works with both
def to_polars(res) -> pl.DataFrame:
    if hasattr(res, "pl"):
        return res.pl()
    return pl.from_arrow(res.to_arrow_table())


# Add up every column of the grid over the chosen squares, for each month
def query_grid(cells: pl.DataFrame) -> pl.DataFrame:
    con = duckdb.connect()
    con.register("sel", cells.to_arrow())

    # List the countries to read, so DuckDB skips the rest of the file
    regions = ",".join("'" + r.replace("'", "") + "'" for r in cells["region"].unique().to_list())
    df = to_polars(con.sql(f"""
        SELECT g.ym, sum(T) T, sum(A) A, sum(S) S, sum(N) N, sum(harm) harm, sum(harm_var) harm_var,
               sum(harm_sys) harm_sys, sum(naive) naive, sum(modis_vu) modis_vu, sum(viirs_vu) viirs_vu,
               sum(terra_vu) terra_vu, sum(terra_raw_vu) terra_raw_vu, sum(modis_raw_vu) modis_raw_vu, sum(frp) frp
        FROM read_parquet('{GRID}') g JOIN sel USING (region, cy, cx)
        WHERE g.region IN ({regions or "''"})
        GROUP BY g.ym"""))
    con.close()
    return df


# Score how unusual each month is against the same month in every other year
# It uses the log of 1 plus the count, leaves the month itself out of its own normal,
# and keeps the spread at 0.3 or more so quiet places don't flag tiny changes
def anomalies(vals: np.ndarray, months: list[int]) -> np.ndarray:
    x = np.log1p(vals)
    z = np.zeros_like(x)
    mo = np.array([m % 100 for m in months])
    for m in range(1, 13):

        # Skip a month of the year with under 4 years of data
        idx = np.where(mo == m)[0]
        if len(idx) < 4:
            continue

        # Compare each year with all the other years of that month
        xs = x[idx]
        for j, i in enumerate(idx):
            others = np.delete(xs, j)
            z[i] = (x[i] - others.mean()) / max(others.std(ddof=1), 0.3)
    return z


# Build everything the app shows for one area, remembering the last 128 areas asked for
@lru_cache(maxsize=128)
def series(area: str) -> dict:
    cells = area_cells(area)
    if cells.height == 0:
        raise HTTPException(404, "No fire data in this area. Try somewhere inside a highlighted country.")

    # Add up the grid and fill months with no fire with 0
    # viirs_vu stays empty before VIIRS, so "no VIIRS yet" doesn't look like "no fire"
    g = query_grid(cells)
    full = pl.DataFrame({"ym": MONTH_LIST}, schema={"ym": pl.Int32}).join(g, on="ym", how="left")
    num = [c for c in full.columns if c != "ym"]
    full = full.with_columns(*[pl.col(c).fill_null(0) for c in num if c != "viirs_vu"])

    # Find the uncertainty and how unusual each month is
    harm = full["harm"].to_numpy()
    sd = np.sqrt(full["harm_var"].to_numpy() + full["harm_sys"].to_numpy() ** 2)
    z = anomalies(harm, MONTH_LIST)

    # Take the pass times from the country with the most grid squares in this area
    main_region = (cells.group_by("region").len().sort("len", descending=True)["region"][0])
    hrs = MONTHS.filter(pl.col("region") == main_region).select("ym", "hT", "hA", "hS", "hN")
    hrs = pl.DataFrame({"ym": MONTH_LIST}, schema={"ym": pl.Int32}).join(hrs, on="ym", how="left")

    # Say which sensor each month's number comes from
    src = np.where(np.array(MONTH_LIST) < 201202, "modis", np.where(full["S"].to_numpy() > 0, "snpp",
                   np.where(full["N"].to_numpy() > 0, "noaa20", "snpp")))

    # Round values to 1 or 2 decimal places, keeping empty values empty
    r1 = lambda a: [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), 1) for v in a]
    r2 = lambda a: [None if (v is None or (isinstance(v, float) and math.isnan(v))) else round(float(v), 2) for v in a]

    # Find yearly totals, the worst month and the most unusual month
    yearly = full.group_by(pl.col("ym") // 100).agg(pl.col("harm").sum(), pl.col("naive").sum()).sort("ym")
    peak = int(np.argmax(harm))
    big = int(np.argmax(np.abs(z)))

    # The band is 1.96 times the uncertainty either side, the range that holds the true value 95% of the time
    return {
        "area": area, "label": area_label(area), "cells": cells.height,
        "countries": sorted(cells["region"].unique().to_list()), "main_country": main_region,
        "months": MONTH_LIST,
        "harm": r1(harm), "lo": r1(np.maximum(harm - 1.96 * sd, 0)), "hi": r1(harm + 1.96 * sd),
        "naive": r1(full["naive"]), "modis_vu": r1(full["modis_vu"]), "modis_raw_vu": r1(full["modis_raw_vu"]),
        "viirs_vu": r1(full["viirs_vu"]), "terra_vu": r1(full["terra_vu"]), "terra_raw_vu": r1(full["terra_raw_vu"]),
        "T": r1(full["T"]), "A": r1(full["A"]), "S": r1(full["S"]), "N": r1(full["N"]), "frp": r1(full["frp"]),
        "z": r2(z), "source": src.tolist(),
        "hours": {k: r2(hrs[k]) for k in ("hT", "hA", "hS", "hN")},
        "summary": {
            "total": round(float(harm.sum())), "peak_month": MONTH_LIST[peak], "peak_value": round(float(harm[peak])),
            "biggest_anomaly_month": MONTH_LIST[big], "biggest_anomaly_z": round(float(z[big]), 2),
            "high_months": int((z >= 2).sum()), "low_months": int((z <= -2).sum()),
            "yearly": {int(y): round(float(h)) for y, h, _ in yearly.iter_rows()}},
    }


# API ADDRESSES

# The countries, months, slopes and which countries have hotspot files
@app.get("/api/meta")
def meta():
    return {**META, "calibration": {r: {"b_adj": c["b_adj"], "b_aqua": c["b_aqua"]} for r, c in CAL.items()},
            "hotspot_countries": hotspot_countries()}


# List the countries that have single detection files on this server
def hotspot_countries():
    return sorted({p.name for d in HOTSPOT_DIRS if d.exists() for p in d.iterdir() if p.is_dir() and any(p.glob("*.parquet"))})


# The full harmonized record for one area
@app.get("/api/series")
def get_series(area: str = Query(..., description="country:X | state:ID | bbox:w,s,e,n | poly:lon lat;...")):
    return series(area)


# Regional monthly history for a drawn box. The pipeline's data/ folder has no per-box monthly record yet, so this says so
# plainly and the website falls back to the seasonal average. It never estimates a region from country totals.
@app.get("/api/region")
def region(bbox: str = Query(..., description="w,s,e,n")):
    try:
        w, s_, e, n = (float(v) for v in bbox.split(","))
    except ValueError:
        raise HTTPException(400, "bbox must be four numbers: w,s,e,n")
    if not (-180 <= w < e <= 180 and -90 <= s_ < n <= 90):
        raise HTTPException(400, "need west < east within +-180 and south < north within +-90")
    return {"history": None, "reason": "regional_observations_not_loaded"}


# Every state's count and anomaly score for one month
@app.get("/api/anomaly-map")
def anomaly_map(ym: int):
    d = STATE_MONTH.filter(pl.col("ym") == ym)
    return {"ym": ym, "states": {s: [round(float(h), 1), round(float(z), 2)] for s, _, h, z in d.iter_rows()}}


# The half degree squares and the most powerful fires for one month, for the globe and the map
@app.get("/api/globe")
def globe(ym: int):
    g = GLOBE.filter(pl.col("ym") == ym)
    t = TOPS.filter(pl.col("ym") == ym)
    return {"ym": ym,
            "cells": [[round((gy + 0.5) * 0.5, 2), round((gx + 0.5) * 0.5, 2), round(float(v), 1)] for _, gy, gx, v in g.iter_rows()],
            "top": [[round(float(la), 3), round(float(lo), 3), round(float(f), 1), SAT_NAMES[int(s)], str(d)]
                    for la, lo, f, s, d in t.select("lat", "lon", "frp", "sat", "date").iter_rows()]}


# Each satellite's average daytime pass time per month across all countries, for the satellite strip
@app.get("/api/satellites")
def satellites():
    d = MONTHS.group_by("ym").agg(*[pl.col(c).mean() for c in ("hT", "hA", "hS", "hN")]).sort("ym")
    return {"months": d["ym"].to_list(),
            **{k: [None if v is None else round(float(v), 2) for v in d[k]] for k in ("hT", "hA", "hS", "hN")}}


# When in the day each satellite caught fires in one country
@app.get("/api/diurnal")
def diurnal(country: str):
    if country not in DIURNAL:
        raise HTTPException(404, "Unknown country")
    return DIURNAL[country]


# Every country's slopes and test results, one flat row each
@app.get("/api/scoreboard")
def scoreboard():
    rows = []
    for r, c in CAL.items():
        v = c["validation"]
        rows.append({"country": r, "name": COUNTRY_NAMES.get(r, r), "b_terra": c["swath"]["Terra"]["b"],
                     "b_aqua_swath": c["swath"]["Aqua"]["b"], "b_adj": c["b_adj"], "b_adj_se": c["b_adj_se"],
                     "b_aqua_anchored": c["b_aqua"], **{f"{k}.{kk}": vv for k, d in v.items() for kk, vv in d.items()}})
    return {"rows": rows}


# DOWNLOADS

# The monthly table for one area as a CSV file
@app.get("/api/download/monthly.csv")
def download_monthly(area: str):
    s = series(area)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["area", "month", "harmonized_fires_viirs_equiv", "lower_95", "upper_95", "record_source",
                "anomaly_z", "anomaly_flag", "modis_terra_count", "modis_aqua_count", "viirs_snpp_count",
                "viirs_noaa20_count", "naive_glued_count", "modis_drift_corrected_viirs_equiv",
                "modis_uncorrected_viirs_equiv", "terra_day_overpass_local_hour", "aqua_day_overpass_local_hour",
                "fire_radiative_power_mw_total"])

    # Write one row per month, flagging months 2 or more spreads above or below normal
    for i, ym in enumerate(s["months"]):
        z = s["z"][i]
        w.writerow([s["label"], f"{ym // 100}-{ym % 100:02d}", s["harm"][i], s["lo"][i], s["hi"][i], s["source"][i],
                    z, "high" if z >= 2 else "low" if z <= -2 else "", s["T"][i], s["A"][i], s["S"][i], s["N"][i],
                    s["naive"][i], s["modis_vu"][i], s["modis_raw_vu"][i], s["hours"]["hT"][i], s["hours"]["hA"][i],
                    s["frp"][i]])

    # Name the file after the area, using letters and numbers only
    name = "sundial_" + "".join(ch if ch.isalnum() else "_" for ch in s["label"])[:40] + "_monthly.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# Every single detection in one area and month range as a CSV file, with its VIIRS weight
@app.get("/api/download/hotspots.csv")
def download_hotspots(area: str, start: int = Query(..., description="YYYYMM"), end: int = Query(..., description="YYYYMM")):
    cells = area_cells(area)
    if cells.height == 0:
        raise HTTPException(404, "No fire data in this area.")

    # Find each country's detection files, from the first folder that has them
    files = []
    for r in cells["region"].unique().to_list():
        for d in HOTSPOT_DIRS:
            found = list((d / r).glob("*.parquet"))
            if found:
                files += [str(p) for p in found]
                break
    if not files:
        raise HTTPException(404, "Hotspot files for this country aren't on this server (the demo ships Argentina). "
                                 "Run the pipeline to add more, or use NASA FIRMS.")

    # Join each detection to its grid square and to its weight for that country, month, satellite and day or night
    # The file name check keeps a detection with its own country's square, since squares on a border belong to two countries
    # On Windows DuckDB reports file names with backslashes, so they are turned into slashes before the check
    con = duckdb.connect()
    con.register("sel", cells.to_arrow())
    con.register("wts", WEIGHTS.to_arrow())
    flist = "[" + ",".join("'" + f + "'" for f in files) + "]"
    q = f"""
        SELECT h.lat AS latitude, h.lon AS longitude, h.date AS acq_date, lpad(CAST(h.hhmm AS VARCHAR), 4, '0') AS acq_time_utc,
               round(h.lst, 2) AS local_solar_hour, h.sat, h.day, h.frp, h.conf AS confidence, h.scan, h.track,
               round(w.weight, 4) AS viirs_equiv_weight, w.in_record AS in_harmonized_record
        FROM read_parquet({flist}, filename=true) h
        JOIN sel USING (cy, cx)
        JOIN wts w ON w.region = sel.region AND w.ym = h.ym AND w.sat = h.sat AND w.day = h.day
        WHERE h.ym BETWEEN {int(start)} AND {int(end)}
          AND replace(h.filename, chr(92), '/') LIKE '%/' || sel.region || '/%'
        ORDER BY h.date, h.hhmm"""

    # Count first, and refuse downloads that are too big
    n = con.sql(f"SELECT count(*) FROM ({q})").fetchall()[0][0]
    if n > MAX_HOTSPOT_ROWS:
        con.close()
        raise HTTPException(413, f"{n:,} hotspots: too many for one download. Pick a smaller area or fewer months (limit {MAX_HOTSPOT_ROWS:,}).")
    df = to_polars(con.sql(q))
    con.close()

    # Write satellite names and D or N in place of the numbers and true or false
    df = df.with_columns(pl.col("sat").replace_strict(SAT_NAMES, return_dtype=pl.Utf8).alias("satellite"),
                         pl.when(pl.col("day")).then(pl.lit("D")).otherwise(pl.lit("N")).alias("day_night")) \
        .select("latitude", "longitude", "acq_date", "acq_time_utc", "local_solar_hour", "satellite", "day_night",
                "frp", "confidence", "scan", "track", "viirs_equiv_weight", "in_harmonized_record")
    name = "sundial_" + "".join(ch if ch.isalnum() else "_" for ch in area_label(area))[:40] + f"_hotspots_{start}_{end}.csv"
    return StreamingResponse(iter([df.write_csv()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


# MAP FILES AND THE WEBSITE

# Send one of the allowed map files from data/
@app.get("/data/{name}")
def data_file(name: str):
    # The website ships its own data files (frontend/data/meta.json, countries.geojson, ...). Those are for all
    # 182 countries and have a different layout from the pipeline's files of the same name, so they win
    # Names with a slash, a backslash or two dots are never files in that folder, so they can't climb out of it
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(404)
    site = ROOT / "frontend" / "data" / name
    if not name.startswith(".") and site.is_file():
        return FileResponse(site)
    if name not in ("countries.geojson", "states.geojson", "land.geojson", "basemap_land.geojson", "basemap_borders.geojson"):
        raise HTTPException(404)
    return FileResponse(DATA / name, media_type="application/geo+json")


# Serve the website from frontend/ at the main address
app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
