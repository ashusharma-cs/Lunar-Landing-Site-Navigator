"""LOLA terrain access in one convention: heights in metres above the 1737.4 km sphere.

Tiers (finest first), each a `Tier` with a projection kind:
  - PGDA 5 m site tiles (GeoTIFF, south polar stereographic)
  - PDS LDEM 80S 40 m and 60S 240 m (polar stereographic IMG + LBL)
  - SVS global LDEM 16 ppd (equirectangular), for non-polar sites
Sampling is bilinear and done in numba so skylines can march millions of points.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numba as nb
import numpy as np
import rasterio

RAW = Path(__file__).parent / "data" / "raw"
R_MOON_M = 1_737_400.0

POLAR, EQUIRECT, EQUIRECT_CROP = 0, 1, 2  # EQUIRECT wraps in longitude (global maps); crops don't


@dataclass
class Tier:
    """A height grid. For POLAR: x0/y0 are the metre coords of pixel (0,0)'s centre and `res`
    metres per pixel (row index grows toward -y). For EQUIRECT: x0 = lon of col 0 centre,
    y0 = lat of row 0 centre (deg), `res` deg per pixel."""
    name: str
    kind: int
    data: np.ndarray  # 2-D, raw DN
    x0: float
    y0: float
    res: float
    scale: float      # DN -> metres
    offset: float     # metres added after scaling

    def heights(self, rows: slice, cols: slice) -> np.ndarray:
        return self.data[rows, cols].astype(np.float32) * self.scale + self.offset


# --- projection (south polar stereographic on the 1737.4 km sphere, PDS/LOLA convention) ---

@nb.njit(cache=True)
def latlon_to_xy(lat_deg, lon_deg):
    rho = 2.0 * R_MOON_M * np.tan(np.radians(90.0 + lat_deg) / 2.0)
    lon = np.radians(lon_deg)
    return rho * np.sin(lon), rho * np.cos(lon)


@nb.njit(cache=True)
def xy_to_latlon(x, y):
    rho = np.hypot(x, y)
    lat = -90.0 + np.degrees(2.0 * np.arctan(rho / (2.0 * R_MOON_M)))
    return lat, np.degrees(np.arctan2(x, y)) % 360.0


# --- loaders ---

def _label(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text(errors="ignore").splitlines():
        m = re.match(r"\s*([A-Z_^]+)\s*=\s*\"?([^\"<]+?)\"?\s*(<.*>)?\s*$", line)
        if m:
            out.setdefault(m.group(1), m.group(2).strip())
    return out


def load_pds_polar(stem: str) -> Tier:
    lbl = _label(RAW / "pds" / f"{stem}.lbl")
    lines, samples = int(lbl["LINES"]), int(lbl["LINE_SAMPLES"])
    dtype = np.int16 if lbl["SAMPLE_TYPE"] == "LSB_INTEGER" else np.float32
    data = np.memmap(RAW / "pds" / f"{stem}.img", dtype=dtype, mode="r", shape=(lines, samples))
    res = float(lbl["MAP_SCALE"].split()[0])
    s0, l0 = float(lbl["SAMPLE_PROJECTION_OFFSET"].split()[0]), float(lbl["LINE_PROJECTION_OFFSET"].split()[0])
    km = "KILOMETER" in (RAW / "pds" / f"{stem}.lbl").read_text()
    scale = float(lbl["SCALING_FACTOR"]) * (1000.0 if km else 1.0)
    return Tier(stem, POLAR, data, x0=-s0 * res, y0=l0 * res, res=res, scale=scale, offset=0.0)


def load_pgda_tile(site: str) -> Tier:
    path = RAW / "pgda" / f"{site}_5mpp_surf.tif"
    with rasterio.open(path) as ds:
        data = ds.read(1)
        t = ds.transform
    # PGDA heights are metres relative to 1737.4 km; GeoTIFF transform gives the outer corner.
    return Tier(site, POLAR, data, x0=t.c + 0.5 * t.a, y0=t.f + 0.5 * t.e, res=t.a, scale=1.0, offset=0.0)


def load_pds_global64() -> Tier:
    """PDS LOLA LDEM_64 (64 ppd, ~474 m), int16 half-metres; columns start at 0 E."""
    lbl = _label(RAW / "pds" / "ldem_64.lbl")
    rows, cols = int(lbl["LINES"]), int(lbl["LINE_SAMPLES"])
    data = np.memmap(RAW / "pds" / "ldem_64.img", dtype=np.int16, mode="r", shape=(rows, cols))
    res = 360.0 / cols
    return Tier("ldem_64", EQUIRECT, data, x0=res / 2, y0=90.0 - res / 2, res=res, scale=0.5, offset=0.0)


def load_svs_global() -> Tier:
    with rasterio.open(RAW / "svs" / "ldem_16_uint.tif") as ds:
        data = ds.read(1)
    h, w = data.shape
    res = 360.0 / w
    # Columns start at 180 W; DN = half-metres + 20000. Both verified in check_dem.py against PDS 240 m.
    return Tier("ldem_16", EQUIRECT, data, x0=-180.0 + res / 2, y0=90.0 - res / 2, res=res,
                scale=0.5, offset=-10_000.0)


# --- sampling ---

@nb.njit(cache=True)
def _bilinear(data, fr, fc, scale, offset):
    h, w = data.shape
    r0, c0 = int(np.floor(fr)), int(np.floor(fc))
    if r0 < 0 or c0 < 0 or r0 + 1 >= h or c0 + 1 >= w:
        return np.nan
    tr, tc = fr - r0, fc - c0
    v = ((1 - tr) * ((1 - tc) * data[r0, c0] + tc * data[r0, c0 + 1])
         + tr * ((1 - tc) * data[r0 + 1, c0] + tc * data[r0 + 1, c0 + 1]))
    return v * scale + offset


@nb.njit(cache=True)
def sample_tier(kind, data, x0, y0, res, scale, offset, lat, lon):
    if kind == POLAR:
        x, y = latlon_to_xy(lat, lon)
        return _bilinear(data, (y0 - y) / res, (x - x0) / res, scale, offset)
    lon_w = (lon + 180.0) % 360.0 - 180.0
    fc = (lon_w - x0) / res
    if kind == EQUIRECT:
        h, w = data.shape
        if fc < 0:
            fc += w
        if fc >= w - 1:
            fc -= w
    return _bilinear(data, (y0 - lat) / res, fc, scale, offset)


def sample(tier: Tier, lat: float, lon: float) -> float:
    return float(sample_tier(tier.kind, tier.data, tier.x0, tier.y0, tier.res, tier.scale, tier.offset, lat, lon))
