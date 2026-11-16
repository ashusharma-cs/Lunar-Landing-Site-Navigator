// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Sun and Earth tracks over a time window for one site.

import { R_EARTH_KM, R_SUN_KM, angularRadius, azEl, discVisible, skylineAt } from "./astro.ts";
import type { Ephemeris } from "./ephemeris.ts";

export type TrackPoint = {
  t: number;
  sunAz: number;
  sunEl: number;
  sunSky: number;    // skyline elevation at the Sun's azimuth
  sunR: number;      // Sun angular radius, deg
  sunVis: number;    // fraction of the Sun's disc above the skyline
  earthAz: number;
  earthEl: number;
  earthSky: number;
  earthR: number;
  earthVis: number;  // fraction of Earth's disc above the skyline
};

/** Direct-to-Earth line of sight: centre clears the skyline ("in view", our conservative radio
 * criterion), only part of the disc shows ("partly visible", what NASA's Earth-visibility maps count
 * as visible), or none of it ("blocked"). `earthVis` is the fraction of Earth's disc above the skyline. */
export function earthState(earthVis: number): { label: string; tone: "ok" | "partial" | "bad" } {
  if (earthVis >= 0.5) return { label: "in view", tone: "ok" };
  if (earthVis > 0) return { label: `partly visible · ${(100 * earthVis).toFixed(0)}%`, tone: "partial" };
  return { label: "blocked", tone: "bad" };
}

export function samplePoint(eph: Ephemeris, sky: Float32Array, lat: number, lon: number, hM: number, t: number): TrackPoint | null {
  const s = eph.at(t);
  if (!s) return null;
  const sun = azEl(lat, lon, hM, s.sun);
  const earth = azEl(lat, lon, hM, s.earth);
  const sunSky = skylineAt(sky, sun.az);
  const earthSky = skylineAt(sky, earth.az);
  const sunR = angularRadius(R_SUN_KM, s.sunKm);
  const earthR = angularRadius(R_EARTH_KM, s.earthKm);
  return {
    t,
    sunAz: sun.az, sunEl: sun.el, sunSky, sunR, sunVis: discVisible((sun.el - sunSky) / sunR),
    earthAz: earth.az, earthEl: earth.el, earthSky, earthR, earthVis: discVisible((earth.el - earthSky) / earthR),
  };
}

export function sampleTrack(eph: Ephemeris, sky: Float32Array, lat: number, lon: number, hM: number,
                            startMs: number, endMs: number, stepMs: number): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let t = startMs; t <= endMs; t += stepMs) {
    const p = samplePoint(eph, sky, lat, lon, hM, t);
    if (p) out.push(p);
  }
  return out;
}
