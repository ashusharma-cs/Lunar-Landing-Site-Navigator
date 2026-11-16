# AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"""Plan 3.1 first test: method A (Horizons per site) vs method B (sub-points + geometry)."""

import numpy as np

from horizons import azel_from_subpoints, fetch_site_azel, fetch_subpoints

START, STOP = "2026-11-14", "2026-11-16"
SITES = {"Apollo 11": (23.473, 0.674, 0.0), "Mons Mouton (approx)": (31.2, -84.5, 0.0)}

sp = fetch_subpoints(START, STOP)
for name, (lon, lat, h) in SITES.items():
    for label, target, vec in (("Sun", "10", sp.sun_vec()), ("Earth", "399", sp.earth_vec())):
        _, az_a, el_a = fetch_site_azel(lon, lat, h, target, START, STOP)
        az_b, el_b = azel_from_subpoints(lon, lat, h, vec)
        n = min(len(az_a), len(az_b))
        daz = (az_b[:n] - az_a[:n] + 180) % 360 - 180
        del_ = el_b[:n] - el_a[:n]
        print(f"{name:22s} {label:5s} el={el_a[0]:7.3f}  max|d_az|={np.abs(daz).max():.4f} deg"
              f"  max|d_el|={np.abs(del_).max():.4f} deg")
