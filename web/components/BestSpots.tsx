"use client";

import { Readout, Segmented } from "@/components/ui/Controls";
import { useRouter } from "next/navigation";
import { memo, useMemo } from "react";
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
  })));
  const router = useRouter();
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

  return (
    <div>
      <p className="eyebrow mb-2">Best spots in this area</p>
      {!sv && !running && (
        <>
          <p className="text-[12px] leading-snug text-ink-2">
            Map how long every spot in the {region.areaHalfKm * 2} km area sees the Sun and Earth over this window, and
            rank the best gentle ground.
          </p>
          <button onClick={st.requestSurvey}
                  className="mt-3 w-full border border-line-2 px-3 py-2 text-left text-[12.5px] text-ink transition-colors hover:border-ink">
            Map Sun and Earth across the area
          </button>
        </>
      )}

      {running && (
        <div className="mt-1">
          <div className="flex justify-between text-[11.5px] text-ink-2">
            <span>Tracing every cell toward the Sun and Earth…</span>
            <span className="font-mono tabular-nums">{pct(st.surveyProgress ?? 0)}</span>
          </div>
          <div className="mt-1.5 h-0.5 bg-line"><div className="h-full bg-ink" style={{ width: pct(st.surveyProgress ?? 0) }} /></div>
        </div>
      )}

      {sv && !running && (
        <>
          <p className="font-mono text-[11px] text-ink-3">
            {day(sv.startMs)} → {day(sv.endMs)} · {sv.steps} steps · {Math.round(sv.cellM)} m cells
          </p>
          {stale && (
            <p className="mt-2 border-l border-sun pl-2 text-[11.5px] leading-snug text-ink-2">
              The window has changed since this map was made.{" "}
              <button onClick={st.requestSurvey} className="border-b border-ink-3 text-ink hover:border-ink">Re-map</button>
            </p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-3">Map</span>
            <Segmented label="Heatmap layer" value={st.heatLayer} onChange={st.setHeatLayer} options={LAYERS} />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[12px] text-ink-3">Max slope</span>
            <Segmented label="Steepest slope allowed" value={st.maxSlope} onChange={st.setMaxSlope} options={SLOPES} />
          </div>

          {st.heatLayer !== "off" && (
            <div className="mt-3">
              <div className="text-[11.5px] text-ink-2">{LAYER_NAME[st.heatLayer]}</div>
              <div className="mt-1 h-2" style={{ background: `linear-gradient(90deg, ${HEAT_RAMPS[st.heatLayer][0]}, ${HEAT_RAMPS[st.heatLayer][1]})` }} />
              <div className="mt-0.5 flex justify-between font-mono text-[10.5px] text-ink-3"><span>0%</span><span>50%</span><span>100%</span></div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                <span className="size-3 border border-line-2"
                      style={{ background: "repeating-linear-gradient(135deg, #2a2a2a 0 2px, #0a0a0a 2px 5px)" }} />
                Steeper than {st.maxSlope}° · {pct(steepShare)} of the area
              </div>
            </div>
          )}

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

          <p className="eyebrow mt-4 mb-1">Top spots · Sun and Earth together</p>
          {sv.spots.length === 0 && <p className="text-[11.5px] text-ink-3">No ground at {st.maxSlope}° or gentler.</p>}
          <ol className="border-t border-line">
            {sv.spots.map((s) => (
              <li key={s.rank}>
                <button onClick={() => st.requestPick(s.lat, s.lon, region.id)}
                        className="flex w-full items-baseline gap-2.5 border-b border-line py-1.5 text-left hover:bg-white/[0.03]">
                  <span className="grid size-4 shrink-0 place-items-center border border-ink font-mono text-[10px] text-ink">{s.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[11.5px] text-ink">{formatLatLon(s.lat, s.lon, 3)}</span>
                    <span className="block font-mono text-[10.5px] text-ink-3">
                      Sun {pct((s.cpu ?? s.gpu).sun)} · Earth {pct((s.cpu ?? s.gpu).earth)} · {s.slopeDeg.toFixed(1)}°
                    </span>
                  </span>
                  <span className="font-mono text-[12.5px] text-ink tabular-nums">{pct((s.cpu ?? s.gpu).both)}</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10.5px] leading-snug text-ink-3">
            Map: Sun (any of its disc) and Earth (centre clearing the ridge) traced on the GPU from each cell&apos;s centre,
            2 m up, at every step. Ranked spots are re-checked with the full 200 km skyline at the same steps; the list shows
            those values. Slope from LOLA over two grid steps (~{Math.round(sv.slopeBaseM)} m),
            not the lander footprint. Default 8°: NASA requires the HLS lander to touch down within 8° of vertical
            (<a href={SLOPE_SOURCE} target="_blank" rel="noreferrer" className="underline hover:text-ink-2">Aerospace America</a>).
            Shading under the map uses a fixed overhead light. Click a spot to fly there and analyse it.
          </p>
          {sv.spots.length >= 2 && (
            <button onClick={() => {
              const top = sv.spots.slice(0, MAX_COMPARE).map((s) => ({ regionId: region.id, lat: Number(s.lat.toFixed(5)), lon: Number(s.lon.toFixed(5)) }));
              st.setCompare(top);
              router.push(compareHref(top));
            }} className="mt-3 w-full border border-line-2 px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:border-ink">
              Compare top {Math.min(MAX_COMPARE, sv.spots.length)} side by side →
            </button>
          )}
          <button onClick={st.requestSurvey} className="mt-2 text-[11.5px] text-ink-2 underline hover:text-ink">Re-map this window</button>
        </>
      )}
    </div>
  );
});
