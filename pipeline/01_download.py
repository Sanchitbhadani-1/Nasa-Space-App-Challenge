# DOWNLOAD.PY IS STEP 1. IT DOWNLOADS NASA FIRMS YEARLY FIRE FILES FOR EACH COUNTRY
# RUN IT WITH python -m pipeline.01_download Argentina Brazil United_States
# THE TEXT BELOW STAYS AS A DOCSTRING BECAUSE THE FILE PRINTS IT AS ITS HELP MESSAGE

"""Step 1: download NASA FIRMS yearly country archive files (standard-quality product).

Usage: python -m pipeline.01_download Argentina Brazil United_States ...
Output: work/raw/<source>_<year>_<Country>.csv   (country names as FIRMS spells them, spaces -> _)
"""
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pipeline.common import WORK, SOURCES, FIRMS_BASE

# The newest full year in NASA's yearly files. Newer months come from pipeline.recent
LAST_YEAR = 2025


# Download one file for one source, year and country, and say how it went
def fetch(job):
    source, year, country = job
    dest = WORK / "raw" / f"{source}_{year}_{country}.csv"

    # Skip files that are already downloaded
    if dest.exists() and dest.stat().st_size > 0:
        return f"skip {dest.name}"
    url = f"{FIRMS_BASE}/{source}/{year}/{source}_{year}_{country}.csv"

    # Try up to 3 times. Save to a .part file first so a broken download never looks finished
    for attempt in range(3):
        try:
            tmp = dest.with_suffix(".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.rename(dest)
            return f"ok   {dest.name}"
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(3)
    return f"FAIL {dest.name}: {err}"


# Download every source and year for each country, 4 files at a time
def main(countries):
    (WORK / "raw").mkdir(parents=True, exist_ok=True)

    # Make one job for each country, source and year
    jobs = [(s, y, c) for c in countries for s, first in SOURCES.items() for y in range(first, LAST_YEAR + 1)]

    # Run the jobs 4 at a time and print each result
    with ThreadPoolExecutor(4) as ex:
        for msg in ex.map(fetch, jobs):
            print(msg, flush=True)


# Print the help message if no country was given, otherwise download
if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
