"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Timelines from "@/components/Timelines";
import { Segmented } from "@/components/ui/Controls";
import { InfoTip } from "@/components/ui/InfoTip";
import ModeSwitch from "@/components/ui/ModeSwitch";
import { TERMS, type TermKey, label } from "@/lib/glossary";
import { BackIcon, Mark, PauseIcon, PlayIcon } from "@/components/ui/Icons";
import { skylineAsync } from "@/lib/engine";
import {
  LOOKAHEAD_MS, earthAnyPart, earthInView, formatDuration, fractionBoth, fractionIn, longestRun, nextChange, runText,
  scanEvents, sunLit,
} from "@/lib/metrics";
import { OBSERVER_HEIGHT_M, type Region, formatLatLon, getRegion } from "@/lib/sites";
import { slopeAt } from "@/lib/spots";
import { heightAt, loadTerrain, toGrid } from "@/lib/terrain";
import { earthState, samplePoint, sampleTrack } from "@/lib/track";
import { useEphemeris } from "@/lib/useEphemeris";
import { type ComparePoint, compareHref, useMissionStore, usePlayback } from "@/store/useMissionStore";

const DAY_MS = 86_400_000;
const STEP_MS = 30 * 60_000;
const LETTERS = ["A", "B", "C"];
const SPEEDS = [
  { value: 6, label: "6h" },
  { value: 24, label: "1d" },
  { value: 72, label: "3d" },
];

type Loaded = { key: string; letter: string; region: Region; lat: number; lon: number; groundM: number; slopeDeg: number; skyline: Float32Array };

/** Which value wins a row: higher, lower, or no ranking. */
type Better = "high" | "low" | null;
type Cell = { text: string; value?: number; unit?: string; tone?: "ok" | "partial" | "bad" };
/** core: shown in Simple mode; the rest appear with "Show all rows". */
type Row = { label: string; hint?: string; tip?: string; core?: boolean; better: Better; cells: Cell[] };

function parse(params: URLSearchParams): ComparePoint[] {
  return params.getAll("p").map((s) => {
    const [regionId, lat, lon] = s.split(":");
    return { regionId, lat: Number(lat), lon: Number(lon) };
  }).filter((p) => getRegion(p.regionId) && Number.isFinite(p.lat) && Number.isFinite(p.lon)).slice(0, 3);
}

function deg(v: number, digits = 2) {
  return `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}°`;
}

/** Index of the winning cell, or -1 when there is no clear winner (fewer than 2 values, or a tie at the top). */
function winner(row: Row): number {
  if (!row.better) return -1;
  const vals = row.cells.map((c) => c.value).filter((v): v is number => v !== undefined);
  if (vals.length < 2) return -1;
  const best = row.better === "high" ? Math.max(...vals) : Math.min(...vals);
  const hits = row.cells.filter((c) => c.value !== undefined && Math.abs(c.value - best) < 1e-9).length;
  return hits === 1 ? row.cells.findIndex((c) => c.value !== undefined && Math.abs(c.value - best) < 1e-9) : -1;
}

