"use client";

import { useState } from "react";
import { parseLatLon, regionFor } from "@/lib/coords";
import { regions } from "@/lib/sites";
import { useMissionStore } from "@/store/useMissionStore";

/**
 * Type a point instead of clicking it. Finds the Artemis III region area holding the point (terrain is
 * loaded only there), switches to it if needed, and picks the point exactly as a click would.
 * `onEnterSurface` is called when the point needs the surface view and we're in orbit.
 */
export default function CoordinateInput({ onEnterSurface }: { onEnterSurface?: () => void }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const go = () => {
    const p = parseLatLon(text);
    if ("error" in p) return setMsg(p.error);
    const st = useMissionStore.getState();
    const { region, nearest } = regionFor(regions, p, st.selectedRegionId);
    if (!region) {
      return setMsg(`Outside the nine region areas (terrain is loaded only there). Nearest: ${nearest.region.name}, `
        + `${nearest.km.toFixed(0)} km from its centre.`);
    }
    setMsg(null);
    if (region.id !== st.selectedRegionId) st.selectRegion(region.id);
    st.requestPick(p.lat, p.lon, region.id);
    if (st.mode !== "surface") onEnterSurface?.();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); go(); }}>
      <label htmlFor="coord-input" className="eyebrow">Go to coordinates</label>
      <div className="mt-1.5 flex">
        <input id="coord-input" value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }}
               placeholder="85.963°S 2.382°W" spellCheck={false} autoComplete="off"
               className="min-w-0 flex-1 border border-line-2 bg-transparent px-2 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none" />
        <button type="submit" className="border border-l-0 border-line-2 px-3 text-[12px] text-ink transition-colors hover:border-ink">Go</button>
      </div>
      {msg && <p role="alert" className="mt-1.5 text-[11px] leading-snug text-bad">{msg}</p>}
    </form>
  );
}
