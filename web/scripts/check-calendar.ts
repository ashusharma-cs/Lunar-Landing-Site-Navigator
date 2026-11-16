// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Check lib/calendar.ts against brute force: for every landing day of two months at several region
// points, sample the stay every minute with the same engine and recompute Sun/Earth fractions,
// longest gaps and the rating. Run: node scripts/check-calendar.ts ../pipeline/cache/skyline_refs.json
import { readFileSync } from "node:fs";
import { grid } from "./node-terrain.ts";
import { rate, stayCalendar } from "../lib/calendar.ts";
import { Ephemeris } from "../lib/ephemeris.ts";
import { earthInView, sunLit } from "../lib/metrics.ts";
import { computeSkyline } from "../lib/skyline.ts";
import { type AreaTerrain, heightAt, toGrid } from "../lib/terrain.ts";
import { samplePoint } from "../lib/track.ts";

const idx = JSON.parse(readFileSync("public/data/ephemeris/index.json", "utf8"));
const years = idx.years.filter((y: { year: number }) => y.year >= 2026).map((y: { year: number; start: string; hours: number }) => {
  const b = readFileSync(`public/data/ephemeris/${y.year}.bin`);
  return { year: y.year, startMs: Date.parse(y.start), hours: y.hours, data: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
});
const eph = new Ephemeris(years as never);

const DAY = 86_400_000, MIN = 60_000, STAY = 7;
const refs = JSON.parse(readFileSync(process.argv[2], "utf8")).filter((_: unknown, i: number) => i % 4 === 1).slice(0, 5);
const first = Date.UTC(2026, 11, 1), last = Date.UTC(2027, 0, 31);
let days = 0, ratingMismatch = 0, worstFrac = 0, worstGap = 0, ms = 0;
const counts = { good: 0, fair: 0, poor: 0 };
for (const r of refs) {
  const m = JSON.parse(readFileSync(`public/data/terrain/${r.area}/meta.json`, "utf8"));
  const t: AreaTerrain = { id: r.area, lat: m.lat, lon: m.lon, terrain: m.terrain, near: grid(r.area, m.grids.near), far: grid(r.area, m.grids.far) };
  const [x, y] = toGrid(t, r.lat, r.lon);
  const ctx = { eph, sky: computeSkyline(t, r.lat, r.lon, 2), lat: r.lat, lon: r.lon, hM: heightAt(t, x, y) + 2 };
  const t0 = performance.now();
  const cal = stayCalendar(ctx, first, last, STAY)!;
  ms += performance.now() - t0;
  // Brute-force states every minute across the whole span, then each stay as a slice of it.
  const n = Math.round((last + STAY * DAY - first) / MIN);
  const sun = new Uint8Array(n), earth = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = samplePoint(eph, ctx.sky, ctx.lat, ctx.lon, ctx.hM, first + i * MIN)!;
    sun[i] = +sunLit(p);
    earth[i] = +earthInView(p);
  }
  for (const c of cal) {
    if (c.rating === null) continue;
    const i0 = Math.round((c.day - first) / MIN), i1 = i0 + STAY * 1440;
    const stats = (a: Uint8Array) => {
      let on = 0, run = 0, gap = 0;
      for (let i = i0; i < i1; i++) {
        if (a[i]) { on++; run = 0; } else gap = Math.max(gap, ++run);
      }
      return { frac: on / (i1 - i0), gap: gap * MIN };
    };
    const s = stats(sun), e = stats(earth);
    worstFrac = Math.max(worstFrac, Math.abs(s.frac - c.sunFrac), Math.abs(e.frac - c.earthFrac));
    worstGap = Math.max(worstGap, Math.abs(s.gap - c.longestDarkMs), Math.abs(e.gap - c.longestBlackoutMs));
    if (rate(s.frac, e.frac, s.gap, e.gap) !== c.rating) ratingMismatch++;
    counts[c.rating]++;
    days++;
  }
}
console.log(`${refs.length} points x ${days / refs.length} landing days, ${STAY}-day stays: ratings ${JSON.stringify(counts)}; ` +
  `${ratingMismatch} rating mismatches vs 1-minute brute force; worst fraction difference ${(100 * worstFrac).toFixed(2)} pp, ` +
  `worst longest-gap difference ${(worstGap / 1000).toFixed(0)} s; ${(ms / refs.length).toFixed(0)} ms per calendar`);
