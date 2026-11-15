"use client";

import { CameraControls, Html } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, type RefObject, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ACESFilmicToneMapping, type Group, type Mesh, Vector3 } from "three";
import Earth from "@/components/space/Earth";
import Moon from "@/components/space/Moon";
import RegionMarkers from "@/components/space/RegionMarkers";
import Sun from "@/components/space/Sun";
import SurfaceScene from "@/components/surface/SurfaceScene";
import { R_EARTH_KM, R_MOON_KM, R_SUN_KM } from "@/lib/astro";
import type { Ephemeris } from "@/lib/ephemeris";
import { earthOrientation, meToThree, surfacePoint } from "@/lib/frames";
import { getRegion } from "@/lib/sites";
import { type CameraView, useMissionStore } from "@/store/useMissionStore";

// Directions always come straight from the ephemeris. Sizes of Moon and Earth are true; in
// "compressed" mode distances shrink so all three bodies fit on screen (the Sun is then drawn
// small); in "true" mode everything is at real distance and size.
const COMPRESSED = { earthDist: 30, sunDist: 90, sunRadius: 5 };
const EARTH_RADIUS = R_EARTH_KM / R_MOON_KM;
const WORLD_UP = new Vector3(0, 1, 0);
// Closest approach to the Moon: below ~30 km the globe textures (best ~89 m/pixel) run out of
// detail; real close-ups come from the terrain view.
const MOON_MIN_ALT = 30 / R_MOON_KM;

type Focus = "moon" | "earth" | "sun" | "site" | "free";
const FOCUS_OF: Record<CameraView, Focus> = {
  overview: "moon", "south-pole": "moon", "from-earth": "moon", earth: "earth", sun: "sun", system: "free",
  region: "site",
};

/** Name tag under a body; hidden when the body is close (fills the view) or behind another body. */
function BodyLabel({ position, radius, text, className, occluders }: {
  position: Vector3; radius: number; text: string; className: string; occluders: RefObject<Mesh | null>[];
}) {
  const [far, setFar] = useState(false);
  const anchor = useRef<Group>(null);
  useFrame(({ camera }) => {
    const toBody = position.clone().sub(camera.position);
    const inFront = toBody.dot(camera.getWorldDirection(new Vector3())) > 0;
    const isFar = inFront && toBody.length() > radius * 12;
    if (isFar !== far) setFar(isFar);
    // Sit just below the body's limb as seen on screen.
    const down = new Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
    anchor.current?.position.copy(position).addScaledVector(down, radius * 1.15);
  });
  // Html stays mounted (unmounting its root from a frame-driven state change races React's render).
  return (
    <group ref={anchor}>
      <Html center occlude={occluders as RefObject<Mesh>[]} style={{ pointerEvents: "none" }}>
        <div className={`translate-y-2 text-[11px] tracking-wide ${far ? "" : "hidden"} ${className}`}>{text}</div>
      </Html>
    </group>
  );
}

