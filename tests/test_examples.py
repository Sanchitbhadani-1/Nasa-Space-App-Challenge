# TEST_EXAMPLES.PY CHECKS THE EXAMPLE TRAINING DATASETS: THAT THEY MATCH THEIR MANIFEST, REPRODUCE EXACTLY, AND DO NOT LEAK THE FUTURE
# RUN IT WITH python -m pytest -q

import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EX = ROOT / "frontend" / "data" / "examples"


# Read one example CSV into a list of dicts
def rows(name):
    with open(EX / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# Check every file in the manifest exists and its row, column and byte counts are the real ones
def test_manifest_matches_files():
    m = json.loads((EX / "manifest.json").read_text())
    assert len(m["files"]) == 6
    for f in m["files"]:
        p = EX / f["file"]
        assert p.stat().st_size == f["bytes"]
        r = rows(f["file"])
        assert len(r) == f["rows"] and len(r[0]) == f["cols"]


# Check the forecast table only uses information from before the month it predicts
def test_forecast_features_do_not_leak():
    by = {}
    for r in rows("country_month_panel.csv"):
        by.setdefault(r["country"], {})[int(r["ym"])] = float(r["harmonized"]) if r["harmonized"] else None
    f = rows("forecast_features.csv")
    assert {r["split"] for r in f} == {"train", "valid", "test"}
    for r in f[::97]:                                    # a spread of rows is plenty
        ym, h = int(r["ym"]), by[r["country"]]
        t = (ym // 100) * 12 + ym % 100 - 1
        past = {(q // 100) * 12 + q % 100 - 1: v for q, v in h.items()}
        assert abs(float(r["lag1"]) - past[t - 1]) < 1e-3 and abs(float(r["lag12"]) - past[t - 12]) < 1e-3
        earlier = [v for q, v in h.items() if q % 100 == ym % 100 and q < ym and v is not None]
        assert abs(float(r["same_month_before"]) - sum(earlier) / len(earlier)) < 1e-2
    order = {"train": 0, "valid": 1, "test": 2}
    assert max(int(r["ym"]) for r in f if r["split"] == "train") <= 201912
    assert min(int(r["ym"]) for r in f if r["split"] == "test") >= 202301
    assert all(order[a["split"]] <= order[b["split"]] for a, b in zip(sorted(f, key=lambda r: int(r["ym"])), sorted(f, key=lambda r: int(r["ym"]))[1:]))


# Check the harmonizer pairs only hold months where both camera families fly, with a real VIIRS target
def test_harmonizer_pairs():
    r = rows("harmonizer_pairs.csv")
    assert min(int(x["ym"]) for x in r) >= 201201
    assert all(float(x["suomi_npp_n"]) >= 0 and float(x["terra_n"]) >= 0 for x in r)
    hours = sorted(float(x["terra_pass_h"]) for x in r if x["terra_pass_h"])
    assert all(0 < h < 24 for h in hours) and 9 < hours[len(hours) // 2] < 11.5      # Terra looks mid-morning; polar countries run later because swaths overlap there


# Check rebuilding the datasets gives byte-identical files (so the committed ones can be trusted)
def test_rebuild_is_deterministic():
    before = {p.name: hashlib.md5(p.read_bytes()).hexdigest() for p in EX.glob("*.csv")}
    subprocess.run([sys.executable, str(ROOT / "frontend" / "tools" / "build_examples.py")], check=True, capture_output=True)
    assert before == {p.name: hashlib.md5(p.read_bytes()).hexdigest() for p in EX.glob("*.csv")}
