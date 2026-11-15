"use client";

import { useFrame } from "@react-three/fiber";
import { forwardRef, useMemo } from "react";
import { AdditiveBlending, CanvasTexture, type Mesh, ShaderMaterial, SpriteMaterial, Vector3 } from "three";

// Photosphere: animated granulation (3-D value-noise fbm on the sphere) with limb darkening.
// Corona: additive radial-gradient sprite.
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
    for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; }
    return s;
  }
  void main() {
    #include <logdepthbuf_fragment>
    vec3 p = normalize(vPos);
    float cells = fbm(p * 55.0 + vec3(0.0, time * 0.04, time * 0.03));
    float g = smoothstep(0.3, 0.7, 0.65 * cells + 0.35 * fbm(p * 9.0 - time * 0.01));
    float spots = smoothstep(0.80, 0.86, fbm(p * 3.0 + 7.0));
    float mu = max(dot(normalize(vNormalW), normalize(cameraPosition - vPosW)), 0.0);
    float limb = 0.18 + 0.82 * pow(mu, 0.6);  // limb darkening
    vec3 col = mix(vec3(0.78, 0.22, 0.02), vec3(1.0, 0.66, 0.22), g);
    col = mix(vec3(0.50, 0.09, 0.01), col, limb) * limb * (1.0 - 0.75 * spots);
    gl_FragColor = vec4(col * 0.95, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function coronaTexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The sprite is 7 Sun radii wide, so the photosphere's edge sits at 2/7 of the gradient radius.
  grad.addColorStop(0, "rgba(255,220,160,0)");
  grad.addColorStop(0.27, "rgba(255,220,160,0)");
  grad.addColorStop(0.3, "rgba(255,170,90,0.28)");
  grad.addColorStop(0.5, "rgba(255,150,60,0.1)");
  grad.addColorStop(1, "rgba(255,140,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

const Sun = forwardRef<Mesh, { position: Vector3; radius: number }>(function Sun({ position, radius }, ref) {
  const material = useMemo(
    () => new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: { time: { value: 0 } } }),
    [],
  );
  const corona = useMemo(
    () => new SpriteMaterial({ map: coronaTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    [],
  );
  useFrame((_, dt) => {
    material.uniforms.time.value += dt;
  });
  return (
    <group position={position}>
      <mesh ref={ref} material={material} scale={radius}>
        <sphereGeometry args={[1, 64, 32]} />
      </mesh>
      <sprite material={corona} scale={radius * 7} />
    </group>
  );
});

export default Sun;
