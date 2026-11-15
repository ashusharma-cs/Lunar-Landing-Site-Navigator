// Cross-check lib/astro.ts + lib/ephemeris.ts (float32, hourly, interpolated) against Horizons
// method A at 10-minute steps. Run: node scripts/check-astro.ts <horizons-json>
import { readFileSync } from "node:fs";
import { azEl } from "../lib/astro.ts";
import { Ephemeris } from "../lib/ephemeris.ts";

const ref = JSON.parse(readFileSync(process.argv[2], "utf8"));
const idx = JSON.parse(readFileSync("public/data/ephemeris/index.json", "utf8"));
const meta = idx.years.find((y: { year: number }) => y.year === 2026);
const buf = readFileSync("public/data/ephemeris/2026.bin");
const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const eph = new Ephemeris([{ year: 2026, startMs: Date.parse(meta.start), hours: meta.hours, data }] as never);

for (const body of ["sun", "earth"] as const) {
  let dAz = 0, dEl = 0;
  for (const r of ref[body]) {
    const s = eph.at(Date.parse(r.t))!;
    const { az, el } = azEl(ref.lat, ref.lon, ref.heightM, s[body]);
    dAz = Math.max(dAz, Math.abs(((az - r.az + 540) % 360) - 180));
    dEl = Math.max(dEl, Math.abs(el - r.el));
  }
  console.log(`${body}: ${ref[body].length} samples, max |dAz| ${dAz.toFixed(4)} deg, max |dEl| ${dEl.toFixed(4)} deg`);
}
