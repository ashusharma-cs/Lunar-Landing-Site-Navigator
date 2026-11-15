// Main-thread client for lib/engine.worker.ts. Falls back to computing on the main thread when a
// worker can't be created or fails, so results never depend on worker support.

import type { EngineRequest, EngineResponse } from "./engine.worker";
import { loadEphemeris } from "./ephemeris";
import { computeSkyline } from "./skyline";
import { type Spot, confirmSpot } from "./spots";
import { loadTerrain } from "./terrain";

type Pending = { resolve: (r: EngineResponse) => void; reject: (e: Error) => void };
type Req = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

let worker: Worker | null | undefined;
/** Where engine calls last ran (shown to dev tools as window.__engineMode). */
let mode: "worker" | "main thread" | "unused" = "unused";
const note = (m: typeof mode) => {
  mode = m;
  if (typeof window !== "undefined") (window as unknown as { __engineMode?: string }).__engineMode = mode;
};
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./engine.worker.ts", import.meta.url));
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (!p) return;
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = () => {
      // Broken worker: fail everything in flight (callers fall back) and stop using it.
      for (const p of pending.values()) p.reject(new Error("engine worker failed"));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function call(req: Req): Promise<EngineResponse> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("no worker"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ ...req, id });
  });
}

/** Skyline of a point (720 azimuths, 200 km), computed off the main thread. */
export async function skylineAsync(terrainId: string, lat: number, lon: number, obsH: number): Promise<Float32Array> {
  try {
    const r = (await call({ kind: "skyline", terrainId, lat, lon, obsH })).skyline!;
    note("worker");
    return r;
  } catch {
    note("main thread");
    return computeSkyline(await loadTerrain(terrainId), lat, lon, obsH);
  }
}

/** Full-skyline re-check of ranked spots at the survey's time steps, off the main thread. */
export async function confirmSpotsAsync(terrainId: string, spots: Spot[], times: number[], obsH: number): Promise<NonNullable<Spot["cpu"]>[]> {
  try {
    const r = (await call({ kind: "confirm", terrainId, spots, times, obsH })).cpu!;
    note("worker");
    return r;
  } catch {
    note("main thread");
    const t = await loadTerrain(terrainId);
    const eph = await loadEphemeris(Math.min(...times), Math.max(...times));
    return spots.map((s) => confirmSpot(t, eph, times, s, obsH));
  }
}
