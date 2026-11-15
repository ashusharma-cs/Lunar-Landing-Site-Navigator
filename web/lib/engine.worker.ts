// Background thread for the CPU-heavy engine calls, so clicks never freeze the page. Same code as
// the main thread (lib/skyline.ts, lib/spots.ts); the worker loads its own copy of the terrain and
// ephemeris through the same download-once cache.

import { loadEphemeris } from "./ephemeris.ts";
import { computeSkyline } from "./skyline.ts";
import { type Spot, confirmSpot } from "./spots.ts";
import { loadTerrain } from "./terrain.ts";

export type EngineRequest =
  | { id: number; kind: "skyline"; terrainId: string; lat: number; lon: number; obsH: number }
  | { id: number; kind: "confirm"; terrainId: string; spots: Spot[]; times: number[]; obsH: number };

export type EngineResponse = { id: number; skyline?: Float32Array; cpu?: NonNullable<Spot["cpu"]>[]; error?: string };

const post = (r: EngineResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const q = e.data;
  try {
    const t = await loadTerrain(q.terrainId);
    if (q.kind === "skyline") {
      const skyline = computeSkyline(t, q.lat, q.lon, q.obsH);
      post({ id: q.id, skyline }, [skyline.buffer]);
    } else {
      const eph = await loadEphemeris(Math.min(...q.times), Math.max(...q.times));
      post({ id: q.id, cpu: q.spots.map((s) => confirmSpot(t, eph, q.times, s, q.obsH)) });
    }
  } catch (err) {
    post({ id: q.id, error: err instanceof Error ? err.message : String(err) });
  }
};
