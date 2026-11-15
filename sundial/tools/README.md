# tools

- `export_static.py`: turns the team's precomputed record into static JSON in `data/`, so the site runs on GitHub Pages with no server.
  Run from the team repo with its venv active: `python /path/to/sundial/tools/export_static.py /path/to/sundial/data`
- `build_trends.js`: run after `export_static.py` (`node tools/build_trends.js` from the sundial folder). Fits the 2001 to 2025 fire trend on the glued and the harmonized record for every country (shared logic in `js/trend.js`) and writes `data/trends.json`, which colours the globe in the "What fire actually did" section. Re-run it whenever the series files change.
- `build_continuity.js`: run after `export_static.py` (`node tools/build_continuity.js`). Cross-calibrates NOAA-20 against Suomi NPP per country (logic in `js/continuity.js`) and writes `data/continuity.json`: the factor that carries the record once Suomi NPP is gone, with its error on held-out years.
- `validate_harmonizer.js`: `node tools/validate_harmonizer.js --write`. Fits the in-browser MODIS converter (`js/harmonize.js`) on 2012 to 2017 only, tests it on 2018 to 2019 and 2021 to 2025 against real Suomi NPP totals, and writes `data/harmonizer_check.json` (the per-country error shown on the harmonizer card). Re-run it whenever the series files change.
- `pipeline_fixes.patch`: two bugs found when running the pipeline on 65 countries (apply in the team repo with `patch -p1 < pipeline_fixes.patch`):
  1. `clean.py`: polars guessed `scan`/`track`/`frp` as integers from the first 100 rows and crashed on the first `1.9` (small countries). Types are now forced to float.
  2. `boundaries.py`: FIRMS and Natural Earth spell some countries differently (Russian_Federation/Russia, Lao_PDR/Laos, Cote_d_Ivoire/Ivory Coast, Republic_of_Congo, Tanzania), so those had no border. Mapping added.
