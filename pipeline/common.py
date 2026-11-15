# COMMON.PY HOLDS THE SETTINGS EVERY PIPELINE STEP SHARES
# FOLDERS, GRID SIZE, SATELLITE CODES, KEY DATES AND WHERE NASA'S FILES LIVE

from pathlib import Path
import numpy as np
from shapely import get_coordinates


# FOLDERS

# The project folder, one level above pipeline/
ROOT = Path(__file__).resolve().parents[1]

# Big in-between files, kept out of git because they can be rebuilt
WORK = ROOT / "work"

# Small files the app reads, kept in git so the app runs right away
DATA = ROOT / "data"


# GRID AND SATELLITES

# Size of one grid square in degrees
CELL = 0.25

# A small number for each satellite, so tables store a number instead of a name
SAT_CODES = {"Terra": 0, "Aqua": 1, "SNPP": 2, "NOAA20": 3}

# The same table turned around, from number back to name
SAT_NAMES = {v: k for k, v in SAT_CODES.items()}

# Local solar time in hours when each MODIS satellite crossed the equator by day, before the drift
NOMINAL_HOUR = {"Terra": 10.5, "Aqua": 13.5}


# KEY DATES

# Years when both MODIS and VIIRS were flying and nothing had drifted yet
CALIB_YEARS = (2012, 2019)

# First month with Aqua data. Before it, MODIS is Terra alone
AQUA_START = 200207

# First full month of Suomi NPP fire data
VIIRS_START = 201202

# The season each month belongs to
SEASONS = {12: "DJF", 1: "DJF", 2: "DJF", 3: "MAM", 4: "MAM", 5: "MAM",
           6: "JJA", 7: "JJA", 8: "JJA", 9: "SON", 10: "SON", 11: "SON"}


# NASA FIRMS ARCHIVE

# Each source name as it appears in the download link, with its first year of data
SOURCES = {"modis": 2000, "viirs-snpp": 2012, "viirs-jpss1": 2018}

# Start of every yearly country file link
FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"


# BOXES THAT CROSS THE 180 DEGREE LINE

# Boxes for a country as (west, south, east, north), split where the country crosses 180 degrees
# A shape's own .bounds is wrong for Russia, Fiji, New Zealand and the US: they have land on both sides of 180,
# so .bounds says west -180 and east 180, a box as wide as the whole planet. Asking FIRMS for that box
# downloads the whole northern hemisphere. Here the western longitudes are moved up by 360 to see
# whether the country is narrower that way. If it is, the box is cut into an east part and a west part.
def api_boxes(geom):
    xy = get_coordinates(geom)
    lon, lat = xy[:, 0], xy[:, 1]
    south, north = float(lat.min()), float(lat.max())
    plain = (float(lon.min()), south, float(lon.max()), north)

    # Longitudes with the western half moved to 180..360, so a country across 180 stays in one piece
    moved = np.where(lon < 0, lon + 360, lon)
    west, east = float(moved.min()), float(moved.max())

    # Keep the plain box unless the moved one is clearly narrower (the 1 degree margin ignores rounding noise)
    if east - west >= plain[2] - plain[0] - 1:
        return [plain]

    # The whole country is east of 180 after the move, so it fits in one box once moved back
    if west >= 180:
        return [(west - 360, south, east - 360, north)]

    # Otherwise one box up to 180 and one from -180
    return [(west, south, 180.0, north), (-180.0, south, east - 360, north)]
