// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import CoordinateInput from "@/components/CoordinateInput";
import { SheetClose, leftPanel } from "@/components/ui/Sheet";
import { Readout } from "@/components/ui/Controls";
import { DescendIcon } from "@/components/ui/Icons";
import { formatLatLon, getRegion, regions } from "@/lib/sites";
import { useMissionStore } from "@/store/useMissionStore";

function Source({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
       className="inline-flex items-center gap-1 border-b border-line-2 text-[11px] text-ink-2 hover:border-ink hover:text-ink">
      {children} <span aria-hidden>↗</span>
    </a>
  );
}

/** Orbit-mode left rail: NASA's nine candidate landing regions (Artemis IV). */
export default function SitePanel({ onDescend, open = false, onClose = () => {} }: {
  onDescend: () => void;
  /** Small screens: shown as a bottom sheet when open. */
  open?: boolean;
  onClose?: () => void;
}) {
  const st = useMissionStore();
  const region = st.selectedRegionId ? getRegion(st.selectedRegionId) : undefined;

  return (
    <aside className={leftPanel(open)}>
      <SheetClose onClose={onClose} rail="md" />
      {region && (
        <button onClick={() => { st.selectRegion(null); st.setView("overview"); }}
                className="mb-3 text-[12px] text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
          ← All regions
        </button>
      )}
      {st.uiMode === "simple" ? (
        <>
          <p className="text-[15px] leading-snug text-ink">Where should a lander touch down near the Moon&apos;s south pole?</p>
          <p className="mt-1.5 text-[12px] leading-snug text-ink-2">
            It needs sunlight for power and a view of Earth to send messages home. Both come and go at the pole.
          </p>
          <ol className="mt-3 mb-4 space-y-1 text-[12px] text-ink-2">
            <li><span className="mr-1.5 font-mono text-ink">1</span>Pick one of NASA&apos;s nine possible regions below</li>
            <li><span className="mr-1.5 font-mono text-ink">2</span>Descend to its real 3D terrain</li>
            <li><span className="mr-1.5 font-mono text-ink">3</span>Click any spot to see if it works</li>
          </ol>
          <p className="eyebrow mb-1">NASA&apos;s candidate landing regions</p>
        </>
      ) : (
        <>
          <p className="eyebrow mb-1">Candidate landing regions · Artemis IV</p>
          <p className="mb-2 text-[11px] leading-snug text-ink-3">
            NASA named nine regions in Oct 2024; they are now the candidates for Artemis IV, the crewed landing planned for early 2028. Landing points inside them are not chosen yet and no coordinates are
            published, so each is shown at the IAU feature it is named after.
          </p>
        </>
      )}
      {st.uiMode !== "simple" && (
        <div className="mb-4">
          <CoordinateInput onEnterSurface={onDescend} />
        </div>
      )}
      <ol className="border-t border-line">
        {regions.map((r, i) => {
          const on = r.id === st.selectedRegionId;
          return (
            <li key={r.id} className="border-b border-line">
              <button onClick={() => st.selectRegion(r.id)}
                      className="group relative grid w-full grid-cols-[26px_1fr] gap-x-1 py-2 pl-2 text-left">
                <span className={`absolute top-0 bottom-0 left-0 w-px ${on ? "bg-ink" : "bg-transparent group-hover:bg-line-2"}`} />
                <span className="pt-px font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                <span className={`text-[13px] ${on ? "text-ink" : "text-ink-2 group-hover:text-ink"}`}>{r.name}</span>
                <span className="col-start-2 mt-0.5 text-[11px] text-ink-3">{r.feature} · {r.featureType.split(",")[0]}</span>
              </button>
              {on && region && (
                <div className="pb-3 pl-[34px]">
                  <button onClick={onDescend}
                          className="inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink py-2 text-[12.5px] font-medium text-bg hover:bg-transparent hover:text-ink">
                    <DescendIcon /> Descend into region
                  </button>
                  <p className="mt-2 text-[11px] leading-snug text-ink-3">On the surface, click the terrain to analyse any exact point.</p>
                  <div className="mt-2">
                    <Readout label="Feature centre (IAU)" value={formatLatLon(region.featureLat, region.featureLon)} />
                    <Readout label="Feature diameter" value={region.featureDiameterKm.toFixed(0)} unit="km" />
                    <Readout label="Terrain area" value={`${(2 * region.areaHalfKm).toFixed(0)} × ${(2 * region.areaHalfKm).toFixed(0)}`} unit="km" />
                  </div>
                  <p className="mt-2 flex flex-col items-start gap-1">
                    <Source href={region.sourceUrl}>NASA: candidate regions</Source>
                    <Source href={region.featureUrl}>USGS Gazetteer: {region.feature}</Source>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {st.uiMode === "simple" && (
        <div className="mt-5">
          <CoordinateInput onEnterSurface={onDescend} />
        </div>
      )}
    </aside>
  );
}
