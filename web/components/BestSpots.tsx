"use client";

import { Readout, Segmented, Toggle } from "@/components/ui/Controls";
import { InfoTip } from "@/components/ui/InfoTip";
import { useRouter } from "next/navigation";
import { memo, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { HEAT_RAMPS } from "@/lib/heat";
import { type Region, formatLatLon } from "@/lib/sites";
import { type HeatLayer, MAX_COMPARE, compareHref, useMissionStore } from "@/store/useMissionStore";

const DAY_MS = 86_400_000;
const LAYERS: { value: HeatLayer; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "sun", label: "Sun" },
  { value: "earth", label: "Earth" },
  { value: "both", label: "Both" },
];
const SLOPES = [5, 8, 10, 15].map((v) => ({ value: v, label: `${v}°` }));
const LAYER_NAME: Record<Exclude<HeatLayer, "off">, string> = {
  sun: "Time with Sun",
  earth: "Time with Earth in view",
  both: "Time with Sun and Earth together",
};
const SLOPE_SOURCE = "https://aerospaceamerica.aiaa.org/features/the-choice/";
const HATCH = "repeating-linear-gradient(135deg, #2a2a2a 0 2px, #0a0a0a 2px 5px)";

function pct(f: number) {
  return `${(100 * f).toFixed(0)}%`;
}