function Bodies({ eph }: { eph: Ephemeris }) {
  const cursorMs = useMissionStore((s) => s.cursorMs);
  const scaleMode = useMissionStore((s) => s.scaleMode);
  const view = useMissionStore((s) => s.view);
  const viewNonce = useMissionStore((s) => s.viewNonce);
  const zoom = useMissionStore((s) => s.zoom);
  const selectedRegionId = useMissionStore((s) => s.selectedRegionId);
  const camera = useThree((s) => s.camera);
  const controls = useRef<CameraControls>(null);
  const moon = useRef<Mesh>(null);
  const earth = useRef<Mesh>(null);
  const sun = useRef<Mesh>(null);
  const focus = useRef<Focus>("moon");
  // Radius of the surface under the orbit target (0 when the target is itself on a surface or in
  // space): zoom scales altitude above it, so steps feel the same from 400 000 km to 30 km.
  const floor = useRef(1);
  const desired = useRef<{ d: number; at: number } | null>(null);
  const followed = useRef(new Vector3());
  // False until the first camera placement: lets a mount straight into a region view (coming back
  // up from the surface) start just above the region instead of flying in from far away.
  const placed = useRef(false);
  const s = eph.at(cursorMs) ?? eph.at(eph.startMs)!;

  const g = useMemo(() => {
    const sunTrue = meToThree(s.sun);
    const earthTrue = meToThree(s.earth);
    const sunDir = sunTrue.clone().normalize();
    const earthDir = earthTrue.clone().normalize();
    const trueScale = scaleMode === "true";
    const earthPos = trueScale ? earthTrue : earthDir.clone().multiplyScalar(COMPRESSED.earthDist);
    const sunPos = trueScale ? sunTrue : sunDir.clone().multiplyScalar(COMPRESSED.sunDist);
    // Earth's phase as seen from the Moon drives earthshine on the lunar night side.
    const fromEarthToSun = sunTrue.clone().sub(earthTrue).normalize();
    const phase = (1 + fromEarthToSun.dot(earthDir.clone().negate())) / 2;
    return {
      sunDir,
      earthDir,
      earthPos,
      sunPos,
      sunRadius: trueScale ? R_SUN_KM / R_MOON_KM : COMPRESSED.sunRadius,
      earthSunDir: fromEarthToSun,
      // Real earthshine is ~1e-4 of sunlight; exaggerated so night-side terrain stays readable.
      earthshine: 0.16 * phase,
      orientation: earthOrientation(s.q, cursorMs),
    };
  }, [s, scaleMode, cursorMs]);

  // Camera moves only on explicit view requests, using the geometry at request time.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const region = selectedRegionId ? getRegion(selectedRegionId) : undefined;
    const far = scaleMode === "true" ? 3e5 : 600;
    const f = FOCUS_OF[view];
    let up = WORLD_UP.clone();
    let eye: Vector3;
    let target: Vector3;
    let minD = 1 + MOON_MIN_ALT;
    let floorR = 1;
    let maxPolar = Math.PI;

    if (view === "region" && region) {
      // Frame the whole namesake feature from 60 deg off vertical, Earth-facing side.
      target = surfacePoint(region.featureLat, region.featureLon);
      up = target.clone().normalize();
      const d = Math.max(0.06, (region.featureDiameterKm / 1737.4) * 2.4);
      const side = g.earthDir.clone().projectOnPlane(up).normalize();
      eye = target.clone().add(up.clone().multiplyScalar(d * 0.5).add(side.multiplyScalar(d * 0.87)));
      minD = MOON_MIN_ALT * 1.4;
      floorR = 0;
      maxPolar = (86 * Math.PI) / 180;
    } else if (view === "earth") {
      target = g.earthPos.clone();
      eye = target.clone().sub(g.earthDir.clone().multiplyScalar(EARTH_RADIUS * 4));
      minD = EARTH_RADIUS * 1.1;
      floorR = EARTH_RADIUS;
    } else if (view === "sun") {
      target = g.sunPos.clone();
      eye = target.clone().sub(g.sunDir.clone().multiplyScalar(g.sunRadius * 4));
      minD = g.sunRadius * 1.3;
      floorR = g.sunRadius;
    } else if (view === "system") {
      // Frame Moon, Earth and Sun together, looking down on the plane they define.
      const pts = [new Vector3(), g.earthPos, g.sunPos];
      target = pts.reduce((a, p) => a.add(p), new Vector3()).divideScalar(3);
      const radius = Math.max(...pts.map((p) => p.distanceTo(target))) + g.sunRadius;
      const normal = g.sunDir.clone().cross(g.earthDir).normalize();
      if (normal.y < 0) normal.negate();
      eye = target.clone().add(normal.multiplyScalar(radius / Math.sin((18 * Math.PI) / 180)));
      minD = 5;
      floorR = 0;
    } else if (view === "south-pole") {
      // Below the pole looking up at it, tilted toward Earth so the near side sits at the bottom.
      target = new Vector3();
      eye = new Vector3(0, -2.4, 0).add(g.earthDir.clone().setY(0).normalize().multiplyScalar(0.35));
    } else if (view === "from-earth") {
      target = new Vector3();
      eye = g.earthPos.clone().multiplyScalar(scaleMode === "true" ? 0.97 : 0.8);
    } else {
      target = new Vector3();
      eye = g.sunDir.clone().multiplyScalar(2.2).add(new Vector3(0, -1.6, 0)).add(g.earthDir.clone().multiplyScalar(1.2));
      eye.setLength(3.6);
    }

    focus.current = f;
    floor.current = floorR;
    desired.current = null;
    followed.current.copy(f === "earth" ? g.earthPos : f === "sun" ? g.sunPos : new Vector3());
    camera.up.copy(up);
    c.updateCameraUp();
    c.minDistance = minD;
    c.maxDistance = far;
    c.minPolarAngle = 0;
    c.maxPolarAngle = maxPolar;
    if (!placed.current && view === "region" && region) {
      // Ascending from the surface: the camera still holds surface-scene (metre) coordinates, which
      // mean thousands of Moon radii here. Jump to just above the region, then rise to the framing.
      const lowUp = target.clone().normalize();
      const low = target.clone().addScaledVector(lowUp, (region.areaHalfKm * 1.2) / 1737.4);
      c.setLookAt(low.x, low.y, low.z, target.x, target.y, target.z, false);
    }
    placed.current = true;
    c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewNonce]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __cc?: unknown }).__cc = controls.current;
  }, []);

  // Zoom by altitude: new altitude = altitude * exp(step). Consecutive steps chain from the last
  // requested distance (not the mid-transition one) so fast scrolling doesn't stall.
  const zoomBy = (step: number) => {
    const c = controls.current;
    if (!c) return;
    const now = performance.now();
    const from = desired.current && now - desired.current.at < 400 ? desired.current.d : c.distance;
    const alt = Math.max(from - floor.current, 1e-6);
    const d = Math.min(c.maxDistance, Math.max(c.minDistance, floor.current + alt * Math.exp(step)));
    desired.current = { d, at: now };
    c.dollyTo(d, true);
  };

  useEffect(() => {
    if (zoom.nonce > 0) zoomBy(zoom.dir > 0 ? -0.7 : 0.7);
     
  }, [zoom]);

  // Wheel / trackpad: camera-controls' own wheel dolly is disabled (ACTION.NONE = 0) in favour of
  // zoomBy. Trackpad pinch arrives as ctrl+wheel with small deltas, so it gets a larger gain.
  const gl = useThree((st) => st.gl);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.mouseButtons.wheel = 0;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      zoomBy(px * (e.ctrlKey ? 0.012 : 0.0025));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
     
  }, [gl]);

  // Keep Earth or the Sun centred while time plays: shift camera and target by the body's motion.
  useFrame(() => {
    const c = controls.current;
    if (!c || (focus.current !== "earth" && focus.current !== "sun")) return;
    const now = focus.current === "earth" ? g.earthPos : g.sunPos;
    const d = now.clone().sub(followed.current);
    if (d.lengthSq() === 0) return;
    followed.current.copy(now);
    const p = c.getPosition(new Vector3());
    const t = c.getTarget(new Vector3());
    c.setLookAt(p.x + d.x, p.y + d.y, p.z + d.z, t.x + d.x, t.y + d.y, t.z + d.z, false);
  });

  return (
    <>
      {/* Distance and angle limits are set per view in the effect above. */}
      <CameraControls ref={controls} smoothTime={0.32} />
      <Moon ref={moon} sunDir={g.sunDir} earthDir={g.earthDir} earthshine={g.earthshine} />
      <RegionMarkers />
      <Earth ref={earth} position={g.earthPos} radius={EARTH_RADIUS} orientation={g.orientation} sunDir={g.earthSunDir} />
      <Sun ref={sun} position={g.sunPos} radius={g.sunRadius} />
      <BodyLabel position={g.earthPos} radius={EARTH_RADIUS} text="Earth" className="text-earth" occluders={[moon, sun]} />
      <BodyLabel position={g.sunPos} radius={g.sunRadius} text="Sun" className="text-sun" occluders={[moon, earth]} />
      <BodyLabel position={new Vector3()} radius={1} text="Moon" className="text-ink-2" occluders={[earth, sun]} />
    </>
  );
}

/** Orbit (globe) or surface (local terrain at the selected site); both share one canvas. */
function Scene({ eph }: { eph: Ephemeris }) {
  const mode = useMissionStore((s) => s.mode);
  const selectedRegionId = useMissionStore((s) => s.selectedRegionId);
  const region = selectedRegionId ? getRegion(selectedRegionId) : undefined;
  return mode === "surface" && region ? <SurfaceScene eph={eph} region={region} /> : <Bodies eph={eph} />;
}

// Memoised: the overlay UI re-renders every playback frame; the scene reads the store itself and
// only needs React work when the ephemeris changes.
export default memo(SpaceScene);

function SpaceScene({ eph }: { eph: Ephemeris | null }) {
  return (
    <Canvas
      camera={{ position: [2.4, -2.2, 1.4], fov: 40, near: 0.0005, far: 1e6 }}
      gl={{ antialias: true, logarithmicDepthBuffer: true, toneMapping: ACESFilmicToneMapping }}
      dpr={[1, 2]}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.1;
      }}
    >
      <Suspense fallback={null}>{eph && <Scene eph={eph} />}</Suspense>
    </Canvas>
  );
}
