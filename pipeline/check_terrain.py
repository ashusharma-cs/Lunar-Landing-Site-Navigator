"""Validate the region terrain areas + the in-browser skyline algorithm (re-implemented here)
against skylines.py, at points the user could pick anywhere in an area, not just its centre.

Grids are azimuthal-equidistant about the feature centre, so grid "north" is true north only at the
centre (near the pole it swings ~20 deg within 30 km). Rays therefore follow true-azimuth great
circles from the picked point, and the grids are used only to look heights up.
"""

import json
import math
from pathlib import Path

import numpy as np

from dem import load_pds_polar, load_svs_global
from skylines import _destination, compute

DATA = Path(__file__).parents[1] / "web" / "public" / "data"
R = 1_737_400.0


def load(area: str):
    meta = json.loads((DATA / "terrain" / area / "meta.json").read_text())
    grids = {}
    for name, g in meta["grids"].items():
        q = np.fromfile(DATA / "terrain" / area / g["file"], "<u2").reshape(g["n"], g["n"]).astype(np.float64)
        grids[name] = (g, g["minM"] + q / 65535 * (g["maxM"] - g["minM"]))
    return meta, grids


def sample(grid, x, y):
    g, h = grid
    n, half = g["n"], g["halfM"]
    fc, fr = (x + half) / (2 * half) * (n - 1), (y + half) / (2 * half) * (n - 1)
    if not (0 <= fc < n - 1 and 0 <= fr < n - 1):
        return None
    c, r = int(fc), int(fr)
    tc, tr = fc - c, fr - r
    return (1 - tr) * ((1 - tc) * h[r, c] + tc * h[r, c + 1]) + tr * ((1 - tc) * h[r + 1, c] + tc * h[r + 1, c + 1])


def height(grids, x, y):
    h = sample(grids["near"], x, y)
    return h if h is not None else sample(grids["far"], x, y)


def to_grid(lat0, lon0, lat, lon):
    """Forward azimuthal-equidistant projection about (lat0, lon0): metres east, north."""
    p1, p2, dl = math.radians(lat0), math.radians(lat), math.radians(lon - lon0)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    d = math.acos(max(-1.0, min(1.0, c))) * R
    b = math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))
    return d * math.sin(b), d * math.cos(b)


def horizon(grids, centre, lat, lon, az_deg, obs_h=2.0):
    """Same march as web/lib/skyline.ts: along the TRUE-azimuth great circle from the point (as the
    skyline engine does), using the feature-centred grids only to look heights up."""
    x0, y0 = to_grid(*centre, lat, lon)
    r0 = R + height(grids, x0, y0) + obs_h
    step0 = 2 * grids["near"][0]["halfM"] / grids["near"][0]["n"]
    best, d = -90.0, step0
    while d < 200_000:
        la, lo = _destination(lat, lon, az_deg, d / R)
        h = height(grids, *to_grid(*centre, la, lo))
        if h is None:
            break
        delta = d / R
        rq = R + h
        best = max(best, math.degrees(math.atan2(rq * math.cos(delta) - r0, rq * math.sin(delta))))
        d *= 1.03
    return best


if __name__ == "__main__":
    tiers = [load_pds_polar("ldem_80s_40m"), load_pds_polar("ldem_60s_240m_float"), load_svs_global()]
    rng = np.random.default_rng(7)
    regions = json.loads((DATA / "sites.json").read_text())["regions"]
    areas = {r["terrainId"]: r for r in regions}
    azs = np.arange(0, 360, 10.0)
    all_d, refs = [], []
    for tid, r in areas.items():
        meta, grids = load(tid)
        half = r["areaHalfKm"] * 1000
        for k in range(3):
            # centre, then two random points out to 90 % of the area half-width
            x, y = (0.0, 0.0) if k == 0 else rng.uniform(-0.9 * half, 0.9 * half, 2)
            d, az = math.hypot(x, y), math.degrees(math.atan2(x, y))
            lat, lon = (r["featureLat"], r["featureLon"]) if d < 1 else _destination(r["featureLat"], r["featureLon"], az, d / R)
            ours = np.array([horizon(grids, (r["featureLat"], r["featureLon"]), lat, lon, a) for a in azs])
            sky, _ = compute([lat], [lon], tiers, obs_h=2.0, n_az=720)
            ref = sky[0][(azs * 2).astype(int)]
            diff = np.abs(ours - ref)
            all_d.append(diff)
            refs.append({"area": tid, "lat": lat, "lon": lon, "skyline720": [round(float(v), 4) for v in sky[0]]})
            print(f"{r['feature']:14s} point {k} ({x / 1000:6.1f}, {y / 1000:6.1f}) km: median |d| {np.median(diff):.3f} deg, max {diff.max():.3f} deg")
    (Path(__file__).parent / "cache" / "skyline_refs.json").write_text(json.dumps(refs))  # for web/scripts/check-skyline.ts
    all_d = np.concatenate(all_d)
    print(f"\nall {len(all_d)} horizon samples: median {np.median(all_d):.3f} deg, 95th pct {np.percentile(all_d, 95):.3f} deg, max {all_d.max():.3f} deg")
