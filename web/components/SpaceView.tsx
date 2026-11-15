"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AscendIcon, Mark, MinusIcon, PauseIcon, PlayIcon, PlusIcon, RecenterIcon } from "@/components/ui/Icons";
import { IconButton, Readout, Segmented, Tab } from "@/components/ui/Controls";
import BestSpots from "@/components/BestSpots";
import AnswerCards from "@/components/AnswerCards";
import ModeSwitch from "@/components/ui/ModeSwitch";
import { TERMS, label as term } from "@/lib/glossary";
import CoordinateInput from "@/components/CoordinateInput";
import SitePanel from "@/components/SitePanel";
import Link from "next/link";
import { OBSERVER_HEIGHT_M, getRegion } from "@/lib/sites";
import { loadTerrain, onTerrainProgress } from "@/lib/terrain";
import Timelines from "@/components/Timelines";
import { LOOKAHEAD_MS, countdown, earthAnyPart, earthInView, fractionIn, longestRun, runText, scanEvents, sunLit } from "@/lib/metrics";
import { earthState, samplePoint, sampleTrack } from "@/lib/track";
import { useEphemeris } from "@/lib/useEphemeris";
import { type CameraView, MAX_COMPARE, REAL_TIME, type SurfaceView, compareHref, useMissionStore, usePlayback } from "@/store/useMissionStore";

const SpaceScene = dynamic(() => import("@/components/space/SpaceScene"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center font-mono text-[12px] text-ink-3">Loading scene</div>,
});

const DAY_MS = 86_400_000;
const C_KM_S = 299_792.458;

const VIEWS: { id: CameraView; label: string }[] = [
  { id: "overview", label: "Moon" },
  { id: "south-pole", label: "South Pole" },
  { id: "from-earth", label: "From Earth" },
  { id: "earth", label: "Earth" },
  { id: "sun", label: "Sun" },
  { id: "system", label: "System" },
];

const SURFACE_VIEWS: { id: SurfaceView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "eye-sun", label: "Eye level · Sun" },
  { id: "eye-earth", label: "Eye level · Earth" },
];
const FADE_MS = 450;

function fmtDeg(v: number, digits = 2) {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}°`;
}

const SPEEDS = [
  { value: REAL_TIME, label: "1×" },
  { value: 1, label: "1h" },
  { value: 6, label: "6h" },
  { value: 24, label: "1d" },
  { value: 72, label: "3d" },
];

function latLon(lat: number, lon: number) {
  const l = ((lon + 540) % 360) - 180;
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"}  ${Math.abs(l).toFixed(2)}°${l < 0 ? "W" : "E"}`;
}

