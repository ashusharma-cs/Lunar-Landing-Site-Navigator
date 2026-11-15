"use client";

import { useEffect } from "react";
import { Segmented } from "@/components/ui/Controls";
import { type UiMode, useMissionStore } from "@/store/useMissionStore";

const KEY = "lln-ui-mode";

/** Restores the viewer's Simple/Planner choice after mount (per-browser convenience; safe without storage). */
export function useUiModeRestore() {
  useEffect(() => {
    try {
      const m = localStorage.getItem(KEY);
      if (m === "simple" || m === "planner") useMissionStore.setState({ uiMode: m as UiMode });
    } catch {}
  }, []);
}

/** Simple / Planner switch, shared by every page. */
export default function ModeSwitch() {
  const mode = useMissionStore((s) => s.uiMode);
  const setMode = useMissionStore((s) => s.setUiMode);
  useUiModeRestore();
  return (
    <div title="Simple: plain answers. Planner: every number and control.">
      <Segmented label="Detail level" value={mode} onChange={setMode}
                 options={[{ value: "simple", label: "Simple" }, { value: "planner", label: "Planner" }]} />
    </div>
  );
}
