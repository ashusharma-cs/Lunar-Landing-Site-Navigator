"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo } from "react";
import {
  BufferAttribute, BufferGeometry, Camera, Color, DataTexture, DoubleSide, FloatType, FrontSide, LinearFilter, type Mesh,
  Mesh as ThreeMesh, NearestFilter, PlaneGeometry, RGBAFormat, RedFormat, Scene, ShaderMaterial, Vector3, WebGLRenderTarget,
} from "three";
import { HEAT_RAMPS as RAMPS, type HeatLayer } from "@/lib/heat";
import { horizonMesh } from "@/lib/skyline";
import type { AreaTerrain } from "@/lib/terrain";

// Local frame: three x = east, y = up, z = south; grids are (x east, y north) metres, so grid y = -z.
// Heights are metres above the 1737.4 km sphere; the scene's y is height above the site ground
// minus the curvature drop r^2 / 2R, so the horizon falls away exactly as on the real Moon.
//
// Shadows: a GPU pass ray-marches from every texel toward the Sun across the near (12 km) and far
// (400 km) grids, takes the highest terrain angle (with the same d^2/2R correction as the skyline
// engine) and converts the Sun's clearance into the visible fraction of its disc. The algorithm is
// validated against pipeline/skylines.py in pipeline/check_terrain.py.

const R_M = 1_737_400.0;
const NEAR_VIS = 1024;
const FAR_VIS = 512;

const heightLib = /* glsl */ `
  uniform sampler2D nearH;
  uniform sampler2D farH;
  uniform float nearHalf;
  uniform float farHalf;
  uniform float nearN;
  uniform float farN;
  const float R = ${R_M.toFixed(1)};

  vec2 gridF(vec2 xy, float hw, float n) { return (xy + hw) / (2.0 * hw) * (n - 1.0); }
  bool inGrid(vec2 f, float n) { return f.x >= 0.0 && f.y >= 0.0 && f.x < n - 1.0 && f.y < n - 1.0; }

  float bilinear(sampler2D t, vec2 f, float n) {
    vec2 i = floor(f);
    vec2 w = f - i;
    vec2 uv = (i + 0.5) / n;
    float p = 1.0 / n;
    float a = texture2D(t, uv).r;
    float b = texture2D(t, uv + vec2(p, 0.0)).r;
    float c = texture2D(t, uv + vec2(0.0, p)).r;
    float d = texture2D(t, uv + vec2(p, p)).r;
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
  }

  // Finest grid covering xy; ok = false outside both.
  float heightAt(vec2 xy, out bool ok) {
    float h = 0.0;
    vec2 f = gridF(xy, nearHalf, nearN);
    vec2 g = gridF(xy, farHalf, farN);
    ok = true;
    if (inGrid(f, nearN)) h = bilinear(nearH, f, nearN);
    else if (inGrid(g, farN)) h = bilinear(farH, g, farN);
    else ok = false;
    return h;
  }

  // Single nearest fetch for long march steps (cheaper; step length >> texel there).
  float heightFast(vec2 xy, out bool ok) {
    float h = 0.0;
    vec2 f = gridF(xy, nearHalf, nearN);
    vec2 g = gridF(xy, farHalf, farN);
    ok = true;
    if (inGrid(f, nearN)) h = texture2D(nearH, (floor(f) + 0.5) / nearN).r;
    else if (inGrid(g, farN)) h = texture2D(farH, (floor(g) + 0.5) / farN).r;
    else ok = false;
    return h;
  }
`;

const passVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const marchLib = /* glsl */ `
  ${heightLib}
  uniform float stepMin;    // first march step, metres

  float discVisible(float x) {
    if (x >= 1.0) return 1.0;
    if (x <= -1.0) return 0.0;
    return 1.0 - (acos(x) - x * sqrt(1.0 - x * x)) / 3.14159265;
  }

  // Visible fraction of a disc of angular radius r (radians) in direction enu (site ENU), seen from
  // grid point xy at obsH metres above the ground: march toward it, keep the highest terrain angle.
  float discVis(vec2 xy, float obsH, vec3 enu, float r) {
    bool ok;
    float hP = heightAt(xy, ok) + obsH;
    // Local vertical at P tilts by (x, y) / R relative to the site's.
    float el = asin(clamp(dot(enu, normalize(vec3(xy / R, 1.0))), -1.0, 1.0));
    if (el < -0.2) return 0.0;
    vec2 dir = normalize(enu.xy);
    float best = -1.5;
    float d = stepMin;
    for (int i = 0; i < 260; i++) {
      if (d > 200000.0) break;
      bool inside;
      float h = d < 1500.0 ? heightAt(xy + dir * d, inside) : heightFast(xy + dir * d, inside);
      if (!inside) break;
      best = max(best, atan((h - hP - d * d / (2.0 * R)) / d));
      if (best > el + r) break;  // fully hidden already
      d *= 1.045;
    }
    return discVisible((el - best) / r);
  }
`;

