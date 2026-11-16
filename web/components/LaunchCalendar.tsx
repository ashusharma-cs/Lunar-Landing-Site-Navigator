// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/Controls";
import { GRACE_MS, type Rating, type StayDay, stayCalendar } from "@/lib/calendar";
import { formatDuration } from "@/lib/metrics";
import { useEphemeris } from "@/lib/useEphemeris";

const DAY_MS = 86_400_000;
const STAYS = [
  { value: 3, label: "3 d" },
  { value: 7, label: "7 d" },
  { value: 14, label: "14 d" },
];
// Rating colours stay clear of the Sun (amber) and Earth (blue) data colours; fair is neutral.
const TONE: Record<Rating, { word: string; label: string; color: string; tint: number }> = {
  good: { word: "good", label: "Sun and Earth the whole stay", color: "var(--ok)", tint: 14 },
  fair: { word: "fair", label: "Each at least half the stay", color: "var(--ink-2)", tint: 0 },
  poor: { word: "poor", label: "Sun or Earth under half", color: "var(--bad)", tint: 8 },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Rated = Extract<StayDay, { rating: Rating }>;

type Props = {
  sky: Float32Array; lat: number; lon: number; hM: number;
  /** Start of the analysis window; its month opens first and its day is outlined. */
  startMs: number;
  onPick: (dayMs: number) => void;
};

function monthStart(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function pct(f: number) {
  return (100 * f).toFixed(0);
}

function describe(c: StayDay, stay: number) {
  const head = `Land ${new Date(c.day).toISOString().slice(0, 10)} 00:00 UTC, ${stay}-day stay`;
  if (c.rating === null) return `${head}: beyond the loaded ephemeris`;
  return `${head}: Sun ${pct(c.sunFrac)}%, Earth in view ${pct(c.earthFrac)}%, ` +
    `longest darkness ${formatDuration(c.longestDarkMs)}, longest comms blackout ${formatDuration(c.longestBlackoutMs)}`;
}

/** Best day: highest of the weaker of Sun % and Earth %; ties go to the higher total, then the shorter worst gap. */
function bestDay(days: StayDay[]): Rated | null {
  let best: Rated | null = null;
  const key = (c: Rated) => [Math.min(c.sunFrac, c.earthFrac), c.sunFrac + c.earthFrac, -Math.max(c.longestDarkMs, c.longestBlackoutMs)];
  for (const c of days) {
    if (c.rating === null) continue;
    if (!best) { best = c; continue; }
    const a = key(c), b = key(best);
    const i = a.findIndex((v, k) => Math.abs(v - b[k]) > 1e-9);
    if (i >= 0 && a[i] > b[i]) best = c;
  }
  return best;
}

export default function LaunchCalendar({ sky, lat, lon, hM, startMs, onPick }: Props) {
  const [month, setMonth] = useState(() => monthStart(startMs));
  const [stay, setStay] = useState(7);
  const first = month;
  const next = new Date(month);
  const nextMonth = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  const last = nextMonth - DAY_MS;
  const { eph, error } = useEphemeris(first, last + stay * DAY_MS);

  const days = useMemo(
    () => (eph ? stayCalendar({ eph, sky, lat, lon, hM }, first, last, stay) : null),
    [eph, sky, lat, lon, hM, first, last, stay],
  );
  const best = days ? bestDay(days) : null;
  const counts = { good: 0, fair: 0, poor: 0 };
  for (const c of days ?? []) if (c.rating) counts[c.rating]++;
  // When no day is good, say which of the two never lasts the whole stay (it can be both).
  const rated = (days ?? []).filter((c): c is Rated => c.rating !== null);
  const sunNever = !rated.some((c) => c.longestDarkMs <= GRACE_MS);
  const earthNever = !rated.some((c) => c.longestBlackoutMs <= GRACE_MS);
  // How much "best" the best day deserves: a real pick (good or fair), only the closest (all poor), or
  // nothing at all when no day has both Sun and Earth (every day's weaker share is 0: they all tie).
  const verdict: "best" | "closest" | "none" | null = !best ? null
    : best.rating !== "poor" ? "best" : Math.min(best.sunFrac, best.earthFrac) > 0 ? "closest" : "none";
  const noEarthAtAll = rated.length > 0 && rated.every((c) => c.earthFrac === 0);
  const noSunAtAll = rated.length > 0 && rated.every((c) => c.sunFrac === 0);
  const lead = (new Date(first).getUTCDay() + 6) % 7;  // Monday-first grid
  const nDays = Math.round((last - first) / DAY_MS) + 1;
  const picked = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate());
  const title = new Date(first).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const shift = (n: number) => setMonth((m) => { const d = new Date(m); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1); });
  const dayName = (ms: number) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => shift(-1)} aria-label="Previous month"
                  className="grid size-8 place-items-center border border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink">‹</button>
          <span className="w-36 text-center text-[14px]">{title}</span>
          <button onClick={() => shift(1)} aria-label="Next month"
                  className="grid size-8 place-items-center border border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink">›</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="eyebrow">Surface stay</span>
          <Segmented label="Surface stay" value={stay} onChange={setStay} options={STAYS} />
        </div>
      </div>

      {error && <p className="mb-3 border-l border-bad pl-3 font-mono text-[12px] text-bad">{error}</p>}

      {best && verdict !== "none" && (
        <div className="mb-4 border-l-2 border-ink pl-3">
          <p className="text-[13px] text-ink">
            {verdict === "best"
              ? <>Best landing day this month for a {stay}-day stay: </>
              : <>No good or fair day this month for a {stay}-day stay. Closest: </>}
            <button onClick={() => onPick(best.day)} className="border-b border-ink-3 hover:border-ink">{dayName(best.day)}</button>
            <span className="ml-2 font-mono text-[12px] tabular-nums">
              <span className="text-sun">Sun {pct(best.sunFrac)}%</span> · <span className="text-earth">Earth {pct(best.earthFrac)}%</span>
              <span className="text-ink-3"> · {TONE[best.rating].word}</span>
            </span>
          </p>
          {counts.good === 0 && (
            <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
              No day this month keeps {sunNever && earthNever ? "either the Sun or Earth" : sunNever ? "the Sun" : "Earth"} in view for the whole stay.
              {sunNever && " Near the pole the Sun circles low along the horizon once every 29.5-day lunar day, and ridges block it for part of the circuit."}
              {earthNever && " Earth sits near the horizon here and rises and sets over a cycle of about 27 days (the Moon's libration), so long stays only keep it from high ground."}
              {!sunNever && !earthNever && " Some days keep each, but never both through the same stay."}
            </p>
          )}
        </div>
      )}
      {verdict === "none" && (
        <div className="mb-4 border-l-2 border-bad pl-3">
          <p className="text-[13px] text-ink">
            No day this month gives a {stay}-day stay both sunlight and contact with Earth at this spot.
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
            {noEarthAtAll
              ? "Earth stays hidden behind the terrain here for every stay this month, so a lander could never radio home directly."
              : noSunAtAll
                ? "The Sun stays hidden behind the terrain here for every stay this month, so a lander would have no solar power."
                : "On days with sunlight Earth is hidden, and on days with Earth in view the Sun is hidden."}
            {" "}Try another month, or a higher spot nearby (the best-spot finder helps).
          </p>
        </div>
      )}

      <div className="grid grid-cols-7 gap-px border border-line bg-line">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-bg px-2 py-1.5 text-[11px] text-ink-3">{w}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`pad${i}`} className="bg-bg" />)}
        {(days ?? Array.from({ length: nDays }, (_, i) => ({ day: first + i * DAY_MS, rating: null }) as StayDay)).map((c) => {
          const tone = c.rating ? TONE[c.rating] : null;
          const isBest = verdict === "best" && best?.day === c.day;
          return (
            <button key={c.day} onClick={() => onPick(c.day)} title={days ? describe(c, stay) : "Loading…"}
                    style={{ background: tone?.tint ? `color-mix(in srgb, ${tone.color} ${tone.tint}%, var(--bg))` : "var(--bg)" }}
                    className={`relative h-[64px] px-1 pt-1 text-left sm:h-[84px] sm:px-2 sm:pt-1.5 transition-[filter] hover:brightness-150 ${c.day === picked ? "outline outline-1 -outline-offset-1 outline-ink" : ""}`}>
              {tone && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: tone.color }} />}
              <span className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1.5">
                  <span className={`font-mono text-[12px] tabular-nums ${tone ? "text-ink" : "text-ink-3"}`}>{new Date(c.day).getUTCDate()}</span>
                  {isBest && <span className="bg-ink px-1 text-[9.5px] leading-[14px] font-medium tracking-[0.06em] text-bg uppercase">Best</span>}
                </span>
                {tone && <span className="hidden text-[10.5px] font-medium tracking-[0.06em] uppercase sm:inline" style={{ color: tone.color }}>{tone.word}</span>}
              </span>
              {c.rating !== null && (
                <span className="absolute inset-x-2 bottom-2 space-y-1">
                  <Meter frac={c.sunFrac} color="var(--sun)" />
                  <Meter frac={c.earthFrac} color="var(--earth)" />
                </span>
              )}
            </button>
          );
        })}
        {Array.from({ length: (7 - ((lead + nDays) % 7)) % 7 }, (_, i) => <div key={`end${i}`} className="bg-bg" />)}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11.5px] text-ink-2">
        {(Object.keys(TONE) as Rating[]).map((r) => (
          <span key={r} className="inline-flex items-center gap-2">
            <span className="text-[10.5px] font-medium tracking-[0.06em] uppercase" style={{ color: TONE[r].color }}>{TONE[r].word}</span>
            {TONE[r].label} <span className="font-mono text-ink-3 tabular-nums">{days ? counts[r] : "—"}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-2 text-ink-3">
          <span className="h-0.5 w-3 bg-sun" /> Sun % <span className="h-0.5 w-3 bg-earth" /> Earth % of stay
        </span>
        <span className="inline-flex items-center gap-2 text-ink-3">
          <span className="size-3 border border-ink" /> Analysis window start
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-3">
        Each day assumes landing at 00:00 UTC and staying the chosen length at this point. Earth counts when its centre clears
        the ridge; gaps up to an hour still count as &ldquo;the whole stay&rdquo;. Best day: the highest of the lower of Sun % and
        Earth %. These ratings are this app&apos;s thresholds, not a NASA criterion. Click a day to start the analysis window there.
      </p>
    </div>
  );
}

function Meter({ frac, color }: { frac: number; color: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block h-[3px] flex-1 bg-white/[0.06]">
        <span className="block h-full" style={{ width: `${100 * frac}%`, background: color }} />
      </span>
      <span className="hidden w-6 text-right font-mono text-[10.5px] leading-none tabular-nums sm:block" style={{ color }}>
        {(100 * frac).toFixed(0)}
      </span>
    </span>
  );
}
