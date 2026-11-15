"use client";

import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import LaunchCalendar from "@/components/LaunchCalendar";
import Panorama from "@/components/Panorama";
import Timelines from "@/components/Timelines";
import { Readout, Segmented } from "@/components/ui/Controls";
import { BackIcon, Mark, PauseIcon, PlayIcon } from "@/components/ui/Icons";
import validation from "@/public/data/validation.json";
import { OBSERVER_HEIGHT_M, type Region } from "@/lib/sites";
import { earthAnyPart, earthInView, longestRun, runText, scanEvents, sunLit } from "@/lib/metrics";
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

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 className="eyebrow">{title}</h2>
        {aside && <div className="text-[11.5px] text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, unit, swatch }: { label: string; value: string; unit?: string; swatch?: string }) {
  return (
    <div className="border-l border-line pl-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        {swatch && <span className="h-px w-3" style={{ background: swatch }} />}
        {label}
      </div>
      <div className="mt-1 font-mono text-[28px] leading-none tabular-nums">
        {value}{unit && <span className="ml-1 text-[14px] text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

/** A point the user picked in a region's terrain area, with its skyline computed from LOLA. */
export type AnalysisPoint = { region: Region; lat: number; lon: number; groundM: number; skyline: Float32Array; terrain: string[] };

export default function SiteView({ point }: { point: AnalysisPoint }) {
  const { startMs, days, cursorMs, playing, hoursPerSecond, setStart, setDays, setCursor, setPlaying, setSpeed } =
    useMissionStore();
  const endMs = startMs + days * DAY_MS;
  const { eph, error } = useEphemeris(startMs, endMs);
  usePlayback();
  const { region, skyline } = point;
  const site = useMemo(() => ({ lat: point.lat, lon: point.lon, heightM: point.groundM }), [point]);

  const track = useMemo(
    () => (eph ? sampleTrack(eph, skyline, site.lat, site.lon, site.heightM + OBSERVER_HEIGHT_M, startMs, endMs, STEP_MS) : []),
    [eph, skyline, site, startMs, endMs],
  );
  const now = eph ? samplePoint(eph, skyline, site.lat, site.lon, site.heightM + OBSERVER_HEIGHT_M, cursorMs) : null;

  const sunTime = track.length ? track.filter((p) => p.sunVis > 0).length / track.length : 0;
  const sunAvg = track.length ? track.reduce((a, p) => a + p.sunVis, 0) / track.length : 0;
  const earthTime = track.length ? track.filter((p) => p.earthVis >= 0.5).length / track.length : 0;
  const earthAny = track.length ? track.filter((p) => p.earthVis > 0).length / track.length : 0;
  // Longest stretches, from state changes pinned to 30 s (lib/metrics.ts).
  const events = useMemo(
    () => (eph ? scanEvents({ eph, sky: skyline, lat: site.lat, lon: site.lon, hM: site.heightM + OBSERVER_HEIGHT_M },
      startMs, endMs, [sunLit, earthInView, earthAnyPart]) : null),
    [eph, skyline, site, startMs, endMs],
  );
  const longest = (i: number, want: boolean) => (events ? runText(longestRun(events[i], startMs, events[i].end, want)) : "—");
  const t = new Date(cursorMs).toISOString();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6">
      <nav className="flex items-center justify-between border-b border-line pb-4">
        <Link href="/" className="inline-flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink">
          <BackIcon /> Back to the 3D view
        </Link>
        <div className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <Mark className="text-ink" /> Lunar Landing Site Navigator
        </div>
      </nav>

      <header className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Artemis III candidate region · {region.name}</p>
          <h1 className="mt-2 text-[34px] leading-none font-medium tracking-[-0.015em]">Your point <span className="text-ink-3">· near {region.feature}</span></h1>
          <p className="mt-3 font-mono text-[12px] whitespace-pre text-ink-2">
            {latLon(site.lat, site.lon)}   ground {site.heightM.toFixed(0)} m   observer +{OBSERVER_HEIGHT_M} m
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            Picked by you on the terrain; not a NASA landing point. Terrain: {point.terrain.join(" → ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="eyebrow">Window</span>
          <input type="date" value={new Date(startMs).toISOString().slice(0, 10)} min="2023-01-01" max="2028-11-30"
                 aria-label="Window start"
                 onChange={(e) => e.target.value && setStart(Date.parse(`${e.target.value}T00:00:00Z`))} />
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Window length">
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
      </header>

      {error && <p className="mt-6 border-l border-bad pl-3 font-mono text-[12px] text-bad">{error}</p>}

      <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Figure label="Time with any Sun" value={(100 * sunTime).toFixed(0)} unit="%" swatch="var(--sun)" />
        <Figure label="Mean Sun disc visible" value={(100 * sunAvg).toFixed(0)} unit="%" swatch="var(--sun)" />
        <Figure label="Earth in view (centre clears)" value={(100 * earthTime).toFixed(0)} unit="%" swatch="var(--earth)" />
        <Figure label="Any part of Earth visible" value={(100 * earthAny).toFixed(0)} unit="%" swatch="var(--earth)" />
        <Figure label="Longest darkness (no Sun)" value={longest(0, false)} swatch="var(--sun)" />
        <Figure label="Longest continuous sunlight" value={longest(0, true)} swatch="var(--sun)" />
        <Figure label="Longest comms blackout (centre)" value={longest(1, false)} swatch="var(--earth)" />
        <Figure label="Longest with no Earth at all" value={longest(2, false)} swatch="var(--earth)" />
      </div>
      <p className="mt-3 text-[11px] text-ink-3">
        Durations from state changes pinned to 30 s. &ldquo;≥&rdquo; marks a stretch that runs into the window edge, so its
        full length is longer than shown.
      </p>

      <div className="mt-10">
        <Section title="Horizon panorama"
                 aside={<>LOLA terrain skyline · <span className="text-sun">Sun</span> and <span className="text-earth">Earth</span> paths over the window · faded where hidden</>}>
          {skyline ? <Panorama skyline={skyline} track={track} now={now} /> : <div className="h-[340px] bg-white/[0.02]" />}
        </Section>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-5">
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
        <div className="flex items-center gap-2">
          <span className="eyebrow">Rate / s</span>
          <Segmented label="Playback rate" value={hoursPerSecond} onChange={setSpeed} options={SPEEDS} />
        </div>
      </div>
      <div className="mt-4">
        <Timelines track={track} startMs={startMs} endMs={endMs} cursorMs={cursorMs} onSeek={setCursor} />
      </div>

      <div className="mt-10">
        <Section title="Launch-window calendar" aside="If the landing slips: what each day would give a stay at this point">
          <LaunchCalendar sky={skyline} lat={site.lat} lon={site.lon} hM={site.heightM + OBSERVER_HEIGHT_M}
                          startMs={startMs} onPick={setStart} />
        </Section>
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-3">
        <Section title="Sun · now">
          {now && (
            <>
              <Readout label="Azimuth" value={deg(now.sunAz, 1)} />
              <Readout label="Elevation, local level" value={deg(now.sunEl)} />
              <Readout label="Skyline at Sun azimuth" value={deg(now.sunSky)} />
              <Readout label="Clearance above terrain" value={deg(now.sunEl - now.sunSky)} tone={now.sunEl > now.sunSky ? "ok" : "bad"} />
              <Readout label="Disc visible" value={(100 * now.sunVis).toFixed(0)} unit="%" tone={now.sunVis > 0 ? "ok" : "bad"} />
            </>
          )}
        </Section>
        <Section title="Earth · now">
          {now && (
            <>
              <Readout label="Azimuth" value={deg(now.earthAz, 1)} />
              <Readout label="Elevation, local level" value={deg(now.earthEl)} />
              <Readout label="Skyline at Earth azimuth" value={deg(now.earthSky)} />
              <Readout label="Clearance above terrain" value={deg(now.earthEl - now.earthSky)} tone={now.earthEl > now.earthSky ? "ok" : "bad"} />
              <Readout label="Line of sight" value={earthState(now.earthVis).label} tone={earthState(now.earthVis).tone} />
            </>
          )}
        </Section>
        <Section title="Method & validation">
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
    </main>
  );
}
