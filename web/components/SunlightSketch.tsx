// The idea in one picture: a lander, a ridge, and the Sun either above the ridge (power) or behind it
// (shadow). A diagram, not data: proportions are exaggerated so the angles are visible.

function Panel({ sunUp, label }: { sunUp: boolean; label: string }) {
  const sun = sunUp ? { x: 205, y: 38 } : { x: 205, y: 92 };
  return (
    <figure className="min-w-0">
      <svg viewBox="0 0 260 150" className="w-full" role="img" aria-label={label}>
        <rect width="260" height="150" fill="#0c0c0e" />
        {/* Sun */}
        <circle cx={sun.x} cy={sun.y} r="11" fill="#f6d79a" stroke="var(--sun)" />
        {/* Ridge in front of the Sun when it is low */}
        <path d="M120 150 L160 82 L185 98 L215 70 L260 104 L260 150 Z" fill="#3a3936" stroke="#8d8b84" strokeWidth="1" />
        {/* Ground and lander */}
        <rect x="0" y="128" width="260" height="22" fill="#2a2927" />
        <g transform="translate(36 112)">
          <rect x="-7" y="0" width="14" height="10" fill="#c9b27a" />
          <line x1="-7" y1="10" x2="-12" y2="16" stroke="#c9b27a" />
          <line x1="7" y1="10" x2="12" y2="16" stroke="#c9b27a" />
          <rect x="-16" y="-6" width="10" height="4" fill="#4a6fa5" />
        </g>
        {/* Line of sight from the lander to the Sun */}
        <line x1="40" y1="112" x2={sun.x} y2={sun.y} stroke={sunUp ? "var(--sun)" : "var(--bad)"} strokeDasharray="4 3" strokeWidth="1.3" />
        {!sunUp && <text x="172" y="86" className="fill-bad text-[13px] font-medium">✕</text>}
        <text x="10" y="18" className="fill-ink text-[11px]">{sunUp ? "Sun above the ridge" : "Sun behind the ridge"}</text>
      </svg>
      <figcaption className={`mt-1.5 text-[12.5px] ${sunUp ? "text-ok" : "text-bad"}`}>{label}</figcaption>
    </figure>
  );
}

export default function SunlightSketch() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Panel sunUp label="Clear line to the Sun: solar power" />
      <Panel sunUp={false} label="Ridge in the way: shadow, no power" />
    </div>
  );
}
