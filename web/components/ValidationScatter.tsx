// Ours vs NASA's published LOLA average-visibility map, one dot per test point. Points on the
// diagonal agree exactly. Pure SVG, so it renders on the server with the rest of the page.

const S = 260;                       // plot size (px)
const M = { top: 10, right: 10, bottom: 38, left: 44 };

export default function ValidationScatter({ title, points, color }: {
  title: string;
  /** [NASA, ours] as fractions of time. */
  points: [number, number][];
  color: string;
}) {
  // Axes span 0 to just above the largest value (both axes the same, so the diagonal stays 45°).
  const top = Math.min(1, Math.ceil(Math.max(...points.flat()) * 10 + 0.5) / 10);
  const x = (v: number) => M.left + (v / top) * S;
  const y = (v: number) => M.top + (1 - v / top) * S;
  const step = top <= 0.6 ? 0.1 : 0.25;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(2));
  const W = M.left + S + M.right, H = M.top + S + M.bottom;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-[13px] text-ink">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[340px]" role="img"
           aria-label={`${title}: ${points.length} points, this app against NASA's map`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(top)} y1={y(t)} y2={y(t)} stroke="rgb(236 235 230 / 0.07)" />
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(top)} stroke="rgb(236 235 230 / 0.07)" />
            <text x={x(0) - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[9.5px]">{Math.round(t * 100)}%</text>
            <text x={x(t)} y={y(0) + 14} textAnchor="middle" className="fill-ink-3 font-mono text-[9.5px]">{Math.round(t * 100)}%</text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(top)} y2={y(top)} stroke="rgb(236 235 230 / 0.35)" strokeDasharray="4 4" />
        <text x={x(top * 0.98)} y={y(top * 0.98) + 14} textAnchor="end" className="fill-ink-3 text-[9.5px]">perfect agreement</text>
        {points.map(([n, o], i) => (
          <circle key={i} cx={x(n)} cy={y(o)} r={2.2} fill={color} fillOpacity={0.75}>
            <title>{`NASA ${(100 * n).toFixed(1)}% · this app ${(100 * o).toFixed(1)}%`}</title>
          </circle>
        ))}
        <text x={x(top / 2)} y={H - 4} textAnchor="middle" className="fill-ink-2 text-[10.5px]">NASA&apos;s map (time visible)</text>
        <text transform={`translate(11 ${y(top / 2)}) rotate(-90)`} textAnchor="middle" className="fill-ink-2 text-[10.5px]">This app</text>
      </svg>
    </figure>
  );
}
