// Check lib/metrics.ts (10-minute scan + 30 s bisection) against a brute-force 1-minute scan of the
// same engine, at several region points over a 30-day window: every state change and every longest
// run must agree. Run: node scripts/check-metrics.ts ../pipeline/cache/skyline_refs.json
import { readFileSync } from "node:fs";
import { grid } from "./node-terrain.ts";
import { Ephemeris } from "../lib/ephemeris.ts";
import { earthAnyPart, earthInView, longestRun, type Pred, scanEvents, sunLit } from "../lib/metrics.ts";
import { computeSkyline } from "../lib/skyline.ts";
import { type AreaTerrain, heightAt, toGrid } from "../lib/terrain.ts";
import { samplePoint } from "../lib/track.ts";

const idx = JSON.parse(readFileSync("public/data/ephemeris/index.json", "utf8"));
const years = idx.years.filter((y: { year: number }) => y.year >= 2026).map((y: { year: number; start: string; hours: number }) => {
  const b = readFileSync(`public/data/ephemeris/${y.year}.bin`);
  return { year: y.year, startMs: Date.parse(y.start), hours: y.hours, data: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
});
const eph = new Ephemeris(years as never);

const refs = JSON.parse(readFileSync(process.argv[2], "utf8")).filter((_: unknown, i: number) => i % 3 !== 0).slice(0, 8);
const start = Date.UTC(2026, 10, 14), end = start + 30 * 86_400_000;
const preds: [string, Pred][] = [["sun", sunLit], ["earth in view", earthInView], ["earth any", earthAnyPart]];
let worstChange = 0, worstRun = 0, changes = 0, ms = 0;
for (const r of refs) {
  const m = JSON.parse(readFileSync(`public/data/terrain/${r.area}/meta.json`, "utf8"));
  const t: AreaTerrain = { id: r.area, lat: m.lat, lon: m.lon, terrain: m.terrain, near: grid(r.area, m.grids.near), far: grid(r.area, m.grids.far) };
  const [x, y] = toGrid(t, r.lat, r.lon);
  const ctx = { eph, sky: computeSkyline(t, r.lat, r.lon, 2), lat: r.lat, lon: r.lon, hM: heightAt(t, x, y) + 2 };
  const t0 = performance.now();
  const evs = scanEvents(ctx, start, end, preds.map((p) => p[1]))!;
  ms += performance.now() - t0;
  preds.forEach(([, f], i) => {
    // Brute force: state every minute; changes at the first minute of the new state.
    const brute: number[] = [];
    let prev = f(samplePoint(eph, ctx.sky, ctx.lat, ctx.lon, ctx.hM, start)!);
    let run = 0, bestTrue = 0, bestFalse = 0;
    for (let tm = start + 60_000; tm <= evs[i].end; tm += 60_000) {
      const s = f(samplePoint(eph, ctx.sky, ctx.lat, ctx.lon, ctx.hM, tm)!);
      if (s !== prev) {
        brute.push(tm);
        run = 0;
        prev = s;
      }
      run += 60_000;
      if (s) bestTrue = Math.max(bestTrue, run);
      else bestFalse = Math.max(bestFalse, run);
    }
    const ours = evs[i].changes.map((c) => c.at);
    if (ours.length !== brute.length) console.log(`MISMATCH ${r.area} ${preds[i][0]}: ${ours.length} vs ${brute.length} changes`);
    ours.forEach((a, k) => (worstChange = Math.max(worstChange, Math.abs(a - (brute[k] ?? a)))));
    changes += ours.length;
    for (const want of [true, false]) {
      const lr = longestRun(evs[i], start, evs[i].end, want);
      const b = want ? bestTrue : bestFalse;
      if (lr && b) worstRun = Math.max(worstRun, Math.abs(lr.end - lr.start - b));
    }
  });
}
console.log(`${refs.length} points x 3 states, 30 days: ${changes} state changes; worst change-time difference ${(worstChange / 1000).toFixed(0)} s, ` +
  `worst longest-run difference ${(worstRun / 1000).toFixed(0)} s; ${(ms / refs.length).toFixed(0)} ms per scan`);
