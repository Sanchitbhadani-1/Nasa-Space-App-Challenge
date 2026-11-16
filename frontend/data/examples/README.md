# Example datasets for training your own models

Six small CSV files cut from the SUNDIAL harmonized fire record, so you can try a model in minutes instead of rebuilding
25 years of NASA FIRMS detections first. They are rebuilt from the site's own data with a short standard-library Python script, so the same inputs always give the same bytes.

Fire counts come from NASA FIRMS (MODIS Terra and Aqua, VIIRS Suomi NPP and NOAA-20), corrected by the SUNDIAL pipeline
into **VIIRS-equivalent detections per month**. The files are historical observations, not live alerts.
Cite NASA FIRMS for the underlying detections.

| File | Rows | What a row is | Good for |
|---|---|---|---|
| `country_month_panel.csv` | ~55k | one country in one month | time series, anomaly detection, trend models |
| `forecast_features.csv` | ~53k | one country-month with lag features, already split into train/valid/test | tabular regression, trains in seconds |
| `harmonizer_pairs.csv` | ~29k | one country-month since 2012 with MODIS counts, pass times and the VIIRS count | learning a better MODIS to VIIRS harmonizer |
| `grid_seasonal.csv` | ~36k | one 0.5 degree cell: twelve monthly means | spatial models, clustering fire regimes |
| `daily_curves.csv` | ~15k | detections in one local half-hour for one country and satellite | learning the daily fire rhythm |
| `country_scorecard.csv` | 182 | one country: calibration, held-out checks, trend | predicting where the correction works |

`manifest.json` lists the same files with their sizes and columns; the website reads it.

## Try it in five seconds

```python
import pandas as pd
base = "https://YOUR-SITE/data/examples/"    # this site's address, then /data/examples/
df = pd.read_csv(base + "forecast_features.csv")
print(df.groupby("split").size())
```

`python train_baseline.py` (next to these files; needs `pandas` and `scikit-learn`) trains gradient boosting on
`forecast_features.csv`. On our run it trained on 39,676 rows in about 3 seconds and reached a mean absolute error of
0.54 in log1p space on the 2023 to 2025 test months, against 0.88 for "repeat last month" and 0.71 for "repeat the same
month last year". Treat that as the bar to beat, not a result to publish: it is one run on one machine.

## Columns

### `country_month_panel.csv`
`country, ym, year, month` identify the row (`ym` is `YYYYMM`).
`harmonized` is the fair record in VIIRS-equivalent fires per month, with `lower_95` and `upper_95` its supplied band and
`anomaly_z` how unusual the month is against the same month in other years. `source` is the camera that carries the
month: `modis` before 2012, `snpp` (Suomi NPP) after. `glued` is the uncorrected splice of the two cameras, the thing we
argue against. `terra_n, aqua_n, suomi_npp_n, noaa20_n` are raw detection counts. `terra_raw_viirs_units` and
`terra_corrected_viirs_units` are Terra alone, before and after the drift correction. `frp_total` is fire radiative power.
Blank means missing, never zero.

### `forecast_features.csv`
Target `y` (and `y_log1p`) is the month's `harmonized` count. Features use only earlier months: `lag1, lag2, lag3, lag6,
lag12`, `mean3` and `mean12` rolling means, and `same_month_before`, the average of that calendar month in earlier years.
`month_sin, month_cos` encode the season, `viirs_era` is 1 once VIIRS carries the record, `lat, lon` are the country
centroid and `tier` is how the country was calibrated. `split` is time-ordered: `train` to 2019-12, `valid` 2020-01 to
2022-12, `test` from 2023-01. Rows need at least 10 months of history, so each country starts a year after its record does.
Do not shuffle across the splits: neighbouring months are strongly related.

### `harmonizer_pairs.csv`
Target `suomi_npp_n`, what the stable VIIRS camera counted. Inputs: `terra_n`, `aqua_n`, their mean daytime local pass times
over that country, `terra_pass_h` and `aqua_pass_h` (they drift after 2020), `month`, `lat`, `lon`. `noaa20_n` is a second VIIRS
for cross-checks. Counts here are raw, not harmonized.

### `grid_seasonal.csv`
`lon, lat` of the cell centre, `jan` to `dec` mean harmonized detections per month over 2012 to 2025, `annual_mean`, and
`peak_month` (1 to 12). Cells whose busiest month averages under four detections are not in the file.

### `daily_curves.csv`
`country, satellite` (`terra`, `aqua`, `suomi_npp`, `noaa20`), `period` (`2012-2019` before the drift, `2022-2025` after),
`local_hour` (start of a local solar half-hour, 0 to 23.5) and `detections`. Terra and Aqua moved to new local times
after 2020, which is what makes the daily rhythm measurable. Suomi NPP stayed near 13:30.

### `country_scorecard.csv`
`tier` (`measured`, `blended`, `borrowed`) and `calib_n` say how much data backs the calibration. `b_terra, b_aqua_swath,
b_adj, b_adj_se` are the swath-trick slopes. `holdout_median_abs_err_pct` is the error on years hidden from the fit.
`terra_drift_gap_closed_pct` is the share of Terra's false trend the correction removed (above 0 helped, below 0 hurt).
`glued_trend_pct_per_year` and `fair_trend_pct_per_year` are the straight-line yearly trends on the two records, and
`trend_kind` is how they relate (`flip`, `phantom`, `hidden`, `overstated`, `agree`).

## Things to know before you train

- The harmonized count is a model output with an uncertainty band, not a ground-truth fire census. Small countries are
  noisier (look at `tier`). Counts are detections, not area burned.
- Months before 2012 rest on MODIS alone; from 2012 the record is VIIRS itself. `viirs_era` lets a model see that break.
- `harmonizer_pairs.csv` is the same data the pipeline's calibration was fitted on, so it is not a held-out check of the
  pipeline. Use the time split or hold out whole countries to measure a new harmonizer honestly.
- Tiny countries with almost no fire have many zeros; use `y_log1p` or a count loss.
