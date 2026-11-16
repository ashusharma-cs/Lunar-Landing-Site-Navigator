// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { type Mesh, NoColorSpace, SRGBColorSpace, ShaderMaterial, type Texture, TextureLoader, Vector3 } from "three";

const CAP_LAT = -75; // must match pipeline/build_textures.py CAP_LAT
const INNER_LAT = -84; // must match pipeline/build_textures.py INNER_LAT
// Camera distance (Moon radii from centre) below which the 8k global maps are fetched.
const HI_RES_DISTANCE = 1.8;

// LROC colour (NASA SVS CGI Moon Kit) + tangent-space normal map from LOLA, lit by the real Sun.
// Reflectance: blend of Lommel-Seeliger (lunar regolith, keeps the full Moon flat) and Lambert.
// Every custom shader carries three's logdepthbuf chunks: the renderer uses a logarithmic depth
// buffer, and a shader without them writes depth on a different scale, letting markers, labels
// and glows bleed through bodies.
const vertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPos;
  varying vec2 vUv;
  void main() {
    vPos = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

// Relief cascade, coarse to fine: global map (4k, or 8k from LOLA 64 ppd when close), south cap
// 75-90 S (LOLA 240 m), inner cap 84-90 S (LOLA 40 m, ~89 m/pixel) around every Artemis region.
// Caps are polar stereographic (no pole pinch) with normals in the grid frame; at longitude L,
// grid x/y map to east = x cos L - y sin L, north = x sin L + y cos L.
const fragment = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D map;
  uniform sampler2D normalMap;
  uniform sampler2D capColor;
  uniform sampler2D capNormal;
  uniform sampler2D innerNormal;
  uniform float capTan;    // tan((90 + capLat) / 2)
  uniform float innerTan;  // tan((90 + innerLat) / 2)
  uniform vec3 sunDir;
  uniform vec3 earthDir;
  uniform float earthshine;
  varying vec3 vPos;
  varying vec2 vUv;

  vec3 gridToEnu(vec3 g, float lon) {
    return vec3(g.x * cos(lon) - g.y * sin(lon), g.x * sin(lon) + g.y * cos(lon), g.z);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(vPos);
    vec3 east = cross(vec3(0.0, 1.0, 0.0), up);
    east = length(east) < 1e-5 ? vec3(1.0, 0.0, 0.0) : normalize(east);
    vec3 north = cross(up, east);

    float lat = asin(clamp(up.y, -1.0, 1.0));
    float lon = atan(-up.z, up.x);  // Moon ME longitude (scene = x_me, z_me, -y_me)

    vec3 tn = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    tn = normalize(mix(tn, vec3(0.0, 0.0, 1.0), smoothstep(radians(78.0), radians(84.0), lat)));  // north pole: no pinch
    vec3 albedo = texture2D(map, vUv).rgb;

    // Caps are sampled unconditionally: lookups inside a branch break mip derivatives at the edges.
    float t = tan((1.5707963 + lat) * 0.5);
    vec2 dir = vec2(sin(lon), cos(lon));
    vec2 cuv = clamp(dir * (t / capTan) * 0.5 + 0.5, 0.0, 1.0);
    vec2 iuv = clamp(dir * (t / innerTan) * 0.5 + 0.5, 0.0, 1.0);
    float cap = smoothstep(radians(-75.0), radians(-77.0), lat);
    float inner = smoothstep(radians(-84.0), radians(-84.6), lat);
    tn = normalize(mix(tn, gridToEnu(texture2D(capNormal, cuv).xyz * 2.0 - 1.0, lon), cap));
    tn = normalize(mix(tn, gridToEnu(texture2D(innerNormal, iuv).xyz * 2.0 - 1.0, lon), inner));
    albedo = mix(albedo, texture2D(capColor, cuv).rgb, cap);
    vec3 n = normalize(east * tn.x + north * tn.y + up * tn.z);

    vec3 v = normalize(cameraPosition - vPos);
    float mu0 = max(dot(n, sunDir), 0.0);
    float mu = max(dot(n, v), 1e-3);
    float lit = mix(mu0, 2.0 * mu0 / (mu0 + mu), 0.55);
    lit *= smoothstep(-0.015, 0.03, dot(up, sunDir));  // no normal-map light leak past the terminator

    // + a faint non-physical display fill so unlit terrain is visible but unmistakably dark.
    vec3 col = albedo * (lit * 1.7 + earthshine * max(dot(n, earthDir), 0.0) + 0.025);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

type Props = { sunDir: Vector3; earthDir: Vector3; earthshine: number };

const Moon = forwardRef<Mesh, Props>(function Moon({ sunDir, earthDir, earthshine }, ref) {
  const [map, normalMap, capColor, capNormal, innerNormal] = useTexture([
    "/textures/moon_color_4k.jpg",
    "/textures/moon_normal_4k.jpg",
    "/textures/moon_south_color.jpg",
    "/textures/moon_south_normal.jpg",
    "/textures/moon_south_inner_normal.jpg",
  ]);
  for (const t of [map, capColor]) t.colorSpace = SRGBColorSpace;
  for (const t of [normalMap, capNormal, innerNormal]) t.colorSpace = NoColorSpace;
  for (const t of [map, normalMap, capColor, capNormal, innerNormal]) t.anisotropy = 16;

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          map: { value: map },
          normalMap: { value: normalMap },
          capColor: { value: capColor },
          capNormal: { value: capNormal },
          innerNormal: { value: innerNormal },
          capTan: { value: Math.tan(((90 + CAP_LAT) * Math.PI) / 360) },
          innerTan: { value: Math.tan(((90 + INNER_LAT) * Math.PI) / 360) },
          sunDir: { value: new Vector3(1, 0, 0) },
          earthDir: { value: new Vector3(1, 0, 0) },
          earthshine: { value: 0 },
        },
      }),
    [map, normalMap, capColor, capNormal, innerNormal],
  );
  material.uniforms.sunDir.value.copy(sunDir);
  material.uniforms.earthDir.value.copy(earthDir);
  material.uniforms.earthshine.value = earthshine;

  // 8k global colour + relief (~1.3 km/pixel) load in the background the first time the camera
  // comes close, then swap in; far views never pay for them.
  const [wantHiRes, setWantHiRes] = useState(false);
  useFrame(({ camera }) => {
    if (!wantHiRes && camera.position.length() < HI_RES_DISTANCE) setWantHiRes(true);
  });
  useEffect(() => {
    if (!wantHiRes) return;
    const loader = new TextureLoader();
    let live = true;
    const load = (url: string) => new Promise<Texture>((resolve, reject) => loader.load(url, resolve, undefined, reject));
    Promise.all([load("/textures/moon_color_8k.jpg"), load("/textures/moon_normal_8k.jpg")]).then(([c, n]) => {
      if (!live) return;
      c.colorSpace = SRGBColorSpace;
      n.colorSpace = NoColorSpace;
      c.anisotropy = n.anisotropy = 16;
      material.uniforms.map.value = c;
      material.uniforms.normalMap.value = n;
    });
    return () => {
      live = false;
    };
  }, [wantHiRes, material]);

  return (
    <mesh ref={ref} material={material}>
      <sphereGeometry args={[1, 384, 192]} />
    </mesh>
  );
});

export default Moon;
