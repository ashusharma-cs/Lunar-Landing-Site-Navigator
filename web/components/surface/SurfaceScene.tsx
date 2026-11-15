"use client";

import { CameraControls, Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, type Group, Line, LineBasicMaterial, type Mesh, type PerspectiveCamera, Raycaster, Vector2, Vector3 } from "three";
import Earth from "@/components/space/Earth";
import Sun from "@/components/space/Sun";
import Terrain, { type SunProbe, type SurveyRun, type SurveyStep } from "@/components/surface/Terrain";
import { R_EARTH_KM, R_SUN_KM } from "@/lib/astro";
import type { Ephemeris } from "@/lib/ephemeris";
import { bodyLocal, earthOrientationLocal, siteFrame } from "@/lib/frames";
import { OBSERVER_HEIGHT_M, type Region, formatLatLon } from "@/lib/sites";
import { confirmSpotsAsync, skylineAsync } from "@/lib/engine";
import { computeSkyline } from "@/lib/skyline";
import { type AreaTerrain, fromGrid, heightAt, loadTerrain, toGrid } from "@/lib/terrain";
import { type Spot, addSlope, cellAt, cellCentre, confirmSpot, rankSpots, stepTimes } from "@/lib/spots";
import { samplePoint } from "@/lib/track";
import { useMissionStore } from "@/store/useMissionStore";

// Local scene in metres centred on the region's IAU namesake feature: x east, y up, z south.
// Sun and Earth sit 3 000 km out along their true directions with true angular sizes, beyond all
// terrain, so ridges occlude them by depth. Nothing here is a landing point: the only analysed
// point is the one the user clicks.
const BODY_DIST = 3e6;
const R_M = 1_737_400;
/** Survey resolution: cells per side of the region's terrain area. */
const SURVEY_CELLS = 512;
/** Survey time step (shorter windows) and the most steps per run. */
const SURVEY_STEP_MS = 2 * 3_600_000;
const SURVEY_MAX_STEPS = 360;

