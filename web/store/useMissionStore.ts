import { useEffect } from "react";
import { create } from "zustand";

const DAY_MS = 86_400_000;

export const DEFAULT_START = Date.UTC(2026, 10, 14);
/** Playback rate equal to the wall clock. */
export const REAL_TIME = 1 / 3600;

export type ScaleMode = "compressed" | "true";
export type CameraView = "overview" | "south-pole" | "from-earth" | "earth" | "sun" | "system" | "region";

export type Mode = "orbit" | "surface";
export type SurfaceView = "overview" | "eye-sun" | "eye-earth";

/** A point the user picked inside a region's terrain area, with its computed skyline. */
export type Probe = { regionId: string; lat: number; lon: number; groundM: number; skyline: Float32Array };

import type { HeatLayer } from "@/lib/heat";
export type { HeatLayer };
/** Best-spot survey of a region's terrain area over one window (see lib/spots.ts). */
export type Survey = {
  regionId: string; startMs: number; endMs: number; steps: number; cells: number; cellM: number;
  /** The time steps (ms) the survey sampled. */
  times: number[];
  /** Baseline of the slope estimate (two LOLA grid steps), metres. */
  slopeBaseM: number;
  /** cells x cells x 4: Sun, Earth, both (fractions of the window), slope (deg). */
  data: Float32Array;
  spots: import("@/lib/spots").Spot[];
};
/** A point queued for side-by-side comparison (up to MAX_COMPARE). */
export type ComparePoint = { regionId: string; lat: number; lon: number };
export const MAX_COMPARE = 3;

/** /compare URL for a set of points. */
export function compareHref(points: ComparePoint[]): string {
  return `/compare?${points.map((p) => `p=${p.regionId}:${p.lat.toFixed(5)}:${p.lon.toFixed(5)}`).join("&")}`;
}

/** Survey values under the pointer. */
export type HeatHover = { sun: number; earth: number; both: number; slope: number } | null;

