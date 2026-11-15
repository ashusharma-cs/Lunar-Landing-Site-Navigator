// Topocentric geometry on the Moon, mirroring pipeline/horizons.py (azel_from_subpoints).
// All vectors are Moon ME frame, km.

export type Vec3 = [number, number, number];

export const R_MOON_KM = 1737.4;
export const R_SUN_KM = 695_700;
export const R_EARTH_KM = 6371;

const D2R = Math.PI / 180;

export function unitFromLonLat(lonDeg: number, latDeg: number): Vec3 {
  const lon = lonDeg * D2R;
  const lat = latDeg * D2R;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Azimuth (deg clockwise from true north) and elevation (deg) of a body seen from a surface site. */
export function azEl(latDeg: number, lonDeg: number, heightM: number, body: Vec3): { az: number; el: number } {
  const r = R_MOON_KM + heightM / 1000;
  const up = unitFromLonLat(lonDeg, latDeg);
  const dx = body[0] - r * up[0];
  const dy = body[1] - r * up[1];
  const dz = body[2] - r * up[2];
  const lon = lonDeg * D2R;
  const lat = latDeg * D2R;
  const e = -Math.sin(lon) * dx + Math.cos(lon) * dy;
  const n = -Math.sin(lat) * Math.cos(lon) * dx - Math.sin(lat) * Math.sin(lon) * dy + Math.cos(lat) * dz;
  const u = up[0] * dx + up[1] * dy + up[2] * dz;
  const az = ((Math.atan2(e, n) / D2R) % 360 + 360) % 360;
  const el = Math.atan2(u, Math.hypot(e, n)) / D2R;
  return { az, el };
}

/** Angular radius (deg) of a sphere of radius `radiusKm` at distance `distKm`. */
export function angularRadius(radiusKm: number, distKm: number): number {
  return Math.asin(radiusKm / distKm) / D2R;
}

/** Fraction of a disc above a flat horizon, given (centre elevation - horizon) / angular radius. */
export function discVisible(x: number): number {
  if (x >= 1) return 1;
  if (x <= -1) return 0;
  return 1 - (Math.acos(x) - x * Math.sqrt(1 - x * x)) / Math.PI;
}

/** Skyline elevation at an azimuth, linearly interpolated (skyline sampled uniformly from 0 deg). */
export function skylineAt(sky: Float32Array, azDeg: number): number {
  const n = sky.length;
  const f = (((azDeg % 360) + 360) % 360) * (n / 360);
  const i = Math.floor(f);
  const t = f - i;
  return sky[i % n] * (1 - t) + sky[(i + 1) % n] * t;
}
