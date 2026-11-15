"use client";

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

/** Orbit-mode left rail: NASA's Artemis III candidate regions. */
export default function SitePanel({ onDescend }: { onDescend: () => void }) {
  const st = useMissionStore();
  const region = st.selectedRegionId ? getRegion(st.selectedRegionId) : undefined;

  return (
    <aside className="absolute top-28 bottom-40 left-6 z-30 hidden w-64 overflow-y-auto pr-2 [scrollbar-color:var(--line-2)_transparent] [scrollbar-width:thin] md:block">
      <p className="eyebrow mb-1">Artemis III candidate regions</p>
      <p className="mb-2 text-[11px] leading-snug text-ink-3">
        NASA named nine regions in Oct 2024. Landing points inside them are not chosen yet and no coordinates are
        published, so each is shown at the IAU feature it is named after.
      </p>
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
                    <Source href={region.sourceUrl}>NASA: Artemis III regions</Source>
                    <Source href={region.featureUrl}>USGS Gazetteer: {region.feature}</Source>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
