// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
// Typed coordinates: parsing and which region's terrain area holds a point.

import { toGrid } from "./terrain.ts";

export type LatLon = { lat: number; lon: number };

/**
 * Parse "85.963°S 2.382°W", "85.963 S, 2.382 W", "85.963S 2.382E" or signed decimals "-85.963, -2.382"
 * (latitude first; south and west negative). Returns degrees with longitude in [-180, 180], or an error.
 */
export function parseLatLon(input: string): LatLon | { error: string } {
  const s = input.trim().toUpperCase().replace(/[°º]/g, " ").replace(/,/g, " ");
  const m = s.match(/^([+-]?\d+(?:\.\d+)?)\s*([NS])?\s+([+-]?\d+(?:\.\d+)?)\s*([EW])?$/);
  if (!m) return { error: "Use decimal degrees, latitude first: 85.963°S 2.382°W or -85.963, -2.382" };
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2]) {
    if (lat < 0) return { error: "Give either a minus sign or N/S, not both" };
    lat = m[2] === "S" ? -lat : lat;
  }
  if (m[4]) {
    if (lon < 0) return { error: "Give either a minus sign or E/W, not both" };
    lon = m[4] === "W" ? -lon : lon;
  }
  if (Math.abs(lat) > 90) return { error: "Latitude must be between 90°S and 90°N" };
  if (Math.abs(lon) > 360) return { error: "Longitude must be between 180°W and 180°E" };
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

type AreaRegion = { id: string; featureLat: number; featureLon: number; areaHalfKm: number };

/** Grid offset (metres) of a point from a region's centre; inside the area when both are within its half-size. */
function offset(r: AreaRegion, p: LatLon): [number, number] {
  return toGrid({ lat: r.featureLat, lon: r.featureLon }, p.lat, p.lon);
}

export function inArea(r: AreaRegion, p: LatLon): boolean {
  const [x, y] = offset(r, p);
  const h = r.areaHalfKm * 1000;
  return Math.abs(x) <= h && Math.abs(y) <= h;
}

/**
 * Region whose terrain area holds the point: the preferred one if it does, otherwise the one with the
 * nearest centre. Null when no area holds it; `nearest` then names the closest region and its distance.
 */
export function regionFor<R extends AreaRegion>(regions: R[], p: LatLon, preferId?: string | null):
  { region: R | null; nearest: { region: R; km: number } } {
  const dist = (r: R) => Math.hypot(...offset(r, p)) / 1000;
  const sorted = [...regions].sort((a, b) => dist(a) - dist(b));
  const inside = sorted.filter((r) => inArea(r, p));
  const region = inside.find((r) => r.id === preferId) ?? inside[0] ?? null;
  return { region, nearest: { region: sorted[0], km: dist(sorted[0]) } };
}
