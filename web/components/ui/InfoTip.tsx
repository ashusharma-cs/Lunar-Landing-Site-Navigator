"use client";

/**
 * Small "?" with a one-sentence explanation. Shows on hover and on keyboard focus; on touch screens a
 * tap focuses the button, which shows it too. Pure CSS, so it never shifts layout.
 */
export function InfoTip({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  return (
    <span className="group/tip relative ml-1 inline-flex align-middle">
      <button type="button" aria-label={text}
              className="grid size-3.5 place-items-center rounded-full border border-line-2 font-mono text-[9px] leading-none text-ink-3 hover:border-ink-3 hover:text-ink focus:border-ink focus:text-ink focus:outline-none">
        ?
      </button>
      <span role="tooltip"
            className={`pointer-events-none invisible absolute top-5 z-50 w-56 border border-line-2 bg-[#141416] px-2.5 py-2 text-left text-[11.5px] leading-snug font-normal tracking-normal text-ink-2 normal-case opacity-0 shadow-lg transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 ${align === "right" ? "right-0" : "left-0"}`}>
        {text}
      </span>
    </span>
  );
}
