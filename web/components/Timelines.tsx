"use client";

import type { TrackPoint } from "@/lib/track";

type Props = {
  track: TrackPoint[]; startMs: number; endMs: number; cursorMs: number; onSeek: (ms: number) => void;
  /** Narrow panels: month-day axis labels only. */
  compact?: boolean;
};

function Bar({ label, track, value, color, startMs, endMs }: {
  label: string; track: TrackPoint[]; value: (p: TrackPoint) => number; color: string; startMs: number; endMs: number;
}) {
  const span = endMs - startMs;
  const w = track.length > 1 ? (100 * (track[1].t - track[0].t)) / span : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-[11.5px] text-ink-3">{label}</span>
      <svg className="h-3 w-full" viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden>
        <rect width="100" height="1" fill="rgb(236 235 230 / 0.05)" />
        {track.map((p, i) => {
          const v = value(p);
          return v > 0 ? (
            <rect key={i} x={(100 * (p.t - startMs)) / span} width={w + 0.02} height="1" fill={color} opacity={0.3 + 0.7 * v} />
          ) : null;
        })}
      </svg>
    </div>
  );
}

export default function Timelines({ track, startMs, endMs, cursorMs, onSeek, compact }: Props) {
  const days = Math.round((endMs - startMs) / 86_400_000);
  const pct = (100 * (cursorMs - startMs)) / (endMs - startMs);
  return (
    <div
      className="relative cursor-pointer space-y-1.5 select-none"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left - 68) / (r.width - 68);
        if (f >= 0 && f <= 1) onSeek(startMs + f * (endMs - startMs));
      }}
    >
      <Bar label="Sunlight" track={track} value={(p) => p.sunVis} color="var(--sun)" startMs={startMs} endMs={endMs} />
      <Bar label="Earth" track={track} value={(p) => p.earthVis} color="var(--earth)" startMs={startMs} endMs={endMs} />
      <div className="pointer-events-none absolute top-0 bottom-0 left-[68px] right-0">
        <div className="absolute top-[-4px] bottom-[-4px] w-px bg-ink" style={{ left: `${pct}%` }} />
      </div>
      <div className="flex justify-between pl-[68px] font-mono text-[10.5px] text-ink-3">
        <span>{new Date(startMs).toISOString().slice(compact ? 5 : 0, 10)}</span>
        {!compact && <span>{days} days</span>}
        <span>{new Date(endMs).toISOString().slice(compact ? 5 : 0, 10)}</span>
      </div>
    </div>
  );
}