/** Best-spot finder for the region's terrain area: run the survey, pick a heatmap layer, rank spots. */
// Memoised with narrow store subscriptions: it must not re-render on every playback frame.
export default memo(function BestSpots({ region }: { region: Region }) {
  const st = useMissionStore(useShallow((s) => ({
    survey: s.survey, surveyProgress: s.surveyProgress, heatLayer: s.heatLayer, maxSlope: s.maxSlope,
    heatHover: s.heatHover, startMs: s.startMs, days: s.days, requestSurvey: s.requestSurvey,
    setHeatLayer: s.setHeatLayer, setMaxSlope: s.setMaxSlope, requestPick: s.requestPick, setCompare: s.setCompare,
    insideRing: s.insideRing, setInsideRing: s.setInsideRing, simple: s.uiMode === "simple", setSurvey: s.setSurvey,
  })));
  const router = useRouter();
  const [more, setMore] = useState(false);
  const sv = st.survey && st.survey.regionId === region.id ? st.survey : null;
  const endMs = st.startMs + st.days * DAY_MS;
  const stale = sv && (sv.startMs !== st.startMs || sv.endMs !== endMs);
  const running = st.surveyProgress !== null;
  const steepShare = useMemo(() => {
    if (!sv) return 0;
    let n = 0;
    for (let k = 3; k < sv.data.length; k += 4) if (sv.data[k] > st.maxSlope) n++;
    return n / (sv.cells * sv.cells);
  }, [sv, st.maxSlope]);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const simple = st.simple;
  const shown = sv ? sv.spots.slice(0, simple ? 3 : 5) : [];
  const vals = (s: (typeof shown)[number]) => s.cpu ?? s.gpu;

  // Remove the survey entirely: map colours, spot markers and the list go; the panel starts over.
  const clear = () => {
    st.setSurvey(null);
    st.setHeatLayer("off");
    useMissionStore.getState().setHeatHover(null);
  };

  const compareTop = () => {
    if (!sv) return;
    const top = sv.spots.slice(0, MAX_COMPARE).map((s) => ({ regionId: region.id, lat: Number(s.lat.toFixed(5)), lon: Number(s.lon.toFixed(5)) }));
    st.setCompare(top);
    router.push(compareHref(top));
  };

  const ringToggle = (
    <div className="mt-3">
      <Toggle checked={st.insideRing} onChange={st.setInsideRing}>Only search inside the ring</Toggle>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
        The ring marks {region.feature} ({region.featureDiameterKm.toFixed(0)} km across). NASA hasn&apos;t published exact
        region edges, so {st.insideRing ? "this limits the search to the named feature." : `by default we search the whole ${region.areaHalfKm * 2} km square around it.`}
      </p>
    </div>
  );

  const legend = st.heatLayer !== "off" && (
    <div className="mt-3">
      <div className="text-[11.5px] text-ink-2">{simple ? "Brighter = more time with Sun and Earth together" : LAYER_NAME[st.heatLayer]}</div>
      <div className="mt-1 h-2" style={{ background: `linear-gradient(90deg, ${HEAT_RAMPS[st.heatLayer][0]}, ${HEAT_RAMPS[st.heatLayer][1]})` }} />
      <div className="mt-0.5 flex justify-between font-mono text-[10.5px] text-ink-3"><span>0%</span><span>50%</span><span>100%</span></div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
        <span className="size-3 border border-line-2" style={{ background: HATCH }} />
        {simple ? <>Hatched: too steep to land (over {st.maxSlope}°)</> : <>Steeper than {st.maxSlope}° · {pct(steepShare)} of the area</>}
      </div>
    </div>
  );

  return (
    <div>
      <p className="eyebrow mb-2">Best spots in this area</p>
      {!sv && !running && (
        <>
          <p className="text-[12px] leading-snug text-ink-2">
            {simple
              ? <>Check every spot here at once and find where a lander would get sunlight and see Earth the most over these dates.</>
              : <>Map how long every spot in the {region.areaHalfKm * 2} km area sees the Sun and Earth over this window, and
                rank the best gentle ground.</>}
          </p>
          <button onClick={st.requestSurvey}
                  className="mt-3 w-full border border-line-2 px-3 py-2 text-left text-[12.5px] text-ink transition-colors hover:border-ink">
            {simple ? "Find the best spots" : "Map Sun and Earth across the area"}
          </button>
        </>
      )}

      {running && (
        <div className="mt-1">
          <div className="flex justify-between text-[11.5px] text-ink-2">
            <span>{simple ? "Checking every spot…" : "Tracing every cell toward the Sun and Earth…"}</span>
            <span className="font-mono tabular-nums">{pct(st.surveyProgress ?? 0)}</span>
          </div>
          <div className="mt-1.5 h-0.5 bg-line"><div className="h-full bg-ink" style={{ width: pct(st.surveyProgress ?? 0) }} /></div>
        </div>
      )}

      {sv && !running && (
        <>
          <p className="text-[11.5px] leading-snug text-ink-2">
            Checked <span className="font-mono text-ink">{sv.sightlines.toLocaleString("en-US")}</span> lines of sight in{" "}
            <span className="font-mono text-ink">{(sv.gpuMs / 1000).toFixed(1)} s</span>{simple ? " on your computer's graphics chip." : " on this GPU."}
          </p>
          {!simple && (
            <p className="mt-1 font-mono text-[11px] text-ink-3">
              {day(sv.startMs)} → {day(sv.endMs)} · {sv.steps} steps · {Math.round(sv.cellM)} m cells
            </p>
          )}
          {stale && (
            <p className="mt-2 border-l border-sun pl-2 text-[11.5px] leading-snug text-ink-2">
              {simple ? "The dates have changed since this map was made." : "The window has changed since this map was made."}{" "}
              <button onClick={st.requestSurvey} className="border-b border-ink-3 text-ink hover:border-ink">{simple ? "Update it" : "Re-map"}</button>
            </p>
          )}

          {!simple && (
            <>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-3">Map</span>
                <Segmented label="Heatmap layer" value={st.heatLayer} onChange={st.setHeatLayer} options={LAYERS} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-3">Max slope</span>
                <Segmented label="Steepest slope allowed" value={st.maxSlope} onChange={st.setMaxSlope} options={SLOPES} />
              </div>
            </>
          )}
          {legend}
          {simple && (
            <div className="mt-2 flex items-center gap-4 text-[11.5px]">
              <button onClick={() => st.setHeatLayer(st.heatLayer === "off" ? "both" : "off")}
                      className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
                {st.heatLayer === "off" ? "Show map" : "Hide map"}
              </button>
              <button onClick={clear} className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">Clear</button>
            </div>
          )}

          {simple ? (
            <p className="mt-3 min-h-[2.5em] border-t border-line pt-2 text-[11.5px] leading-snug text-ink-2">
              {st.heatHover
                ? <>Under your pointer: Sun {pct(st.heatHover.sun)}, Earth {pct(st.heatHover.earth)}, both {pct(st.heatHover.both)} of the time;
                    ground {st.heatHover.slope.toFixed(1)}° steep{st.heatHover.slope > st.maxSlope ? " (too steep)" : ""}.</>
                : <span className="text-ink-3">Point at the map to read any spot.</span>}
            </p>
          ) : (
            <div className="mt-3 border-t border-line">
              {st.heatHover ? (
                <>
                  <Readout label="Under pointer · Sun" value={pct(st.heatHover.sun)} />
                  <Readout label="Earth in view" value={pct(st.heatHover.earth)} />
                  <Readout label="Both together" value={pct(st.heatHover.both)} />
                  <Readout label="Slope" value={`${st.heatHover.slope.toFixed(1)}°`} tone={st.heatHover.slope > st.maxSlope ? "bad" : undefined} />
                </>
              ) : (
                <p className="py-1.5 text-[11.5px] text-ink-3">Point at the map to read a spot.</p>
              )}
            </div>
          )}

          {ringToggle}

          <p className="eyebrow mt-4 mb-1">
            {simple ? `Top ${shown.length} spots` : "Top spots · Sun and Earth together"}
            {simple && <InfoTip text="Flat enough to land (8° or gentler) and with the most time having sunlight and Earth in view at once. Each one is double-checked with the full calculation." />}
          </p>
          {sv.spots.length === 0 && (
            <p className="text-[11.5px] text-ink-3">No ground at {st.maxSlope}° or gentler{st.insideRing ? " inside the ring" : ""}.</p>
          )}
          <ol className="border-t border-line">
            {shown.map((s) => (
              <li key={s.rank}>
                <button onClick={() => st.requestPick(s.lat, s.lon, region.id)}
                        className="flex w-full items-baseline gap-2.5 border-b border-line py-1.5 text-left hover:bg-white/[0.03]">
                  <span className="grid size-4 shrink-0 place-items-center border border-ink font-mono text-[10px] text-ink">{s.rank}</span>
                  {simple ? (
                    <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
                      <span className="text-ink">Sun and Earth {pct(vals(s).both)} of the time</span>
                      <span className="block text-[11px] text-ink-3">ground {s.slopeDeg.toFixed(1)}° steep · click to fly there</span>
                    </span>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[11.5px] text-ink">{formatLatLon(s.lat, s.lon, 3)}</span>
                        <span className="block font-mono text-[10.5px] text-ink-3">
                          Sun {pct(vals(s).sun)} · Earth {pct(vals(s).earth)} · {s.slopeDeg.toFixed(1)}°
                        </span>
                      </span>
                      <span className="font-mono text-[12.5px] text-ink tabular-nums">{pct(vals(s).both)}</span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </ol>
          {sv.spots.length >= 2 && (
            <button onClick={compareTop}
                    className="mt-3 w-full border border-line-2 px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:border-ink">
              Compare top {Math.min(MAX_COMPARE, sv.spots.length)} side by side →
            </button>
          )}

          {simple ? (
            <>
              <button onClick={() => setMore((v) => !v)} aria-expanded={more}
                      className="mt-3 text-[11.5px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
                {more ? "Fewer options" : "More options"}
              </button>
              {more && (
                <div className="mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-3">Colour by</span>
                    <Segmented label="Heatmap layer" value={st.heatLayer} onChange={st.setHeatLayer} options={LAYERS} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-3">Steepest allowed</span>
                    <Segmented label="Steepest slope allowed" value={st.maxSlope} onChange={st.setMaxSlope} options={SLOPES} />
                  </div>
                  <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
                    8° is NASA&apos;s limit for the HLS lander (<a href={SLOPE_SOURCE} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">Aerospace America</a>).
                    Map squares are {Math.round(sv.cellM)} m across, checked at {sv.steps} moments over these dates.
                  </p>
                  <button onClick={st.requestSurvey} className="mt-2 text-[11.5px] text-ink-2 underline hover:text-ink">Check again</button>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
                Map: Sun (any of its disc) and Earth (centre clearing the ridge) traced on the GPU from each cell&apos;s centre,
                2 m up, at every step. Ranked spots are re-checked with the full 200 km skyline at the same steps; the list shows
                those values. Slope from LOLA over two grid steps (~{Math.round(sv.slopeBaseM)} m),
                not the lander footprint. Default 8°: NASA requires the HLS lander to touch down within 8° of vertical
                (<a href={SLOPE_SOURCE} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">Aerospace America</a>).
                Shading under the map uses a fixed overhead light. Click a spot to fly there and analyse it.
              </p>
              <div className="mt-2 flex items-center gap-4">
                <button onClick={st.requestSurvey} className="text-[11.5px] text-ink-2 underline hover:text-ink">Re-map this window</button>
                <button onClick={clear} className="text-[11.5px] text-ink-2 underline hover:text-ink">Clear map</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
});
