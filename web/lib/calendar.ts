// Launch-window calendar: for each landing day, what a stay of N days at the point would get.
// Built on one event scan (lib/metrics.ts) covering the month plus the stay; each day is then a
// few cheap look-ups. The ratings are this app's own thresholds, not a NASA criterion, and the
// UI says so.

import { type Events, type PointCtx, earthInView, fractionIn, longestRun, scanEvents, sunLit } from "./metrics.ts";

const DAY_MS = 86_400_000;
/** Gaps up to this long still count as "the whole stay" (a Sun grazing a ridge can flicker). */
export const GRACE_MS = 60 * 60_000;

export type Rating = "good" | "fair" | "poor";
export type StayDay = {
  /** Landing time: 00:00 UTC on this day. */
  day: number;
  sunFrac: number;
  earthFrac: number;
  longestDarkMs: number;
  longestBlackoutMs: number;
  rating: Rating;
} | { day: number; rating: null };

/**
 * Good: Sun and Earth (centre) through the whole stay, no gap over an hour.
 * Fair: each for at least half the stay. Poor: either less than half.
 */
export function rate(sunFrac: number, earthFrac: number, longestDarkMs: number, longestBlackoutMs: number): Rating {
  if (longestDarkMs <= GRACE_MS && longestBlackoutMs <= GRACE_MS) return "good";
  if (sunFrac >= 0.5 && earthFrac >= 0.5) return "fair";
  return "poor";
}

function stay(sun: Events, earth: Events, day: number, stayMs: number): StayDay {
  const end = day + stayMs;
  if (end > Math.min(sun.end, earth.end)) return { day, rating: null };  // past the ephemeris
  const sunFrac = fractionIn(sun, day, end, true);
  const earthFrac = fractionIn(earth, day, end, true);
  const dark = longestRun(sun, day, end, false);
  const black = longestRun(earth, day, end, false);
  const longestDarkMs = dark ? dark.end - dark.start : 0;
  const longestBlackoutMs = black ? black.end - black.start : 0;
  return { day, sunFrac, earthFrac, longestDarkMs, longestBlackoutMs, rating: rate(sunFrac, earthFrac, longestDarkMs, longestBlackoutMs) };
}

/** One entry per UTC day of [firstDay, lastDay], each landing at 00:00 UTC and staying `stayDays`. */
export function stayCalendar(ctx: PointCtx, firstDay: number, lastDay: number, stayDays: number): StayDay[] | null {
  const stayMs = stayDays * DAY_MS;
  const ev = scanEvents(ctx, firstDay, lastDay + stayMs, [sunLit, earthInView]);
  if (!ev) return null;
  const out: StayDay[] = [];
  for (let d = firstDay; d <= lastDay; d += DAY_MS) out.push(stay(ev[0], ev[1], d, stayMs));
  return out;
}
