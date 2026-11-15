# TEST_FRONTEND.PY CHECKS THAT THE API SERVES THE WEBSITE AND THAT THE WEBSITE'S OWN DATA FILES WIN
# RUN IT WITH python -m pytest -q

from fastapi.testclient import TestClient

from backend.main import app

# A pretend browser that talks to the app without starting a server
client = TestClient(app)


# The website is served at the main address
def test_home_page_is_the_website():
    r = client.get("/")
    assert r.status_code == 200 and "SUNDIAL" in r.text


# The website asks for data/meta.json, which is its own 182 country file, not the pipeline's
def test_site_meta_is_the_websites_own():
    m = client.get("/data/meta.json").json()
    assert len(m["countries"]) == 182 and "centroid" in m["countries"][0]


# The same goes for the borders: all 182 countries, not just the ones the pipeline was run on
def test_site_borders_cover_every_country():
    assert len(client.get("/data/countries.geojson").json()["features"]) >= 182


# Files the website does not ship still come from the pipeline's data/ folder
def test_pipeline_map_files_still_served():
    assert client.get("/data/states.geojson").status_code == 200
    assert client.get("/data/calibration.json").status_code == 404   # not on the allowed list


# Country files in subfolders are served by the website itself
def test_series_files_are_served():
    assert client.get("/data/series/Argentina.json").status_code == 200
