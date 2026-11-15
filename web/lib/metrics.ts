// Mission metrics for a point: when it has Sun and Earth, the longest stretches without them, and
// countdowns to the next change. One scan per point and window samples every 10 minutes and pins
// each state change to 30 s by bisection on the same engine (lib/track.ts samplePoint); every metric
// below is derived from that event list. Validated against a 1-minute brute-force scan in
// scripts/check-metrics.ts.

import type { Ephemeris } from "./ephemeris.ts";
import { type TrackPoint, samplePoint } from "./track.ts";

const STEP_MS = 10 * 60_000;
const REFINE_MS = 30_000;
const DAY_MS = 86_400_000;
/** How far past the window countdowns look for the next change. */
export const LOOKAHEAD_MS = 60 * DAY_MS;

export type PointCtx = { eph: Ephemeris; sky: Float32Array; lat: number; lon: number; hM: number };
export type Pred = (p: TrackPoint) => boolean;

/** Any part of the Sun's disc above the skyline (solar panels at observer height get light). */
export const sunLit: Pred = (p) => p.sunVis > 0;
/** Earth's centre above the skyline: the conservative direct-to-Earth criterion. */
export const earthInView: Pred = (p) => p.earthVis >= 0.5;
/** Any part of Earth's disc above the skyline (NASA's Earth-visibility definition). */
export const earthAnyPart: Pred = (p) => p.earthVis > 0;

export type Change = { at: number; to: boolean };
/** State of one predicate over [start, end]: initial state plus every change, in time order. */
export type Events = { start: number; end: number; initial: boolean; changes: Change[] };

function sample(ctx: PointCtx, t: number) {
  return samplePoint(ctx.eph, ctx.sky, ctx.lat, ctx.lon, ctx.hM, t);
}

/** Scan [start, end] once for several predicates. `end` shrinks to the last time the ephemeris covers. */
export function scanEvents(ctx: PointCtx, start: number, end: number, preds: Pred[]): Events[] | null {
  const first = sample(ctx, start);
  if (!first) return null;
  const out: Events[] = preds.map((f) => ({ start, end: start, initial: f(first), changes: [] }));
  const state = preds.map((f) => f(first));
  let prevT = start;
  for (let t = start + STEP_MS; t <= end; t += STEP_MS) {
    const p = sample(ctx, t);
    if (!p) break;
    preds.forEach((f, i) => {
      const s = f(p);
      if (s === state[i]) return;
      // Bisect between the two samples for this predicate's change.
      let a = prevT, b = t;
      while (b - a > REFINE_MS) {
        const m = (a + b) / 2;
        const q = sample(ctx, m);
        if (q && f(q) === state[i]) a = m;
        else b = m;
      }
      out[i].changes.push({ at: b, to: s });
      state[i] = s;
    });
    prevT = t;
    for (const e of out) e.end = t;
  }
  return out;
}

export function stateAt(ev: Events, t: number): boolean {
  let s = ev.initial;
  for (const c of ev.changes) {
    if (c.at > t) break;
    s = c.to;
  }
  return s;
}

/** Next change after `t`, or null if none before the scanned end. */
export function nextChange(ev: Events, t: number): Change | null {
  return ev.changes.find((c) => c.at > t) ?? null;
}

/** Fraction of [from, to] spent in state `want`. */
export function fractionIn(ev: Events, from: number, to: number, want: boolean): number {
  let total = 0;
  for (const r of runs(ev, from, to)) if (r.state === want) total += r.end - r.start;
  return total / (to - from);
}

export type Run = { state: boolean; start: number; end: number; openStart: boolean; openEnd: boolean };

/** Maximal runs of constant state clipped to [from, to]; open ends touch the clip edges. */
export function runs(ev: Events, from: number, to: number): Run[] {
  const out: Run[] = [];
  let s = ev.initial, t0 = ev.start;
  const push = (end: number) => {
    const a = Math.max(t0, from), b = Math.min(end, to);
    if (b > a) out.push({ state: s, start: a, end: b, openStart: a === from, openEnd: b === to });
  };
  for (const c of ev.changes) {
    push(c.at);
    s = c.to;
    t0 = c.at;
  }
  push(ev.end);
  return out;
}

/** Longest run in state `want` within [from, to]. Open-ended runs are lower bounds ("at least"). */
export function longestRun(ev: Events, from: number, to: number, want: boolean): Run | null {
  let best: Run | null = null;
  for (const r of runs(ev, from, to)) if (r.state === want && (!best || r.end - r.start > best.end - best.start)) best = r;
  return best;
}

/** "sets in 3 d 4 h" style countdown to the next change, or a note when none is in range. */
export function countdown(ev: Events, t: number, words: { on: string; off: string }): string {
  const c = nextChange(ev, t);
  if (!c) return `${stateAt(ev, t) ? "no change" : "none"} for ${formatDuration(ev.end - t)}+`;
  return `${c.to ? words.on : words.off} in ${formatDuration(c.at - t)}`;
}

/** Longest run as text; "≥" when it touches the window edge (true length unknown). */
export function runText(r: Run | null): string {
  if (!r) return "none";
  return `${r.openStart || r.openEnd ? "≥ " : ""}${formatDuration(r.end - r.start)}`;
}

export function formatDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, "0")} m`;
  return `${min} m`;
}
