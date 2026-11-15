"use client";

// Side panels on wide screens, bottom sheets on small ones. Class strings are written out in full
// (not assembled) so Tailwind can see them. Left panels become side rails from `md`, the right panel
// from `lg`; below that they are hidden until opened from the small-screen tab bar.

// No top padding: the sticky Close row sits flush with the top edge, so nothing scrolls into view above it.
const SHEET = "fixed inset-x-0 bottom-0 z-40 max-h-[62dvh] overflow-y-auto border-t border-line-2 bg-bg/95 px-4 pt-0 pb-6 backdrop-blur "
  + "[scrollbar-color:var(--line-2)_transparent] [scrollbar-width:thin]";

/** Left rail from md up (regions / your spot); bottom sheet below. */
export function leftPanel(open: boolean) {
  return `${SHEET} ${open ? "block" : "hidden"} md:absolute md:inset-x-auto md:top-28 md:bottom-40 md:left-6 md:z-30 md:block `
    + "md:max-h-none md:w-64 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:pb-0 md:pr-2 md:backdrop-blur-none";
}

/** Right rail from lg up (best spots, ephemeris); bottom sheet below. */
export function rightPanel(open: boolean) {
  return `${SHEET} ${open ? "block" : "hidden"} lg:absolute lg:inset-x-auto lg:top-28 lg:right-6 lg:bottom-44 lg:z-30 lg:block `
    + "lg:max-h-none lg:w-64 lg:border-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:pb-0 lg:pl-2 lg:backdrop-blur-none";
}

/** "Close" row at the top of a sheet; hidden once the panel is a rail. */
export function SheetClose({ onClose, rail }: { onClose: () => void; rail: "md" | "lg" }) {
  return (
    <div className={`sticky top-0 z-10 -mx-4 mb-2 flex justify-end border-b border-line bg-bg px-4 pt-2 pb-1.5 ${rail === "md" ? "md:hidden" : "lg:hidden"}`}>
      <button onClick={onClose} className="px-2 py-1 text-[12px] text-ink-2 hover:text-ink">Close ✕</button>
    </div>
  );
}
