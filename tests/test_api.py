# TEST_API.PY CHECKS THAT THE API ANSWERS AND THAT ITS NUMBERS AGREE WITH EACH OTHER
# RUN IT WITH python -m pytest -q

import io

import polars as pl
from fastapi.testclient import TestClient

from backend.main import app

# A pretend browser that talks to the API without starting a server
client = TestClient(app)


# Check that the API lists its months and includes Argentina
def test_meta():
    m = client.get("/api/meta").json()
    assert m["first_month"] <= 200101 and m["last_month"] >= 202412
    assert any(c["id"] == "Argentina" for c in m["countries"])


# Check a country series, its uncertainty band, which sensor each month uses, and a drawn shape
def test_series_country_state_and_drawn_area():
    s = client.get("/api/series", params={"area": "country:Argentina"}).json()
    assert len(s["months"]) == len(s["harm"]) == len(s["z"])
    assert all(lo <= h <= hi for lo, h, hi in zip(s["lo"], s["harm"], s["hi"]))

    # In the VIIRS years the harmonized count is the VIIRS count itself
    i = s["months"].index(202009)
    assert s["source"][i] == "snpp" and s["harm"][i] == s["S"][i]
    assert s["source"][s["months"].index(200909)] == "modis"

    # A drawn shape in northern Argentina returns fires
    st = client.get("/api/series", params={"area": "poly:-64 -30;-60 -30;-60 -26;-64 -26"})
    assert st.status_code == 200 and st.json()["summary"]["total"] > 0


# Check that a badly written area gives 400, and a patch of open ocean with no data gives 404
def test_bad_areas():
    assert client.get("/api/series", params={"area": "nonsense"}).status_code == 400
    assert client.get("/api/series", params={"area": "bbox:0,0,1,1"}).status_code == 404


# Check that the hotspot weights add up to the harmonized monthly count
def test_hotspot_weights_add_up_to_harmonized_count():
    s = client.get("/api/series", params={"area": "country:Argentina"}).json()

    # Try one MODIS month and one VIIRS month
    for ym in (200905, 202009):
        r = client.get("/api/download/hotspots.csv", params={"area": "country:Argentina", "start": ym, "end": ym})
        assert r.status_code == 200
        d = pl.read_csv(io.StringIO(r.text))
        total = d.filter(pl.col("in_harmonized_record"))["viirs_equiv_weight"].sum()
        assert abs(total - s["harm"][s["months"].index(ym)]) < 1.0


# Check the monthly CSV, the globe, the anomaly map and the scoreboard
def test_monthly_csv_and_maps():
    r = client.get("/api/download/monthly.csv", params={"area": "country:Brazil"})
    assert r.status_code == 200 and r.text.startswith("area,month,harmonized_fires_viirs_equiv")
    assert len(client.get("/api/globe", params={"ym": 202009}).json()["cells"]) > 100
    assert len(client.get("/api/anomaly-map", params={"ym": 202009}).json()["states"]) > 100
    assert len(client.get("/api/scoreboard").json()["rows"]) >= 12
