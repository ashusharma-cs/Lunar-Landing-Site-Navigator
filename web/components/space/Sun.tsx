// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useFrame } from "@react-three/fiber";
import { forwardRef, useMemo } from "react";
import { AdditiveBlending, CanvasTexture, type Mesh, ShaderMaterial, SpriteMaterial, Vector3 } from "three";

// The Sun as it looks in visible light through a filter. Drawn by the app (no NASA map of the Sun's
// surface is used), but built from the physics of a real photo:
// - limb darkening, per colour channel: intensity falls toward the edge as I(mu) = 1 - u (1 - mu)
//   - v (1 - mu)^2, faster in blue than red, so the edge turns orange-red (coefficients approximate the
//   measured solar values at ~450, 550 and 650 nm);
// - fine, low-contrast granulation (convection cells ~1,000 km across: invisible at full-disc scale
//   except as a faint grain);
// - faculae: faint bright patches visible near the limb;
// - a few small sunspots, only in the active-latitude bands (about 5-35 deg either side of the equator).
// Position and size are exact (JPL Horizons); the surface pattern is illustrative.
const vertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vPos = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float time;
  varying vec3 vPos;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
    return s;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vPos);
    float mu = clamp(dot(normalize(vNormalW), normalize(cameraPosition - vPosW)), 0.0, 1.0);
    float x = 1.0 - mu;

    // Quadratic limb darkening per channel (red, green, blue): blue fades most toward the edge.
    vec3 u = vec3(0.70, 0.84, 0.93);
    vec3 v = vec3(0.10, 0.04, -0.02);
    vec3 limb = max(1.0 - u * x - v * x * x, 0.0);

    // Granulation: fine, faint, slowly evolving.
    float gran = fbm(p * 180.0 + vec3(0.0, time * 0.03, time * 0.02)) - 0.5;
    float shade = 1.0 + 0.07 * gran;

    // Faculae: faint bright network, only noticeable near the limb.
    float fac = smoothstep(0.62, 0.78, fbm(p * 22.0 + 3.0));
    shade += fac * 0.22 * smoothstep(0.25, 0.85, x);

    // Sunspots: small, rare, only in the active-latitude bands (|lat| ~ 5-35 deg). Umbra + penumbra.
    float lat = abs(p.y);
    float band = smoothstep(0.08, 0.15, lat) * (1.0 - smoothstep(0.50, 0.60, lat));
    // fbm here averages ~0.47 (spread ~0.1), so only rare peaks above ~0.7 become spots.
    float s = fbm(p * 20.0 + 11.0) * band;
    float penumbra = smoothstep(0.715, 0.735, s);
    float umbra = smoothstep(0.75, 0.762, s);
    shade *= 1.0 - 0.5 * penumbra - 0.42 * umbra;

    // Photosphere colour (~5,800 K, slightly warm) in HDR: tone mapping turns the centre near-white.
    vec3 base = vec3(1.0, 0.76, 0.42) * 1.3;
    gl_FragColor = vec4(base * limb * shade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Soft glow around the disc (scattered light, as in a photo): bright at the edge, fading fast. */
function glowTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The sprite is 6 Sun radii wide, so the disc's edge sits at 1/6 of the gradient radius.
  grad.addColorStop(0, "rgba(255,240,215,0)");
  grad.addColorStop(0.16, "rgba(255,240,215,0)");
  grad.addColorStop(0.17, "rgba(255,236,205,0.30)");
  grad.addColorStop(0.24, "rgba(255,226,185,0.12)");
  grad.addColorStop(0.4, "rgba(255,214,165,0.04)");
  grad.addColorStop(1, "rgba(255,205,150,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

const Sun = forwardRef<Mesh, { position: Vector3; radius: number }>(function Sun({ position, radius }, ref) {
  const material = useMemo(
    () => new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { time: { value: 0 } } }),
    [],
  );
  const glow = useMemo(
    () => new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    [],
  );
  useFrame((_, dt) => {
    material.uniforms.time.value += dt;
  });
  return (
    <group position={position}>
      <mesh ref={ref} material={material} scale={radius}>
        <sphereGeometry args={[1, 96, 48]} />
      </mesh>
      <sprite material={glow} scale={radius * 6} />
    </group>
  );
});

export default Sun;
