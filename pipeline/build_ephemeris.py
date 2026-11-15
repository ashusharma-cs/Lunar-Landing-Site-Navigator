"""Hourly Sun/Earth geometry in the Moon ME frame -> web/public/data/ephemeris/<year>.bin

Per hour, 12 float32: sun unit xyz, sun km, earth unit xyz, earth km, quaternion (x,y,z,w)
rotating Moon ME vectors into ICRF (orients Earth's spin in the scene). The rotation comes from
TRIAD on the Sun and Earth directions known in both frames.
"""

import json
from pathlib import Path

import numpy as np

from horizons import _query, _rows, _unit, fetch_subpoints

OUT = Path(__file__).parents[1] / "web" / "public" / "data" / "ephemeris"
YEARS = [1969, 2023, 2024, 2025, 2026, 2027, 2028]


def radec_from_moon(target: str, start: str, stop: str) -> np.ndarray:
    text = _query({"COMMAND": target, "CENTER": "500@301", "START_TIME": start, "STOP_TIME": stop,
                   "STEP_SIZE": "1h", "QUANTITIES": "1", "EXTRA_PREC": "YES"})
    _, v = _rows(text)
    return _unit(v[:, 0], v[:, 1])


def triad(a1, b1, a2, b2) -> np.ndarray:
    """Rotation matrices M (N,3,3) with M @ a1 ~= a2 and M @ b1 in the a2-b2 plane."""
    def frame(a, b):
        t1 = a / np.linalg.norm(a, axis=1, keepdims=True)
        t2 = np.cross(a, b)
        t2 /= np.linalg.norm(t2, axis=1, keepdims=True)
        return np.stack([t1, t2, np.cross(t1, t2)], axis=2)
    return frame(a2, b2) @ np.transpose(frame(a1, b1), (0, 2, 1))


def to_quat(m: np.ndarray) -> np.ndarray:
    w = np.sqrt(np.maximum(0, 1 + m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2])) / 2
    x = np.copysign(np.sqrt(np.maximum(0, 1 + m[:, 0, 0] - m[:, 1, 1] - m[:, 2, 2])) / 2, m[:, 2, 1] - m[:, 1, 2])
    y = np.copysign(np.sqrt(np.maximum(0, 1 - m[:, 0, 0] + m[:, 1, 1] - m[:, 2, 2])) / 2, m[:, 0, 2] - m[:, 2, 0])
    z = np.copysign(np.sqrt(np.maximum(0, 1 - m[:, 0, 0] - m[:, 1, 1] + m[:, 2, 2])) / 2, m[:, 1, 0] - m[:, 0, 1])
    return np.stack([x, y, z, w], axis=1)


def build_year(year: int) -> dict:
    start, stop = f"{year}-01-01 00:00", f"{year}-12-31 23:00"
    sp = fetch_subpoints(start, stop)
    sun_me, earth_me = _unit(sp.sun_lon, sp.sun_lat), _unit(sp.earth_lon, sp.earth_lat)
    sun_i, earth_i = radec_from_moon("10", start, stop), radec_from_moon("399", start, stop)
    n = min(len(sun_me), len(sun_i), len(earth_i))
    rot = triad(sun_me[:n], earth_me[:n], sun_i[:n], earth_i[:n])
    resid = np.degrees(np.arccos(np.clip(np.einsum("nij,nj,ni->n", rot, earth_me[:n], earth_i[:n]), -1, 1)))
    rec = np.concatenate([sun_me[:n], sp.sun_km[:n, None], earth_me[:n], sp.earth_km[:n, None], to_quat(rot)], axis=1)
    OUT.mkdir(parents=True, exist_ok=True)
    rec.astype(np.float32).tofile(OUT / f"{year}.bin")
    print(f"{year}: {n} hours, TRIAD Earth residual max {resid.max():.4f} deg")
    return {"year": year, "start": sp.times[0].isoformat().replace("+00:00", "Z"), "hours": n}


if __name__ == "__main__":
    index = {"stepHours": 1, "floatsPerHour": 12,
             "fields": ["sunX", "sunY", "sunZ", "sunKm", "earthX", "earthY", "earthZ", "earthKm", "qx", "qy", "qz", "qw"],
             "frame": "MOON_ME (DE441 via JPL Horizons); quaternion rotates MOON_ME -> ICRF",
             "years": [build_year(y) for y in YEARS]}
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    import pack_data
    pack_data.version_ephemeris()  # content hashes so browsers can cache each year forever
