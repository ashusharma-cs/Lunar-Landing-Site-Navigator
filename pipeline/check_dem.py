# AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"""Cross-check every terrain tier's georeferencing against the others."""

import numpy as np

from dem import EQUIRECT, Tier, load_pds_polar, load_pgda_tile, load_svs_global, sample, xy_to_latlon

near, far = load_pds_polar("ldem_80s_40m"), load_pds_polar("ldem_60s_240m_float")
glob = load_svs_global()

# 1. Shackleton (crater centre ~89.67 S, 129.8 E) must be a deep pit; the mirrored longitude must not.
print("Shackleton centre  ", sample(near, -89.67, 129.8), "  mirrored lon", sample(near, -89.67, -129.8))

# 2. 40 m vs 240 m polar grids.
rng = np.random.default_rng(0)
pts = [(rng.uniform(-89.5, -80.5), rng.uniform(0, 360)) for _ in range(400)]
d = np.array([sample(near, a, o) - sample(far, a, o) for a, o in pts])
print(f"40m vs 240m: median |diff| {np.median(np.abs(d)):.1f} m")

# 3. PGDA 5 m tile vs PDS 40 m, over the tile interior.
tile = load_pgda_tile("Haworth")
h, w = tile.data.shape
print("PGDA tile", tile.data.shape, tile.data.dtype, "res", tile.res, "nodata-ish min", np.nanmin(tile.data[::50, ::50]))
d = []
for r, c in rng.integers(100, min(h, w) - 100, size=(300, 2)):
    x, y = tile.x0 + c * tile.res, tile.y0 - r * tile.res
    lat, lon = xy_to_latlon(x, y)
    d.append(float(tile.data[r, c]) - sample(near, lat, lon))
d = np.array(d)
print(f"PGDA vs PDS40: median diff {np.median(d):.1f} m, median |diff| {np.median(np.abs(d)):.1f} m")

# 4. SVS global (equirect) vs PDS 240 m on a 61-79 S band: test lon origin + uint offset.
for shift in (0.0, 180.0):
    g = Tier(glob.name, EQUIRECT, glob.data, glob.x0 + shift, glob.y0, glob.res, glob.scale, glob.offset)
    pts = [(rng.uniform(-79, -61), rng.uniform(0, 360)) for _ in range(500)]
    d = np.array([sample(g, a, o) - sample(far, a, o) for a, o in pts])
    print(f"SVS lon shift {shift:5.1f}: median diff {np.nanmedian(d):8.1f} m, median |dev| {np.nanmedian(np.abs(d - np.nanmedian(d))):7.1f} m")
