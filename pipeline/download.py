# AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"""Download raw NASA data (terrain + textures) into pipeline/data/raw. Resumable, skips finished files."""

import sys
from pathlib import Path

import requests

RAW = Path(__file__).parent / "data" / "raw"
PDS = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar"
PGDA = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp"
SVS_MOON = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720"
SVS_STARS = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851"
EO = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images"

FILES = {
    # Polar LOLA grids (PDS): 40 m near field for 80-90 S, 240 m far field for 60-90 S (covers Chandrayaan-3).
    "pds/ldem_80s_40m.lbl": f"{PDS}/img/ldem_80s_40m.lbl",
    "pds/ldem_80s_40m.img": f"{PDS}/img/ldem_80s_40m.img",
    "pds/ldem_60s_240m_float.lbl": f"{PDS}/float_img/ldem_60s_240m_float.lbl",
    "pds/ldem_60s_240m_float.img": f"{PDS}/float_img/ldem_60s_240m_float.img",
    # NASA SVS CGI Moon Kit: globe colour + displacement.
    "svs/lroc_color_poles_8k.tif": f"{SVS_MOON}/lroc_color_poles_8k.tif",
    "svs/ldem_16_uint.tif": f"{SVS_MOON}/ldem_16_uint.tif",
    # NASA SVS Deep Star Maps 2020 (celestial equirectangular).
    "svs/starmap_2020_4k.exr": f"{SVS_STARS}/starmap_2020_4k.exr",
    # Earth: Blue Marble NG (November) + Black Marble night lights.
    "earth/world.topo.bathy.200411.3x5400x2700.jpg":
        f"{EO}/bmng/bmng-topography-bathymetry/november/world.topo.bathy.200411.3x5400x2700.jpg",
    "earth/dnb_land_ocean_ice.2012.3600x1800.jpg":
        f"{EO}/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg",
}
# PGDA 5 m/pixel site DEMs (3D terrain detail near curated sites).
for site in ("Haworth", "DM2", "Site06", "Site23", "Site11", "Site01", "Site04"):
    FILES[f"pgda/{site}_5mpp_surf.tif"] = f"{PGDA}/{site}/{site}_final_adj_5mpp_surf.tif"


def fetch(rel: str, url: str) -> None:
    dest = RAW / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = int(requests.head(url, allow_redirects=True, timeout=60).headers.get("content-length", 0))
    have = dest.stat().st_size if dest.exists() else 0
    if total and have == total:
        print(f"ok   {rel}", flush=True)
        return
    headers = {"Range": f"bytes={have}-"} if have else {}
    with requests.get(url, headers=headers, stream=True, timeout=120) as r:
        r.raise_for_status()
        mode = "ab" if r.status_code == 206 else "wb"
        with open(dest, mode) as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"done {rel} ({dest.stat().st_size / 1e6:.0f} MB)", flush=True)


if __name__ == "__main__":
    only = sys.argv[1:]
    for rel, url in FILES.items():
        if only and not any(o in rel for o in only):
            continue
        try:
            fetch(rel, url)
        except Exception as e:  # keep going; rerun to resume
            print(f"FAIL {rel}: {e}", flush=True)
