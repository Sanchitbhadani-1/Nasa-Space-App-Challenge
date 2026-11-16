# CLEAN.PY IS STEP 2. IT TURNS NASA'S YEARLY FIRE CSV FILES INTO SMALL PARQUET FILES
# IT KEEPS VEGETATION FIRES ONLY, DROPS LOW CONFIDENCE DETECTIONS, AND ADDS LOCAL SOLAR TIME AND A GRID SQUARE
# RUN IT WITH python -m pipeline.02_clean work/raw    FILES LAND IN work/hotspots/<Country>/<source>_<year>.parquet

import sys
from pathlib import Path
import polars as pl
from pipeline.common import WORK, CELL, SAT_CODES

# The columns we read from each NASA file
COLS = ["latitude", "longitude", "scan", "track", "acq_date", "acq_time",
        "satellite", "confidence", "frp", "daynight", "type"]


# Read one NASA file and return its cleaned detections
def clean_file(path: Path) -> pl.DataFrame:
    source, year, *country = path.stem.split("_")

    # Read the file with every column type set by hand
    # Left to guess, polars reads scan, track and frp as whole numbers in small files and then fails on 1.9
    # The yearly archive files have a "type" column, but the FIRMS API files that recent.py saves may not, so
    # read only the columns the file really has
    have = [c for c in COLS if c in pl.read_csv(path, n_rows=0).columns]
    types = {"acq_time": pl.Utf8, "confidence": pl.Utf8, "satellite": pl.Utf8, "type": pl.Int64,
             "acq_date": pl.Utf8, "latitude": pl.Float64, "longitude": pl.Float64, "scan": pl.Float64,
             "track": pl.Float64, "frp": pl.Float64, "daynight": pl.Utf8}
    df = pl.read_csv(path, columns=have, schema_overrides={c: t for c, t in types.items() if c in have})

    # Keep vegetation fires only (type 0). Volcanoes, factories and offshore gas flares are other types
    # A file with no type column has no way to tell, so all its rows are kept
    if "type" in df.columns:
        df = df.filter(pl.col("type").is_null() | (pl.col("type") == 0))

    # MODIS gives confidence as a number, so keep 30 and above, and read Terra or Aqua from each row
    if source == "modis":
        df = df.filter(pl.col("confidence").cast(pl.Int64, strict=False) >= 30)
        sat = pl.col("satellite").replace_strict({"Terra": 0, "T": 0, "Aqua": 1, "A": 1}, default=None)

    # VIIRS gives confidence as low, nominal or high, so drop low, and take the satellite from the file name
    else:
        df = df.filter(pl.col("confidence").is_in(["n", "h", "nominal", "high"]))
        sat = pl.lit(SAT_CODES["SNPP"] if source == "viirs-snpp" else SAT_CODES["NOAA20"])

    # Turn the time of day, like 0930, into hours in UTC
    t = pl.col("acq_time").str.zfill(4)
    utc = t.str.slice(0, 2).cast(pl.Float32) + t.str.slice(2, 2).cast(pl.Float32) / 60

    # Build the cleaned table
    # Local solar time is UTC plus longitude divided by 15
    # The grid square numbers are latitude and longitude divided by the square size, rounded down
    out = df.select(
        sat.cast(pl.UInt8).alias("sat"),
        pl.col("latitude").cast(pl.Float32).alias("lat"),
        pl.col("longitude").cast(pl.Float32).alias("lon"),
        pl.col("acq_date").str.to_date().alias("date"),
        t.cast(pl.Int16).alias("hhmm"),
        ((utc + pl.col("longitude") / 15) % 24).cast(pl.Float32).alias("lst"),
        (pl.col("daynight") == "D").alias("day"),
        pl.col("frp").cast(pl.Float32),
        pl.col("scan").cast(pl.Float32),
        pl.col("track").cast(pl.Float32),
        pl.col("confidence").alias("conf"),
        (pl.col("latitude") / CELL).floor().cast(pl.Int16).alias("cy"),
        (pl.col("longitude") / CELL).floor().cast(pl.Int16).alias("cx"),

    # Drop rows with an unknown satellite, and add the month as one number like 202009
    ).drop_nulls("sat").with_columns(
        (pl.col("date").dt.year().cast(pl.Int32) * 100 + pl.col("date").dt.month().cast(pl.Int32)).alias("ym"))
    return out


# Clean every CSV file in the given folders, skipping ones already done
def main(raw_dirs):
    files = sorted(f for d in raw_dirs for f in Path(d).glob("*.csv"))
    for i, f in enumerate(files):

        # Work out where this file's cleaned copy goes, and skip it if it is there and not older than the CSV
        # A CSV from recent.py grows as the year goes on, so a cleaned copy older than it is out of date
        source, year, *country = f.stem.split("_")
        dest = WORK / "hotspots" / "_".join(country) / f"{source}_{year}.parquet"
        if dest.exists() and dest.stat().st_mtime >= f.stat().st_mtime:
            continue

        # Clean the file and save it
        dest.parent.mkdir(parents=True, exist_ok=True)
        df = clean_file(f)
        df.write_parquet(dest, compression="zstd")
        print(f"[{i + 1}/{len(files)}] {f.name}: {df.height:,} hotspots", flush=True)
    print("clean done")


# Clean the folders named when the file is run
if __name__ == "__main__":
    main(sys.argv[1:])