const passFragment = /* glsl */ `
  ${marchLib}
  uniform float gridHalf;   // which grid this target covers
  uniform vec3 sunEnu;      // unit vector toward the Sun, site ENU
  uniform float sunR;       // Sun angular radius, radians
  uniform float obsH;       // height of the lit point above ground (m)
  uniform vec3 probeXY;     // z = 1: evaluate at (x, y) instead of this texel (validation probe)
  varying vec2 vUv;

  void main() {
    vec2 xy = probeXY.z > 0.5 ? probeXY.xy : (vUv * 2.0 - 1.0) * gridHalf;
    gl_FragColor = vec4(discVis(xy, obsH, sunEnu, sunR), 0.0, 0.0, 1.0);
  }
`;

// Survey: one time step for every cell of the area, added to the running totals (ping-pong).
// Channels: Sun lit (any of the disc), Earth in view (centre clears), both at once, Sun disc fraction.
const surveyFragment = /* glsl */ `
  ${marchLib}
  uniform sampler2D prev;
  uniform float gridHalf;
  uniform float cells;
  uniform vec3 sunEnu;
  uniform float sunR;
  uniform vec3 earthEnu;
  uniform float earthR;
  uniform float obsH;
  varying vec2 vUv;

  void main() {
    // Cell centres: cell i covers [i, i+1] / cells of the area.
    vec2 xy = ((floor(vUv * cells) + 0.5) / cells * 2.0 - 1.0) * gridHalf;
    float sv = discVis(xy, obsH, sunEnu, sunR);
    float ev = discVis(xy, obsH, earthEnu, earthR);
    float lit = sv > 0.0 ? 1.0 : 0.0;
    float seen = ev >= 0.5 ? 1.0 : 0.0;
    gl_FragColor = texture2D(prev, vUv) + vec4(lit, seen, lit * seen, sv);
  }
`;

const terrainVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${heightLib}
  uniform float hSite;
  varying vec2 vXY;
  varying vec3 vWorld;
  void main() {
    vec2 xy = vec2(position.x, -position.z);
    bool ok;
    float h = heightAt(xy, ok);
    vec3 p = vec3(position.x, h - hSite - dot(xy, xy) / (2.0 * R), position.z);
    vXY = xy;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const terrainFragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  ${heightLib}
  uniform float isFar;          // 1: planar far mesh, which leaves the near area to the near mesh
  uniform sampler2D nearVis;    // Sun visibility per texel of each grid (GPU shadow pass)
  uniform sampler2D farVis;
  uniform vec3 sunEnu;
  uniform vec3 earthEnu;
  uniform float earthshine;
  uniform sampler2D heat;       // survey: Sun, Earth, both (fractions of the window), slope (deg)
  uniform float heatLayer;      // 0 off, 1 Sun, 2 Earth, 3 both
  uniform float maxSlope;       // deg; steeper cells are hatched
  uniform vec3 heatLo;          // ramp ends (linear RGB): 0 % and 100 %
  uniform vec3 heatHi;
  varying vec2 vXY;
  varying vec3 vWorld;

  void main() {
    #include <logdepthbuf_fragment>
    vec2 xy = vXY;
    bool inNear = inGrid(gridF(xy, nearHalf, nearN), nearN);
    if (isFar > 0.5 && max(abs(xy.x), abs(xy.y)) < nearHalf - 30.0) discard;  // near mesh owns it
    if (!inGrid(gridF(xy, farHalf, farN), farN)) discard;
    float texel = inNear ? 2.0 * nearHalf / nearN : 2.0 * farHalf / farN;

    bool ok;
    float hx1 = heightAt(xy + vec2(texel, 0.0), ok), hx0 = heightAt(xy - vec2(texel, 0.0), ok);
    float hy1 = heightAt(xy + vec2(0.0, texel), ok), hy0 = heightAt(xy - vec2(0.0, texel), ok);
    vec3 n = normalize(vec3(-(hx1 - hx0) / (2.0 * texel), -(hy1 - hy0) / (2.0 * texel), 1.0));

    // Relief is LOLA only: no generated micro-detail, so the ground never shows features the data
    // doesn't contain. Curvature: the local vertical at xy tilts by xy / R relative to the site's.
    n = normalize(n + vec3(xy / R, 0.0) * n.z);

    float albedo = 0.6;  // uniform; LOLA carries no albedo
    vec3 camEnu = vec3(cameraPosition.x, -cameraPosition.z, cameraPosition.y);
    vec3 pEnu = vec3(vWorld.x, -vWorld.z, vWorld.y);
    vec3 v = normalize(camEnu - pEnu);
    float mu0 = max(dot(n, sunEnu), 0.0);
    float mu = max(dot(n, v), 1e-3);
    float lit = mix(mu0, 2.0 * mu0 / (mu0 + mu), 0.55);
    float sv = inNear ? texture2D(nearVis, (xy + nearHalf) / (2.0 * nearHalf)).r
                      : texture2D(farVis, (xy + farHalf) / (2.0 * farHalf)).r;

    vec3 sun = vec3(1.0, 0.97, 0.92) * lit * sv * 2.2;
    vec3 earthLight = vec3(0.75, 0.85, 1.0) * earthshine * max(dot(n, earthEnu), 0.0);
    vec3 col = albedo * (sun + earthLight + vec3(0.012));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    if (heatLayer > 0.5 && inNear) {
      // Heatmap: exact ramp colours (after tone mapping), relief from a fixed overhead light.
      vec4 hv = texture2D(heat, (xy + nearHalf) / (2.0 * nearHalf));
      float v = heatLayer < 1.5 ? hv.r : heatLayer < 2.5 ? hv.g : hv.b;
      float relief = 0.4 + 0.6 * clamp(dot(n, normalize(vec3(-0.35, 0.45, 1.0))), 0.0, 1.0);
      vec3 c = mix(heatLo, heatHi, v);
      if (hv.a > maxSlope) {
        float stripe = step(0.6, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
        c = mix(vec3(0.012), vec3(0.08), stripe);
      }
      gl_FragColor = vec4(c * relief, 1.0);
    }
    #include <colorspace_fragment>
  }
`;

function heightTexture(g: AreaTerrain["near"]) {
  const t = new DataTexture(g.heights, g.n, g.n, RedFormat, FloatType);
  t.minFilter = t.magFilter = NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Sun visibility from the GPU pass at grid point (x, y), obsH metres up, for a given Sun. */
export type SunProbe = (x: number, y: number, obsH: number, sunEnu: Vector3, sunRadiusRad: number) => number;

type Props = {
  terrain: AreaTerrain;
  /** Ground height at the area centre (m); the scene's y = 0. */
  centreGroundM: number;
  sunEnu: Vector3;
  sunRadiusRad: number;
  earthEnu: Vector3;
  earthshine: number;
  /** Called with a probe returning Sun visibility at a grid point, obsH metres up, for a given Sun. */
  onProbe?: (probe: SunProbe) => void;
  /** At eye level: draw the terrain as a mesh on the skyline's own sample points around this point. */
  horizonFrom?: { lat: number; lon: number } | null;
  /** Called with the survey runner (Sun and Earth for every cell of the area over many time steps). */
  onSurvey?: (run: SurveyRun) => void;
  /** Heatmap overlay from a survey (cells x cells x 4: Sun, Earth, both, slope deg). */
  heat?: { data: Float32Array; cells: number; layer: HeatLayer; maxSlope: number } | null;
};

export type SurveyStep = { sunEnu: Vector3; sunR: number; earthEnu: Vector3; earthR: number };
/** Runs the steps a few per frame; resolves to cells x cells x 4 fractions (Sun, Earth, both, mean Sun disc). */
export type SurveyRun = (steps: SurveyStep[], cells: number, obsH: number, onProgress: (f: number) => void,
  isCancelled: () => boolean) => Promise<Float32Array | null>;


function linear(hex: string) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return new Vector3(...v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)));
}

const Terrain = forwardRef<Mesh, Props>(function Terrain({ terrain, centreGroundM, sunEnu, sunRadiusRad, earthEnu, earthshine, onProbe, horizonFrom, onSurvey, heat }, ref) {
  const gl = useThree((s) => s.gl);

  const gpu = useMemo(() => {
    const nearH = heightTexture(terrain.near);
    const farH = heightTexture(terrain.far);
    const heightUniforms = {
      nearH: { value: nearH },
      farH: { value: farH },
      nearHalf: { value: terrain.near.halfM },
      farHalf: { value: terrain.far.halfM },
      nearN: { value: terrain.near.n },
      farN: { value: terrain.far.n },
    };
    const sun = { value: new Vector3(0, 0, 1) };
    const sunR = { value: 0.00466 };

    const makeTarget = (size: number) =>
      new WebGLRenderTarget(size, size, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    const nearVis = makeTarget(NEAR_VIS);
    const farVis = makeTarget(FAR_VIS);
    const passMat = (half: number, stepMin: number) =>
      new ShaderMaterial({
        vertexShader: passVertex,
        fragmentShader: passFragment,
        uniforms: { ...heightUniforms, gridHalf: { value: half }, stepMin: { value: stepMin }, sunEnu: sun, sunR, obsH: { value: 0.3 },
          probeXY: { value: new Vector3(0, 0, 0) } },
        depthTest: false,
        depthWrite: false,
      });
    const quad = new ThreeMesh(new PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const passScene = new Scene();
    passScene.add(quad);
    const passCamera = new Camera();
    const nearPass = passMat(terrain.near.halfM, (2 * terrain.near.halfM) / terrain.near.n);
    const farPass = passMat(terrain.far.halfM, (2 * terrain.far.halfM) / terrain.far.n);
    // 1x1 probe target for validation at the landing point (uv 0.5, 0.5 = grid centre).
    const probeTarget = new WebGLRenderTarget(1, 1, { type: FloatType, depthBuffer: false });

    const shared = { ...heightUniforms, sunEnu: sun, hSite: { value: centreGroundM } };
    const earth = { earthEnu: { value: new Vector3(0, 0, 1) }, earthshine: { value: 0 } };
    const heatU = {
      heat: { value: null as DataTexture | null }, heatLayer: { value: 0 }, maxSlope: { value: 90 },
      heatLo: { value: new Vector3() }, heatHi: { value: new Vector3() },
    };
    const surfaceMat = (isFar: number, doubleSided = false) =>
      new ShaderMaterial({
        vertexShader: terrainVertex,
        fragmentShader: terrainFragment,
        uniforms: { ...shared, ...earth, ...heatU, isFar: { value: isFar }, nearVis: { value: nearVis.texture }, farVis: { value: farVis.texture } },
        side: doubleSided ? DoubleSide : FrontSide,
      });
    const near = surfaceMat(0);
    const far = surfaceMat(1);
    const horizon = surfaceMat(0, true);

    // Overview meshes: 1024 x 1024 vertices each (the eye-level view uses the horizon mesh instead).
    const nearGeo = new PlaneGeometry(2 * terrain.near.halfM, 2 * terrain.near.halfM, 1023, 1023).rotateX(-Math.PI / 2);
    const farGeo = new PlaneGeometry(2 * terrain.far.halfM, 2 * terrain.far.halfM, 1023, 1023).rotateX(-Math.PI / 2);

    const render = () => {
      const prev = gl.getRenderTarget();
      quad.material = nearPass;
      gl.setRenderTarget(nearVis);
      gl.render(passScene, passCamera);
      quad.material = farPass;
      gl.setRenderTarget(farVis);
      gl.render(passScene, passCamera);
      gl.setRenderTarget(prev);
    };

    const probe: SunProbe = (x, y, obsH, sunEnu, sunRadiusRad) => {
      const m = passMat(terrain.near.halfM, (2 * terrain.near.halfM) / terrain.near.n);
      m.uniforms.obsH.value = obsH;
      m.uniforms.probeXY.value.set(x, y, 1);
      m.uniforms.sunEnu = { value: sunEnu.clone() };
      m.uniforms.sunR = { value: sunRadiusRad };
      quad.material = m;
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(probeTarget);
      gl.render(passScene, passCamera);
      gl.setRenderTarget(prev);
      const out = new Float32Array(4);
      gl.readRenderTargetPixels(probeTarget, 0, 0, 1, 1, out);
      m.dispose();
      return out[0];
    };

    const survey: SurveyRun = async (steps, cells, obsH, onProgress, isCancelled) => {
      const opts = { type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false };
      const targets = [new WebGLRenderTarget(cells, cells, opts), new WebGLRenderTarget(cells, cells, opts)];
      const mat = new ShaderMaterial({
        vertexShader: passVertex,
        fragmentShader: surveyFragment,
        uniforms: {
          ...heightUniforms, stepMin: { value: (2 * terrain.near.halfM) / terrain.near.n }, prev: { value: null },
          gridHalf: { value: terrain.near.halfM }, cells: { value: cells }, obsH: { value: obsH },
          sunEnu: { value: new Vector3() }, sunR: { value: 0 }, earthEnu: { value: new Vector3() }, earthR: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      });
      const prevTarget = gl.getRenderTarget();
      const prevColor = gl.getClearColor(new Color());
      const prevAlpha = gl.getClearAlpha();
      gl.setClearColor(0x000000, 0);
      for (const t of targets) {
        gl.setRenderTarget(t);
        gl.clear();
      }
      gl.setClearColor(prevColor, prevAlpha);
      gl.setRenderTarget(prevTarget);
      let k = 0;
      try {
        while (k < steps.length) {
          if (isCancelled()) return null;
          const t0 = performance.now();
          const saved = gl.getRenderTarget();
          // A few steps per frame keeps the page responsive; budget ~12 ms of GPU submits.
          while (k < steps.length && performance.now() - t0 < 12) {
            const st = steps[k];
            mat.uniforms.sunEnu.value.copy(st.sunEnu);
            mat.uniforms.sunR.value = st.sunR;
            mat.uniforms.earthEnu.value.copy(st.earthEnu);
            mat.uniforms.earthR.value = st.earthR;
            mat.uniforms.prev.value = targets[k % 2].texture;
            quad.material = mat;
            gl.setRenderTarget(targets[(k + 1) % 2]);
            gl.render(passScene, passCamera);
            k++;
          }
          gl.setRenderTarget(saved);
          onProgress(k / steps.length);
          await new Promise((r) => requestAnimationFrame(r));
        }
        const out = new Float32Array(cells * cells * 4);
        gl.readRenderTargetPixels(targets[k % 2], 0, 0, cells, cells, out);
        for (let i = 0; i < out.length; i++) out[i] /= steps.length;
        return out;
      } finally {
        mat.dispose();
        for (const t of targets) t.dispose();
      }
    };

    return { sun, sunR, earth, heatU, near, far, horizon, nearGeo, farGeo, render, probe, survey, dispose: () => {
      for (const o of [nearH, farH, nearVis, farVis, probeTarget, nearPass, farPass, near, far, horizon, nearGeo, farGeo, quad.geometry]) o.dispose();
    } };
  }, [terrain, gl, centreGroundM]);

  useEffect(() => () => gpu.dispose(), [gpu]);

  const horizonGeo = useMemo(() => {
    if (!horizonFrom) return null;
    const { positions, index } = horizonMesh(terrain, horizonFrom.lat, horizonFrom.lon);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(positions, 3));
    g.setIndex(new BufferAttribute(index, 1));
    return g;
  }, [terrain, horizonFrom]);
  useEffect(() => () => horizonGeo?.dispose(), [horizonGeo]);
  useEffect(() => onProbe?.(gpu.probe), [gpu, onProbe]);
  useEffect(() => onSurvey?.(gpu.survey), [gpu, onSurvey]);

  // Heat overlay: survey values plus slope, one texel per cell.
  const heatTex = useMemo(() => {
    if (!heat) return null;
    const t = new DataTexture(heat.data, heat.cells, heat.cells, RGBAFormat, FloatType);
    t.minFilter = t.magFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, [heat?.data, heat?.cells]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => heatTex?.dispose(), [heatTex]);
  useEffect(() => {
    const u = gpu.heatU;
    u.heat.value = heatTex;
    u.heatLayer.value = heatTex && heat && heat.layer !== "off" ? { sun: 1, earth: 2, both: 3 }[heat.layer] : 0;
    u.maxSlope.value = heat?.maxSlope ?? 90;
    if (heat && heat.layer !== "off") {
      u.heatLo.value.copy(linear(RAMPS[heat.layer][0]));
      u.heatHi.value.copy(linear(RAMPS[heat.layer][1]));
    }
  }, [gpu, heatTex, heat]);

  // Re-trace shadows whenever the Sun has moved (every frame while time plays).
  const last = useMemo(() => new Vector3(), []);
  useFrame(() => {
    gpu.sunR.value = sunRadiusRad;
    gpu.earth.earthEnu.value.copy(earthEnu);
    gpu.earth.earthshine.value = earthshine;
    if (last.distanceToSquared(sunEnu) > 1e-10) {
      last.copy(sunEnu);
      gpu.sun.value.copy(sunEnu);
      gpu.render();
    }
  }, -1);

  return horizonGeo ? (
    <mesh ref={ref} geometry={horizonGeo} material={gpu.horizon} frustumCulled={false} />
  ) : (
    <group>
      <mesh ref={ref} geometry={gpu.nearGeo} material={gpu.near} frustumCulled={false} />
      <mesh geometry={gpu.farGeo} material={gpu.far} frustumCulled={false} />
    </group>
  );
});

export default Terrain;
