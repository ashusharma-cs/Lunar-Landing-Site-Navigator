"""Web textures for every 3D object -> web/public/textures

Moon:   LROC colour (NASA SVS CGI Moon Kit) + tangent-space normal map from LOLA LDEM 16 ppd
Earth:  Blue Marble NG (Nov) day + Black Marble night lights + ocean specular mask
Lander/terrain: generated regolith detail, MLI foil and solar-cell textures (seamless tiles)
"""

from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

from dem import RAW, load_svs_global

OUT = Path(__file__).parents[1] / "web" / "public" / "textures"
Image.MAX_IMAGE_PIXELS = None


def save(arr: np.ndarray, name: str, **kw) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(arr)
    img.save(OUT / name, **kw)
    print(f"{name:28s} {img.size[0]}x{img.size[1]}  {(OUT / name).stat().st_size / 1e6:.1f} MB")


def moon() -> None:
    with rasterio.open(RAW / "svs" / "lroc_color_poles_8k.tif") as ds:
        rgb = np.transpose(ds.read(), (1, 2, 0))
    img = Image.fromarray(rgb)
    save(np.asarray(img.resize((4096, 2048), Image.LANCZOS)), "moon_color_4k.jpg", quality=88)
    save(np.asarray(img.resize((8192, 4096), Image.LANCZOS)), "moon_color_8k.jpg", quality=85)

    # Normal map: east/north slopes of the LOLA surface (exaggerated x3 so relief reads at globe scale).
    g = load_svs_global()
    h = g.data.astype(np.float32) * g.scale + g.offset
    rows, cols = h.shape
    lat = np.radians(90 - (np.arange(rows) + 0.5) * 180 / rows)[:, None]
    m_per_px = 1_737_400 * np.radians(360 / cols)
    dzdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * m_per_px * np.maximum(np.cos(lat), 0.02))
    dzdy = np.zeros_like(h)
    dzdy[1:-1] = (h[:-2] - h[2:]) / (2 * m_per_px)
    n = np.stack([-3 * dzdx, -3 * dzdy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    nm = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    save(np.asarray(Image.fromarray(nm).resize((4096, 2048), Image.LANCZOS)), "moon_normal_4k.jpg", quality=92)


CAP_LAT = -75.0  # south polar cap textures cover 75-90 S


def south_cap(n_normal: int = 3072, n_color: int = 2048) -> None:
    """South polar cap in polar stereographic (no pole pinch): normal map from the PDS LOLA
    240 m grid (8x sharper than the global 16 ppd map) and LROC colour reprojected from the
    8k equirectangular map. Normals are stored in the grid frame (x right, y up, z out);
    the shader rotates them into east/north using longitude."""
    from scipy.ndimage import map_coordinates

    from dem import load_pds_polar, xy_to_latlon

    rho_max = 2 * 1_737_400.0 * np.tan(np.radians(90 + CAP_LAT) / 2)

    far = load_pds_polar("ldem_60s_240m_float")
    s = np.linspace(-rho_max, rho_max, n_normal)
    x, y = np.meshgrid(s, s[::-1])  # row 0 = +y (top of image)
    h = map_coordinates(np.asarray(far.data, np.float32), [(far.y0 - y) / far.res, (x - far.x0) / far.res],
                        order=1) * far.scale
    px = s[1] - s[0]
    k = 2.0  # relief exaggeration so polar ridges read at globe scale
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px)
    dhdy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / (2 * px)
    nrm = np.stack([-k * dhdx, -k * dhdy, np.ones_like(h)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    save(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "moon_south_normal.jpg", quality=92)

    with rasterio.open(RAW / "svs" / "lroc_color_poles_8k.tif") as ds:
        rgb = ds.read().astype(np.float32)
    _, H, W = rgb.shape
    s = np.linspace(-rho_max, rho_max, n_color)
    x, y = np.meshgrid(s, s[::-1])
    lat, lon = xy_to_latlon(x, y)
    lon = (lon + 180) % 360 - 180
    rows, cols = (90 - lat) / 180 * H - 0.5, (lon + 180) / 360 * W - 0.5
    col = np.stack([map_coordinates(rgb[c], [rows, cols], order=1, mode="grid-wrap") for c in range(3)], -1)
    save(np.clip(col, 0, 255).astype(np.uint8), "moon_south_color.jpg", quality=90)


INNER_LAT = -84.0  # high-detail inner cap (all Artemis III regions) from the 40 m LOLA grid


def south_inner_cap(n: int = 4096) -> None:
    """84-90 S normal map at ~89 m/pixel from the PDS LOLA 40 m grid (same grid-frame convention as
    south_cap). Colour stays with the outer cap: LROC colour is ~1.3 km/pixel anyway."""
    from scipy.ndimage import map_coordinates

    from dem import load_pds_polar

    rho_max = 2 * 1_737_400.0 * np.tan(np.radians(90 + INNER_LAT) / 2)
    near = load_pds_polar("ldem_80s_40m")
    s = np.linspace(-rho_max, rho_max, n)
    x, y = np.meshgrid(s, s[::-1])
    h = map_coordinates(np.asarray(near.data), [(near.y0 - y) / near.res, (x - near.x0) / near.res],
                        order=1, output=np.float32) * near.scale
    px = s[1] - s[0]
    k = 1.5
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px)
    dhdy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) / (2 * px)
    nrm = np.stack([-k * dhdx, -k * dhdy, np.ones_like(h)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    save(((nrm * 0.5 + 0.5) * 255).astype(np.uint8), "moon_south_inner_normal.jpg", quality=90)


def moon_normal_8k() -> None:
    """Global normal map at 8192x4096 (~1.3 km/pixel) from PDS LOLA LDEM_64 (int16 half-metres)."""
    from dem import _label

    lbl = _label(RAW / "pds" / "ldem_64.lbl")
    rows, cols = int(lbl["LINES"]), int(lbl["LINE_SAMPLES"])
    dn = np.memmap(RAW / "pds" / "ldem_64.img", dtype=np.int16, mode="r", shape=(rows, cols))
    # PDS cylindrical grids start at 0 E; roll so column 0 is 180 W like the SVS colour map.
    h = Image.fromarray(np.roll(np.asarray(dn, np.float32) * float(lbl["SCALING_FACTOR"]), cols // 2, axis=1))
    h = np.asarray(h.resize((8192, 4096), Image.BOX), np.float32)
    rows, cols = h.shape
    lat = np.radians(90 - (np.arange(rows) + 0.5) * 180 / rows)[:, None]
    m_per_px = 1_737_400 * np.radians(360 / cols)
    dzdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * m_per_px * np.maximum(np.cos(lat), 0.05))
    dzdy = np.zeros_like(h)
    dzdy[1:-1] = (h[:-2] - h[2:]) / (2 * m_per_px)
    n = np.stack([-2 * dzdx, -2 * dzdy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    save(((n * 0.5 + 0.5) * 255).astype(np.uint8), "moon_normal_8k.jpg", quality=88)


def clouds() -> None:
    """Blue Marble cloud composite (NASA Earth Observatory), static, not real-time."""
    src = RAW / "earth" / "cloud_combined_2048.jpg"
    img = Image.open(src).convert("L")
    save(np.asarray(img), "earth_clouds_2k.jpg", quality=88)


def earth() -> None:
    day = Image.open(RAW / "earth" / "world.topo.bathy.200411.3x5400x2700.jpg").convert("RGB")
    day = day.resize((4096, 2048), Image.LANCZOS)
    save(np.asarray(day), "earth_day_4k.jpg", quality=88)
    a = np.asarray(day).astype(np.float32)
    water = ((a[..., 2] > a[..., 0] * 1.15) & (a[..., 2] > a[..., 1] * 0.95)).astype(np.float32)
    save((np.asarray(Image.fromarray((water * 255).astype(np.uint8)).resize((2048, 1024), Image.BILINEAR))),
         "earth_specular_2k.jpg", quality=85)
    night = Image.open(RAW / "earth" / "dnb_land_ocean_ice.2012.3600x1800.jpg").convert("RGB")
    save(np.asarray(night.resize((2048, 1024), Image.LANCZOS)), "earth_night_2k.jpg", quality=85)



def tile_noise(size: int, octaves: int, seed: int) -> np.ndarray:
    """Seamless fractal noise in [0,1] (sum of random-phase periodic sinusoid grids via FFT)."""
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)[:, None], np.fft.fftfreq(size)[None, :]
    k = np.hypot(*f)
    k[0, 0] = 1
    spec = (rng.normal(size=(size, size)) + 1j * rng.normal(size=(size, size))) / k ** (1 + 0.15 * octaves)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    return (n - n.min()) / (n.max() - n.min())


def normal_from_height(h: np.ndarray, strength: float) -> np.ndarray:
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def regolith() -> None:
    size = 1024
    base = tile_noise(size, 3, 1)
    fine = tile_noise(size, 1, 2)
    rng = np.random.default_rng(3)
    yy, xx = np.mgrid[0:size, 0:size]
    craters = np.zeros((size, size), np.float32)
    for _ in range(140):  # small periodic craterlets: raised rim, bowl floor
        cx, cy, r = rng.uniform(0, size), rng.uniform(0, size), rng.uniform(4, 40) * rng.uniform(0.3, 1) ** 2 + 3
        dx = (xx - cx + size / 2) % size - size / 2
        dy = (yy - cy + size / 2) % size - size / 2
        d = np.hypot(dx, dy) / r
        craters += np.where(d < 1, -(1 - d ** 2) * r * 0.02, np.exp(-((d - 1) * 4) ** 2) * r * 0.008)
    height = base * 0.6 + fine * 0.25 + craters
    albedo = np.clip(0.42 + (base - 0.5) * 0.22 + (fine - 0.5) * 0.18, 0, 1)
    save((np.stack([albedo] * 3, -1) * 255).astype(np.uint8), "regolith_albedo.jpg", quality=90)
    save(normal_from_height(height, 6.0), "regolith_normal.png")


def lander() -> None:
    size = 1024
    # Gold MLI foil: crinkled height field -> albedo with sheen variation + normal map.
    crinkle = tile_noise(size, 1, 11) * 0.6 + tile_noise(size, 0, 12) * 0.4
    shade = 0.75 + 0.25 * crinkle
    gold = np.stack([0.95 * shade, 0.72 * shade, 0.28 * shade], -1)
    save((np.clip(gold, 0, 1) * 255).astype(np.uint8), "mli_gold.jpg", quality=90)
    save(normal_from_height(crinkle, 18.0), "mli_normal.png")
    # Solar panel: dark blue cells, silver gridlines, white gaps between cells.
    yy, xx = np.mgrid[0:size, 0:size]
    cell = 128
    u, v = xx % cell, yy % cell
    rgb = np.zeros((size, size, 3), np.float32)
    rgb[:] = (0.05, 0.09, 0.22)
    rgb[(u % 16 == 0) & (u > 4) & (u < cell - 4)] = (0.55, 0.58, 0.62)  # finger lines
    rgb[(v > cell // 2 - 2) & (v < cell // 2 + 2)] = (0.65, 0.67, 0.70)  # bus bar
    rgb[(u < 4) | (v < 4)] = (0.85, 0.86, 0.88)                          # cell gaps
    rgb *= (0.92 + 0.08 * tile_noise(size, 0, 13))[..., None]
    save((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "solar_cells.jpg", quality=92)


if __name__ == "__main__":
    moon()
    south_cap()
    south_inner_cap()
    moon_normal_8k()
    clouds()
    earth()
    regolith()
    lander()
