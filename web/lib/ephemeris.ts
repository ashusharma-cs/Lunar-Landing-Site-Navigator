// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Hourly Sun/Earth geometry produced by pipeline/build_ephemeris.py, one Float32 file per year.

import { cachedBytes } from "./assetCache.ts";
import type { Vec3 } from "./astro";

const HOUR_MS = 3_600_000;
const FLOATS = 12; // sun xyz, sun km, earth xyz, earth km, quaternion xyzw

export type EphemerisState = { sun: Vec3; earth: Vec3; sunKm: number; earthKm: number; q: [number, number, number, number] };

type Year = { year: number; startMs: number; hours: number; data: Float32Array };

const years = new Map<number, Promise<Year>>();
let indexPromise: Promise<{ years: { year: number; start: string; hours: number; v?: string }[] }> | null = null;

function index() {
  indexPromise ??= fetch("/data/ephemeris/index.json").then((r) => r.json());
  return indexPromise;
}

export async function availableYears(): Promise<number[]> {
  return (await index()).years.map((y) => y.year);
}

function loadYear(year: number): Promise<Year> {
  let p = years.get(year);
  if (!p) {
    p = (async () => {
      const meta = (await index()).years.find((y) => y.year === year);
      if (!meta) throw new Error(`No ephemeris for ${year}`);
      const buf = await cachedBytes(`/data/ephemeris/${year}.bin${meta.v ? `?v=${meta.v}` : ""}`);
      return { year, startMs: Date.parse(meta.start), hours: meta.hours, data: new Float32Array(buf) };
    })();
    years.set(year, p);
  }
  return p;
}

/** Ephemeris covering [startMs, endMs], loading the needed year files. */
export async function loadEphemeris(startMs: number, endMs: number): Promise<Ephemeris> {
  const y0 = new Date(startMs).getUTCFullYear();
  const y1 = new Date(endMs).getUTCFullYear() + (new Date(endMs).getUTCMonth() === 11 ? 1 : 0);
  const avail = new Set(await availableYears());
  const loaded = await Promise.all(
    Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((y) => avail.has(y)).map(loadYear),
  );
  if (!loaded.length) throw new Error(`No JPL Horizons ephemeris loaded for ${y0}. Available: ${[...avail].join(", ")}.`);
  return new Ephemeris(loaded);
}

export class Ephemeris {
  private readonly yrs: Year[];

  constructor(yrs: Year[]) {
    this.yrs = yrs;
  }

  get startMs() {
    return this.yrs[0]?.startMs ?? NaN;
  }

  get endMs() {
    const last = this.yrs[this.yrs.length - 1];
    return last ? last.startMs + (last.hours - 1) * HOUR_MS : NaN;
  }

  private row(tMs: number): { y: Year; i: number } | null {
    for (const y of this.yrs) {
      const i = Math.floor((tMs - y.startMs) / HOUR_MS);
      if (i >= 0 && i < y.hours) return { y, i };
    }
    return null;
  }

  private rec(y: Year, i: number, k: number) {
    return y.data[i * FLOATS + k];
  }

  /** Linearly interpolated state at a time (unit vectors re-normalised). Null outside coverage. */
  at(tMs: number): EphemerisState | null {
    const a = this.row(tMs);
    if (!a) return null;
    const b = this.row(tMs + HOUR_MS) ?? a;
    const f = (tMs - (a.y.startMs + a.i * HOUR_MS)) / HOUR_MS;
    const v = (k: number) => this.rec(a.y, a.i, k) * (1 - f) + this.rec(b.y, b.i, k) * f;
    const unit = (k: number): Vec3 => {
      const x = v(k), y = v(k + 1), z = v(k + 2);
      const n = Math.hypot(x, y, z);
      return [x / n, y / n, z / n];
    };
    const sunKm = v(3);
    const earthKm = v(7);
    const su = unit(0);
    const eu = unit(4);
    const q: [number, number, number, number] = [v(8), v(9), v(10), v(11)];
    const qn = Math.hypot(...q);
    return {
      sun: [su[0] * sunKm, su[1] * sunKm, su[2] * sunKm],
      earth: [eu[0] * earthKm, eu[1] * earthKm, eu[2] * earthKm],
      sunKm,
      earthKm,
      q: [q[0] / qn, q[1] / qn, q[2] / qn, q[3] / qn],
    };
  }
}
