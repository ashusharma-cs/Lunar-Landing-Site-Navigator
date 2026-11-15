// Check lib/skyline.ts (in-browser skyline from area grids) against the Python skyline engine at
// centre and off-centre points in every region area. Refs: pipeline/check_terrain.py.
// Run: node scripts/check-skyline.ts ../pipeline/cache/skyline_refs.json
import { readFileSync } from "node:fs";
import { grid } from "./node-terrain.ts";
import { computeSkyline } from "../lib/skyline.ts";
import type { AreaTerrain } from "../lib/terrain.ts";


const refs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const areas = new Map<string, AreaTerrain>();
const diffs: number[] = [];
let ms = 0;
for (const r of refs) {
  let t = areas.get(r.area);
  if (!t) {
    const meta = JSON.parse(readFileSync(`public/data/terrain/${r.area}/meta.json`, "utf8"));
    t = { id: r.area, lat: meta.lat, lon: meta.lon, terrain: meta.terrain, near: grid(r.area, meta.grids.near), far: grid(r.area, meta.grids.far) };
    areas.set(r.area, t);
  }
  const t0 = performance.now();
  const sky = computeSkyline(t, r.lat, r.lon, 2.0);
  ms += performance.now() - t0;
  for (let j = 0; j < 720; j++) diffs.push(Math.abs(sky[j] - r.skyline720[j]));
}
diffs.sort((a, b) => a - b);
const pct = (p: number) => diffs[Math.floor((p / 100) * (diffs.length - 1))].toFixed(3);
console.log(`${refs.length} points x 720 azimuths: median ${pct(50)} deg, 95th ${pct(95)} deg, max ${pct(100)} deg; ${(ms / refs.length).toFixed(0)} ms per skyline`);
