"""Mission replay: does the engine reproduce Chandrayaan-3's documented lunar day?

Site: Vikram lander, 69.3741 S, 32.32 E (LROC image 1314, NASA/GSFC/ASU).
Documented: landed 2023-08-23 12:33 UTC (ISRO); rover put to sleep 2 Sep and lander ~3-4 Sep
"as the lunar night began"; revival attempts timed for the next sunrise, 21-22 Sep 2023.
Engine: LOLA 240 m + global skyline at the lander, Sun from JPL Horizons at 10-minute steps,
cross-checked against Horizons' own topocentric elevation at landing.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from dem import load_pds_polar, load_svs_global
from horizons import R_MOON_KM, _unit, enu_basis, fetch_site_azel, fetch_subpoints
from skylines import compute

LAT, LON = -69.3741, 32.32
LANDING = datetime(2023, 8, 23, 12, 33, tzinfo=timezone.utc)
OBS_H = 2.0
OUT = Path(__file__).parent / "validation"


def main():
    far240, glob = load_pds_polar("ldem_60s_240m_float"), load_svs_global()
    sky, ground = compute([LAT], [LON], [far240, glob], obs_h=OBS_H, n_az=720)
    sky, ground = sky[0], float(ground[0])

    sp = fetch_subpoints("2023-08-15 00:00", "2023-10-05 00:00", "10m")
    times = np.array(sp.times)
    out = {}
    for name, vec, r_km in (("sun", sp.sun_vec(), 695_700.0), ("earth", sp.earth_vec(), 6371.0)):
        p = (R_MOON_KM + (ground + OBS_H) / 1000) * _unit(LON, LAT)
        v = (vec - p) @ enu_basis(LON, LAT).T
        az = np.degrees(np.arctan2(v[:, 0], v[:, 1])) % 360
        el = np.degrees(np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1])))
        r = np.degrees(np.arcsin(r_km / np.linalg.norm(v, axis=1)))
        horizon = np.interp(az, np.arange(721) * 0.5, np.append(sky, sky[0]))
        out[name] = {"el": el, "horizon": horizon, "visible": el - horizon > -r}

    i = int(np.argmin([abs((t - LANDING).total_seconds()) for t in times]))
    sun = out["sun"]
    vis = sun["visible"]
    rise = next(k for k in range(i, 0, -1) if not vis[k - 1])            # last sunrise before landing
    sset = next(k for k in range(i, len(vis)) if not vis[k])            # first loss of Sun after landing
    nrise = next(k for k in range(sset, len(vis)) if vis[k])            # next sunrise
    _, _, h_el = fetch_site_azel(LON, LAT, ground / 1000, "10", "2023-08-23 12:30", "2023-08-23 12:40", "10m")

    fmt = lambda k: times[k].strftime("%Y-%m-%d %H:%M UTC")
    result = {
        "site": {"lat": LAT, "lon": LON, "source": "LROC image 1314", "groundM_LOLA": round(ground, 1)},
        "landing": {"utc": fmt(i), "sunElevationDeg": round(float(sun["el"][i]), 2),
                    "horizonAtSunDeg": round(float(sun["horizon"][i]), 2),
                    "sunVisible": bool(vis[i]), "earthVisible": bool(out["earth"]["visible"][i]),
                    "earthElevationDeg": round(float(out["earth"]["el"][i]), 2),
                    "horizonsElevationDeg": round(float(h_el[0]), 2)},
        "sunriseBeforeLanding": fmt(rise),
        "hoursAfterSunrise": round((times[i] - times[rise]).total_seconds() / 3600, 1),
        "sunset": fmt(sset),
        "nextSunrise": fmt(nrise),
        "earthAlwaysVisible": bool(out["earth"]["visible"].all()),
        "documented": {"landing": "2023-08-23 12:33 UTC", "sleep": "rover 2 Sep, lander ~3-4 Sep, as lunar night began",
                       "revivalAtSunrise": "21-22 Sep 2023"},
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "chandrayaan3_replay.json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
