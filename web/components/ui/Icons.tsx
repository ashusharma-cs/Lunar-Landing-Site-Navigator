// 16px stroke icons, drawn to a 1.25px hairline so they sit with the type.
type P = { className?: string };
const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.25 };

export const PlayIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" stroke="none" /></svg>
);
export const PauseIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M5 3.5v9M11 3.5v9" strokeWidth={2} /></svg>
);
export const PlusIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M8 3v10M3 8h10" /></svg>
);
export const MinusIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M3 8h10" /></svg>
);
export const RecenterIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden>
    <circle cx="8" cy="8" r="4.5" /><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
  </svg>
);
export const ArrowIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" /></svg>
);
export const DescendIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M8 2.5v9M4.5 8 8 11.5 11.5 8M3 14h10" /></svg>
);
export const AscendIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M8 13.5v-9M4.5 8 8 4.5 11.5 8M3 2h10" /></svg>
);
export const BackIcon = ({ className }: P) => (
  <svg {...base} className={className} aria-hidden><path d="M13 8H3M6.5 4.5 3 8l3.5 3.5" /></svg>
);

/** Mark: the Moon's limb with the Sun grazing it at 1.5 degrees. */
export const Mark = ({ className }: P) => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className={className} aria-hidden>
    <circle cx="11" cy="11" r="7.25" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.5 12.2 20.5 9.8" stroke="var(--sun)" strokeWidth="1.25" />
  </svg>
);
