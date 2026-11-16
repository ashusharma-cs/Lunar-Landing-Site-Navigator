// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useEffect, useState } from "react";
import { type Ephemeris, loadEphemeris } from "./ephemeris";

/** Ephemeris covering [startMs, endMs]; null while loading. */
export function useEphemeris(startMs: number, endMs: number): { eph: Ephemeris | null; error: string | null } {
  const [eph, setEph] = useState<Ephemeris | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadEphemeris(startMs, endMs)
      .then((e) => {
        if (!live) return;
        setEph(e);
        setError(null);
      })
      .catch((e) => {
        if (!live) return;
        setEph(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [startMs, endMs]);
  return { eph, error };
}
