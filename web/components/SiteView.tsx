"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import AnswerCards, { humanDuration } from "@/components/AnswerCards";
import LaunchCalendar from "@/components/LaunchCalendar";
import Panorama from "@/components/Panorama";
import Timelines from "@/components/Timelines";
import { Readout, Segmented } from "@/components/ui/Controls";
import { BackIcon, Mark, PauseIcon, PlayIcon } from "@/components/ui/Icons";
import { InfoTip } from "@/components/ui/InfoTip";
import ModeSwitch from "@/components/ui/ModeSwitch";
import validation from "@/public/data/validation.json";
import { TERMS, type TermKey, label } from "@/lib/glossary";
import { LOOKAHEAD_MS, type Run, earthAnyPart, earthInView, fractionIn, longestRun, runText, scanEvents, sunLit } from "@/lib/metrics";
import { OBSERVER_HEIGHT_M, type Region } from "@/lib/sites";
import { earthState, samplePoint, sampleTrack } from "@/lib/track";
import { useEphemeris } from "@/lib/useEphemeris";
import { useMissionStore, usePlayback } from "@/store/useMissionStore";

const DAY_MS = 86_400_000;
const STEP_MS = 30 * 60_000;
const SPEEDS = [
  { value: 6, label: "6h" },
  { value: 24, label: "1d" },
  { value: 72, label: "3d" },
];

function deg(v: number, digits = 2) {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}°`;
}

function latLon(lat: number, lon: number) {
  const l = ((lon + 540) % 360) - 180;
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? "S" : "N"}  ${Math.abs(l).toFixed(3)}°${l < 0 ? "W" : "E"}`;
}

