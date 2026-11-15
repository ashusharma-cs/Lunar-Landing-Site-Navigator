"use client";

import { GRACE_MS, type Rating, rate } from "@/lib/calendar";
import { type Events, fractionIn, longestRun, nextChange } from "@/lib/metrics";
import type { TrackPoint } from "@/lib/track";

const DAY_MS = 86_400_000;
/** Stay length the verdict assumes (the calendar's default). */
export const VERDICT_STAY_DAYS = 7;

/** "3 days 4 hours", "5 hours", "40 minutes": durations for everyone. */
export function humanDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (d > 0) return h ? `${unit(d, "day")} ${unit(h, "hour")}` : unit(d, "day");
  if (h > 0) return min ? `${unit(h, "hour")} ${unit(min, "minute")}` : unit(h, "hour");
  return unit(min, "minute");
}

function next(ev: Events, t: number, on: string, off: string, horizonMs: number): string {
  const c = nextChange(ev, t);
  return c ? `${c.to ? on : off} in ${humanDuration(c.at - t)}` : `No change for over ${Math.round(horizonMs / DAY_MS)} days`;
}

function Bar({ frac, color }: { frac: number; color: string }) {
  return (
    <div className="mt-1 h-1 bg-white/[0.07]">
      <div className="h-full" style={{ width: `${100 * frac}%`, background: color }} />
    </div>
  );
}

function Card({ title, color, headline, tone, children }: {
  title: string; color: string; headline: string; tone: "ok" | "partial" | "bad"; children: React.ReactNode;
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "partial" ? "text-sun" : "text-bad";
  return (
    <section className="border-t border-line py-3">
      <p className="text-[11px] font-medium tracking-[0.08em] uppercase" style={{ color }}>{title}</p>
      <p className={`mt-1 text-[16px] leading-snug ${toneClass}`}>{headline}</p>
      <div className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-ink-2">{children}</div>
    </section>
  );
}

const VERDICT: Record<Rating, { word: string; tone: "ok" | "partial" | "bad" }> = {
  good: { word: "Good", tone: "ok" },
  fair: { word: "Fair", tone: "partial" },
  poor: { word: "Poor", tone: "bad" },
};

/**
 * Simple mode: the one question answered in three cards (power, talking to Earth, a verdict), worded for
 * students and the public. Same engine values as the detailed panel; nothing is approximated.
 */
export default function AnswerCards({ now, events, cursorMs, startMs, winEnd, days, lookaheadMs }: {
  now: TrackPoint; events: Events[]; cursorMs: number; startMs: number; winEnd: number; days: number; lookaheadMs: number;
}) {
  const [sun, earth] = events;
  const sunUp = now.sunVis > 0;
  const sunFrac = fractionIn(sun, startMs, winEnd, true);
  const earthFrac = fractionIn(earth, startMs, winEnd, true);
  const earthHead = now.earthVis >= 0.5 ? { t: "Can talk to Earth now", tone: "ok" as const }
    : now.earthVis > 0 ? { t: "Earth only peeking over the horizon", tone: "partial" as const }
    : { t: "Earth hidden: no direct radio", tone: "bad" as const };

  // Verdict for landing now and staying VERDICT_STAY_DAYS (calendar thresholds; app-chosen).
  const stayEnd = cursorMs + VERDICT_STAY_DAYS * DAY_MS;
  const canRate = stayEnd <= Math.min(sun.end, earth.end);
  const sF = canRate ? fractionIn(sun, cursorMs, stayEnd, true) : 0;
  const eF = canRate ? fractionIn(earth, cursorMs, stayEnd, true) : 0;
  const dark = canRate ? longestRun(sun, cursorMs, stayEnd, false) : null;
  const black = canRate ? longestRun(earth, cursorMs, stayEnd, false) : null;
  const rating = canRate ? rate(sF, eF, dark ? dark.end - dark.start : 0, black ? black.end - black.start : 0) : null;
  const pct = (f: number) => `${(100 * f).toFixed(0)}%`;
  const reason = !rating ? "" : rating === "good" ? "Sunlight and Earth contact the whole time."
    : `Sunlight ${pct(sF)} and Earth contact ${pct(eF)} of the stay.`;

  return (
    <div className="mt-4">
      <Card title={`Land here now for ${VERDICT_STAY_DAYS} days?`} color="var(--ink-2)"
            tone={rating ? VERDICT[rating].tone : "partial"} headline={rating ? VERDICT[rating].word : "Not enough data ahead"}>
        <p>{reason}</p>
        <p className="text-ink-3">
          Our rating, not NASA&apos;s: good = both all the time (gaps under {GRACE_MS / 3_600_000} h), fair = each at least half.
        </p>
      </Card>

      <Card title="Power" color="var(--sun)" tone={sunUp ? (now.sunVis < 1 ? "partial" : "ok") : "bad"}
            headline={sunUp ? (now.sunVis < 1 ? "Sun partly up: some power" : "Sun up: solar power") : "Dark: no solar power"}>
        <p>{next(sun, cursorMs, "Sun rises", "Sun sets", lookaheadMs)}.</p>
        {sunUp && <p className="text-ink-3">Sun {Math.max(0, now.sunEl - now.sunSky).toFixed(1)}° above the hills here; at the pole it always stays low.</p>}
        <div className="pt-1">
          <p>Sunlit {pct(sunFrac)} of these {days} days</p>
          <Bar frac={sunFrac} color="var(--sun)" />
        </div>
      </Card>

      <Card title="Talk to Earth" color="var(--earth)" tone={earthHead.tone} headline={earthHead.t}>
        <p>{next(earth, cursorMs, "Earth rises", "Earth sets", lookaheadMs)}.</p>
        <div className="pt-1">
          <p>Earth in view {pct(earthFrac)} of these {days} days</p>
          <Bar frac={earthFrac} color="var(--earth)" />
        </div>
      </Card>


    </div>
  );
}
