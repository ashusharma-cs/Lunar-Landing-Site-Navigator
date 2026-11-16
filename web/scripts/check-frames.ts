// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Check lib/frames.ts: the Earth point Horizons says faces the Moon (sub-observer point seen
// from the Moon's centre) must, after earthOrientation(), point from Earth back to the Moon.
// Run: node scripts/check-frames.ts ../pipeline/cache/check_sublunar.json
import { readFileSync } from "node:fs";
import { Vector3 } from "three";
import { Ephemeris } from "../lib/ephemeris.ts";
import { earthOrientation, meToThree } from "../lib/frames.ts";

const ref = JSON.parse(readFileSync(process.argv[2], "utf8"));
const idx = JSON.parse(readFileSync("public/data/ephemeris/index.json", "utf8"));
const meta = idx.years.find((y: { year: number }) => y.year === 2026);
const buf = readFileSync("public/data/ephemeris/2026.bin");
const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const eph = new Ephemeris([{ year: 2026, startMs: Date.parse(meta.start), hours: meta.hours, data }] as never);

let worst = 0;
for (const r of ref) {
  const t = Date.parse(r.t);
  const s = eph.at(t)!;
  const lon = (r.lon * Math.PI) / 180, lat = (r.lat * Math.PI) / 180;
  // Earth-fixed unit vector in the mesh's local three.js frame: (x, z, -y) of Earth-fixed.
  const local = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  const world = local.applyQuaternion(earthOrientation(s.q, t));
  const toMoon = meToThree(s.earth).negate().normalize();
  worst = Math.max(worst, (world.angleTo(toMoon) * 180) / Math.PI);
}
console.log(`sub-Moon point on Earth: max angle from Earth->Moon direction ${worst.toFixed(3)} deg over ${ref.length} times`);
