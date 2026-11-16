"""A five-second baseline for forecast_features.csv. Replace the model with your own and compare.

    pip install pandas scikit-learn
    python train_baseline.py [path/to/forecast_features.csv]

It predicts next month's harmonized fire count (in log1p space, so a big country does not drown out the small ones) and
prints the error on the validation years (2020 to 2022) and on the test years (2023 on) next to two honest baselines:
repeating last month, and repeating the same month last year. Beat those before you believe a fancier model.
"""
import sys
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

path = sys.argv[1] if len(sys.argv) > 1 else "forecast_features.csv"
df = pd.read_csv(path)
df["tier"] = df["tier"].astype("category").cat.codes
features = [c for c in df.columns if c not in ("country", "ym", "split", "y", "y_log1p")]
train, valid, test = (df[df.split == s] for s in ("train", "valid", "test"))

t0 = time.time()
model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06, random_state=0)
model.fit(train[features], train["y_log1p"])
print(f"trained on {len(train):,} rows in {time.time() - t0:.1f} s\n")


def mae(pred, part):
    return float(np.mean(np.abs(pred - part["y_log1p"])))


print(f"{'mean absolute error, log1p fires':36s}{'valid':>8s}{'test':>8s}")
for name, f in [("repeat last month", lambda p: np.log1p(p["lag1"])),
                ("repeat same month last year", lambda p: np.log1p(p["lag12"])),
                ("gradient boosting (this script)", lambda p: model.predict(p[features]))]:
    print(f"{name:36s}{mae(f(valid), valid):8.3f}{mae(f(test), test):8.3f}")
print("\nA gap of 0.1 in log1p space is about 10% in the fire count.")
