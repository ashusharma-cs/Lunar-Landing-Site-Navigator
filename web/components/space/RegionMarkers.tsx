// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useState } from "react";
import { BufferGeometry, LineBasicMaterial, LineLoop, Vector3 } from "three";
import { surfacePoint } from "@/lib/frames";
import { type Region, regions } from "@/lib/sites";
import { useMissionStore } from "@/store/useMissionStore";

// NASA's candidate landing regions (Artemis IV) have no published coordinates (NASA picks landing sites later),
// so each is shown by the IAU feature it is named after: an outline at the feature's official
// centre and diameter (USGS Gazetteer), labelled with the region names that refer to it.
const LABEL_DISTANCE = 2.2;
const R_MOON_KM = 1737.4;

type Feature = { name: string; lat: number; lon: number; diameterKm: number; regions: Region[] };

function circle(lat: number, lon: number, radiusKm: number): Vector3[] {
  const p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180, d = radiusKm / R_MOON_KM;
  return Array.from({ length: 129 }, (_, k) => {
    const a = (k / 128) * 2 * Math.PI;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(a));
    const l2 = l1 + Math.atan2(Math.sin(a) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return surfacePoint((p2 * 180) / Math.PI, (l2 * 180) / Math.PI).multiplyScalar(1.0006);
  });
}

export default function RegionMarkers() {
  const selected = useMissionStore((s) => s.selectedRegionId);
  const selectRegion = useMissionStore((s) => s.selectRegion);
  const [near, setNear] = useState(false);
  const [facing, setFacing] = useState<Record<string, boolean>>({});

  const features = useMemo(() => {
    const byName = new Map<string, Feature>();
    for (const r of regions) {
      const f = byName.get(r.feature) ?? { name: r.feature, lat: r.featureLat, lon: r.featureLon, diameterKm: r.featureDiameterKm, regions: [] };
      f.regions.push(r);
      byName.set(r.feature, f);
    }
    return [...byName.values()].map((f) => {
      const loop = new LineLoop(
        new BufferGeometry().setFromPoints(circle(f.lat, f.lon, f.diameterKm / 2)),
        new LineBasicMaterial({ color: "#82acd9", transparent: true, opacity: 0.55, toneMapped: false }),
      );
      return { ...f, loop, centre: surfacePoint(f.lat, f.lon).multiplyScalar(1.0006) };
    });
  }, []);

  useFrame(({ camera }) => {
    const isNear = camera.position.length() < LABEL_DISTANCE;
    if (isNear !== near) setNear(isNear);
    // Exact horizon test for a sphere: the feature centre must face the camera.
    let changed = false;
    const next: Record<string, boolean> = {};
    for (const f of features) {
      next[f.name] = f.centre.dot(camera.position.clone().sub(f.centre)) > 0;
      if (next[f.name] !== facing[f.name]) changed = true;
    }
    if (changed) setFacing(next);
  });

  return (
    <>
      {features.map((f) => {
        const active = f.regions.some((r) => r.id === selected);
        f.loop.material.opacity = active ? 0.95 : 0.5;
        return (
          <group key={f.name}>
            <primitive object={f.loop} />
            <Html position={f.centre} center zIndexRange={[20, 0]}
                  style={{ pointerEvents: (near || active) && facing[f.name] ? "auto" : "none" }}>
              <button onClick={() => selectRegion(f.regions[0].id)}
                      className={`${(near || active) && facing[f.name] ? "block" : "hidden"} text-left whitespace-nowrap`}>
                <span className={`block text-[11px] ${active ? "text-ink" : "text-earth"}`}>{f.regions.map((r) => r.name).join(" · ")}</span>
                <span className="block text-[10px] text-ink-3">{f.name} · IAU feature</span>
              </button>
            </Html>
          </group>
        );
      })}
    </>
  );
}
