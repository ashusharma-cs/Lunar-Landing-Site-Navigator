// Check that the eye-level horizon mesh draws the same horizon the numbers use: rebuild the mesh,
// place it in the scene's geometry (heights from the grids, curvature drop about the area centre),
// and measure the silhouette from the eye (2 m up along the point's local vertical) per mesh ray.
// Run: node scripts/check-horizon.ts ../pipeline/cache/skyline_refs.json
import { readFileSync } from "node:fs";
import { grid } from "./node-terrain.ts";
import { computeSkyline, horizonMesh } from "../lib/skyline.ts";
import { type AreaTerrain, heightAt, toGrid } from "../lib/terrain.ts";

const R = 1_737_400;

const refs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const diffs: number[] = [];
const areas = new Map<string, AreaTerrain>();
for (const r of refs) {
  let t = areas.get(r.area);
  if (!t) {
    const m = JSON.parse(readFileSync(`public/data/terrain/${r.area}/meta.json`, "utf8"));
    t = { id: r.area, lat: m.lat, lon: m.lon, terrain: m.terrain, near: grid(r.area, m.grids.near), far: grid(r.area, m.grids.far) };
    areas.set(r.area, t);
  }
  const hc = heightAt(t, 0, 0);
  const sceneY = (x: number, z: number) => heightAt(t, x, -z) - hc - (x * x + z * z) / (2 * R);
  const sky = computeSkyline(t, r.lat, r.lon, 2.0);
  const nAz = 1440;
  const { positions } = horizonMesh(t, r.lat, r.lon, nAz);
  const [gx, gy] = toGrid(t, r.lat, r.lon);
  const px = gx, pz = -gy;
  const up = [px / R, 1, pz / R];
  const ul = Math.hypot(...up);
  up[0] /= ul; up[1] /= ul; up[2] /= ul;
  const eye = [px + up[0] * 2, sceneY(px, pz) + up[1] * 2, pz + up[2] * 2];
  const rings = (positions.length / 3 - 1) / nAz;
  for (let j = 0; j < nAz; j += 2) {
    let best = -90;
    for (let k = 0; k < rings; k++) {
      const i = (1 + k * nAz + j) * 3;
      const x = positions[i], z = positions[i + 2];
      const y = sceneY(x, z);
      if (!Number.isFinite(y)) break;
      const dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      const ang = (Math.asin((dx * up[0] + dy * up[1] + dz * up[2]) / Math.hypot(dx, dy, dz)) * 180) / Math.PI;
      if (ang > best) best = ang;
    }
    diffs.push(Math.abs(best - sky[j / 2]));
  }
}
diffs.sort((a, b) => a - b);
const pct = (p: number) => diffs[Math.floor((p / 100) * (diffs.length - 1))].toFixed(4);
console.log(`drawn horizon vs computed skyline, ${refs.length} points x 720 azimuths: median ${pct(50)} deg, 95th ${pct(95)} deg, max ${pct(100)} deg`);