type MissionState = {
  /** Orbit = globe scene; surface = local terrain scene at the selected site. */
  mode: Mode;
  setMode: (mode: Mode) => void;
  surfaceView: SurfaceView;
  surfaceNonce: number;
  setSurfaceView: (v: SurfaceView) => void;
  /** Terrain loaded and first shadows traced (ends the descent fade). */
  surfaceReady: boolean;
  setSurfaceReady: (ready: boolean) => void;
  /** Zoom request from on-screen buttons: +1 in, -1 out; nonce re-triggers. */
  zoom: { dir: 1 | -1; nonce: number };
  requestZoom: (dir: 1 | -1) => void;
  startMs: number;
  days: number;
  cursorMs: number;
  playing: boolean;
  hoursPerSecond: number;
  /** Locked to the wall clock (UTC now). Any manual time or rate change leaves live mode. */
  live: boolean;
  goLive: () => void;
  selectedRegionId: string | null;
  selectRegion: (id: string | null) => void;
  probe: Probe | null;
  setProbe: (p: Probe | null) => void;
  /** Best-spot finder. `surveyNonce` requests a run; progress is null when idle. */
  surveyNonce: number;
  requestSurvey: () => void;
  surveyProgress: number | null;
  setSurveyProgress: (f: number | null) => void;
  survey: Survey | null;
  setSurvey: (s: Survey | null) => void;
  heatLayer: HeatLayer;
  setHeatLayer: (l: HeatLayer) => void;
  /** Steepest slope allowed for ranked spots (deg). Default 8: HLS must land within 8 deg of vertical. */
  maxSlope: number;
  setMaxSlope: (deg: number) => void;
  heatHover: HeatHover;
  setHeatHover: (h: HeatHover) => void;
  /** Fly the overview camera to the picked point; nonce re-triggers. */
  focusNonce: number;
  requestFocus: () => void;
  /** Points queued for the comparison page (in order; A, B, C). */
  compare: ComparePoint[];
  addCompare: (p: ComparePoint) => void;
  setCompare: (ps: ComparePoint[]) => void;
  /** Ask the surface scene to pick (and fly to) a point, as a click would. */
  /** `regionId`: the request waits until that region's surface scene is up. */
  pickRequest: { lat: number; lon: number; regionId?: string; nonce: number } | null;
  requestPick: (lat: number, lon: number, regionId?: string) => void;
  scaleMode: ScaleMode;
  /** Camera request; `viewNonce` changes on every request so repeating a view re-triggers it. */
  view: CameraView;
  viewNonce: number;
  setView: (view: CameraView) => void;
  setStart: (ms: number) => void;
  setDays: (days: number) => void;
  setCursor: (ms: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (hoursPerSecond: number) => void;
  setScaleMode: (mode: ScaleMode) => void;
  /** Advance the play cursor, looping inside the window. */
  tick: (dtSeconds: number) => void;
};

export const useMissionStore = create<MissionState>((set, get) => ({
  mode: "orbit",
  setMode: (mode) => set((s) => (mode === "surface"
    ? { mode, surfaceReady: false, surfaceView: "overview", surfaceNonce: s.surfaceNonce + 1 }
    : { mode, view: "region", viewNonce: s.viewNonce + 1 })),
  surfaceView: "overview",
  surfaceNonce: 0,
  setSurfaceView: (surfaceView) => set((s) => ({ surfaceView, surfaceNonce: s.surfaceNonce + 1 })),
  surfaceReady: false,
  setSurfaceReady: (surfaceReady) => set({ surfaceReady }),
  zoom: { dir: 1, nonce: 0 },
  requestZoom: (dir) => set((s) => ({ zoom: { dir, nonce: s.zoom.nonce + 1 } })),
  startMs: DEFAULT_START,
  days: 30,
  cursorMs: DEFAULT_START,
  playing: false,
  hoursPerSecond: 24,
  live: false,
  goLive: () => {
    const now = Date.now();
    const midnight = now - (now % DAY_MS);
    set({ startMs: midnight, days: Math.max(get().days, 14), cursorMs: now, hoursPerSecond: REAL_TIME, playing: true, live: true });
  },
  selectedRegionId: null,
  selectRegion: (id) =>
    set((s) => (id
      ? { selectedRegionId: id, probe: s.probe?.regionId === id ? s.probe : null, view: "region", viewNonce: s.viewNonce + 1 }
      : { selectedRegionId: null, probe: null })),
  probe: null,
  setProbe: (probe) => set({ probe }),
  surveyNonce: 0,
  requestSurvey: () => set((s) => ({ surveyNonce: s.surveyNonce + 1 })),
  surveyProgress: null,
  setSurveyProgress: (surveyProgress) => set({ surveyProgress }),
  survey: null,
  setSurvey: (survey) => set({ survey }),
  heatLayer: "off",
  setHeatLayer: (heatLayer) => set({ heatLayer }),
  maxSlope: 8,
  setMaxSlope: (maxSlope) => set({ maxSlope }),
  heatHover: null,
  setHeatHover: (heatHover) => set({ heatHover }),
  focusNonce: 0,
  requestFocus: () => set((s) => ({ focusNonce: s.focusNonce + 1 })),
  compare: [],
  addCompare: (p) => set((s) => (s.compare.some((c) => c.regionId === p.regionId && c.lat === p.lat && c.lon === p.lon)
    ? {} : { compare: [...s.compare, p].slice(-MAX_COMPARE) })),
  setCompare: (compare) => set({ compare: compare.slice(0, MAX_COMPARE) }),
  pickRequest: null,
  requestPick: (lat, lon, regionId) => set((s) => ({ pickRequest: { lat, lon, regionId, nonce: (s.pickRequest?.nonce ?? 0) + 1 } })),
  scaleMode: "compressed",
  view: "overview",
  viewNonce: 0,
  setView: (view) => set((s) => ({ view, viewNonce: s.viewNonce + 1 })),
  setStart: (ms) => set({ startMs: ms, cursorMs: ms, live: false }),
  setDays: (days) => {
    const { startMs, cursorMs } = get();
    set({ days, cursorMs: Math.min(cursorMs, startMs + days * DAY_MS) });
  },
  setCursor: (ms) => set({ cursorMs: ms, live: false }),
  setPlaying: (playing) => set((s) => ({ playing, live: playing && s.live })),
  setSpeed: (hoursPerSecond) => set({ hoursPerSecond, live: false }),
  setScaleMode: (scaleMode) => set({ scaleMode }),
  tick: (dt) => {
    const { startMs, days, cursorMs, hoursPerSecond, live } = get();
    if (live) {
      // Wall clock; roll the window forward if a long session runs past its end.
      const now = Date.now();
      set(now > startMs + days * DAY_MS ? { cursorMs: now, startMs: now - (now % DAY_MS) } : { cursorMs: now });
      return;
    }
    const end = startMs + days * DAY_MS;
    let next = cursorMs + dt * hoursPerSecond * 3_600_000;
    if (next > end) next = startMs;
    set({ cursorMs: next });
  },
}));

/** Drive the play cursor with requestAnimationFrame while `playing` is on. */
export function usePlayback() {
  const playing = useMissionStore((s) => s.playing);
  const tick = useMissionStore((s) => s.tick);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      tick((now - last) / 1000);
      last = now;
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, tick]);
}

// Dev only: lets browser-side checks drive time and mode (e.g. the GPU shadow validation).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __mission?: typeof useMissionStore }).__mission = useMissionStore;
}
