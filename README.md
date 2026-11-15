# NASA Space Apps Challenge: one fair fire record (SUNDIAL)

NASA's MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20) satellites count fires differently depending on the camera
and on the time of day each one looks. This repo rebuilds 25 years of NASA FIRMS fire detections into one record that
can be compared year to year, and shows it on a website.

## Layout

| Folder | What it is |
|---|---|
| `pipeline/` | The Python pipeline. Five steps (`01_download` to `05_build`) plus `recent.py` for months newer than NASA's yearly files. |
| `data/` | What the pipeline writes and the code reads: borders, calibration, harmonized record, daily curves, grid. |
| `sundial/` | The static website (HTML, JS, JSON), runs on any static host with no server. Has its own data in `sundial/data/`. |
| `tests/` | `pytest` tests (FIRMS boxes that cross the 180 degree line). |
| `run_pipeline.sh` | Runs the five pipeline steps for the countries you name. |

`data/` and `sundial/data/` are different things. `data/` is the pipeline's output for the countries you ran it on
(currently 12 borders). `sundial/data/` is the site's export: monthly series, borders and daily curves for the
182 countries the site shows.

## Run the pipeline

```bash
pip install -r requirements.txt
./run_pipeline.sh Argentina Brazil          # FIRMS spellings, spaces as _
export FIRMS_MAP_KEY=xxxxxxxx               # only for months newer than the yearly files
python -m pipeline.recent 2026-01-01 2026-11-12 Argentina
```

`pipeline/recent.py` splits countries that cross the 180 degree line (Russia, Fiji, New Zealand, the US) into two API
boxes. It has not been run against the live API with a real key yet.

## Run the website

```bash
cd sundial && python -m http.server 8000     # then open http://localhost:8000
```

Rebuild the site's derived files (they reproduce exactly from the series files):

```bash
cd sundial
node tools/build_trends.js
node tools/build_continuity.js
node tools/validate_harmonizer.js --write
```

`sundial/tools/export_static.py` produces the site's series from the pipeline's backend module. `backend/main.py` is
not in this repo yet, so that script stops with a message until it is added.

## Tests

```bash
pytest
```

Data from NASA FIRMS. Not affiliated with or endorsed by NASA. AI helped write parts of the code; the analysis and the
sources are checked by the team.
