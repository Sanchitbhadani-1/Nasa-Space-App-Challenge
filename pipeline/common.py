# COMMON.PY HOLDS THE SETTINGS EVERY PIPELINE STEP SHARES
# FOLDERS, GRID SIZE, SATELLITE CODES, KEY DATES AND WHERE NASA'S FILES LIVE

from pathlib import Path


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
