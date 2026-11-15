"""NASA candidate landing regions (Artemis IV, the crewed south-pole landing) -> web/public/data/sites.json

NASA's nine candidate regions (Oct 2024) have published names and a map image, not coordinates,
and the landing sites inside them are not chosen yet. So a region carries no point: it is anchored
to the IAU feature it is named after (USGS Gazetteer of Planetary Nomenclature) and gets a terrain
*area* around that feature (pipeline/build_terrain.py). Points inside the area are analysed only
where the user picks them.
"""

import json
from pathlib import Path

import shapefile

from dem import RAW

OUT = Path(__file__).parents[1] / "web" / "public" / "data"
OBS_H = 2.0  # metres: solar panel / antenna height above ground

# NASA, "NASA Provides Update on Artemis III Moon Landing Regions" (Oct 2024) -> IAU namesake feature.
# NASA later made Artemis III a 2027 low-Earth-orbit test and Artemis IV (early 2028) the crewed
# south-pole landing; its mission page keeps the same nine candidate regions.
REGIONS = [
    ("Peak near Cabeus B", "Cabeus B"), ("Haworth", "Haworth"), ("Malapert Massif", "Mons Malapert"),
    ("Mons Mouton Plateau", "Mons Mouton"), ("Mons Mouton", "Mons Mouton"), ("Nobile Rim 1", "Nobile"),
    ("Nobile Rim 2", "Nobile"), ("de Gerlache Rim 2", "de Gerlache"), ("Slater Plain", "Slater"),
]
NASA_REGIONS_URL = "https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/"
SKYLINE_REACH_KM = 200  # terrain beyond the area so any picked point sees 200 km of horizon


def slug(s: str) -> str:
    return s.lower().replace(" ", "-")


def area_half_km(diameter_km: float) -> float:
    """Half-width of the terrain area: the whole feature plus its rim and surroundings."""
    return round(min(100.0, max(25.0, diameter_km / 2 * 1.25 + 10)), 1)


def regions():
    r = shapefile.Reader(str(next((RAW / "sources" / "nomen").glob("*.shp"))))
    names = [f[0] for f in r.fields[1:]]
    feats = {d["clean_name"]: d for d in (dict(zip(names, rec)) for rec in r.records())}
    out = []
    for region, feature in REGIONS:
        f = feats[feature]
        half = area_half_km(f["diameter"])
        out.append({"id": slug(region), "name": region, "feature": feature,
                    "featureLat": round(f["center_lat"], 4), "featureLon": round((f["center_lon"] + 180) % 360 - 180, 4),
                    "featureDiameterKm": round(f["diameter"], 1), "featureType": f["type"],
                    "featureUrl": f["link"].replace("http://", "https://"),
                    "terrainId": slug(feature), "areaHalfKm": half, "farHalfKm": half + SKYLINE_REACH_KM,
                    "source": "NASA candidate region for the crewed south-pole landing (Artemis IV; announced Oct 2024 for Artemis III); anchored to its IAU namesake feature",
                    "sourceUrl": NASA_REGIONS_URL})
    return out


def main():
    meta = {"observerHeightM": OBS_H, "regions": regions()}
    (OUT / "sites.json").write_text(json.dumps(meta, indent=1))
    for old in (OUT / "skylines").glob("*.bin"):
        old.unlink()
    for r in meta["regions"]:
        print(f"{r['name']:20s} -> {r['feature']:14s} {r['featureLat']:8.3f} {r['featureLon']:9.3f}  "
              f"D={r['featureDiameterKm']:5.1f} km  area +/-{r['areaHalfKm']} km  terrain {r['terrainId']}")


if __name__ == "__main__":
    main()