/** /compare?p=<region>:<lat>:<lon>&p=...: up to three picked points side by side over one window. */
export default function CompareView() {
  const params = useSearchParams();
  const router = useRouter();
  const points = useMemo(() => parse(params), [params]);
  const st = useMissionStore();
  const simple = st.uiMode === "simple";
  const [allRows, setAllRows] = useState(false);
  const endMs = st.startMs + st.days * DAY_MS;
  const { eph, error } = useEphemeris(st.startMs, endMs + LOOKAHEAD_MS);
  usePlayback();

  // Each point: its region's terrain (download-once cache) and its skyline (background thread).
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const wanted = points.map((p) => `${p.regionId}:${p.lat}:${p.lon}`).join("|");
  useEffect(() => {
    let live = true;
    Promise.all(points.map(async (p, i) => {
      const region = getRegion(p.regionId)!;
      const t = await loadTerrain(region.terrainId);
      const [x, y] = toGrid(t, p.lat, p.lon);
      const skyline = await skylineAsync(region.terrainId, p.lat, p.lon, OBSERVER_HEIGHT_M);
      return { key: `${p.regionId}:${p.lat}:${p.lon}`, letter: LETTERS[i], region, lat: p.lat, lon: p.lon,
        groundM: heightAt(t, x, y), slopeDeg: slopeAt(t, x, y), skyline };
    })).then((r) => live && setLoaded(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const ready = loaded.length === points.length && loaded.map((l) => l.key).join("|") === wanted;

  // Window metrics per point: one event scan and one 30-minute track each (lib/metrics.ts, lib/track.ts).
  const stats = useMemo(() => {
    if (!eph || !ready) return null;
    return loaded.map((l) => {
      const ctx = { eph, sky: l.skyline, lat: l.lat, lon: l.lon, hM: l.groundM + OBSERVER_HEIGHT_M };
      const ev = scanEvents(ctx, st.startMs, endMs + LOOKAHEAD_MS, [sunLit, earthInView, earthAnyPart]);
      const track = sampleTrack(eph, l.skyline, l.lat, l.lon, ctx.hM, st.startMs, endMs, STEP_MS);
      return { ctx, ev, track };
    });
  }, [eph, ready, loaded, st.startMs, endMs]);

  const remove = (i: number) => {
    const rest = points.filter((_, k) => k !== i);
    st.setCompare(rest);
    router.replace(rest.length ? compareHref(rest) : "/compare");
  };

  const rows: Row[] = [];
  if (stats && ready) {
    const now = stats.map((s) => samplePoint(s.ctx.eph, s.ctx.sky, s.ctx.lat, s.ctx.lon, s.ctx.hM, st.cursorMs));
    const win = stats.map((s) => {
      const ev = s.ev!;
      const to = Math.min(endMs, ev[0].end);
      return { ev, to };
    });
    const countdown = (i: number, k: 0 | 1, on: string, off: string): Cell => {
      const c = nextChange(win[i].ev[k], st.cursorMs);
      return c ? { text: `${c.to ? on : off} in ${formatDuration(c.at - st.cursorMs)}` } : { text: `no change ${LOOKAHEAD_MS / DAY_MS} d+` };
    };
    const run = (i: number, k: number, want: boolean): Cell => {
      const r = longestRun(win[i].ev[k], st.startMs, win[i].to, want);
      return { text: runText(r), value: r ? r.end - r.start : 0 };
    };
    const pctCell = (f: number): Cell => ({ text: (100 * f).toFixed(0), value: Math.round(1000 * f) / 1000, unit: "%" });
    const n = loaded.length;
    const each = (f: (i: number) => Cell) => Array.from({ length: n }, (_, i) => f(i));

    const L = (k: TermKey) => ({ label: label(k, simple), tip: TERMS[k].tip });
    rows.push(
      { label: simple ? "Right now" : "Now", better: null, cells: [] },
      { label: simple ? "Sun up?" : "Sun", core: true, better: null, tip: TERMS.disc.tip,
        cells: each((i) => ({ text: now[i]!.sunVis > 0 ? (now[i]!.sunVis < 1 ? "partly" : "yes") : "no", tone: now[i]!.sunVis > 0 ? (now[i]!.sunVis < 1 ? "partial" : "ok") : "bad" })) },
      { ...L("lineOfSight"), core: true, better: null, cells: each((i) => ({ text: earthState(now[i]!.earthVis).label, tone: earthState(now[i]!.earthVis).tone })) },
      // Elevation only matters for power where the Sun is actually up over the terrain: rank sunlit points only.
      { ...L("elevation"), hint: "ranked among sunlit points", better: "high",
        cells: each((i) => ({ text: deg(now[i]!.sunEl), value: now[i]!.sunVis > 0 ? now[i]!.sunEl : undefined })) },
      { ...L("clearance"), hint: "negative: Sun behind terrain", better: "high",
        cells: each((i) => ({ text: deg(now[i]!.sunEl - now[i]!.sunSky), value: now[i]!.sunEl - now[i]!.sunSky, tone: now[i]!.sunEl > now[i]!.sunSky ? "ok" : "bad" })) },
      { ...L("disc"), better: "high", cells: each((i) => ({ text: (100 * now[i]!.sunVis).toFixed(0), value: now[i]!.sunVis, unit: "%", tone: now[i]!.sunVis > 0 ? "ok" : "bad" })) },
      { ...L("sunNext"), better: null, cells: each((i) => countdown(i, 0, "rises", "sets")) },
      { ...L("earthNext"), better: null, cells: each((i) => countdown(i, 1, "returns", "lost")) },
      { label: simple ? `Over these ${st.days} days` : `This ${st.days}-day window`, better: null, cells: [] },
      { ...L("both"), core: true, hint: simple ? undefined : "power and radio at once", better: "high", cells: each((i) => pctCell(fractionBoth(win[i].ev[0], win[i].ev[1], st.startMs, win[i].to))) },
      { ...L("sunTime"), core: true, better: "high", cells: each((i) => pctCell(fractionIn(win[i].ev[0], st.startMs, win[i].to, true))) },
      { ...L("earthTime"), core: true, better: "high", cells: each((i) => pctCell(fractionIn(win[i].ev[1], st.startMs, win[i].to, true))) },
      { ...L("earthAny"), better: "high", cells: each((i) => pctCell(fractionIn(win[i].ev[2], st.startMs, win[i].to, true))) },
      { ...L("longestDark"), core: true, better: "low", cells: each((i) => run(i, 0, false)) },
      { ...L("blackout"), better: "low", cells: each((i) => run(i, 1, false)) },
      { ...L("longestSun"), better: "high", cells: each((i) => run(i, 0, true)) },
      { label: simple ? "The ground" : "The point", better: null, cells: [] },
      { ...L("slope"), core: true, hint: "NASA lander limit 8°", better: "low", cells: each((i) => ({ text: deg(loaded[i].slopeDeg, 1), value: loaded[i].slopeDeg, tone: loaded[i].slopeDeg > 8 ? "bad" : undefined })) },
      { ...L("ground"), better: null, cells: each((i) => ({ text: `${loaded[i].groundM.toFixed(0)} m` })) },
    );
  }

  const t = new Date(st.cursorMs).toISOString();
  const cols = `minmax(11rem, 14rem) repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6">
      <nav className="flex items-center justify-between border-b border-line pb-4">
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
        <div>
          <p className="eyebrow">Side by side</p>
          <h1 className="mt-2 text-[34px] leading-none font-medium tracking-[-0.015em]">Compare points</h1>
          <p className="mt-3 max-w-xl text-[12.5px] leading-snug text-ink-2">
            {simple
              ? <>Up to three spots side by side, over the same dates. The best spot in each row is marked.</>
              : <>Same window, same engine, same moment for every point. The best value in each row is marked; ties and
                single values are not.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="eyebrow">{simple ? "Dates" : "Window"}</span>
          <input type="date" value={new Date(st.startMs).toISOString().slice(0, 10)} min="2023-01-01" max="2028-10-30"
                 aria-label="Window start" onChange={(e) => e.target.value && st.setStart(Date.parse(`${e.target.value}T00:00:00Z`))} />
          <select value={st.days} onChange={(e) => st.setDays(Number(e.target.value))} aria-label="Window length">
            {[14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>
      </header>

      {error && <p className="mt-6 border-l border-bad pl-3 font-mono text-[12px] text-bad">{error}</p>}

      {points.length < 2 && (
        <p className="mt-8 border-l border-line-2 pl-3 text-[13px] leading-relaxed text-ink-2">
          {points.length === 0 ? "No points to compare yet." : "One point so far; add at least one more."} In the 3D view,
          descend into a region, click a point and choose <span className="text-ink">Add to comparison</span>, or use{" "}
          <span className="text-ink">Compare top 3</span> in the best-spot finder.{" "}
          <Link href="/" className="border-b border-ink-3 text-ink hover:border-ink">Back to the 3D view</Link>
        </p>
      )}

      {points.length > 0 && (
        <>
          <div className="mt-8 grid gap-x-6" style={{ gridTemplateColumns: cols }}>
            <div />
            {points.map((p, i) => {
              const region = getRegion(p.regionId)!;
              return (
                <div key={i} className="border-b border-line pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center border border-ink font-mono text-[12px]">{LETTERS[i]}</span>
                      <span className="text-[13px] text-ink">{region.name}</span>
                    </div>
                    <button onClick={() => remove(i)} aria-label={`Remove point ${LETTERS[i]}`}
                            className="text-[16px] leading-none text-ink-3 hover:text-ink">×</button>
                  </div>
                  <p className="mt-1.5 font-mono text-[11.5px] text-ink-2">{formatLatLon(p.lat, p.lon, 3)}</p>
                  <Link href={`/analysis?region=${p.regionId}&lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}`}
                        className="mt-1.5 inline-block border-b border-ink-3 text-[11.5px] text-ink-2 hover:border-ink hover:text-ink">
                    Full analysis →
                  </Link>
                </div>
              );
            })}

            {!rows.length && <p className="col-span-full py-6 font-mono text-[12px] text-ink-3">Computing skylines…</p>}
            {rows.filter((row) => !simple || allRows || row.core || !row.cells.length).map((row) => {
              if (!row.cells.length) {
                return <p key={row.label} className="eyebrow col-span-full mt-6 mb-1 border-b border-line pb-1.5">{row.label}</p>;
              }
              const w = winner(row);
              return (
                <div key={row.label} className="contents">
                  <div className="border-b border-line py-2">
                    <div className="text-[12.5px] text-ink-2">{row.label}{row.tip && <InfoTip text={row.tip} />}</div>
                    {row.hint && <div className="text-[10.5px] text-ink-3">{row.hint}</div>}
                  </div>
                  {row.cells.map((c, i) => {
                    const color = c.tone === "ok" ? "text-ok" : c.tone === "partial" ? "text-sun" : c.tone === "bad" ? "text-bad" : "text-ink";
                    return (
                      <div key={i} className={`flex items-baseline gap-2 border-b border-line py-2 ${i === w ? "bg-white/[0.035]" : ""}`}>
                        <span className={`font-mono text-[13px] tabular-nums ${color} ${i === w ? "font-semibold" : ""}`}>
                          {c.text}{c.unit && <span className="ml-0.5 text-ink-3">{c.unit}</span>}
                        </span>
                        {i === w && <span className="text-[10px] font-medium tracking-[0.06em] text-ok uppercase">best</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {simple && rows.length > 0 && (
            <button onClick={() => setAllRows((v) => !v)} className="mt-3 text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
              {allRows ? "Show only the key rows" : `Show all ${rows.filter((r) => r.cells.length).length} rows`}
            </button>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-5">
            <button onClick={() => st.setPlaying(!st.playing)} aria-label={st.playing ? "Pause" : "Play"}
                    className="grid size-10 shrink-0 place-items-center border border-line-2 text-ink transition-colors hover:border-ink">
              {st.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <div className="shrink-0">
              <div className="font-mono text-[20px] leading-none tabular-nums">{t.slice(0, 10)}</div>
              <div className="mt-1 font-mono text-[12px] text-ink-2 tabular-nums">{t.slice(11, 16)} <span className="text-ink-3">UTC</span></div>
            </div>
            <input type="range" className="scrubber min-w-40 flex-1" min={st.startMs} max={endMs} step={STEP_MS / 3}
                   value={st.cursorMs} onChange={(e) => st.setCursor(Number(e.target.value))} aria-label="Time" />
            <div className={`items-center gap-2 ${simple ? "hidden" : "flex"}`}>
              <span className="eyebrow">Rate / s</span>
              <Segmented label="Playback rate" value={st.hoursPerSecond} onChange={st.setSpeed} options={SPEEDS} />
            </div>
          </div>

          {stats && ready && (
            <div className="mt-6 space-y-5">
              {loaded.map((l, i) => (
                <div key={l.key}>
                  <div className="mb-1.5 flex items-center gap-2 text-[12px] text-ink-2">
                    <span className="grid size-5 place-items-center border border-ink font-mono text-[11px] text-ink">{l.letter}</span>
                    {l.region.name} · <span className="font-mono">{formatLatLon(l.lat, l.lon, 3)}</span>
                  </div>
                  <Timelines track={stats[i].track} startMs={st.startMs} endMs={endMs} cursorMs={st.cursorMs} onSeek={st.setCursor} />
                </div>
              ))}
            </div>
          )}

          <p className="mt-8 text-[11px] leading-snug text-ink-3">
            Each point: skyline from LOLA terrain (720 azimuths, 200 km), Sun and Earth from JPL Horizons (DE441), observer
            2 m up. Sun counts when any of its disc clears the skyline; Earth &ldquo;in view&rdquo; when its centre does.
            Durations come from state changes pinned to 30 s; &ldquo;≥&rdquo; means the stretch runs past the window edge.
            Countdowns look up to {LOOKAHEAD_MS / DAY_MS} days ahead. The 8° slope limit is NASA&apos;s HLS landing requirement.
          </p>
        </>
      )}
    </main>
  );
}
