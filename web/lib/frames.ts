// Coordinate frames for the 3D scene.
//
// Scene units: 1 = Moon radius (1737.4 km). Scene axes are three.js (Y up); Moon ME maps as
//   three = (x_me, z_me, -y_me)
// so lunar north is +Y and longitude 0 is +X. With that mapping three's SphereGeometry UVs
// line up with equirectangular maps whose left edge is 180 W (NASA SVS Moon kit, Blue Marble).

import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { R_MOON_KM, type Vec3 } from "./astro.ts";

/** C: Moon ME -> three. */
const C = new Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0);
const CT = C.clone().transpose();

export function meToThree(v: Vec3, scale = 1 / R_MOON_KM): Vector3 {
  return new Vector3(v[0] * scale, v[2] * scale, -v[1] * scale);
}

/** Rotation Moon ME -> ICRF, from the ephemeris quaternion (x, y, z, w). */
export function meToIcrf(q: [number, number, number, number]): Matrix3 {
  return new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion(...q)));
}

/** Greenwich mean sidereal time, degrees (IAU 1982 linear term; plenty for a texture's rotation). */
export function gmstDeg(ms: number): number {
  const jd = ms / 86_400_000 + 2440587.5;
  return ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360 + 360) % 360;
}

/**
 * Orientation of Earth's mesh in the scene: Earth-fixed -> ICRF (spin about the ICRF pole by
 * GMST; precession since J2000 is ~0.4 deg and ignored) -> Moon ME -> three.
 */
export function earthOrientation(q: [number, number, number, number], ms: number): Quaternion {
  return toQuaternion(C.clone().multiply(earthMeshToMe(q, ms)));
}

/** Earth's mesh frame (three-style Earth-fixed) -> Moon ME. */
function earthMeshToMe(q: [number, number, number, number], ms: number): Matrix3 {
  const g = (gmstDeg(ms) * Math.PI) / 180;
  const spin = new Matrix3().set(Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1);
  return meToIcrf(q).transpose().multiply(spin).multiply(CT);
}

function toQuaternion(m3: Matrix3): Quaternion {
  const e = m3.elements; // column-major
  const m4 = new Matrix4().set(e[0], e[3], e[6], 0, e[1], e[4], e[7], 0, e[2], e[5], e[8], 0, 0, 0, 0, 1);
  return new Quaternion().setFromRotationMatrix(m4);
}

// --- Site-local surface frame -------------------------------------------------------------------
// Metres, three.js axes at the landing site: x = east, y = up, z = south (-north), so the terrain
// grids' (x east, y north) map to three (x, -z).

export type SiteFrame = { L: Matrix3; siteKm: Vec3 };

/** L: local three -> Moon ME (columns east, up, -north). */
export function siteFrame(latDeg: number, lonDeg: number, heightM: number): SiteFrame {
  const p = (latDeg * Math.PI) / 180;
  const l = (lonDeg * Math.PI) / 180;
  const e = [-Math.sin(l), Math.cos(l), 0];
  const n = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
  const u = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  const L = new Matrix3().set(e[0], u[0], -n[0], e[1], u[1], -n[1], e[2], u[2], -n[2]);
  const r = R_MOON_KM + heightM / 1000;
  return { L, siteKm: [u[0] * r, u[1] * r, u[2] * r] };
}

/** Topocentric direction (unit, local three) and distance (km) of a body given in ME km. */
export function bodyLocal(f: SiteFrame, v: Vec3): { dir: Vector3; km: number } {
  const d = new Vector3(v[0] - f.siteKm[0], v[1] - f.siteKm[1], v[2] - f.siteKm[2]);
  const km = d.length();
  return { dir: d.applyMatrix3(f.L.clone().transpose()).normalize(), km };
}

/** Earth's mesh orientation in the local frame. */
export function earthOrientationLocal(f: SiteFrame, q: [number, number, number, number], ms: number): Quaternion {
  return toQuaternion(f.L.clone().transpose().multiply(earthMeshToMe(q, ms)));
}

/** Point on the lunar surface in scene units (radius 1 + height). */
export function surfacePoint(latDeg: number, lonDeg: number, heightM = 0): Vector3 {
  const r = 1 + heightM / (R_MOON_KM * 1000);
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return meToThree([Math.cos(lat) * Math.cos(lon) * r, Math.cos(lat) * Math.sin(lon) * r, Math.sin(lat) * r], 1);
}
