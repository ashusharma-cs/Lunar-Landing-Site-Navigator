# AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"""External validation: our sunlight / Earth-visibility engine vs NASA's published illumination maps.

Reference: LOLA team average visibility maps (PGDA product 69; Mazarico et al. 2011, Icarus 211),
AVGVISIB_85S_060M_201608 and AVGVISIB_75S_120M_201608 (+ _EARTH). Each pixel is the fraction of
hourly timesteps over ~18.6 years in which ANY part of the solar (or Earth's) disc is visible.

Ours: skyline from LOLA (PDS 40 m + 240 m + global) at the point, Sun/Earth from JPL Horizons
hourly over 18.6 years (2008-01-01 onward), same "any part of the disc" rule, observer on the ground.
Points: named sites + 300 random points (uniform by area, 80.5-89.8 S, fixed seed) so the
comparison spans permanent shadow to near-continuous light.
"""

import json
from pathlib import Path

import numpy as np

from dem import POLAR, RAW, Tier, _label, latlon_to_xy, load_pds_polar, load_svs_global, sample
from horizons import R_MOON_KM, _unit, enu_basis, fetch_subpoints
from skylines import compute

OUT = Path(__file__).parent / "validation"
WEB = Path(__file__).parents[1] / "web" / "public" / "data"
R_SUN_KM, R_EARTH_KM = 695_700.0, 6371.0
HOURS = int(18.6 * 365.25 * 24)


def load_illum(stem: str) -> Tier:
    lbl = _label(RAW / "illum" / f"{stem}.LBL")
    n = int(lbl["LINES"])
    data = np.memmap(RAW / "illum" / f"{stem}.IMG", dtype="<i2", mode="r", shape=(n, n))
    res = float(lbl["MAP_SCALE"].split()[0])
    s0, l0 = float(lbl["SAMPLE_PROJECTION_OFFSET"].split()[0]), float(lbl["LINE_PROJECTION_OFFSET"].split()[0])
    return Tier(stem, POLAR, data, x0=-s0 * res, y0=l0 * res, res=res, scale=float(lbl["SCALING_FACTOR"]), offset=0.0)


def ephemeris():
    sun, earth = [], []
    for y in range(2008, 2027):
        sp = fetch_subpoints(f"{y}-01-01 00:00", f"{y}-12-31 23:00")
        sun.append(sp.sun_vec())
        earth.append(sp.earth_vec())
    return np.concatenate(sun)[:HOURS], np.concatenate(earth)[:HOURS]


def visible_fraction(lat, lon, ground_m, sky, body, r_body_km):
    """Fraction of hours with any part of the body's disc above the skyline."""
    p = (R_MOON_KM + ground_m / 1000) * _unit(lon, lat)
    v = (body - p) @ enu_basis(lon, lat).T
    az = np.degrees(np.arctan2(v[:, 0], v[:, 1])) % 360
    el = np.degrees(np.arctan2(v[:, 2], np.hypot(v[:, 0], v[:, 1])))
    r = np.degrees(np.arcsin(r_body_km / np.linalg.norm(v, axis=1)))
    grid = np.arange(len(sky) + 1) * (360 / len(sky))
    horizon = np.interp(az, grid, np.append(sky, sky[0]))
    return float(np.mean(el - horizon > -r))


def main():
    # Real spacecraft positions (LROC images 1360, 1408) as fixed named validation points.
    named = [("IM-1 Odysseus (LROC)", -80.13, 1.44), ("IM-2 Athena (LROC)", -84.7906, 29.1957)]
    rng = np.random.default_rng(42)
    rho_min, rho_max = [2 * R_MOON_KM * np.tan(np.radians(90 + lat) / 2) for lat in (-89.8, -80.5)]
    rho = np.sqrt(rng.uniform(rho_min ** 2, rho_max ** 2, 300))
    lon = rng.uniform(-180, 180, 300)
    lat = -90 + np.degrees(2 * np.arctan(rho / (2 * R_MOON_KM)))
    pts = named + [(f"random {i:03d}", float(a), float(o)) for i, (a, o) in enumerate(zip(lat, lon))]

    near40, far240, glob = load_pds_polar("ldem_80s_40m"), load_pds_polar("ldem_60s_240m_float"), load_svs_global()
    lats, lons = np.array([p[1] for p in pts]), np.array([p[2] for p in pts])
    skies, ground = compute(lats, lons, [near40, far240, glob], obs_h=0.0, n_az=720, d_min=30.0)

    sun, earth = ephemeris()
    maps = {k: load_illum(k) for k in ("AVGVISIB_85S_060M_201608", "AVGVISIB_85S_060M_201608_EARTH",
                                       "AVGVISIB_75S_120M_201608", "AVGVISIB_75S_120M_201608_EARTH")}
    rows = []
    for (name, a, o), sky, g in zip(pts, skies, ground):
        def ref(stem):
            v = sample(maps[stem], a, o)
            return None if np.isnan(v) else round(v, 4)
        rows.append({
            "name": name, "lat": round(a, 5), "lon": round(o, 5), "groundM": round(float(g), 1),
            "sunOurs": round(visible_fraction(a, o, g, sky, sun, R_SUN_KM), 4),
            "earthOurs": round(visible_fraction(a, o, g, sky, earth, R_EARTH_KM), 4),
            "sunNasa60": ref("AVGVISIB_85S_060M_201608"), "earthNasa60": ref("AVGVISIB_85S_060M_201608_EARTH"),
            "sunNasa120": ref("AVGVISIB_75S_120M_201608"), "earthNasa120": ref("AVGVISIB_75S_120M_201608_EARTH"),
        })

    def stats(ours_key, ref_key):
        pairs = np.array([(r[ours_key], r[ref_key]) for r in rows if r[ref_key] is not None])
        d = (pairs[:, 0] - pairs[:, 1]) * 100
        return {"n": len(pairs), "medianAbsPP": round(float(np.median(np.abs(d))), 2),
                "meanBiasPP": round(float(np.mean(d)), 2), "within5PP": round(float(np.mean(np.abs(d) <= 5) * 100), 1),
                "r": round(float(np.corrcoef(pairs[:, 0], pairs[:, 1])[0, 1]), 4)}

    summary = {
        "reference": "NASA LOLA AVGVISIB maps (PGDA product 69, Mazarico et al. 2011)",
        "span": f"{HOURS} hourly steps from 2008-01-01 (18.6 years)",
        "sun_vs_60m": stats("sunOurs", "sunNasa60"), "sun_vs_120m": stats("sunOurs", "sunNasa120"),
        "earth_vs_60m": stats("earthOurs", "earthNasa60"), "earth_vs_120m": stats("earthOurs", "earthNasa120"),
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "illumination_vs_nasa.json").write_text(json.dumps({"summary": summary, "points": rows}, indent=1))
    # Compact copy for the web app's "How it works" chart (ours vs NASA 120 m, every point with both).
    keep = [[r["sunNasa120"], r["sunOurs"], r["earthNasa120"], r["earthOurs"]] for r in rows]
    keep = [[round(v, 4) for v in k] for k in keep if None not in k]
    (WEB / "validation_points.json").write_text(json.dumps({
        "reference": "NASA LOLA AVGVISIB 120 m (PGDA product 69, Mazarico et al. 2011)",
        "fields": ["sunNasa", "sunOurs", "earthNasa", "earthOurs"], "points": keep}, separators=(",", ":")))
    print(json.dumps(summary, indent=1))
    print("\nNamed sites (fraction of time, ours vs NASA 60 m / 120 m):")
    for r in rows[: len(named)]:
        print(f"  {r['name']:20s} sun {r['sunOurs']:.3f} vs {r['sunNasa60']} / {r['sunNasa120']}   "
              f"earth {r['earthOurs']:.3f} vs {r['earthNasa60']} / {r['earthNasa120']}")

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.8), dpi=130)
    for ax, (ok, rk, title) in zip(axes, [("sunOurs", "sunNasa120", "Sunlight"), ("earthOurs", "earthNasa120", "Earth visibility")]):
        x = [r[rk] for r in rows if r[rk] is not None]
        y = [r[ok] for r in rows if r[rk] is not None]
        ax.plot([0, 1], [0, 1], color="#999", lw=0.8)
        ax.scatter(x, y, s=9, color="#222")
        ax.set_xlabel("NASA LOLA AVGVISIB (120 m), fraction of time")
        ax.set_ylabel("This app, fraction of time")
        ax.set_title(f"{title}: {len(x)} points, 18.6 years hourly")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(OUT / "illumination_vs_nasa.png")


if __name__ == "__main__":
    main()
