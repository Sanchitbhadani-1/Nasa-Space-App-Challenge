# RECENT.PY IS AN EXTRA STEP. IT FETCHES MONTHS NEWER THAN NASA'S YEARLY FILES FROM THE FIRMS API
# RUN IT WITH python -m pipeline.recent 2026-01-01 2026-11-12 Argentina    IT NEEDS FIRMS_MAP_KEY SET FIRST
# THE TEXT BELOW STAYS AS A DOCSTRING BECAUSE THE FILE PRINTS IT AS ITS HELP MESSAGE

"""Optional step: fetch months newer than the yearly archive (2026 so far) from the FIRMS API.

Needs a free map key: https://firms.modaps.eosdis.nasa.gov/api/map_key/
Set it as an environment variable, never in code:   export FIRMS_MAP_KEY=xxxxxxxx

Usage: python -m pipeline.recent 2026-01-01 2026-11-12 Argentina Brazil ...
Writes work/raw/<source>_2026_<Country>.csv in the same format as the archive files,
so `python -m pipeline.02_clean work/raw` picks them up. Run boundaries first (it needs data/countries.geojson).

NOTE: written against the documented Area API (10-day windows, bbox west,south,east,north),
but not yet tested with a real key. Check the first output file before trusting a full run.
"""
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, timedelta
from shapely import contains_xy
from shapely.geometry import shape
from pipeline.common import WORK, DATA, api_boxes

# The FIRMS Area API link, filled in with the key, source, box, number of days and start day
API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox}/{days}/{day}"

# For each yearly file name, the API sources to try in order
# The science quality source comes first and the near real time source is the backup
SOURCES = {"modis": ["MODIS_SP", "MODIS_NRT"], "viirs-snpp": ["VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"],
           "viirs-jpss1": ["VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"]}


# Download a link as text, trying up to 3 times and waiting longer after each failure
def get(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode()
        except Exception:  # noqa: BLE001
            time.sleep(5 * (attempt + 1))

    # Report the failure without printing the key, which sits after "/csv/" in the link
    raise RuntimeError("FIRMS API request failed: " + url.split("/csv/")[0])


# Fetch every day from start to end for each country and save them as yearly CSV files
def main(start, end, countries):

    # Stop if the map key is missing
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Set FIRMS_MAP_KEY first (see the top of this file).")

    # Load each country's border to cut the box down to the country itself
    borders = {f["properties"]["id"]: shape(f["geometry"])
               for f in json.loads((DATA / "countries.geojson").read_text())["features"]}
    d0, d1 = date.fromisoformat(start), date.fromisoformat(end)
    for c in countries:
        geom = borders[c]

        # One box, or two for a country that crosses 180 degrees (geom.bounds would cover the whole planet's width)
        boxes = [",".join(f"{v:.2f}" for v in b) for b in api_boxes(geom)]
        for prefix, srcs in SOURCES.items():
            rows, header = {}, None
            day = d0

            # Ask for 10 days at a time, the most the API allows in one request
            while day <= d1:
                n = min(10, (d1 - day).days + 1)
                for src in srcs:
                    got = False
                    for bbox in boxes:
                        text = get(API.format(key=key, src=src, bbox=bbox, days=n, day=day.isoformat()))
                        r = list(csv.reader(io.StringIO(text)))

                        # Keying rows by their contents drops repeats
                        if len(r) > 1:
                            header = r[0]
                            got = True
                            for row in r[1:]:
                                rows[tuple(row)] = row

                    # Keep the first source that sends rows
                    if got:
                        break
                day += timedelta(days=n)
                time.sleep(0.5)
            if not header:
                print(f"{c} {prefix}: no rows")
                continue

            # Keep only detections inside the country's border, not just inside its box
            lat, lon = header.index("latitude"), header.index("longitude")
            keep = [row for row in rows.values() if contains_xy(geom, float(row[lon]), float(row[lat]))]

            # Split the detections by year
            by_year = {}
            for row in keep:
                by_year.setdefault(row[header.index("acq_date")][:4], []).append(row)

            # Write one file per year, named like NASA's yearly files so clean.py picks them up
            for y, rs in by_year.items():
                dest = WORK / "raw" / f"{prefix}_{y}_{c}.csv"
                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "w", newline="") as f:
                    w = csv.writer(f)
                    w.writerow(header)
                    w.writerows(rs)
                print(f"{c} {prefix} {y}: {len(rs):,} detections -> {dest.name}", flush=True)


# Print the help message if dates or countries are missing, otherwise fetch
if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
