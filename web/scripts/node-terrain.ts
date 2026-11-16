// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Node-side loader for region terrain, decoding the same packed files the browser uses
// (lib/terrain.ts unpackGrid), so the checks run on exactly the app's data.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { type AreaTerrain, type Grid, gridFromU16, unpackGrid } from "../lib/terrain.ts";

type GridMeta = { halfM: number; n: number; minM: number; maxM: number; file: string; encoding?: string };

export function grid(area: string, g: GridMeta): Grid {
  const b = readFileSync(`public/data/terrain/${area}/${g.file}`);
  const q = g.encoding
    ? unpackGrid(new Uint8Array(inflateSync(b)), g.n)
    : new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  return gridFromU16(q, g);
}

export function loadArea(area: string): AreaTerrain {
  const m = JSON.parse(readFileSync(`public/data/terrain/${area}/meta.json`, "utf8"));
  return { id: area, lat: m.lat, lon: m.lon, terrain: m.terrain, near: grid(area, m.grids.near), far: grid(area, m.grids.far) };
}