function day(ms: number) {
  return new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** A numbered question heading: the page reads top to bottom as a beginner's questions. */
function Section({ n, title, aside, children }: { n?: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 className="text-[17px] text-ink">
          {n !== undefined && <span className="mr-2 font-mono text-[13px] text-ink-3">{n}</span>}
          {title}
        </h2>
        {aside && <div className="text-[11.5px] text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Figure({ term, simple, value, unit, swatch }: { term: TermKey; simple: boolean; value: string; unit?: string; swatch?: string }) {
  return (
    <div className="border-l border-line pl-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        {swatch && <span className="h-px w-3" style={{ background: swatch }} />}
        {label(term, simple)}
        <InfoTip text={TERMS[term].tip} />
      </div>
      <div className="mt-1 font-mono text-[26px] leading-none tabular-nums">
        {value}{unit && <span className="ml-1 text-[14px] text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

/** "11 days 11 hours, 14 Nov → 26 Nov" (with "at least" when the stretch runs past the dates shown). */
function stretch(r: Run | null): string {
  if (!r) return "none in these dates";
  const open = r.openStart || r.openEnd ? "at least " : "";
  return `${open}${humanDuration(r.end - r.start)}, ${day(r.start)} → ${day(r.end)}`;
}

/** A point the user picked in a region's terrain area, with its skyline computed from LOLA. */
export type AnalysisPoint = { region: Region; lat: number; lon: number; groundM: number; skyline: Float32Array; terrain: string[] };

export default function SiteView({ point }: { point: AnalysisPoint }) {
  const { startMs, days, cursorMs, playing, hoursPerSecond, setStart, setDays, setCursor, setPlaying, setSpeed, uiMode } =
    useMissionStore();
  const simple = uiMode === "simple";
  const endMs = startMs + days * DAY_MS;
  const { eph, error } = useEphemeris(startMs, endMs + LOOKAHEAD_MS);
  usePlayback();
  const { region, skyline } = point;
  const site = useMemo(() => ({ lat: point.lat, lon: point.lon, heightM: point.groundM }), [point]);

  const track = useMemo(
    () => (eph ? sampleTrack(eph, skyline, site.lat, site.lon, site.heightM + OBSERVER_HEIGHT_M, startMs, endMs, STEP_MS) : []),
    [eph, skyline, site, startMs, endMs],
  );
  const now = eph ? samplePoint(eph, skyline, site.lat, site.lon, site.heightM + OBSERVER_HEIGHT_M, cursorMs) : null;

  // State changes pinned to 30 s over the dates plus a lookahead for countdowns (lib/metrics.ts); every
  // figure below comes from them, clipped to the dates shown.
  const events = useMemo(
    () => (eph ? scanEvents({ eph, sky: skyline, lat: site.lat, lon: site.lon, hM: site.heightM + OBSERVER_HEIGHT_M },
      startMs, endMs + LOOKAHEAD_MS, [sunLit, earthInView, earthAnyPart]) : null),
    [eph, skyline, site, startMs, endMs],
  );
  const winEnd = events ? Math.min(endMs, events[0].end) : endMs;
  const frac = (i: number) => (events ? fractionIn(events[i], startMs, winEnd, true) : 0);
  const run = (i: number, want: boolean) => (events ? longestRun(events[i], startMs, winEnd, want) : null);
  const longest = (i: number, want: boolean) => (events ? runText(run(i, want)) : "—");
  const sunAvg = track.length ? track.reduce((a, p) => a + p.sunVis, 0) / track.length : 0;
  const pct = (f: number) => (100 * f).toFixed(0);
  const t = new Date(cursorMs).toISOString();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6">
      <nav className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <Link href="/" className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
          <BackIcon /> Back to the 3D view
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/how-it-works" className="text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">How it works</Link>
          <ModeSwitch />
          <div className="hidden items-center gap-2.5 text-[12.5px] text-ink-2 sm:flex">
            <Mark className="text-ink" /> Lunar Landing Site Navigator
          </div>
        </div>
      </nav>

      <header className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <p className="eyebrow">{simple ? "Your landing spot" : "Artemis III candidate region"} · {region.name}</p>
          <h1 className="mt-2 text-[32px] leading-tight font-medium tracking-[-0.015em]">
            {simple ? "What would a lander here experience?" : <>Your point <span className="text-ink-3">· near {region.feature}</span></>}
          </h1>
          <p className="mt-3 font-mono text-[12px] whitespace-pre text-ink-2">
            {latLon(site.lat, site.lon)}   ground {site.heightM.toFixed(0)} m{simple ? "" : `   observer +${OBSERVER_HEIGHT_M} m`}
          </p>
          <p className="mt-1.5 text-[12px] leading-snug text-ink-3">
            {simple
              ? <>A spot you picked on real NASA terrain near {region.feature}, not an official landing point. Everything below is
                  for this exact spot, 2 m above the ground where a lander&apos;s solar panels and antenna would be.</>
              : <>Picked by you on the terrain; not a NASA landing point. Terrain: {point.terrain.join(" → ")}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="eyebrow">{simple ? "Dates" : "Window"}</span>
          <input type="date" value={new Date(startMs).toISOString().slice(0, 10)} min="2023-01-01" max="2028-10-30"
                 aria-label="First day" onChange={(e) => e.target.value && setStart(Date.parse(`${e.target.value}T00:00:00Z`))} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Number of days">
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
      </header>

      {error && <p className="mt-6 border-l border-bad pl-3 font-mono text-[12px] text-bad">{error}</p>}

      {/* 1. The answer, worded the same as on the 3D view. */}
      <div className="mt-10">
        <Section n={1} title={simple ? "The short answer" : "Summary at the selected time"}
                 aside={<>For the time on the slider below · {t.slice(0, 10)} {t.slice(11, 16)} UTC</>}>
          {now && events ? (
            <AnswerCards row now={now} events={events} cursorMs={cursorMs} startMs={startMs} winEnd={winEnd} days={days} lookaheadMs={LOOKAHEAD_MS} />
          ) : <p className="font-mono text-[12px] text-ink-3">Computing…</p>}
        </Section>
      </div>

      {/* 2. Days at a glance. */}
      <div className="mt-12">
        <Section n={2} title={simple ? `The next ${days} days at a glance` : "Timeline"}
                 aside={<><span className="text-sun">yellow</span> = sunlight · <span className="text-earth">blue</span> = Earth in view · dark = none · click to jump</>}>
          <div className="mb-5 flex flex-wrap items-center gap-5">
            <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}
                    className="grid size-10 shrink-0 place-items-center border border-line-2 text-ink transition-colors hover:border-ink">
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="shrink-0">
              <div className="font-mono text-[20px] leading-none tabular-nums">{t.slice(0, 10)}</div>
              <div className="mt-1 font-mono text-[12px] text-ink-2 tabular-nums">{t.slice(11, 16)} <span className="text-ink-3">UTC</span></div>
            </div>
            <input type="range" className="scrubber min-w-40 flex-1" min={startMs} max={endMs} step={STEP_MS / 3}
                   value={cursorMs} onChange={(e) => setCursor(Number(e.target.value))} aria-label="Time" />
            {!simple && (
              <div className="flex items-center gap-2">
                <span className="eyebrow">Rate / s</span>
                <Segmented label="Playback rate" value={hoursPerSecond} onChange={setSpeed} options={SPEEDS} />
              </div>
            )}
          </div>
          <Timelines large track={track} startMs={startMs} endMs={endMs} cursorMs={cursorMs} onSeek={setCursor} />
          {events && (
            <div className="mt-4 grid gap-x-8 gap-y-1 text-[13px] text-ink-2 md:grid-cols-2">
              <p><span className="text-ink">{label("longestDark", simple)}:</span> {stretch(run(0, false))}<InfoTip text={TERMS.longestDark.tip} /></p>
              <p><span className="text-ink">{label("blackout", simple)}:</span> {stretch(run(1, false))}<InfoTip text={TERMS.blackout.tip} /></p>
            </div>
          )}
        </Section>
      </div>

      {/* 3. Why: the horizon. */}
      <div className="mt-12">
        <Section n={3} title={simple ? "Why: the sky seen from this spot" : "Horizon panorama"}
                 aside={simple ? "A full turn on the spot, compass directions along the bottom"
                   : <>LOLA terrain skyline · <span className="text-sun">Sun</span> and <span className="text-earth">Earth</span> paths over the window · faded where hidden</>}>
          {simple && (
            <ul className="mb-4 grid gap-x-8 gap-y-1.5 text-[12.5px] leading-snug text-ink-2 md:grid-cols-3">
              <li><span className="text-ink">Grey shape:</span> the mountains and crater rims all around you, as if you turned in a full circle. The dashed line is a perfectly flat horizon (0°).</li>
              <li><span className="text-sun">Yellow</span> and <span className="text-earth">blue</span> dots: where the Sun and Earth travel over these dates. Faint dots inside the grey are hidden behind terrain: no power or no radio then.</li>
              <li><span className="text-ink">Big markers:</span> where the Sun and Earth are at the slider&apos;s time. Near the pole the Sun circles low around the horizon instead of rising high.</li>
            </ul>
          )}
          {skyline ? <Panorama plain={simple} skyline={skyline} track={track} now={now} /> : <div className="h-[340px] bg-white/[0.02]" />}
        </Section>
      </div>

      {/* 4. If the date slips. */}
      <div className="mt-12">
        <Section n={4} title={simple ? "If the landing date slips" : "Launch-window calendar"}
                 aside="What each landing day would give a stay at this spot">
          <LaunchCalendar sky={skyline} lat={site.lat} lon={site.lon} hM={site.heightM + OBSERVER_HEIGHT_M}
                          startMs={startMs} onPick={setStart} />
        </Section>
      </div>

      {/* 5. Everything else, folded away in Simple mode. */}
      <details key={uiMode} open={!simple} className="group mt-12 border-t border-line pt-4">
        <summary className="cursor-pointer list-none text-[17px] text-ink select-none">
          <span className="mr-2 font-mono text-[13px] text-ink-3">5</span>
          All the numbers <span className="ml-2 text-[12px] text-ink-3 group-open:hidden">show</span>
          <span className="ml-2 hidden text-[12px] text-ink-3 group-open:inline">hide</span>
        </summary>

        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Figure term="sunTime" simple={simple} value={pct(frac(0))} unit="%" swatch="var(--sun)" />
          <Figure term="sunAvg" simple={simple} value={pct(sunAvg)} unit="%" swatch="var(--sun)" />
          <Figure term="earthTime" simple={simple} value={pct(frac(1))} unit="%" swatch="var(--earth)" />
          <Figure term="earthAny" simple={simple} value={pct(frac(2))} unit="%" swatch="var(--earth)" />
          <Figure term="longestDark" simple={simple} value={longest(0, false)} swatch="var(--sun)" />
          <Figure term="longestSun" simple={simple} value={longest(0, true)} swatch="var(--sun)" />
          <Figure term="blackout" simple={simple} value={longest(1, false)} swatch="var(--earth)" />
          <Figure term="noEarth" simple={simple} value={longest(2, false)} swatch="var(--earth)" />
        </div>
        <p className="mt-3 text-[11px] text-ink-3">
          Durations from state changes pinned to 30 s. &ldquo;≥&rdquo; marks a stretch that runs past the last date shown, so it
          is at least that long.
        </p>

        <div className="mt-10 grid gap-10 md:grid-cols-3">
          <Section title={simple ? "The Sun right now" : "Sun · now"}>
            {now && (
              <>
                <Readout label={label("azimuth", simple)} tip={TERMS.azimuth.tip} value={deg(now.sunAz, 1)} />
                <Readout label={label("elevation", simple)} tip={TERMS.elevation.tip} value={deg(now.sunEl)} />
                <Readout label={label("skyline", simple)} tip={TERMS.skyline.tip} value={deg(now.sunSky)} />
                <Readout label={label("clearance", simple)} tip={TERMS.clearance.tip} value={deg(now.sunEl - now.sunSky)} tone={now.sunEl > now.sunSky ? "ok" : "bad"} />
                <Readout label={label("disc", simple)} tip={TERMS.disc.tip} value={pct(now.sunVis)} unit="%" tone={now.sunVis > 0 ? "ok" : "bad"} />
              </>
            )}
          </Section>
          <Section title={simple ? "Earth right now" : "Earth · now"}>
            {now && (
              <>
                <Readout label={label("azimuth", simple)} tip={TERMS.azimuth.tip} value={deg(now.earthAz, 1)} />
                <Readout label={label("elevation", simple)} tip={TERMS.elevation.tip} value={deg(now.earthEl)} />
                <Readout label={label("skyline", simple)} tip={TERMS.skyline.tip} value={deg(now.earthSky)} />
                <Readout label={label("clearance", simple)} tip={TERMS.clearance.tip} value={deg(now.earthEl - now.earthSky)} tone={now.earthEl > now.earthSky ? "ok" : "bad"} />
                <Readout label={label("lineOfSight", simple)} tip={TERMS.lineOfSight.tip} value={earthState(now.earthVis).label} tone={earthState(now.earthVis).tone} />
              </>
            )}
          </Section>
          <Section title={simple ? "Where the numbers come from" : "Method & validation"}>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Sun and Earth directions from JPL Horizons (DE441), hourly, interpolated. Skyline for this point computed
              in your browser from LOLA terrain ({point.terrain.join(", ")}), marched 200 km along great circles at 720
              azimuths. Sun and Earth treated as discs: Earth is &ldquo;in view&rdquo; when its centre clears the skyline and
              &ldquo;partly visible&rdquo; when only part of its disc does (NASA&apos;s Earth-visibility maps count both). Sampled every 30 minutes.
            </p>
            <p className="mt-2 text-[11px] leading-snug text-ink-3">
              The in-browser skyline matches the Python engine to a median 0.012° (95% within 0.52°) at 21 test points
              across all regions.
            </p>
            <p className="mt-2 text-[11px] leading-snug text-ink-3">
              Across 302 polar points this engine matches NASA&apos;s LOLA average-illumination map (PGDA product 69) to a
              median {validation.illumination.sun.medianAbsPP} percentage points (r = {validation.illumination.sun.r}).
            </p>
          </Section>
        </div>
      </details>
    </main>
  );
}
