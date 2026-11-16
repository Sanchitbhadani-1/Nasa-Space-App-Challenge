# NASA Space Apps Challenge: one fair fire record (SUNDIAL)

NASA's MODIS (Terra, Aqua) and VIIRS (Suomi NPP, NOAA-20) satellites count fires differently depending on the camera
and on the time of day each one looks. This repo rebuilds 25 years of NASA FIRMS fire detections into one record that
can be compared year to year, serves it through an API, and shows it on a website.

## Layout

| Folder | What it is |
|---|---|
| `pipeline/` | The Python pipeline. Five steps (`01_download` to `05_build`) plus `recent.py` for months newer than NASA's yearly files. |
| `data/` | What the pipeline writes and the API reads: borders, calibration, harmonized record, daily curves, grid. |
| `backend/` | The FastAPI app (`backend/main.py`). Serves `/api/...`, a few map files from `data/`, and the website at `/`. |
| `frontend/` | The website (HTML, JS, JSON). Static, so it also runs on any static host with no server. Has its own data in `frontend/data/`. |
| `tests/` | `pytest` tests for the API, the website being served, and FIRMS boxes that cross the 180 degree line. `tests/js/` holds the Node tests for the regional explorer. |
| `AI_USE.md` | Where and how AI tools were used, as the Space Apps rules require. |
| `Dockerfile`, `render.yaml` | Optional: deploy the API plus website as one web service (for example on Render). |
| `run_pipeline.sh` | Runs the five pipeline steps for the countries you name. |

`data/` and `frontend/data/` are different things. `data/` is the pipeline's output for the countries you ran it on
(currently 12 borders). `frontend/data/` is the website's export: monthly series, borders and daily curves for the
182 countries it shows. When the app serves `/data/<file>`, the website's own copy wins; files it does not ship
(`states.geojson`, `land.geojson`, `basemap_*.geojson`) still come from `data/`.

## Run it

```bash
pip install -r requirements.txt
./run_pipeline.sh Argentina Brazil          # FIRMS spellings, spaces as _
uvicorn backend.main:app --reload           # website at http://localhost:8000, API under /api
```

The website alone, with no Python:

```bash
cd frontend && python -m http.server 8000
```

Months newer than NASA's yearly files (needs a free FIRMS map key; not yet tried against the live API):

```bash
export FIRMS_MAP_KEY=xxxxxxxx
python -m pipeline.recent 2026-01-01 2026-11-12 Argentina
```

`pipeline/recent.py` splits countries that cross the 180 degree line (Russia, Fiji, New Zealand, the US) into two API
boxes instead of one box as wide as the planet.

## Rebuild the website's files

The three derived files reproduce exactly from the series files:

```bash
cd frontend
node tools/build_trends.js
node tools/build_continuity.js
node tools/validate_harmonizer.js --write
```

`frontend/tools/export_static.py` writes the website's series, climatology and metadata from `backend/main.py`. It only
writes the countries that `data/` holds, so the committed 182-country files came from a full pipeline run.

## Example datasets

`frontend/data/examples/` holds six small CSVs cut from the harmonized record (a country-month panel, a ready-made next-month
forecast table, MODIS-to-VIIRS pairs, a seasonal world grid, daily curves and a country scorecard), plus a column guide and a
five-second baseline: `python frontend/data/examples/train_baseline.py`. The website lists them under "Use it". Rebuild them
with `python frontend/tools/build_examples.py` (standard library only, identical bytes every run; `tests/test_examples.py`
checks that, and that the forecast features never use the future).

## Regional fire-season explorer

On any country sheet, draw a rectangle on the map or type coordinates to see that area's typical burning months from the
published 0.5 degree grid. Share links keep the box: `#place=Angola&m=202512&box=12,-12,20,-6`. `GET /api/region?bbox=w,s,e,n`
validates the box and says plainly that per-box monthly history is not loaded yet; the page then shows the seasonal average
only and never estimates a region from country totals.

## Tests

```bash
python -m pytest -q
node --test tests/js/*.cjs
```

Data from NASA FIRMS. Not affiliated with or endorsed by NASA. AI helped write parts of the code; the analysis and the
sources are checked by the team.
