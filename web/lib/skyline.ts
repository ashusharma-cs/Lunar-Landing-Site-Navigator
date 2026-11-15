// In-browser skyline for any point the user picks inside a region's terrain area. Same algorithm as
// pipeline/skylines.py: rays follow TRUE-azimuth great circles from the point, exact spherical
// elevation angle, observer height above ground. The area grids are used only to look heights up.
// Validated against the Python engine in scripts/check-skyline.ts (refs from pipeline/check_terrain.py).

import { type AreaTerrain, destination, heightAt, toGrid } from "./terrain.ts";

const R_M = 1_737_400;
const REACH_M = 200_000;
/** Each march step is 2 % longer than the last (shared with the eye-level horizon mesh). */
export const STEP_RATIO = 1.02;

export function computeSkyline(t: AreaTerrain, lat: number, lon: number, obsH: number, nAz = 720): Float32Array {
  const [x0, y0] = toGrid(t, lat, lon);
  const r0 = R_M + heightAt(t, x0, y0) + obsH;
  const step0 = (2 * t.near.halfM) / t.near.n;
  const out = new Float32Array(nAz);
  for (let j = 0; j < nAz; j++) {
    const az = (j * 360) / nAz;
    let best = -90;
    for (let d = step0; d < REACH_M; d *= STEP_RATIO) {
      const [la, lo] = destination(lat, lon, az, d);
      const [x, y] = toGrid(t, la, lo);
      const h = heightAt(t, x, y);
      if (Number.isNaN(h)) break;
      const delta = d / R_M;
      const rq = R_M + h;
      const ang = (Math.atan2(rq * Math.cos(delta) - r0, rq * Math.sin(delta)) * 180) / Math.PI;
      if (ang > best) best = ang;
    }
    out[j] = best;
  }
  return out;
}

/**
 * Eye-level terrain mesh around a point: rings at exactly the skyline's sample distances along
 * true-azimuth great circles, so the horizon drawn in 3D is the horizon the numbers use. Vertices
 * are in scene coordinates (x = grid east, z = -grid north, y = 0); heights are applied on the GPU
 * from the same grids. A small fan of close rings covers the ground under the observer.
 */
export function horizonMesh(t: AreaTerrain, lat: number, lon: number, nAz = 1440): { positions: Float32Array; index: Uint32Array } {
  const step0 = (2 * t.near.halfM) / t.near.n;
  const rings = [0.5, 1.5, 3, 6, 12, 25].filter((d) => d < step0);
  for (let d = step0; d < REACH_M; d *= STEP_RATIO) rings.push(d);
  const [cx, cy] = toGrid(t, lat, lon);
  const positions = new Float32Array((1 + rings.length * nAz) * 3);
  positions.set([cx, 0, -cy], 0);
  let k = 3;
  for (const d of rings) {
    for (let j = 0; j < nAz; j++) {
      const [la, lo] = destination(lat, lon, (j * 360) / nAz, d);
      const [x, y] = toGrid(t, la, lo);
      positions[k++] = x;
      positions[k++] = 0;
      positions[k++] = -y;
    }
  }
  const index = new Uint32Array(nAz * 3 + (rings.length - 1) * nAz * 6);
  let i = 0;
  const v = (ring: number, j: number) => 1 + ring * nAz + (j % nAz);
  for (let j = 0; j < nAz; j++) index.set([0, v(0, j + 1), v(0, j)], (i += 3) - 3);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < nAz; j++) {
      const a = v(r, j), b = v(r, j + 1), c = v(r + 1, j), d = v(r + 1, j + 1);
      index.set([a, b, c, b, d, c], i);
      i += 6;
    }
  }
  return { positions, index };
}
