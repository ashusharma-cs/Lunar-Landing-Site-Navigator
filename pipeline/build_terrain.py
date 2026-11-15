"""Terrain areas for the Artemis III regions -> web/public/data/terrain/<feature>/{near,far}.bin + meta.json

One area per IAU namesake feature (regions sharing a feature share terrain), in a feature-centred
azimuthal-equidistant frame: x east, y north, metres along great circles from the feature centre.
  near: the area itself (feature + rim + surroundings), 2048^2, from LOLA 40 m / 240 m
  far:  the area plus 200 km on every side, so any point the user picks sees its full horizon
Heights are metres above the 1737.4 km sphere, stored uint16 between per-grid min/max.
Rows run south -> north (row 0 at y = -half), columns west -> east, matching WebGL texture v/u.
"""

import json
import math
import shutil
from pathlib import Path

import numba as nb
import numpy as np

import pack_data

from dem import R_MOON_M, load_pds_polar, load_svs_global
from skylines import _destination, _height, _pack

OUT = Path(__file__).parents[1] / "web" / "public" / "data" / "terrain"
SITES = Path(__file__).parents[1] / "web" / "public" / "data" / "sites.json"
N = 2048


@nb.njit(cache=True, parallel=True)
def _grid(lat0, lon0, half, n, t0, g0, t1, g1, t2, g2, t3, g3):
    out = np.empty((n, n), np.float32)
    step = 2.0 * half / (n - 1)
    for r in nb.prange(n):
        y = -half + r * step
        for c in range(n):
            x = -half + c * step
            d = math.hypot(x, y)
            if d < 1e-3:
                lat, lon = lat0, lon0
            else:
                lat, lon = _destination(lat0, lon0, math.degrees(math.atan2(x, y)), d / R_MOON_M)
            out[r, c] = _height(lat, lon, t0, g0, t1, g1, t2, g2, t3, g3)
    return out


def main():
    regions = json.loads(SITES.read_text())["regions"]
    areas = {}
    for r in regions:
        areas.setdefault(r["terrainId"], r)
    for old in OUT.glob("*"):
        if old.is_dir() and old.name not in areas:
            shutil.rmtree(old)
    tiers = [load_pds_polar("ldem_80s_40m"), load_pds_polar("ldem_60s_240m_float"), load_svs_global(), None]
    packed = [x for t in tiers for x in _pack(t)]
    for tid, r in areas.items():
        meta = {"area": tid, "feature": r["feature"], "lat": r["featureLat"], "lon": r["featureLon"],
                "frame": "azimuthal equidistant about the feature centre; x east, y north; rows south->north",
                "terrain": ["LOLA 40 m", "LOLA 240 m", "LOLA 1.9 km"], "grids": {}}
        (OUT / tid).mkdir(parents=True, exist_ok=True)
        for name, half_km in (("near", r["areaHalfKm"]), ("far", r["farHalfKm"])):
            h = _grid(r["featureLat"], r["featureLon"], half_km * 1000.0, N, *packed)
            lo, hi = float(h.min()), float(h.max())
            np.round((h - lo) / (hi - lo) * 65535).astype("<u2").tofile(OUT / tid / f"{name}.bin")
            meta["grids"][name] = {"halfM": half_km * 1000.0, "n": N, "minM": lo, "maxM": hi, "file": f"{name}.bin"}
            print(f"{r['feature']:14s} {name}: {N}^2 over {2 * half_km:.0f} km ({2 * half_km * 1000 / N:.0f} m/px), "
                  f"h {lo:7.0f}..{hi:7.0f} m")
        (OUT / tid / "meta.json").write_text(json.dumps(meta, indent=1))
    pack_data.pack_terrain()  # lossless .z + content hashes; the web app reads only the packed files


if __name__ == "__main__":
    main()
