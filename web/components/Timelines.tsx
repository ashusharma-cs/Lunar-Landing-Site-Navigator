// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import type { TrackPoint } from "@/lib/track";

type Props = {
  track: TrackPoint[]; startMs: number; endMs: number; cursorMs: number; onSeek: (ms: number) => void;
  /** Narrow panels: month-day axis labels only. */
  compact?: boolean;
  /** Big bars with worded labels and a tick per day (analysis page). */
  large?: boolean;
};

function Bar({ label, track, value, color, startMs, endMs, large }: {
  label: string; track: TrackPoint[]; value: (p: TrackPoint) => number; color: string; startMs: number; endMs: number; large?: boolean;
}) {
  const span = endMs - startMs;
  const w = track.length > 1 ? (100 * (track[1].t - track[0].t)) / span : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`shrink-0 text-ink-3 ${large ? "w-24 text-[12.5px]" : "w-14 text-[11.5px]"}`}>{label}</span>
      <svg className={`${large ? "h-7" : "h-3"} w-full`} viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden>
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

export default function Timelines({ track, startMs, endMs, cursorMs, onSeek, compact, large }: Props) {
  const days = Math.round((endMs - startMs) / 86_400_000);
  const pad = large ? 108 : 68;  // label column + gap
  const pct = (100 * (cursorMs - startMs)) / (endMs - startMs);
  return (
    <div
      className="relative cursor-pointer space-y-1.5 select-none"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientX - r.left - pad) / (r.width - pad);
        if (f >= 0 && f <= 1) onSeek(startMs + f * (endMs - startMs));
      }}
    >
      <Bar label="Sunlight" track={track} value={(p) => p.sunVis} color="var(--sun)" startMs={startMs} endMs={endMs} large={large} />
      <Bar label={large ? "Earth in view" : "Earth"} track={track} value={(p) => p.earthVis} color="var(--earth)" startMs={startMs} endMs={endMs} large={large} />
      <div className="pointer-events-none absolute top-0 bottom-0 right-0" style={{ left: pad }}>
        {large && Array.from({ length: days + 1 }, (_, d) => (
          <span key={d} className={`absolute bottom-4 w-px ${d % 7 === 0 ? "h-2 bg-ink-3" : "h-1 bg-line-2"}`} style={{ left: `${(100 * d) / days}%` }} />
        ))}
        <div className="absolute top-[-4px] bottom-[-4px] w-px bg-ink" style={{ left: `${pct}%` }} />
      </div>
      <div className={`flex justify-between font-mono text-[10.5px] text-ink-3 ${large ? "pt-2" : ""}`} style={{ paddingLeft: pad }}>
        <span>{new Date(startMs).toISOString().slice(compact ? 5 : 0, 10)}</span>
        {!compact && <span>{days} days</span>}
        <span>{new Date(endMs).toISOString().slice(compact ? 5 : 0, 10)}</span>
      </div>
    </div>
  );
}