export default function SpaceView() {
  const st = useMissionStore();
  const endMs = st.startMs + st.days * DAY_MS;
  const { eph, error } = useEphemeris(st.startMs, endMs);
  usePlayback();

  const now = eph?.at(st.cursorMs) ?? null;
  const deg = 180 / Math.PI;
  const sub = (v: number[], r: number) => ({ lat: Math.asin(v[2] / r) * deg, lon: Math.atan2(v[1], v[0]) * deg });
  const subSun = now ? sub(now.sun, now.sunKm) : null;
  const subEarth = now ? sub(now.earth, now.earthKm) : null;
  let earthPhase = 0;
  if (now) {
    const es = now.sun.map((v, i) => v - now.earth[i]);
    const n = Math.hypot(...es);
    earthPhase = (1 + -(es[0] * now.earth[0] + es[1] * now.earth[1] + es[2] * now.earth[2]) / (n * now.earthKm)) / 2;
  }
  const region = st.selectedRegionId ? getRegion(st.selectedRegionId) : undefined;
  const t = new Date(st.cursorMs).toISOString();
  const surface = st.mode === "surface" && region;
  const probe = st.probe && region && st.probe.regionId === region.id ? st.probe : null;

  // Descent / ascent: fade to black, swap scenes, fade back. Going down, the fade lifts once the
  // terrain has its first shadows (surfaceReady), so it is derived rather than reset by hand.
  const [fade, setFade] = useState<"none" | "down" | "up">("none");
  const descend = () => {
    setFade("down");
    setTimeout(() => st.setMode("surface"), FADE_MS);
  };
  const ascend = () => {
    setFade("up");
    setTimeout(() => {
      st.setMode("orbit");
      setFade("none");
    }, FADE_MS);
  };
  // A region's terrain starts downloading as soon as it is selected (once per browser; see
  // lib/assetCache.ts), so it is usually ready by the time the user descends.
  const [load, setLoad] = useState<{ id: string; loaded: number; total: number } | null>(null);
  const terrainId = region?.terrainId;
  const terrainLoad = load && load.id === terrainId ? load : null;
  useEffect(() => {
    if (!terrainId) return;
    const off = onTerrainProgress(terrainId, (loaded, total) => setLoad({ id: terrainId, loaded, total }));
    loadTerrain(terrainId).catch(() => {});
    return off;
  }, [terrainId]);

  const fading = fade === "up" || (fade === "down" && !(st.mode === "surface" && st.surfaceReady));

  // On the surface the readouts belong to the point the user picked: its own LOLA skyline.
  const local = surface && eph && probe
    ? samplePoint(eph, probe.skyline, probe.lat, probe.lon, probe.groundM + OBSERVER_HEIGHT_M, st.cursorMs)
    : null;
  // One scan per point and window (+ lookahead for countdowns); everything below derives from it.
  const ctx = useMemo(
    () => (eph && probe ? { eph, sky: probe.skyline, lat: probe.lat, lon: probe.lon, hM: probe.groundM + OBSERVER_HEIGHT_M } : null),
    [eph, probe],
  );
  const events = useMemo(
    () => (ctx ? scanEvents(ctx, st.startMs, endMs + LOOKAHEAD_MS, [sunLit, earthInView, earthAnyPart]) : null),
    [ctx, st.startMs, endMs],
  );
  const track = useMemo(
    () => (ctx ? sampleTrack(ctx.eph, ctx.sky, ctx.lat, ctx.lon, ctx.hM, st.startMs, endMs, 30 * 60_000) : []),
    [ctx, st.startMs, endMs],
  );
  const winEnd = events ? Math.min(endMs, events[0].end) : endMs;
  const simple = st.uiMode === "simple";
  const [showDetails, setShowDetails] = useState(false);


  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg text-ink">
      <div className="absolute inset-0">
        <SpaceScene eph={eph} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/90 to-transparent" />
      {/* Side scrims keep the rails legible over the bright lunar surface without boxing them in. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-[360px] bg-gradient-to-r from-black/90 via-black/65 to-transparent md:block" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 hidden w-[340px] bg-gradient-to-l from-black/90 via-black/65 to-transparent lg:block" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-start justify-between gap-4 px-6 pt-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <Mark className="text-ink" />
          <div>
            <h1 className="text-[15px] leading-tight font-medium">Lunar Landing Site Navigator</h1>
            <p className="eyebrow mt-1">1.5 Degrees · NASA Space Apps 2026</p>
          </div>
          <div className="ml-4">
            <ModeSwitch />
          </div>
          <Link href="/how-it-works" className="ml-1 text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">How it works</Link>
        </div>
        {surface ? (
          <nav className="pointer-events-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-4 border-b border-line">
              {SURFACE_VIEWS.filter((v) => v.id === "overview" || probe).map((v) => (
                <Tab key={v.id} active={st.surfaceView === v.id} onClick={() => st.setSurfaceView(v.id)}>{v.label}</Tab>
              ))}
            </div>
            <button onClick={ascend}
                    className="inline-flex items-center gap-2 border border-line-2 px-3 py-1 text-[12.5px] text-ink hover:border-ink">
              <AscendIcon /> Return to orbit
            </button>
          </nav>
        ) : (
          <nav className="pointer-events-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-4 border-b border-line">
              {VIEWS.map((v) => (
                <Tab key={v.id} active={st.view === v.id} onClick={() => st.setView(v.id)}>{v.label}</Tab>
              ))}
            </div>
            <div className={`items-center gap-2 ${simple ? "hidden" : "flex"}`}>
              <span className="eyebrow">Scale</span>
              <Segmented label="Scale" value={st.scaleMode} onChange={st.setScaleMode}
                         options={[{ value: "compressed", label: "Compressed" }, { value: "true", label: "True" }]} />
            </div>
          </nav>
        )}
      </header>

      {surface ? (
        <aside className="absolute top-28 bottom-40 left-6 z-30 hidden w-64 overflow-y-auto pr-2 [scrollbar-color:var(--line-2)_transparent] [scrollbar-width:thin] md:block">
          <p className="eyebrow">{simple ? "Possible landing region" : "Surface · LOLA terrain"}</p>
          <p className="mt-1 text-[18px]">{region.name}</p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            {simple
              ? <>Real NASA terrain, {(2 * region.areaHalfKm).toFixed(0)} km across. The ring marks {region.feature}.</>
              : <>{(2 * region.areaHalfKm).toFixed(0)} km area around {region.feature} (IAU). Outline: the feature&apos;s official diameter.</>}
          </p>
          {!simple && (
            <div className="mt-4">
              <CoordinateInput />
            </div>
          )}
          {!probe ? (
            <p className="mt-6 border-l border-ink pl-3 text-[12.5px] leading-snug text-ink-2">
              {simple
                ? <>Click any spot on the ground. We&apos;ll tell you if a lander there would get sunlight for power and could talk to Earth.</>
                : <>Click anywhere on the terrain to pick a point. Its skyline is computed from LOLA on the spot and every
                  number below is for that exact point.</>}
            </p>
          ) : (
            <>
              {simple && local && events && (
                <AnswerCards now={local} events={events} cursorMs={st.cursorMs} startMs={st.startMs} winEnd={winEnd}
                             days={st.days} lookaheadMs={LOOKAHEAD_MS} />
              )}
              {simple && (
                <button onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}
                        className="mt-2 text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
                  {showDetails ? "Hide the numbers" : "Show the numbers behind this"}
                </button>
              )}
              {(!simple || showDetails) && (<>
              <p className="eyebrow mt-6">Your point</p>
              <p className="mt-1 font-mono text-[11.5px] whitespace-pre text-ink-2">
                {latLon(probe.lat, probe.lon)}   {probe.groundM.toFixed(0)} m
              </p>
              <p className="eyebrow mt-5 mb-1 text-sun">Sun at this point</p>
              <div className="border-t border-line">
                <Readout label={term("azimuth", simple)} tip={TERMS.azimuth.tip} value={local ? fmtDeg(local.sunAz, 1) : "—"} />
                <Readout label={term("elevation", simple)} tip={TERMS.elevation.tip} value={local ? fmtDeg(local.sunEl) : "—"} />
                <Readout label={term("clearance", simple)} tip={TERMS.clearance.tip} value={local ? fmtDeg(local.sunEl - local.sunSky) : "—"}
                         tone={local ? (local.sunEl > local.sunSky ? "ok" : "bad") : undefined} />
                <Readout label={term("disc", simple)} tip={TERMS.disc.tip} value={local ? (100 * local.sunVis).toFixed(0) : "—"} unit="%"
                         tone={local ? (local.sunVis > 0 ? "ok" : "bad") : undefined} />
              </div>
              <p className="eyebrow mt-5 mb-1 text-earth">Earth at this point</p>
              <div className="border-t border-line">
                <Readout label={term("azimuth", simple)} tip={TERMS.azimuth.tip} value={local ? fmtDeg(local.earthAz, 1) : "—"} />
                <Readout label={term("elevation", simple)} tip={TERMS.elevation.tip} value={local ? fmtDeg(local.earthEl) : "—"} />
                <Readout label={term("lineOfSight", simple)} tip={TERMS.lineOfSight.tip} value={local ? earthState(local.earthVis).label : "—"}
                         tone={local ? earthState(local.earthVis).tone : undefined} />
              </div>
              {events && (
                <>
                  <p className="eyebrow mt-5 mb-1">Next changes</p>
                  <div className="border-t border-line">
                    <Readout label="Sun" value={countdown(events[0], st.cursorMs, { on: "rises", off: "sets" })} />
                    <Readout label="Earth" value={countdown(events[1], st.cursorMs, { on: "returns", off: "lost" })} />
                  </div>
                  <p className="eyebrow mt-5 mb-1">This {st.days}-day window</p>
                  <div className="border-t border-line">
                    <Readout label={term("longestDark", simple)} tip={TERMS.longestDark.tip} value={runText(longestRun(events[0], st.startMs, winEnd, false))} />
                    <Readout label={term("blackout", simple)} tip={TERMS.blackout.tip} value={runText(longestRun(events[1], st.startMs, winEnd, false))} />
                    <Readout label={term("sunTime", simple)} tip={TERMS.sunTime.tip} value={(100 * fractionIn(events[0], st.startMs, winEnd, true)).toFixed(0)} unit="%" />
                    <Readout label={term("earthTime", simple)} tip={TERMS.earthTime.tip} value={(100 * fractionIn(events[1], st.startMs, winEnd, true)).toFixed(0)} unit="%" />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-ink-3">
                    Comms count Earth in view only when its centre clears the ridge. &ldquo;≥&rdquo;: the stretch runs past the window edge.
                  </p>
                  <div className="mt-3">
                    <Timelines track={track} startMs={st.startMs} endMs={endMs} cursorMs={st.cursorMs} onSeek={st.setCursor} compact />
                  </div>
                </>
              )}
              </>)}
              <Link href={`/analysis?region=${region.id}&lat=${probe.lat.toFixed(5)}&lon=${probe.lon.toFixed(5)}`}
                    className="mt-4 inline-flex items-center gap-2 border-b border-ink-3 pb-0.5 text-[12.5px] text-ink hover:border-ink">
                {simple ? "Full report for this spot" : <>Sunlight &amp; comms analysis for this point</>} <span aria-hidden>→</span>
              </Link>
              {(() => {
                const here = { regionId: region.id, lat: Number(probe.lat.toFixed(5)), lon: Number(probe.lon.toFixed(5)) };
                const queued = st.compare.some((c) => c.regionId === here.regionId && c.lat === here.lat && c.lon === here.lon);
                return (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <button onClick={() => st.addCompare(here)} disabled={queued}
                            className="border border-line-2 px-2.5 py-1 text-[12px] text-ink transition-colors hover:border-ink disabled:cursor-default disabled:text-ink-3 disabled:hover:border-line-2">
                      {queued ? "In comparison" : "Add to comparison"}
                    </button>
                    {st.compare.length > 0 && (
                      <Link href={compareHref(st.compare)} className="border-b border-ink-3 pb-0.5 text-[12px] text-ink-2 hover:border-ink hover:text-ink">
                        Compare {st.compare.length} of {MAX_COMPARE} <span aria-hidden>→</span>
                      </Link>
                    )}
                  </div>
                );
              })()}
            </>
          )}
          {simple && (
            <div className="mt-6">
              <CoordinateInput />
            </div>
          )}
          {!simple && (
            <p className="mt-4 text-[11px] leading-snug text-ink-3">
              Shadows are ray-traced on the GPU from every terrain point toward the Sun across the LOLA terrain.
            </p>
          )}
        </aside>
      ) : (
      <SitePanel onDescend={descend} />
      )}

      <aside className="absolute top-28 right-6 bottom-44 z-30 hidden w-64 overflow-y-auto pl-2 [scrollbar-color:var(--line-2)_transparent] [scrollbar-width:thin] lg:block">
        {surface && region && (
          <div className="mb-6">
            <BestSpots region={region} />
          </div>
        )}
        {!simple && (<>
        <p className="eyebrow mb-2">Ephemeris · JPL Horizons</p>
        <div className="border-t border-line">
          <Readout label="Sub-solar point" value={subSun ? latLon(subSun.lat, subSun.lon) : "—"} />
          <Readout label="Sub-Earth point" value={subEarth ? latLon(subEarth.lat, subEarth.lon) : "—"} />
          <Readout label="Earth range" value={now ? Math.round(now.earthKm).toLocaleString("en-US") : "—"} unit="km" />
          <Readout label="Light time" value={now ? (now.earthKm / C_KM_S).toFixed(3) : "—"} unit="s" />
          <Readout label="Earth phase, from Moon" value={now ? (earthPhase * 100).toFixed(0) : "—"} unit="%" />
        </div>
        <details className="mt-6 text-[11px] leading-snug text-ink-3">
          <summary className="eyebrow cursor-pointer select-none hover:text-ink-2">Rendering notes</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Positions, lighting, terrain and numbers are measured or computed data.</li>
            <li>The Sun&apos;s surface is procedural: no NASA map of it exists.</li>
            <li>Moon night side: a faint display fill and strongly boosted earthshine keep unlit ground readable.</li>
            <li>Globe relief (normal maps) is exaggerated 1.5–3× to read at orbit scale; the surface view is true scale.</li>
            <li>Earth&apos;s clouds are NASA&apos;s static Blue Marble composite, not today&apos;s weather.</li>
            <li>Compressed scale shortens distances only; directions are always exact.</li>
          </ul>
        </details>
        </>)}
      </aside>

      <div className="absolute right-6 bottom-32 z-30 flex flex-col gap-1">
        {!surface && <IconButton label="Zoom in" onClick={() => st.requestZoom(1)}><PlusIcon /></IconButton>}
        {!surface && <IconButton label="Zoom out" onClick={() => st.requestZoom(-1)}><MinusIcon /></IconButton>}
        <IconButton label="Reset view" onClick={() => (surface ? st.setSurfaceView(st.surfaceView) : st.setView(st.view))}>
          <RecenterIcon />
        </IconButton>
      </div>

      <footer className="absolute inset-x-6 bottom-5 z-30">
        <div className="flex items-center gap-5">
          <button onClick={() => st.setPlaying(!st.playing)} aria-label={st.playing ? "Pause" : "Play"}
                  className="grid size-10 shrink-0 place-items-center border border-line-2 text-ink transition-colors hover:border-ink">
            {st.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="shrink-0">
            <div className="font-mono text-[20px] leading-none tabular-nums">{t.slice(0, 10)}</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-[12px] text-ink-2 tabular-nums">
              {st.live ? t.slice(11, 19) : t.slice(11, 16)} <span className="text-ink-3">UTC</span>
              {st.live ? (
                <span className="flex items-center gap-1 text-[10.5px] tracking-[0.12em] text-ok uppercase">
                  <span className="size-1.5 animate-pulse rounded-full bg-ok" /> Live
                </span>
              ) : (
                <button onClick={st.goLive} className="border-b border-ink-3 text-[10.5px] tracking-[0.12em] text-ink-2 uppercase hover:border-ink hover:text-ink">
                  Now
                </button>
              )}
            </div>
          </div>
          <div className="relative min-w-0 flex-1">
            <input type="range" className="scrubber w-full" min={st.startMs} max={endMs} step={10 * 60_000}
                   value={st.cursorMs} onChange={(e) => st.setCursor(Number(e.target.value))} aria-label="Time" />
            <div className="pointer-events-none absolute inset-x-0 top-[13px] h-1.5">
              {Array.from({ length: st.days + 1 }, (_, d) => (
                <span key={d} className={`absolute top-0 w-px ${d % 7 === 0 ? "h-1.5 bg-ink-3" : "h-1 bg-line-2"}`}
                      style={{ left: `${(100 * d) / st.days}%` }} />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-ink-3">
              <span>{new Date(st.startMs).toISOString().slice(0, 10)}</span>
              <span>{new Date(endMs).toISOString().slice(0, 10)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-3">
          <div className={`items-center gap-2 ${simple ? "hidden" : "flex"}`}>
            <span className="eyebrow">Rate / s</span>
            <Segmented label="Playback rate" value={st.hoursPerSecond} onChange={st.setSpeed} options={SPEEDS} />
          </div>
          <div className="flex items-center gap-2">
            <span className="eyebrow">Window</span>
            <input type="date" value={new Date(st.startMs).toISOString().slice(0, 10)} min="1969-01-01" max="2028-11-30"
                   aria-label="Window start"
                   onChange={(e) => e.target.value && st.setStart(Date.parse(`${e.target.value}T00:00:00Z`))} />
            <select value={st.days} onChange={(e) => st.setDays(Number(e.target.value))} aria-label="Window length">
              {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </div>
          {error && <span className="font-mono text-[11px] text-bad">{error}</span>}
          <p className="ml-auto text-[10.5px] text-ink-3">
            LRO LOLA &amp; LROC · JPL Horizons DE441 · NASA SVS CGI Moon Kit · Blue Marble NG · USGS Gazetteer
          </p>
        </div>
      </footer>

      <div className={`pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black transition-opacity ease-in-out ${fading ? "opacity-100" : "opacity-0"}`}
           style={{ transitionDuration: `${FADE_MS}ms` }}>
        {fading && fade === "down" && terrainLoad && terrainLoad.total > 0 && terrainLoad.loaded < terrainLoad.total && (
          <div className="w-56 text-center">
            <p className="font-mono text-[11.5px] text-ink-2 tabular-nums">
              Loading LOLA terrain · {(terrainLoad.loaded / 2 ** 20).toFixed(1)} / {(terrainLoad.total / 2 ** 20).toFixed(1)} MB
            </p>
            <div className="mt-2 h-px bg-line"><div className="h-full bg-ink" style={{ width: `${(100 * terrainLoad.loaded) / terrainLoad.total}%` }} /></div>
          </div>
        )}
      </div>
    </main>
  );
}
