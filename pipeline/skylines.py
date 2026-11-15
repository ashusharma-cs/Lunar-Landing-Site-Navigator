"""Terrain skylines (horizon elevation angle per true azimuth) from LOLA tiers.

Rays follow great circles from the site, so azimuths are true-north based and the polar
stereographic grid-north rotation never enters. Elevation uses exact spherical geometry:
    angle = atan2(r*cos(delta) - r0, r*sin(delta)),  delta = d / R
which reduces to atan((h - h0 - d^2/2R) / d) for small delta.
"""

from __future__ import annotations

import numba as nb
import numpy as np

from dem import POLAR, R_MOON_M, Tier, sample_tier

EMPTY = np.zeros((2, 2), np.float32)


@nb.njit(cache=True)
def _height(lat, lon, t0, g0, t1, g1, t2, g2, t3, g3):
    """Finest valid height among up to four tiers. g = (kind, x0, y0, res, scale, offset)."""
    if t0.shape[0] > 2:
        h = sample_tier(int(g0[0]), t0, g0[1], g0[2], g0[3], g0[4], g0[5], lat, lon)
        if not np.isnan(h) and h > -20000:
            return h
    if t1.shape[0] > 2:
        h = sample_tier(int(g1[0]), t1, g1[1], g1[2], g1[3], g1[4], g1[5], lat, lon)
        if not np.isnan(h):
            return h
    if t2.shape[0] > 2:
        h = sample_tier(int(g2[0]), t2, g2[1], g2[2], g2[3], g2[4], g2[5], lat, lon)
        if not np.isnan(h):
            return h
    return sample_tier(int(g3[0]), t3, g3[1], g3[2], g3[3], g3[4], g3[5], lat, lon)


@nb.njit(cache=True)
def _destination(lat1, lon1, az, delta):
    p1, l1, a = np.radians(lat1), np.radians(lon1), np.radians(az)
    p2 = np.arcsin(np.sin(p1) * np.cos(delta) + np.cos(p1) * np.sin(delta) * np.cos(a))
    l2 = l1 + np.arctan2(np.sin(a) * np.sin(delta) * np.cos(p1), np.cos(delta) - np.sin(p1) * np.sin(p2))
    return np.degrees(p2), np.degrees(l2)


@nb.njit(cache=True, parallel=True)
def _skylines(lats, lons, obs_h, azs, d_min, d_max, step_frac, t0, g0, t1, g1, t2, g2, t3, g3):
    n, m = lats.shape[0], azs.shape[0]
    out = np.full((n, m), -90.0, np.float32)
    ground = np.empty(n, np.float32)
    for i in nb.prange(n):
        h0 = _height(lats[i], lons[i], t0, g0, t1, g1, t2, g2, t3, g3)
        ground[i] = h0
        r0 = R_MOON_M + h0 + obs_h
        for j in range(m):
            best = -90.0
            d = d_min
            while d < d_max:
                lat, lon = _destination(lats[i], lons[i], azs[j], d / R_MOON_M)
                h = _height(lat, lon, t0, g0, t1, g1, t2, g2, t3, g3)
                if not np.isnan(h):
                    delta = d / R_MOON_M
                    r = R_MOON_M + h
                    ang = np.degrees(np.arctan2(r * np.cos(delta) - r0, r * np.sin(delta)))
                    if ang > best:
                        best = ang
                d += max(d_min, d * step_frac)
            out[i, j] = best
    return out, ground


def _pack(t: Tier | None):
    if t is None:
        return EMPTY, np.array([POLAR, 0, 0, 1, 1, 0], np.float64)
    return np.asarray(t.data), np.array([t.kind, t.x0, t.y0, t.res, t.scale, t.offset], np.float64)


def compute(lats, lons, tiers: list[Tier | None], obs_h: float = 2.0, n_az: int = 720,
            d_min: float = 10.0, d_max: float = 200_000.0, step_frac: float = 0.003):
    """Skylines for many sites. `tiers` finest first, padded to 4 with None (last must be global or 240 m)."""
    tiers = list(tiers) + [None] * (4 - len(tiers))
    packed = [x for t in tiers for x in _pack(t)]
    azs = np.arange(n_az, dtype=np.float64) * (360.0 / n_az)
    return _skylines(np.atleast_1d(np.asarray(lats, np.float64)), np.atleast_1d(np.asarray(lons, np.float64)),
                     float(obs_h), azs, d_min, d_max, step_frac, *packed)
