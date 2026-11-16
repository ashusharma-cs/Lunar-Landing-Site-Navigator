// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Best-spot finder. The GPU survey (components/surface/Terrain.tsx) gives, for every cell of a
// region's terrain area, the fraction of a window's time steps with the Sun lit, Earth in view
// (centre clears the skyline) and both at once. Here: slope per cell from the LOLA grid, ranking
// by "both" among cells no steeper than a limit, and a re-check of each ranked spot with the full
// CPU skyline (lib/skyline.ts) at the same time steps.

import type { Ephemeris } from "./ephemeris.ts";
import { computeSkyline } from "./skyline.ts";
import { type AreaTerrain, fromGrid, heightAt } from "./terrain.ts";
import { samplePoint } from "./track.ts";

const DEG = 180 / Math.PI;

/** Cell centre (grid metres, x east / y north) of cell (i, j) in a cells x cells survey of the near grid. */
export function cellCentre(t: AreaTerrain, cells: number, i: number, j: number): [number, number] {
  const h = t.near.halfM;
  return [((i + 0.5) / cells) * 2 * h - h, ((j + 0.5) / cells) * 2 * h - h];
}

/** Survey cell holding grid point (x, y), or null outside the near grid. */
export function cellAt(t: AreaTerrain, cells: number, x: number, y: number): [number, number] | null {
  const h = t.near.halfM;
  const i = Math.floor(((x + h) / (2 * h)) * cells), j = Math.floor(((y + h) / (2 * h)) * cells);
  return i < 0 || j < 0 || i >= cells || j >= cells ? null : [i, j];
}

/** Slope (deg) at grid point (x, y): central differences over one LOLA grid step either side. */
export function slopeAt(t: AreaTerrain, x: number, y: number): number {
  const s = (2 * t.near.halfM) / t.near.n;
  const dx = (heightAt(t, x + s, y) - heightAt(t, x - s, y)) / (2 * s);
  const dy = (heightAt(t, x, y + s) - heightAt(t, x, y - s)) / (2 * s);
  return Math.atan(Math.hypot(dx, dy)) * DEG;
}

/** Writes slope into channel 3 of the survey data (in place) and returns it. */
export function addSlope(t: AreaTerrain, cells: number, data: Float32Array): Float32Array {
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const [x, y] = cellCentre(t, cells, i, j);
      const v = slopeAt(t, x, y);
      data[(j * cells + i) * 4 + 3] = Number.isFinite(v) ? v : 90;
    }
  }
  return data;
}

export type Spot = {
  rank: number;
  x: number; y: number; lat: number; lon: number; groundM: number; slopeDeg: number;
  /** From the GPU survey (cell centre). */
  gpu: { sun: number; earth: number; both: number };
  /** Re-checked with the full CPU skyline at the same time steps; null until confirmed. */
  cpu: { sun: number; earth: number; both: number } | null;
};

/**
 * Top spots by time with Sun and Earth together, among cells no steeper than maxSlope; ties go to
 * more Sun. Spots are kept at least minSepM apart so the list isn't one hilltop five times.
 * maxRadiusM limits the search to a circle about the area centre (the named feature's ring).
 */
export function rankSpots(t: AreaTerrain, cells: number, data: Float32Array, maxSlope: number,
  { count = 5, minSepM = 2000, maxRadiusM = Infinity }: { count?: number; minSepM?: number; maxRadiusM?: number } = {}): Spot[] {
  const order: number[] = [];
  for (let k = 0; k < cells * cells; k++) {
    if (data[k * 4 + 3] > maxSlope) continue;
    if (maxRadiusM < Infinity && Math.hypot(...cellCentre(t, cells, k % cells, Math.floor(k / cells))) > maxRadiusM) continue;
    order.push(k);
  }
  order.sort((a, b) => data[b * 4 + 2] - data[a * 4 + 2] || data[b * 4] - data[a * 4]);
  const out: Spot[] = [];
  for (const k of order) {
    if (out.length >= count) break;
    const i = k % cells, j = Math.floor(k / cells);
    const [x, y] = cellCentre(t, cells, i, j);
    if (out.some((s) => Math.hypot(s.x - x, s.y - y) < minSepM)) continue;
    const [lat, lon] = fromGrid(t, x, y);
    out.push({
      rank: out.length + 1, x, y, lat, lon, groundM: heightAt(t, x, y), slopeDeg: data[k * 4 + 3],
      gpu: { sun: data[k * 4], earth: data[k * 4 + 1], both: data[k * 4 + 2] }, cpu: null,
    });
  }
  return out;
}

/** Survey time steps: midpoints of `count` equal slices of [startMs, endMs]. */
export function stepTimes(startMs: number, endMs: number, count: number): number[] {
  const dt = (endMs - startMs) / count;
  return Array.from({ length: count }, (_, k) => startMs + (k + 0.5) * dt);
}

/** Re-check one spot with the full skyline (720 azimuths, 200 km) at the survey's time steps. */
export function confirmSpot(t: AreaTerrain, eph: Ephemeris, times: number[], s: Spot, obsH: number): NonNullable<Spot["cpu"]> {
  const sky = computeSkyline(t, s.lat, s.lon, obsH);
  let sun = 0, earth = 0, both = 0, n = 0;
  for (const tm of times) {
    const p = samplePoint(eph, sky, s.lat, s.lon, s.groundM + obsH, tm);
    if (!p) continue;
    const lit = p.sunVis > 0, seen = p.earthVis >= 0.5;
    sun += +lit;
    earth += +seen;
    both += +(lit && seen);
    n++;
  }
  return { sun: sun / n, earth: earth / n, both: both / n };
}
