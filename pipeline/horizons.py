"""JPL Horizons access: Sun and Earth geometry as seen from the Moon.

Method A: Horizons computes az/el for one surface site directly (used for validation).
Method B: one geocentric query gives sub-solar and sub-Earth points in the MOON_ME frame
(the same frame LOLA uses); az/el for any site is then pure geometry (see `azel_from_subpoints`).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

API = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE = Path(__file__).parent / "cache" / "horizons"
AU_KM = 149_597_870.7
R_MOON_KM = 1737.4


def _query(params: dict[str, str]) -> str:
    """Run a Horizons query, caching the raw text response on disk by its parameters."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE / f"{key}.txt"
    if path.exists():
        return path.read_text()
    full = {"format": "text", "MAKE_EPHEM": "YES", "EPHEM_TYPE": "OBSERVER",
            "ANG_FORMAT": "DEG", "CSV_FORMAT": "YES", "TIME_DIGITS": "MINUTES", **params}
    quoted = {k: f"'{v}'" if k not in ("format",) else v for k, v in full.items()}
    resp = requests.get(API, params=quoted, timeout=300)
    resp.raise_for_status()
    text = resp.text
    if "$$SOE" not in text:
        raise RuntimeError(f"Horizons returned no ephemeris:\n{text[:2000]}")
    path.write_text(text)
    return text


def _rows(text: str) -> tuple[list[datetime], np.ndarray]:
    body = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    times, values = [], []
    for line in body:
        cells = [c.strip() for c in line.split(",")]
        times.append(datetime.strptime(cells[0], "%Y-%b-%d %H:%M").replace(tzinfo=timezone.utc))
        # Cells 1-2 are solar/lunar presence flags; the rest are numbers (trailing comma -> "").
        values.append([float(c) for c in cells[3:] if c not in ("",)])
    return times, np.array(values)


@dataclass
class SubPoints:
    """Hourly Sun and Earth positions in Moon-fixed (MOON_ME) coordinates."""
    times: list[datetime]
    earth_lon: np.ndarray  # deg, east-positive
    earth_lat: np.ndarray
    earth_km: np.ndarray   # Moon centre -> Earth centre
    sun_lon: np.ndarray
    sun_lat: np.ndarray
    sun_km: np.ndarray     # Moon centre -> Sun centre

    def sun_vec(self) -> np.ndarray:
        return _unit(self.sun_lon, self.sun_lat) * self.sun_km[:, None]

    def earth_vec(self) -> np.ndarray:
        return _unit(self.earth_lon, self.earth_lat) * self.earth_km[:, None]


def fetch_subpoints(start: str, stop: str, step: str = "1h") -> SubPoints:
    """Method B: geocentric query for the Moon -> sub-Earth point, sub-solar point, ranges."""
    text = _query({"COMMAND": "301", "CENTER": "500@399", "START_TIME": start,
                   "STOP_TIME": stop, "STEP_SIZE": step, "QUANTITIES": "14,15,19,20"})
    if "MOON_ME" not in text:
        raise RuntimeError("Expected Horizons sub-points in the MOON_ME frame")
    times, v = _rows(text)
    # Columns: ObsSub-LON, ObsSub-LAT, SunSub-LON, SunSub-LAT, r (AU), rdot, delta (AU), deldot
    return SubPoints(times, v[:, 0], v[:, 1], v[:, 6] * AU_KM, v[:, 2], v[:, 3], v[:, 4] * AU_KM)


def fetch_site_azel(lon: float, lat: float, height_km: float, target: str,
                    start: str, stop: str, step: str = "1h") -> tuple[list[datetime], np.ndarray, np.ndarray]:
    """Method A: Horizons apparent az/el of `target` (10 = Sun, 399 = Earth) from a lunar surface site."""
    text = _query({"COMMAND": target, "CENTER": "coord@301", "COORD_TYPE": "GEODETIC",
                   "SITE_COORD": f"{lon},{lat},{height_km}", "START_TIME": start,
                   "STOP_TIME": stop, "STEP_SIZE": step, "QUANTITIES": "4", "APPARENT": "AIRLESS"})
    times, v = _rows(text)
    return times, v[:, 0], v[:, 1]


def _unit(lon_deg, lat_deg) -> np.ndarray:
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def enu_basis(lon_deg: float, lat_deg: float) -> np.ndarray:
    """Rows are local east, north, up unit vectors in Moon-fixed coordinates."""
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    return np.stack([east, north, up])


def azel_from_subpoints(lon: float, lat: float, height_km: float,
                        body_vec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Topocentric azimuth (deg from true north, clockwise) and elevation of a body.

    `body_vec` is (N, 3) Moon-fixed km. The site offset is always subtracted: Earth's
    apparent position shifts by up to ~0.27 deg across the Moon, about one Sun radius.
    """
    site = (R_MOON_KM + height_km) * _unit(lon, lat)
    enu = (body_vec - site) @ enu_basis(lon, lat).T
    az = np.degrees(np.arctan2(enu[:, 0], enu[:, 1])) % 360.0
    el = np.degrees(np.arctan2(enu[:, 2], np.hypot(enu[:, 0], enu[:, 1])))
    return az, el
