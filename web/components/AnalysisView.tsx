"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import SiteView, { type AnalysisPoint } from "@/components/SiteView";
import { OBSERVER_HEIGHT_M, getRegion } from "@/lib/sites";
import { computeSkyline } from "@/lib/skyline";
import { heightAt, loadTerrain, toGrid } from "@/lib/terrain";

/** /analysis?region=<id>&lat=<deg>&lon=<deg>: full sunlight & comms analysis for a picked point. */
export default function AnalysisView() {
  const params = useSearchParams();
  const region = getRegion(params.get("region") ?? "");
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const [point, setPoint] = useState<AnalysisPoint | null>(null);
  const valid = region && Number.isFinite(lat) && Number.isFinite(lon);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    loadTerrain(region.terrainId).then((t) => {
      if (!live) return;
      const [x, y] = toGrid(t, lat, lon);
      setPoint({ region, lat, lon, groundM: heightAt(t, x, y), skyline: computeSkyline(t, lat, lon, OBSERVER_HEIGHT_M), terrain: t.terrain });
    });
    return () => {
      live = false;
    };
  }, [valid, region, lat, lon]);

  if (!valid) {
    return (
      <main className="mx-auto w-full max-w-6xl px-6 py-10 text-[13px] text-ink-2">
        No point selected. Descend into a region and click the terrain to pick one.{" "}
        <Link href="/" className="border-b border-ink-3 text-ink">Back to the 3D view</Link>
      </main>
    );
  }
  return point ? <SiteView point={point} /> : <main className="mx-auto w-full max-w-6xl px-6 py-10 font-mono text-[12px] text-ink-3">Computing skyline</main>;
}
