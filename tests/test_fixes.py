# TEST_FIXES.PY CHECKS THE BUGS FOUND AFTER THE WEBSITE WAS MERGED STAY FIXED
# RUN IT WITH python -m pytest -q

import importlib
import io
import os

import polars as pl
from fastapi.testclient import TestClient

from backend.main import app

# A pretend browser that talks to the app without starting a server
client = TestClient(app)

# 02_clean starts with a number, so it has to be loaded by name
clean = importlib.import_module("pipeline.02_clean")

# One MODIS row, written the way the FIRMS API writes it (no "type" column)
API_CSV = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight\n"
           "-30,-60,330,1.1,1.0,2026-01-02,0830,Terra,MODIS,80,6.1NRT,300,12.0,D\n")


# The hotspot download must hold rows, whatever the slashes in the file names look like
def test_hotspot_download_is_not_empty():
    r = client.get("/api/download/hotspots.csv", params={"area": "country:Argentina", "start": 202009, "end": 202009})
    d = pl.read_csv(io.StringIO(r.text))
    assert r.status_code == 200 and d.height > 1000


# A box with west bigger than east crosses 180 degrees, so it must not wrap the long way round over Argentina
def test_box_across_180_does_not_wrap_the_long_way():
    r = client.get("/api/series", params={"area": "bbox:170,-30,-170,-20"})
    assert r.status_code == 404


# A normal box still works
def test_ordinary_box_still_works():
    assert client.get("/api/series", params={"area": "bbox:-64,-30,-60,-26"}).status_code == 200


# Names that try to climb out of the data folder are refused
def test_data_route_refuses_path_tricks():
    for name in ("..%5Cbackend%5Cmain.py", "%2e%2e%5Cbackend%5Cmain.py", "..%2Fbackend%2Fmain.py", "a%5Cb.json"):
        assert client.get("/data/" + name).status_code == 404, name


# A file from the FIRMS API has no type column, and the cleaner must still read it
def test_clean_reads_a_file_without_a_type_column(tmp_path):
    p = tmp_path / "modis_2026_Argentina.csv"
    p.write_text(API_CSV)
    assert clean.clean_file(p).height == 1


# Rows of the wrong type are still dropped when the file has a type column
def test_clean_still_drops_non_vegetation_fires(tmp_path):
    p = tmp_path / "modis_2020_Argentina.csv"
    head, row = API_CSV.splitlines()
    p.write_text(head + ",type\n" + row + ",0\n" + row + ",2\n")
    assert clean.clean_file(p).height == 1


# A CSV that grows after it was cleaned is cleaned again, and an unchanged one is skipped
def test_clean_redoes_a_csv_that_grew(tmp_path, monkeypatch):
    monkeypatch.setattr(clean, "WORK", tmp_path / "work")
    raw = tmp_path / "raw"
    raw.mkdir()
    csv = raw / "modis_2026_Argentina.csv"
    csv.write_text(API_CSV)
    clean.main([str(raw)])
    out = tmp_path / "work" / "hotspots" / "Argentina" / "modis_2026.parquet"
    assert pl.read_parquet(out).height == 1

    # Nothing changed, so the cleaned file is left alone
    before = out.stat().st_mtime_ns
    clean.main([str(raw)])
    assert out.stat().st_mtime_ns == before

    # A new row arrives and the CSV is newer than the cleaned copy
    csv.write_text(API_CSV + API_CSV.splitlines()[1].replace("2026-01-02", "2026-01-03") + "\n")
    os.utime(csv, (out.stat().st_mtime + 10, out.stat().st_mtime + 10))
    clean.main([str(raw)])
    assert pl.read_parquet(out).height == 2
