# BOUNDARIES.PY IS STEP 3. IT DOWNLOADS NATURAL EARTH BORDERS AND KEEPS THE COUNTRIES WE HAVE FIRE DATA FOR
# RUN IT WITH python -m pipeline.03_boundaries
# IT WRITES data/countries.geojson, data/states.geojson, data/land.geojson AND THE MAP'S BACKGROUND FILES

import json
import urllib.request
from pathlib import Path
from shapely.geometry import shape, mapping
from pipeline.common import WORK, DATA

# Where Natural Earth's map files live online
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"

# The Natural Earth files we use for states, countries, coarse land and finer land
FILES = {"admin1": "ne_10m_admin_1_states_provinces.geojson",
         "admin0": "ne_50m_admin_0_countries.geojson",
         "land": "ne_110m_land.geojson",
         "land50": "ne_50m_land.geojson"}

# Countries that NASA's file names and Natural Earth spell differently, from the NASA name to the Natural Earth name
NE_NAME = {"United_States": "United States of America", "Cote_d_Ivoire": "Ivory Coast", "Lao_PDR": "Laos",
           "Russian_Federation": "Russia", "Republic_of_Congo": "Republic of the Congo",
           "Tanzania": "United Republic of Tanzania", "Democratic_Republic_of_the_Congo": "Democratic Republic of the Congo",
           "Brunei_Darussalam": "Brunei", "Hong_Kong": "Hong Kong S.A.R.", "Bahamas": "The Bahamas", "Serbia": "Republic of Serbia",
           "Macedonia_Former_Yugoslav_Republic_of": "North Macedonia", "Dem_Rep_Korea": "North Korea", "Republic_of_Korea": "South Korea",
           "Sao_Tome_and_Principe": "São Tomé and Principe", "Cape_Verde": "Cabo Verde", "The_Gambia": "Gambia", "Swaziland": "eSwatini",
           "Czech_Republic": "Czechia", "Timor-Leste": "East Timor", "Wallis_and_Futuna_Islands": "Wallis and Futuna",
           "Heard_I_and_McDonald_Islands": "Heard Island and McDonald Islands", "Saint-Martin": "Saint Martin",
           "Saint-Barthelemy": "Saint Barthelemy", "Aland_Islands": "Aland"}

# Shorter names the app shows, so it says "Russia" and not "Russian Federation"
DISPLAY = {"United States of America": "United States", "United Republic of Tanzania": "Tanzania", "Ivory Coast": "Côte d'Ivoire"}


# Load one Natural Earth file, downloading it first if it isn't saved yet
def fetch(key):
    dest = WORK / "ne" / FILES[key]
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        print("downloading", FILES[key], flush=True)
        urllib.request.urlretrieve(NE + FILES[key], dest)
    return json.loads(dest.read_text())


# Simplify a shape and round its points to 3 decimal places, so the files stay small
def rounded(geom, tol):
    g = shape(geom).simplify(tol, preserve_topology=True)
    m = mapping(g)

    # Round every point, going down through the nested lists of points
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 3), round(c[1], 3)]
    return {"type": m["type"], "coordinates": rnd(m["coordinates"])}


# List the countries that have a cleaned fire folder in work/hotspots
def countries_in_data():
    return sorted(p.name for p in (WORK / "hotspots").iterdir() if p.is_dir())


# Write the country, state, land and background map files
def main():

    # Match each country we have fire data for to its Natural Earth name
    have = countries_in_data()
    wanted = {NE_NAME.get(c, c.replace("_", " ")): c for c in have}

    # COUNTRIES

    # Keep the borders of the countries we have data for
    a0 = fetch("admin0")
    feats = []
    for f in a0["features"]:
        name = f["properties"]["ADMIN"]
        if name in wanted:
            feats.append({"type": "Feature", "geometry": rounded(f["geometry"], 0.03),
                          "properties": {"id": wanted[name], "name": DISPLAY.get(name, name)}})

    # Warn about countries with no border found
    missing = set(wanted) - {NE_NAME.get(f["properties"]["id"], f["properties"]["id"].replace("_", " ")) for f in feats}
    if missing:
        print("WARNING: no border found for", missing)
    DATA.mkdir(exist_ok=True)
    (DATA / "countries.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))

    # STATES AND PROVINCES

    # Keep the states and provinces inside those countries
    a1 = fetch("admin1")
    sfeats = []
    for f in a1["features"]:
        p = f["properties"]
        if p.get("admin") in wanted and f["geometry"]:
            sfeats.append({"type": "Feature", "geometry": rounded(f["geometry"], 0.02),
                           "properties": {"id": p["adm1_code"], "name": p["name"] or p["adm1_code"],
                                          "country": wanted[p["admin"]]}})
    (DATA / "states.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": sfeats}))

    # LAND AND BACKGROUND MAP

    # Save the coarse land shapes, which keep the 3D globe light
    land = fetch("land")
    (DATA / "land.geojson").write_text(json.dumps(land))

    # Save finer land and every country border for the 2D map's background
    # This draws the map without map tiles, so it needs no API key and works offline
    l50 = fetch("land50")
    (DATA / "basemap_land.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": rounded(f["geometry"], 0.02)} for f in l50["features"]]}))
    (DATA / "basemap_borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": f["properties"]["ADMIN"]}, "geometry": rounded(f["geometry"], 0.04)}
        for f in a0["features"]]}))
    print(f"countries {len(feats)}, states {len(sfeats)}")


# Write the files when the file is run
if __name__ == "__main__":
    main()
