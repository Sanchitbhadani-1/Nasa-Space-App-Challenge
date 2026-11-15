# TEST_BOXES.PY CHECKS THAT COUNTRIES ACROSS THE 180 DEGREE LINE GET SENSIBLE FIRMS BOXES
# RUN IT WITH pytest tests/test_boxes.py

import json
from shapely.geometry import shape
from pipeline import recent
from pipeline.common import ROOT, api_boxes

# Every country border the website draws (182 of them, including Russia, Fiji and New Zealand), by id
FEATURES = {f["properties"]["id"]: f
            for f in json.loads((ROOT / "sundial" / "data" / "countries.geojson").read_text())["features"]}
BORDERS = {k: shape(f["geometry"]) for k, f in FEATURES.items()}


# Russia, Fiji and New Zealand cross 180 degrees, so each must come back as two boxes that stay inside -180..180
def test_countries_across_180_are_split():
    for c in ("Russian_Federation", "Fiji", "New_Zealand", "United_States"):
        boxes = api_boxes(BORDERS[c])
        assert len(boxes) == 2, c
        for w, s, e, n in boxes:
            assert -180 <= w < e <= 180 and s < n, (c, boxes)

        # The two boxes meet at the 180 degree line
        assert max(b[2] for b in boxes) == 180 and min(b[0] for b in boxes) == -180


# Russia's two boxes must be far smaller than the old one, which spanned all 360 degrees
def test_russia_is_not_the_whole_planet():
    west_part, east_part = api_boxes(BORDERS["Russian_Federation"])
    assert west_part[0] < 25 and east_part[2] < -165
    assert (west_part[2] - west_part[0]) + (east_part[2] - east_part[0]) < 200


# Countries that do not cross 180 keep their plain box
def test_ordinary_countries_keep_one_box():
    for c in ("Brazil", "United_Kingdom", "Chile", "Angola"):
        boxes = api_boxes(BORDERS[c])
        assert len(boxes) == 1 and boxes[0] == tuple(BORDERS[c].bounds), c


# The fetch step asks the API once per box for each 10 day window
def test_recent_asks_for_every_box(monkeypatch, tmp_path):
    urls = []
    monkeypatch.setenv("FIRMS_MAP_KEY", "test")
    monkeypatch.setattr(recent, "get", lambda url: urls.append(url) or "latitude,longitude,acq_date\n")
    monkeypatch.setattr(recent, "WORK", tmp_path)

    # Give the fetch step a border file that holds Fiji
    (tmp_path / "countries.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [FEATURES["Fiji"]]}))
    monkeypatch.setattr(recent, "DATA", tmp_path)
    monkeypatch.setattr(recent.time, "sleep", lambda s: None)
    recent.main("2026-01-01", "2026-01-05", ["Fiji"])

    # One 5 day window, two boxes, two sources tried (nothing came back from the first), three file kinds
    assert len(urls) == 2 * 2 * 3
    assert len({u.split("/")[-3] for u in urls}) == 2
