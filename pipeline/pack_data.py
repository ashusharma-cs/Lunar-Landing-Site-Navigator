# AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"""Pack and version the web data so the browser downloads each file once and keeps it.

Terrain grids (uint16, 2048 x 2048) -> <name>.z: each row delta-encoded (mod 2^16), low-byte plane then
high-byte plane, zlib level 9. Lossless: the decoder in web/lib/terrain.ts (unpackGrid) restores the exact
uint16 values; this script checks that before replacing anything. About half the raw size.

Every data file then gets a content hash ("v") in its meta/index, and the web app requests it as
file?v=<hash>. Browsers and the CDN may keep it forever: a changed file gets a new URL.

Run after build_terrain.py / build_ephemeris.py:  ./.venv/Scripts/python pack_data.py
"""
import hashlib
import json
import zlib
from pathlib import Path

import numpy as np

WEB = Path(__file__).resolve().parent.parent / "web" / "public" / "data"
ENCODING = "row-delta-u16, byte planes, zlib"


def pack_grid(q: np.ndarray) -> bytes:
    """q: (n, n) uint16, rows south -> north."""
    d = np.diff(q.astype(np.int32), axis=1, prepend=0).astype(np.uint16)  # mod 2^16
    b = d.astype("<u2").tobytes()
    return zlib.compress(b[0::2] + b[1::2], 9)


def unpack_grid(z: bytes, n: int) -> np.ndarray:
    raw = zlib.decompress(z)
    half = len(raw) // 2
    d = (np.frombuffer(raw[:half], np.uint8).astype(np.uint16) | (np.frombuffer(raw[half:], np.uint8).astype(np.uint16) << 8))
    return np.cumsum(d.reshape(n, n).astype(np.uint32), axis=1).astype(np.uint16)  # wraps mod 2^16


def version(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:12]


def pack_terrain():
    for meta_path in sorted((WEB / "terrain").glob("*/meta.json")):
        meta = json.loads(meta_path.read_text())
        for name, g in meta["grids"].items():
            src = meta_path.parent / f"{name}.bin"
            if src.exists():
                n = g["n"]
                q = np.fromfile(src, "<u2").reshape(n, n)
                z = pack_grid(q)
                assert np.array_equal(unpack_grid(z, n), q), f"round trip failed: {src}"
                (meta_path.parent / f"{name}.z").write_bytes(z)
                src.unlink()
                print(f"{src.relative_to(WEB)}: {q.nbytes / 2**20:.1f} MB -> {len(z) / 2**20:.1f} MB")
            z = (meta_path.parent / f"{name}.z").read_bytes()
            g.update(file=f"{name}.z", encoding=ENCODING, v=version(z))
        meta_path.write_text(json.dumps(meta, indent=1))


def version_ephemeris():
    idx_path = WEB / "ephemeris" / "index.json"
    idx = json.loads(idx_path.read_text())
    for y in idx["years"]:
        y["v"] = version((WEB / "ephemeris" / f"{y['year']}.bin").read_bytes())
    idx_path.write_text(json.dumps(idx, indent=1))


if __name__ == "__main__":
    pack_terrain()
    version_ephemeris()