export default function SurfaceScene({ eph, region }: { eph: Ephemeris; region: Region }) {
  const cursorMs = useMissionStore((s) => s.cursorMs);
  const surfaceView = useMissionStore((s) => s.surfaceView);
  const surfaceNonce = useMissionStore((s) => s.surfaceNonce);
  const surfaceReady = useMissionStore((s) => s.surfaceReady);
  const setSurfaceReady = useMissionStore((s) => s.setSurfaceReady);
  const probe = useMissionStore((s) => s.probe);
  const setProbe = useMissionStore((s) => s.setProbe);
  const survey = useMissionStore((s) => s.survey);
  const heatLayer = useMissionStore((s) => s.heatLayer);
  const maxSlope = useMissionStore((s) => s.maxSlope);
  const insideRing = useMissionStore((s) => s.insideRing);
  /** Radius of the drawn ring: the named feature's official diameter / 2. */
  const ringM = (region.featureDiameterKm / 2) * 1000;
  const surveyNonce = useMissionStore((s) => s.surveyNonce);
  const focusNonce = useMissionStore((s) => s.focusNonce);
  const pickRequest = useMissionStore((s) => s.pickRequest);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const controls = useRef<CameraControls>(null);
  const sunMesh = useRef<Mesh>(null);
  const earthMesh = useRef<Mesh>(null);
  const [terrain, setTerrain] = useState<AreaTerrain | null>(null);
  const mode = useRef<"orbit" | "eye">("orbit");
  const flying = useRef(false);
  /** Overview camera at the moment the user went to eye level. */
  const beforeEye = useRef<{ pos: Vector3; target: Vector3 } | null>(null);

  useEffect(() => {
    let live = true;
    loadTerrain(region.terrainId).then((t) => live && setTerrain(t));
    return () => {
      live = false;
    };
  }, [region.terrainId]);

  // Metre-scale clip planes while on the surface; restore the globe's on the way out.
  useEffect(() => {
    camera.near = 0.05;
    camera.far = 1e7;
    camera.updateProjectionMatrix();
    return () => {
      camera.near = 0.0005;
      camera.far = 1e6;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  const centreGround = terrain ? heightAt(terrain, 0, 0) : 0;
  /** Scene y of the ground under scene (x, z), relative to the centre ground, with curvature drop. */
  const groundY = useCallback(
    (x: number, z: number) => {
      if (!terrain) return 0;
      const h = heightAt(terrain, x, -z);
      return Number.isNaN(h) ? -Infinity : h - centreGround - (x * x + z * z) / (2 * R_M);
    },
    [terrain, centreGround],
  );

  const frame = useMemo(() => siteFrame(region.featureLat, region.featureLon, centreGround), [region, centreGround]);
  const s = eph.at(cursorMs) ?? eph.at(eph.startMs)!;
  const g = useMemo(() => {
    const sun = bodyLocal(frame, s.sun);
    const earth = bodyLocal(frame, s.earth);
    const sunAng = Math.asin(R_SUN_KM / sun.km);
    const earthAng = Math.asin(R_EARTH_KM / earth.km);
    const earthToSun = new Vector3(s.sun[0] - s.earth[0], s.sun[1] - s.earth[1], s.sun[2] - s.earth[2])
      .applyMatrix3(frame.L.clone().transpose()).normalize();
    const phase = (1 + earthToSun.dot(earth.dir.clone().negate())) / 2;
    const enu = (v: Vector3) => new Vector3(v.x, -v.z, v.y);
    return {
      sunDir: sun.dir, earthDir: earth.dir, sunEnu: enu(sun.dir), earthEnu: enu(earth.dir), sunAng,
      sunPos: sun.dir.clone().multiplyScalar(BODY_DIST), sunRadius: BODY_DIST * Math.tan(sunAng),
      earthPos: earth.dir.clone().multiplyScalar(BODY_DIST), earthRadius: BODY_DIST * Math.tan(earthAng),
      earthToSun, earthshine: 0.16 * phase,
      earthOrientation: earthOrientationLocal(frame, s.q, cursorMs),
    };
  }, [frame, s, cursorMs]);

  // At eye level the terrain is drawn on the skyline's own sample points around the picked point.
  const horizonFrom = useMemo(
    () => (surfaceView !== "overview" && probe && probe.regionId === region.id ? { lat: probe.lat, lon: probe.lon } : null),
    [surfaceView, probe, region.id],
  );

  // The picked point in scene coordinates.
  const probePos = useMemo(() => {
    if (!terrain || !probe || probe.regionId !== region.id) return null;
    const [x, y] = toGrid(terrain, probe.lat, probe.lon);
    return new Vector3(x, groundY(x, -y), -y);
  }, [terrain, probe, region.id, groundY]);

  const lookAt = useCallback((view: typeof surfaceView, smooth: boolean) => {
    const c = controls.current;
    if (!c || !terrain) return;
    c.minPolarAngle = 0;
    // "Up" is the local vertical: the area centre's for the overview, the picked point's at eye level
    // (it tilts by offset / R, ~3 deg at 90 km), so the eye-level horizon isn't rolled.
    camera.up.copy(view === "overview" || !probePos ? new Vector3(0, 1, 0)
      : new Vector3(probePos.x / R_M, 1, probePos.z / R_M).normalize());
    c.updateCameraUp();
    if (view === "overview" || !probePos) {
      // Whole area, camera ~120 deg round from the Sun so relief and shadows read.
      const wasEye = mode.current === "eye";
      mode.current = "orbit";
      const half = region.areaHalfKm * 1000;
      const az = Math.atan2(g.sunDir.x, -g.sunDir.z) + (2 * Math.PI) / 3;
      // Back from eye level: return to exactly the view the user left. Otherwise the default framing.
      const saved = wasEye ? beforeEye.current : null;
      const target = saved?.target ?? probePos ?? new Vector3(0, groundY(0, 0), 0);
      const p = saved?.pos ?? target.clone().add(new Vector3(Math.sin(az) * half * 1.7, half * 1.1, -Math.cos(az) * half * 1.7));
      c.minDistance = 30;
      c.maxDistance = 900_000;
      c.maxPolarAngle = (88 * Math.PI) / 180;
      c.azimuthRotateSpeed = c.polarRotateSpeed = 1;
      // While flying to the view the ground clamp below stays off: nudging the camera mid-flight would
      // cancel the flight (e.g. coming back up from eye level, which starts 2 m above the ground).
      flying.current = smooth;
      c.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, smooth)
        .then(() => { flying.current = false; }, () => { flying.current = false; });
    } else {
      // Standing on the picked point at panel height, facing the Sun or Earth; drag to look around.
      // Remember the overview the user is leaving, so "Overview" brings them back to it.
      if (mode.current !== "eye") {
        const pos = new Vector3(), target = new Vector3();
        c.getPosition(pos);
        c.getTarget(target);
        beforeEye.current = { pos, target };
      }
      mode.current = "eye";
      const eye = probePos.clone().addScaledVector(camera.up, OBSERVER_HEIGHT_M);
      const dir = (view === "eye-sun" ? g.sunDir : g.earthDir).clone();
      const p = eye.clone().addScaledVector(dir, -0.1);
      c.minDistance = c.maxDistance = 0.1;
      c.maxPolarAngle = Math.PI;
      c.azimuthRotateSpeed = c.polarRotateSpeed = -0.35;
      c.setLookAt(p.x, p.y, p.z, eye.x, eye.y, eye.z, smooth);
    }
  }, [terrain, g, region, probePos, groundY, camera]);

  // Entry: start high above the area, then descend once terrain and first shadows are in.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.up.set(0, 1, 0);
    c.updateCameraUp();
    c.mouseButtons.wheel = 0; // custom wheel below
    c.setLookAt(0, region.areaHalfKm * 4000, region.areaHalfKm * 1200, 0, 0, 0, false);
  }, [camera, region]);

  useEffect(() => {
    if (!terrain || surfaceReady) return;
    const id = requestAnimationFrame(() => {
      setSurfaceReady(true);
      const c = controls.current;
      if (c) {
        c.smoothTime = 1.4;
        lookAt("overview", true);
        setTimeout(() => {
          if (controls.current) controls.current.smoothTime = 0.32;
        }, 2500);
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain]);

  useEffect(() => {
    if (surfaceReady) lookAt(surfaceView, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceNonce]);

  // Wheel: scale distance to the orbit target (ignored when standing at eye level).
  useEffect(() => {
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = controls.current;
      if (!c || mode.current === "eye") return;
      const px = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      c.dollyTo(Math.min(c.maxDistance, Math.max(c.minDistance, c.distance * Math.exp(px * (e.ctrlKey ? 0.012 : 0.0025)))), true);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl]);

  // The terrain is displaced on the GPU, so a screen point's ground hit is found by marching the
  // camera ray against the real height grids. Returns scene (x, z), or null for sky.
  const hitGround = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const r = gl.domElement.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const above = (t: number) => o.y + d.y * t - groundY(o.x + d.x * t, o.z + d.z * t);
    let t0 = 0, t1 = 1;
    while (t1 < 2e6 && above(t1) > 0) {
      t0 = t1;
      t1 *= 1.05;
    }
    if (t1 >= 2e6) return null;
    for (let i = 0; i < 40; i++) {
      const m = (t0 + t1) / 2;
      if (above(m) > 0) t0 = m;
      else t1 = m;
    }
    return [o.x + d.x * t1, o.z + d.z * t1];
  }, [gl, camera, groundY]);

  // Picking a point: its skyline is computed off the main thread (lib/engine.ts); if the user picks
  // again before it lands, only the latest pick is kept.
  const pickSeq = useRef(0);
  const pickPoint = useCallback((lat: number, lon: number, focus = false) => {
    if (!terrain) return;
    const n = ++pickSeq.current;
    const [x, y] = toGrid(terrain, lat, lon);
    const groundM = heightAt(terrain, x, y);
    skylineAsync(region.terrainId, lat, lon, OBSERVER_HEIGHT_M).then((skyline) => {
      if (n !== pickSeq.current) return;
      setProbe({ regionId: region.id, lat, lon, groundM, skyline });
      if (focus) useMissionStore.getState().requestFocus();
    });
  }, [terrain, region, setProbe]);

  // Click (not drag) on the terrain picks the point to analyse.
  useEffect(() => {
    if (!terrain) return;
    const el = gl.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || mode.current === "eye") return;
      const hit = hitGround(e.clientX, e.clientY);
      if (!hit) return;
      const [x, z] = hit;
      const half = region.areaHalfKm * 1000;
      if (Math.abs(x) > half || Math.abs(z) > half) return; // outside the region's terrain area
      const [lat, lon] = fromGrid(terrain, x, -z);
      pickPoint(lat, lon);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
    };
  }, [terrain, gl, hitGround, region, pickPoint]);

  // Survey values under the pointer (overview with a heatmap only), at most once per frame.
  useEffect(() => {
    if (!terrain || !survey || survey.regionId !== region.id || heatLayer === "off") {
      useMissionStore.getState().setHeatHover(null);
      return;
    }
    const el = gl.domElement;
    let queued: PointerEvent | null = null, raf = 0;
    const flush = () => {
      raf = 0;
      const e = queued;
      if (!e || mode.current === "eye") return;
      const hit = hitGround(e.clientX, e.clientY);
      const c = hit && cellAt(terrain, survey.cells, hit[0], -hit[1]);
      const k = c ? (c[1] * survey.cells + c[0]) * 4 : -1;
      useMissionStore.getState().setHeatHover(k < 0 ? null
        : { sun: survey.data[k], earth: survey.data[k + 1], both: survey.data[k + 2], slope: survey.data[k + 3] });
    };
    const onMove = (e: PointerEvent) => {
      queued = e;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onLeave = () => useMissionStore.getState().setHeatHover(null);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [terrain, survey, heatLayer, region.id, gl, hitGround]);

  // Best-spot survey: Sun and Earth for every cell over the window's time steps on the GPU, then
  // slope, ranking and a full-skyline re-check of each ranked spot on the CPU.
  const surveyRun = useRef<SurveyRun | null>(null);
  const onSurvey = useCallback((run: SurveyRun) => {
    surveyRun.current = run;
  }, []);
  useEffect(() => {
    const run = surveyRun.current;
    if (!surveyNonce || !terrain || !run) return;
    let cancelled = false;
    const st0 = useMissionStore.getState();
    const startMs = st0.startMs, endMs = startMs + st0.days * 86_400_000;
    const times = stepTimes(startMs, endMs, Math.min(SURVEY_MAX_STEPS, Math.ceil((endMs - startMs) / SURVEY_STEP_MS)));
    const enu = (v: Vector3) => new Vector3(v.x, -v.z, v.y);
    const steps: SurveyStep[] = [];
    for (const t of times) {
      const st = eph.at(t);
      if (!st) continue;
      const sun = bodyLocal(frame, st.sun), earth = bodyLocal(frame, st.earth);
      steps.push({ sunEnu: enu(sun.dir), sunR: Math.asin(R_SUN_KM / sun.km), earthEnu: enu(earth.dir), earthR: Math.asin(R_EARTH_KM / earth.km) });
    }
    const set = useMissionStore.getState();
    set.setSurveyProgress(0);
    const t0 = performance.now();
    run(steps, SURVEY_CELLS, OBSERVER_HEIGHT_M, (f) => !cancelled && set.setSurveyProgress(f), () => cancelled).then((raw) => {
      if (cancelled || !raw) return;
      const gpuMs = performance.now() - t0;
      const data = addSlope(terrain, SURVEY_CELLS, raw);
      const st1 = useMissionStore.getState();
      const spots = rankSpots(terrain, SURVEY_CELLS, data, st1.maxSlope, { maxRadiusM: st1.insideRing ? ringM : Infinity });
      // Re-check the ranked spots with the full skyline (off the main thread) before showing them.
      return confirmSpotsAsync(region.terrainId, spots, times, OBSERVER_HEIGHT_M).then((cpu) => {
        if (cancelled) return;
        spots.forEach((s, i) => (s.cpu = cpu[i]));
        set.setSurvey({
          regionId: region.id, startMs, endMs, steps: steps.length, cells: SURVEY_CELLS,
          cellM: (2 * terrain.near.halfM) / SURVEY_CELLS, data, spots, times, slopeBaseM: (4 * terrain.near.halfM) / terrain.near.n,
          gpuMs, sightlines: SURVEY_CELLS * SURVEY_CELLS * steps.length * 2,
        });
        set.setHeatLayer("both");
        set.setSurveyProgress(null);
      });
    });
    return () => {
      cancelled = true;
      useMissionStore.getState().setSurveyProgress(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surveyNonce]);

  // Dev check: GPU survey cells vs the full CPU skyline at the same steps, at seeded random cells.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !terrain) return;
    (window as unknown as { __checkSurvey?: unknown }).__checkSurvey = (n = 40) => {
      const sv = useMissionStore.getState().survey;
      if (!sv) return "no survey";
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const diffs: number[][] = [[], [], []];
      for (let k = 0; k < n; k++) {
        const i = Math.floor(rnd() * sv.cells), j = Math.floor(rnd() * sv.cells);
        const [x, y] = cellCentre(terrain, sv.cells, i, j);
        const [lat, lon] = fromGrid(terrain, x, y);
        const cpu = confirmSpot(terrain, eph, sv.times, { lat, lon, groundM: heightAt(terrain, x, y) } as Spot, OBSERVER_HEIGHT_M);
        const o = (j * sv.cells + i) * 4;
        diffs[0].push(Math.abs(cpu.sun - sv.data[o]));
        diffs[1].push(Math.abs(cpu.earth - sv.data[o + 1]));
        diffs[2].push(Math.abs(cpu.both - sv.data[o + 2]));
      }
      const stat = (a: number[]) => {
        const s = [...a].sort((p, q) => p - q);
        return { medianPP: +(100 * s[Math.floor(s.length / 2)]).toFixed(2), p90PP: +(100 * s[Math.floor(0.9 * (s.length - 1))]).toFixed(2), maxPP: +(100 * s[s.length - 1]).toFixed(2) };
      };
      return { cells: n, sun: stat(diffs[0]), earth: stat(diffs[1]), both: stat(diffs[2]) };
    };
  }, [terrain, eph]);

  // A new slope limit or ring setting re-ranks the existing survey (and re-checks the new spots).
  useEffect(() => {
    const sv = useMissionStore.getState().survey;
    if (!terrain || !sv || sv.regionId !== region.id) return;
    // Show the new ranking at once (map values), then swap in the full-skyline re-check.
    const spots = rankSpots(terrain, sv.cells, sv.data, maxSlope, { maxRadiusM: insideRing ? ringM : Infinity });
    useMissionStore.getState().setSurvey({ ...sv, spots });
    confirmSpotsAsync(region.terrainId, spots, sv.times, OBSERVER_HEIGHT_M).then((cpu) => {
      const now = useMissionStore.getState().survey;
      if (!now || now.data !== sv.data || now.spots !== spots) return;  // superseded
      useMissionStore.getState().setSurvey({ ...now, spots: spots.map((s, i) => ({ ...s, cpu: cpu[i] })) });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxSlope, insideRing]);

  // Fly the overview camera to the picked point once per request (from the best-spot list); the
  // probe and the request arrive together, the point's position a render later.
  const focused = useRef(0);
  useEffect(() => {
    const c = controls.current;
    if (focusNonce === focused.current || !c || !probePos || mode.current === "eye") return;
    focused.current = focusNonce;
    c.moveTo(probePos.x, probePos.y, probePos.z, true);
    c.dollyTo(Math.min(c.distance, 9000), true);
  }, [focusNonce, probePos]);

  const heat = useMemo(
    () => (survey && survey.regionId === region.id && surfaceView === "overview"
      ? { data: survey.data, cells: survey.cells, layer: heatLayer, maxSlope } : null),
    [survey, region.id, surfaceView, heatLayer, maxSlope],
  );
  const spotMarks = useMemo(() => {
    if (!terrain || !survey || survey.regionId !== region.id || surfaceView !== "overview") return [];
    return survey.spots.map((s) => ({ rank: s.rank, pos: new Vector3(s.x, groundY(s.x, -s.y), -s.y) }));
  }, [terrain, survey, region.id, surfaceView, groundY]);

  // Dev only: pick a point by lat/lon exactly as a click would (used by browser-side checks).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !terrain) return;
    (window as unknown as { __pick?: unknown }).__pick = (lat: number, lon: number) => {
      pickPoint(lat, lon);
    };
  }, [terrain, pickPoint]);

  // Pick requested from the UI (best-spot list): same probe as a click, then fly there.
  useEffect(() => {
    // Waits for this region's terrain (typed coordinates can switch region or descend first).
    if (!pickRequest || !terrain || terrain.id !== region.terrainId) return;
    if (pickRequest.regionId && pickRequest.regionId !== region.id) return;
    pickPoint(pickRequest.lat, pickRequest.lon, true);
    useMissionStore.setState({ pickRequest: null });  // handled; never replayed on a later mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickRequest?.nonce, terrain, region.id]);

  // Keep the camera above the ground (not while flying to a view; see lookAt).
  useFrame(() => {
    const c = controls.current;
    if (!c || !terrain || mode.current === "eye" || flying.current) return;
    const p = camera.position;
    const floor = groundY(p.x, p.z) + 5;
    if (p.y < floor) c.setPosition(p.x, floor, p.z, false);
  });

  // The IAU feature's official outline, draped on the terrain.
  const outline = useMemo(() => {
    if (!terrain) return null;
    const rM = (region.featureDiameterKm / 2) * 1000;
    const pts = Array.from({ length: 361 }, (_, k) => {
      const a = (k / 360) * 2 * Math.PI;
      const x = rM * Math.sin(a), z = -rM * Math.cos(a);
      return new Vector3(x, groundY(x, z) + 20, z);
    });
    return new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: "#82acd9", transparent: true, opacity: 0.8 }));
  }, [terrain, region, groundY]);

  // Dev check: GPU shadow pass at the area centre vs the CPU skyline engine over a window.
  const onProbe = useCallback((gpuProbe: SunProbe) => {
    if (process.env.NODE_ENV === "production" || !terrain) return;
    // Probe the area centre, or a grid point (x east, y north, metres) anywhere in the area.
    (window as unknown as { __checkShadows?: unknown }).__checkShadows = async (days = 30, stepH = 1, x = 0, y = 0) => {
      const [lat, lon] = fromGrid(terrain, x, y);
      const ground = heightAt(terrain, x, y);
      const skyline = computeSkyline(terrain, lat, lon, OBSERVER_HEIGHT_M);
      let n = 0, agree = 0, gpuLit = 0, cpuLit = 0, absDiff = 0;
      for (let t = eph.startMs; t < eph.startMs + days * 86_400_000; t += stepH * 3_600_000) {
        const st = eph.at(t);
        if (!st) continue;
        const sun = bodyLocal(frame, st.sun);
        const gpu = gpuProbe(x, y, OBSERVER_HEIGHT_M, new Vector3(sun.dir.x, -sun.dir.z, sun.dir.y), Math.asin(R_SUN_KM / sun.km));
        const cpu = samplePoint(eph, skyline, lat, lon, ground + OBSERVER_HEIGHT_M, t)!.sunVis;
        n++;
        agree += Number(gpu > 0.5 === cpu > 0.5);
        gpuLit += Number(gpu > 0);
        cpuLit += Number(cpu > 0);
        absDiff += Math.abs(gpu - cpu);
      }
      return { samples: n, agreePct: (100 * agree) / n, gpuLitPct: (100 * gpuLit) / n, cpuLitPct: (100 * cpuLit) / n, meanAbsDiff: absDiff / n };
    };
  }, [eph, frame, terrain]);

  return (
    <>
      <CameraControls ref={controls} smoothTime={0.32} />
      {terrain && (
        <Terrain terrain={terrain} centreGroundM={centreGround} sunEnu={g.sunEnu} sunRadiusRad={g.sunAng}
                 earthEnu={g.earthEnu} earthshine={g.earthshine} onProbe={onProbe} horizonFrom={horizonFrom}
                 onSurvey={onSurvey} heat={heat} />
      )}
      {outline && surfaceView === "overview" && <primitive object={outline} />}
      {probePos && probe && <PointBeacon position={probePos} label={formatLatLon(probe.lat, probe.lon, 3)} />}
      {spotMarks.map((m) => <SpotMark key={m.rank} position={m.pos} rank={m.rank} />)}
      <Sun ref={sunMesh} position={g.sunPos} radius={g.sunRadius} />
      <Earth ref={earthMesh} position={g.earthPos} radius={g.earthRadius} orientation={g.earthOrientation} sunDir={g.earthToSun} />
    </>
  );
}

/** A ranked best spot: its number on a small ground tag. */
function SpotMark({ position, rank }: { position: Vector3; rank: number }) {
  return (
    <group position={position}>
      <Html style={{ pointerEvents: "none" }} zIndexRange={[19, 0]} center>
        <div className="grid size-5 place-items-center border border-ink bg-bg/80 font-mono text-[11px] text-ink">{rank}</div>
      </Html>
    </group>
  );
}

/** The user's picked point: a hairline mast and ground ring at constant on-screen size, plus a tag. */
function PointBeacon({ position, label }: { position: Vector3; label: string }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    group.current?.scale.setScalar(Math.max(camera.position.distanceTo(position) / 600, 0.004));
  });
  return (
    <group position={position}>
      <group ref={group}>
        <mesh position={[0, 20, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 40, 6]} />
          <meshBasicMaterial color="#ecebe6" toneMapped={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
          <ringGeometry args={[9, 10.5, 48]} />
          <meshBasicMaterial color="#ecebe6" toneMapped={false} />
        </mesh>
      </group>
      <Html style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
        <div className="flex -translate-y-10 items-center gap-1.5 pl-2 whitespace-nowrap">
          <span className="h-px w-3 bg-ink" />
          <span className="font-mono text-[11px] text-ink">Your point · {label}</span>
        </div>
      </Html>
    </group>
  );
}
