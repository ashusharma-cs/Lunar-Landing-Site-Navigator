// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useTexture } from "@react-three/drei";
import { forwardRef, useMemo } from "react";
import {
  AdditiveBlending, type Mesh, NoColorSpace, type Quaternion, SRGBColorSpace, ShaderMaterial, Vector3,
} from "three";

// Blue Marble NG day side, Black Marble night lights, Blue Marble clouds (static composite),
// ocean glint, and single-scattering atmosphere (Rayleigh + Mie) evaluated along every view ray:
// the surface gets aerial perspective, a thin shell draws the limb where rays miss the planet.
// All atmosphere maths runs in kilometres around Earth's centre.

const vertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPosW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }
`;

const atmosphereLib = /* glsl */ `
  uniform vec3 uCenter;     // Earth centre, scene units
  uniform float uKmPerUnit; // kilometres per scene unit
  uniform vec3 sunDir;      // unit, from Earth toward the Sun

  const float R_PLANET = 6371.0;
  const float R_ATMOS = 6471.0;
  const vec3 BETA_R = vec3(5.802e-3, 13.558e-3, 33.1e-3); // Rayleigh, per km (sea level)
  const float BETA_M = 3.996e-3;                         // Mie scattering, per km
  const float H_R = 8.0;
  const float H_M = 1.2;
  const float G = 0.76;
  const float SUN_I = 9.0;

  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  // In-scattered light along [ro + rd*t] up to tMax; writes view transmittance.
  vec3 scatter(vec3 ro, vec3 rd, float tMax, out vec3 trans) {
    trans = vec3(1.0);
    vec2 a = raySphere(ro, rd, R_ATMOS);
    float t0 = max(a.x, 0.0);
    float t1 = min(a.y, tMax);
    if (t1 <= t0) return vec3(0.0);
    const int N = 14;
    const int M = 5;
    float ds = (t1 - t0) / float(N);
    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < N; i++) {
      vec3 p = ro + rd * (t0 + ds * (float(i) + 0.5));
      float h = length(p) - R_PLANET;
      float dR = exp(-h / H_R) * ds;
      float dM = exp(-h / H_M) * ds;
      odR += dR;
      odM += dM;
      if (raySphere(p, sunDir, R_PLANET).x > 0.0) continue;  // in Earth's shadow
      float dl = raySphere(p, sunDir, R_ATMOS).y / float(M);
      float lR = 0.0, lM = 0.0;
      for (int j = 0; j < M; j++) {
        float hl = length(p + sunDir * dl * (float(j) + 0.5)) - R_PLANET;
        lR += exp(-hl / H_R) * dl;
        lM += exp(-hl / H_M) * dl;
      }
      vec3 att = exp(-(BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM)));
      sumR += dR * att;
      sumM += dM * att;
    }
    float mu = dot(rd, sunDir);
    float pR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
    float pM = 3.0 / (8.0 * 3.14159265) * ((1.0 - G * G) * (1.0 + mu * mu)) /
               ((2.0 + G * G) * pow(1.0 + G * G - 2.0 * G * mu, 1.5));
    trans = exp(-(BETA_R * odR + BETA_M * 1.1 * odM));
    return SUN_I * (sumR * BETA_R * pR + sumM * BETA_M * pM);
  }
`;

const surface = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform sampler2D cloudMap;
  ${atmosphereLib}
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vPosW);
    float d = dot(n, sunDir);
    float cloud = texture2D(cloudMap, vUv).r;
    vec3 ground = mix(texture2D(dayMap, vUv).rgb, vec3(0.92), cloud * 0.9);
    float water = texture2D(specMap, vUv).r * (1.0 - cloud);
    vec3 h = normalize(sunDir + v);
    float glint = water * pow(max(dot(n, h), 0.0), 600.0) * 0.7;
    vec3 col = ground * max(d, 0.0) * 1.35 + vec3(1.0, 0.95, 0.85) * glint * step(0.0, d);
    vec3 lights = texture2D(nightMap, vUv).rgb;
    col += lights * lights * (1.0 - cloud) * 1.3 * (1.0 - smoothstep(-0.15, 0.05, d));

    // Aerial perspective: camera -> surface point through the atmosphere.
    vec3 ro = (cameraPosition - uCenter) * uKmPerUnit;
    // Mesh facets sit up to ~2 km inside the true sphere; project onto it, or the exponential
    // haze density reads them as below sea level and the tessellation shows through.
    vec3 p = normalize((vPosW - uCenter) * uKmPerUnit) * R_PLANET;
    vec3 rd = normalize(p - ro);
    vec3 trans;
    vec3 inscatter = scatter(ro, rd, length(p - ro), trans);
    gl_FragColor = vec4(col * trans + inscatter, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const limb = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  ${atmosphereLib}
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = (cameraPosition - uCenter) * uKmPerUnit;
    vec3 rd = normalize((vPosW - uCenter) * uKmPerUnit - ro);
    if (raySphere(ro, rd, R_PLANET).x > 0.0) discard;  // the surface shader owns the disc
    vec3 trans;
    vec3 c = scatter(ro, rd, 1e9, trans);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Props = { position: Vector3; radius: number; orientation: Quaternion; sunDir: Vector3 };

const Earth = forwardRef<Mesh, Props>(function Earth({ position, radius, orientation, sunDir }, ref) {
  const [dayMap, nightMap, specMap, cloudMap] = useTexture([
    "/textures/earth_day_4k.jpg",
    "/textures/earth_night_2k.jpg",
    "/textures/earth_specular_2k.jpg",
    "/textures/earth_clouds_2k.jpg",
  ]);
  for (const t of [dayMap, nightMap]) t.colorSpace = SRGBColorSpace;
  for (const t of [specMap, cloudMap]) t.colorSpace = NoColorSpace;
  for (const t of [dayMap, nightMap, cloudMap]) t.anisotropy = 8;

  const [surfaceMat, limbMat] = useMemo(() => {
    // Shared uniform objects so both passes always see the same geometry.
    const shared = {
      sunDir: { value: new Vector3(1, 0, 0) },
      uCenter: { value: new Vector3() },
      uKmPerUnit: { value: 1 },
    };
    return [
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: surface,
        uniforms: { ...shared, dayMap: { value: dayMap }, nightMap: { value: nightMap }, specMap: { value: specMap }, cloudMap: { value: cloudMap } },
      }),
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: limb,
        uniforms: shared,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    ];
  }, [dayMap, nightMap, specMap, cloudMap]);
  surfaceMat.uniforms.sunDir.value.copy(sunDir);
  surfaceMat.uniforms.uCenter.value.copy(position);
  surfaceMat.uniforms.uKmPerUnit.value = 6371 / radius;

  return (
    <group position={position} scale={radius}>
      <mesh ref={ref} quaternion={orientation} material={surfaceMat}>
        <sphereGeometry args={[1, 128, 64]} />
      </mesh>
      {/* Shell at the top of the atmosphere (100 km). */}
      <mesh material={limbMat} scale={6471 / 6371}>
        <sphereGeometry args={[1, 96, 48]} />
      </mesh>
    </group>
  );
});

export default Earth;
