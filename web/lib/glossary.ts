// One place for every technical term the UI shows: the plain label (Simple mode), the technical label
// (Planner mode) and a one-sentence explanation for the "?" tip. Keep tips factual and short.

export type Term = { simple: string; planner: string; tip: string };

export const TERMS = {
  azimuth: { simple: "Compass direction", planner: "Azimuth", tip: "Which way to look: 0° is north, 90° east, 180° south, 270° west." },
  elevation: {
    simple: "Height above a flat horizon", planner: "Elevation, local level",
    tip: "Angle above a perfectly flat horizon: 0° is the horizon, 90° straight overhead. Near the pole the Sun stays within a few degrees of it.",
  },
  skyline: {
    simple: "Height of the hills that way", planner: "Skyline at that azimuth",
    tip: "How high the mountains and crater rims reach in that direction, computed from NASA LOLA laser-altimeter terrain.",
  },
  clearance: {
    simple: "Above the hills by", planner: "Clearance above terrain",
    tip: "Height minus the hills. Positive: it clears the terrain. Negative: hidden behind mountains, even if it is above the flat horizon.",
  },
  disc: {
    simple: "How much of the Sun shows", planner: "Disc visible",
    tip: "Share of the Sun's disc above the hills. Any part gives some solar power; at 100% the whole disc is visible.",
  },
  lineOfSight: {
    simple: "Can we talk to Earth?", planner: "Line of sight",
    tip: "In view: Earth's centre clears the hills (our rule for a dependable direct radio link). Partly visible: only part of Earth shows. Blocked: none of it.",
  },
  sunTime: { simple: "Time in sunlight", planner: "Time with any Sun", tip: "Share of the dates with at least part of the Sun above the hills." },
  sunAvg: { simple: "Average Sun showing", planner: "Mean Sun disc visible", tip: "Average share of the Sun's disc above the hills over the dates; partial Sun counts partly." },
  earthTime: {
    simple: "Time Earth is in view", planner: "Earth in view (centre clears)",
    tip: "Share of the dates with Earth's centre above the hills: when direct radio contact is dependable.",
  },
  earthAny: {
    simple: "Time any of Earth shows", planner: "Any part of Earth visible",
    tip: "Share of the dates with any sliver of Earth above the hills. NASA's Earth-visibility maps count this as visible.",
  },
  both: {
    simple: "Sun and Earth at once", planner: "Sun and Earth together",
    tip: "Share of the dates with sunlight and Earth in view at the same time: power and radio together.",
  },
  longestDark: {
    simple: "Longest night", planner: "Longest darkness (no Sun)",
    tip: "Longest stretch with no Sun at all. A solar-powered lander's batteries must last through it.",
  },
  longestSun: { simple: "Longest day", planner: "Longest continuous sunlight", tip: "Longest unbroken stretch of sunlight." },
  blackout: {
    simple: "Longest time out of contact", planner: "Longest comms blackout (centre)",
    tip: "Longest stretch without Earth in view: no direct radio link home (a relay satellite would be needed).",
  },
  noEarth: { simple: "Longest with no Earth at all", planner: "Longest with no Earth at all", tip: "Longest stretch with not even a sliver of Earth above the hills." },
  slope: {
    simple: "Ground steepness", planner: "Slope (LOLA, 2 grid steps)",
    tip: "How steep the ground is, measured over two LOLA terrain steps (tens of metres). NASA requires the HLS lander to touch down within 8° of vertical.",
  },
  ground: { simple: "Ground height", planner: "Ground elevation", tip: "Height of the ground above the Moon's 1,737.4 km reference sphere." },
  sunNext: { simple: "Sun next", planner: "Sun next", tip: "Time until the Sun next rises above or sets behind the hills here." },
  earthNext: { simple: "Earth next", planner: "Earth (centre) next", tip: "Time until Earth's centre next rises above or sets behind the hills here." },
} satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;

export function label(key: TermKey, simple: boolean): string {
  return simple ? TERMS[key].simple : TERMS[key].planner;
}
