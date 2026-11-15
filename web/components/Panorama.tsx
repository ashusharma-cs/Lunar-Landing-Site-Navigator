"use client";

import { scaleLinear } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { skylineAt } from "@/lib/astro";
import type { TrackPoint } from "@/lib/track";

const HEIGHT = 340;
const M = { top: 16, right: 16, bottom: 28, left: 40 };
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

type Props = {
  skyline: Float32Array; track: TrackPoint[]; now: TrackPoint | null;
  /** Simple mode: label the mountains in words. */
  plain?: boolean;
};

export default function Panorama({ skyline, track, now, plain }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, terrainPath, skylinePath, peakAz, peakEl } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const v of skyline) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const p of track) { hi = Math.max(hi, p.sunEl, p.earthEl); lo = Math.min(lo, p.earthEl); }
    const x = scaleLinear().domain([0, 360]).range([M.left, width - M.right]);
    const y = scaleLinear().domain([Math.floor(lo - 1), Math.ceil(hi + 1.5)]).range([HEIGHT - M.bottom, M.top]);
    const pts: string[] = [];
    for (let i = 0; i <= 720; i++) {
      const az = (i / 720) * 360;
      pts.push(`${x(az).toFixed(1)},${y(skylineAt(skyline, az)).toFixed(1)}`);
    }
    const skylinePath = `M${pts.join("L")}`;
    const terrainPath = `${skylinePath}L${x(360)},${HEIGHT - M.bottom}L${x(0)},${HEIGHT - M.bottom}Z`;
    // Highest point of the skyline, for the "mountains" label.
    let peak = 0;
    for (let i = 1; i < skyline.length; i++) if (skyline[i] > skyline[peak]) peak = i;
    return { x, y, terrainPath, skylinePath, peakAz: (peak * 360) / skyline.length, peakEl: skyline[peak] };
  }, [skyline, track, width]);

  const yTicks = y.ticks(6);

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label="Horizon panorama with Sun and Earth paths">
        <defs>
          <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0a0a0b" />
            <stop offset="100%" stopColor="#121214" />
          </linearGradient>
          <linearGradient id="ground" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#4a4946" />
            <stop offset="100%" stopColor="#1a1a19" />
          </linearGradient>
        </defs>
        <rect x={M.left} y={M.top} width={width - M.left - M.right} height={HEIGHT - M.top - M.bottom} fill="url(#sky)" />

        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgb(236 235 230 / 0.35)" : "rgb(236 235 230 / 0.07)"}
                  strokeDasharray={t === 0 ? "4 4" : undefined} />
            <text x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[10px]">{t}°</text>
          </g>
        ))}

        {/* Paths where visible, drawn behind the terrain so the ground occludes them naturally. */}
        {track.map((p, i) => (
          <g key={i}>
            {p.sunVis > 0 && <circle cx={x(p.sunAz)} cy={y(p.sunEl)} r={1.4} fill="var(--sun)" opacity={0.35 + 0.65 * p.sunVis} />}
            {p.earthVis > 0 && <circle cx={x(p.earthAz)} cy={y(p.earthEl)} r={1.4} fill="var(--earth)" opacity={0.9} />}
          </g>
        ))}

        {now && (
          <>
            <ellipse cx={x(now.sunAz)} cy={y(now.sunEl)} rx={Math.max(3, x(now.sunR) - x(0))}
                     ry={Math.max(3, y(0) - y(now.sunR))} fill="#f6d79a" stroke="var(--sun)" />
            <ellipse cx={x(now.earthAz)} cy={y(now.earthEl)} rx={Math.max(4, x(now.earthR) - x(0))}
                     ry={Math.max(4, y(0) - y(now.earthR))} fill="#1d4ed8" stroke="#93c5fd" />
          </>
        )}

        <path d={terrainPath} fill="url(#ground)" />

        {/* Blocked stretches, faded on top of the terrain. */}
        {track.map((p, i) => (
          <g key={i}>
            {p.sunVis === 0 && <circle cx={x(p.sunAz)} cy={y(p.sunEl)} r={1.1} fill="var(--sun)" opacity={0.18} />}
            {p.earthVis === 0 && <circle cx={x(p.earthAz)} cy={y(p.earthEl)} r={1.1} fill="var(--earth)" opacity={0.18} />}
          </g>
        ))}

        <path d={skylinePath} fill="none" stroke="#d8d6cf" strokeWidth={1} />

        {plain && (
          <>
            <text x={Math.min(Math.max(x(peakAz), M.left + 60), width - M.right - 60)} y={y(peakEl) + 30} textAnchor="middle"
                  className="fill-ink text-[11px]">mountains &amp; crater rims</text>
          </>
        )}

        {now && (
          <>
            <text x={x(now.sunAz)} y={y(now.sunEl) - 10} textAnchor="middle" className="fill-sun text-[11px]">Sun</text>
            <text x={x(now.earthAz)} y={y(now.earthEl) - 12} textAnchor="middle" className="fill-earth text-[11px]">Earth</text>
          </>
        )}

        {COMPASS.map((c, i) => (
          <text key={c} x={x(i * 45)} y={HEIGHT - 8} textAnchor="middle" className="fill-ink-2 text-[11px]">
            {c} <tspan className="fill-ink-3 font-mono">{i * 45}°</tspan>
          </text>
        ))}
      </svg>
    </div>
  );
}
