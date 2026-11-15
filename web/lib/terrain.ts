// Region terrain areas from pipeline/build_terrain.py: azimuthal-equidistant about the region's IAU
// namesake feature, x east / y north in metres, rows south -> north, heights in metres above the
// 1737.4 km sphere. "near" is the area itself; "far" adds 200 km on every side.

import { type Progress, cachedBytes, inflate } from "./assetCache.ts";

export type Grid = { halfM: number; n: number; heights: Float32Array };
export type AreaTerrain = { id: string; lat: number; lon: number; terrain: string[]; near: Grid; far: Grid };

type GridMeta = { halfM: number; n: number; minM: number; maxM: number; file: string; encoding?: string; v?: string };

const R_M = 1_737_400;
const D2R = Math.PI / 180;
const cache = new Map<string, Promise<AreaTerrain>>();
const listeners = new Map<string, Set<Progress>>();

/**
 * Packed grid (pipeline/pack_data.py) after inflating: low-byte plane then high-byte plane of row
 * deltas mod 2^16. Returns the exact uint16 grid, rows south -> north.
 */
export function unpackGrid(raw: Uint8Array, n: number): Uint16Array {
  const len = n * n;
  const q = new Uint16Array(len);
  for (let r = 0; r < n; r++) {
    let v = 0;
    for (let c = 0, i = r * n; c < n; c++, i++) {
      v = (v + (raw[i] | (raw[len + i] << 8))) & 0xffff;
      q[i] = v;
    }
  }
  return q;
}

/** Heights in metres from the quantised grid. */
export function gridFromU16(q: Uint16Array, g: Pick<GridMeta, "halfM" | "n" | "minM" | "maxM">): Grid {
  const heights = new Float32Array(q.length);
  const k = (g.maxM - g.minM) / 65535;
  for (let i = 0; i < q.length; i++) heights[i] = g.minM + q[i] * k;
  return { halfM: g.halfM, n: g.n, heights };
}

async function loadGrid(id: string, g: GridMeta, onProgress: Progress): Promise<Grid> {
  const url = `/data/terrain/${id}/${g.file}${g.v ? `?v=${g.v}` : ""}`;
  const buf = await cachedBytes(url, onProgress);
  const q = g.encoding ? unpackGrid(new Uint8Array(await inflate(buf)), g.n) : new Uint16Array(buf);
  return gridFromU16(q, g);
}

/** Download progress of a region's terrain (bytes over both grids); called until it's loaded. */
export function onTerrainProgress(id: string, cb: Progress): () => void {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  return () => listeners.get(id)?.delete(cb);
}

/** A region's terrain, downloaded once per browser (Cache Storage) and decoded once per page. */
export function loadTerrain(id: string): Promise<AreaTerrain> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const meta = await (await fetch(`/data/terrain/${id}/meta.json`)).json();
      const got = [0, 0], tot = [0, 0];
      const prog = (k: number) => (loaded: number, total: number) => {
        got[k] = loaded;
        tot[k] = total;
        for (const cb of listeners.get(id) ?? []) cb(got[0] + got[1], tot[0] + tot[1]);
      };
      const [near, far] = await Promise.all([loadGrid(id, meta.grids.near, prog(0)), loadGrid(id, meta.grids.far, prog(1))]);
      return { id, lat: meta.lat, lon: meta.lon, terrain: meta.terrain, near, far };
    })();
    p.catch(() => cache.delete(id));  // let a failed download retry
    cache.set(id, p);
  }
  return p;
}

/** Bilinear height at (x east, y north) metres, or NaN outside the grid. */
export function sampleGrid(g: Grid, x: number, y: number): number {
  const fc = ((x + g.halfM) / (2 * g.halfM)) * (g.n - 1);
  const fr = ((y + g.halfM) / (2 * g.halfM)) * (g.n - 1);
  if (fc < 0 || fr < 0 || fc >= g.n - 1 || fr >= g.n - 1) return NaN;
  const c = Math.floor(fc), r = Math.floor(fr);
  const tc = fc - c, tr = fr - r;
  const i = r * g.n + c;
  const h = g.heights;
  return (1 - tr) * ((1 - tc) * h[i] + tc * h[i + 1]) + tr * ((1 - tc) * h[i + g.n] + tc * h[i + g.n + 1]);
}

/** Height from the finest grid covering the point. */
export function heightAt(t: AreaTerrain, x: number, y: number): number {
  const h = sampleGrid(t.near, x, y);
  return Number.isNaN(h) ? sampleGrid(t.far, x, y) : h;
}

/** Great-circle destination from (lat, lon) along true azimuth `azDeg` for `dM` metres. */
export function destination(latDeg: number, lonDeg: number, azDeg: number, dM: number): [number, number] {
  const p1 = latDeg * D2R, l1 = lonDeg * D2R, a = azDeg * D2R, d = dM / R_M;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(a));
  const l2 = l1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / D2R, l2 / D2R];
}

/** Grid (x east, y north, metres) of a lat/lon, about the area centre (forward azimuthal equidistant). */
export function toGrid(t: { lat: number; lon: number }, latDeg: number, lonDeg: number): [number, number] {
  const p1 = t.lat * D2R, p2 = latDeg * D2R, dl = (lonDeg - t.lon) * D2R;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, c))) * R_M;
  const b = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
  return [d * Math.sin(b), d * Math.cos(b)];
}

/** Lat/lon of a grid point (inverse azimuthal equidistant about the area centre). */
export function fromGrid(t: { lat: number; lon: number }, x: number, y: number): [number, number] {
  const d = Math.hypot(x, y);
  return d < 1e-3 ? [t.lat, t.lon] : destination(t.lat, t.lon, (Math.atan2(x, y) * 180) / Math.PI, d);
}
