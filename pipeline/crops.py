"""Regional terrain windows read straight from NASA servers (HTTP range requests via GDAL /vsicurl/),
cached locally, so a site gets full-resolution data without downloading whole 1-2 GB products.

  SLDEM2015 (LOLA + SELENE TC, 512 ppd ~59 m, 60S-60N; PGDA product 54) for non-polar sites
  PDS LOLA LDEM_60S_60M (60 m, polar stereographic, 60-90S) for southern high latitudes
"""

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

from dem import EQUIRECT_CROP, POLAR, R_MOON_M, Tier, latlon_to_xy

CACHE = Path(__file__).parent / "data" / "raw" / "crops"
SLDEM = "/vsicurl/http://imbrium.mit.edu/DATA/SLDEM2015/TILES/FLOAT_IMG/SLDEM2015_512_{tile}_FLOAT.LBL"
PDS60 = "/vsicurl/https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_60s_60m.lbl"
M_PER_DEG = R_MOON_M * math.pi / 180


def _cached(name: str, fetch) -> Tier:
    CACHE.mkdir(parents=True, exist_ok=True)
    npy, meta = CACHE / f"{name}.npy", CACHE / f"{name}.json"
    if not npy.exists():
        arr, m = fetch()
        np.save(npy, arr)
        meta.write_text(json.dumps(m))
    m = json.loads(meta.read_text())
    return Tier(name, m["kind"], np.load(npy, mmap_mode="r"), m["x0"], m["y0"], m["res"], m["scale"], 0.0)


def sldem_crop(name: str, tile: str, lat: float, lon: float, half_deg: float) -> Tier:
    """Window of an SLDEM2015 tile around (lat, lon). Tile e.g. '00N_30N_000_045' (lon 0-360)."""
    def fetch():
        with rasterio.open(SLDEM.format(tile=tile)) as ds:
            t = ds.transform  # metres, simple cylindrical centred on 180 E
            lon360 = lon % 360
            half_lon = half_deg / max(math.cos(math.radians(lat)), 0.2)
            c0 = int((((lon360 - half_lon) - 180) * M_PER_DEG - t.c) / t.a)
            c1 = int((((lon360 + half_lon) - 180) * M_PER_DEG - t.c) / t.a)
            r0 = int((t.f - (lat + half_deg) * M_PER_DEG) / -t.e)
            r1 = int((t.f - (lat - half_deg) * M_PER_DEG) / -t.e)
            c0, r0 = max(c0, 0), max(r0, 0)
            c1, r1 = min(c1, ds.width), min(r1, ds.height)
            arr = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0)).astype(np.float32) * 1000.0  # km -> m
            res = t.a / M_PER_DEG
            x0 = 180 + (t.c + (c0 + 0.5) * t.a) / M_PER_DEG
            x0 = (x0 + 180) % 360 - 180  # crop longitudes in [-180, 180)
            y0 = (t.f + (r0 + 0.5) * t.e) / M_PER_DEG
            return arr, {"kind": EQUIRECT_CROP, "x0": x0, "y0": y0, "res": res, "scale": 1.0,
                         "source": f"SLDEM2015 tile {tile}"}
    return _cached(name, fetch)


def pds60_crop(name: str, lat: float, lon: float, half_m: float) -> Tier:
    """Window of PDS LOLA LDEM_60S_60M (int16 half-metres) around (lat, lon)."""
    def fetch():
        x, y = latlon_to_xy(lat, lon)
        with rasterio.open(PDS60) as ds:
            t = ds.transform
            c0, c1 = int((x - half_m - t.c) / t.a), int((x + half_m - t.c) / t.a)
            r0, r1 = int((t.f - (y + half_m)) / -t.e), int((t.f - (y - half_m)) / -t.e)
            arr = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
            return arr, {"kind": POLAR, "x0": t.c + (c0 + 0.5) * t.a, "y0": t.f + (r0 + 0.5) * t.e, "res": t.a,
                         "scale": 0.5, "source": "PDS LOLA LDEM_60S_60M"}
    return _cached(name, fetch)
