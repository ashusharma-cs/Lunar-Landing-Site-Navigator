// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
"use client";

import { useRef, useState } from "react";

const W = 224;  // tip width (px)

/**
 * Small "?" with a one-sentence explanation. Shows on hover and on keyboard focus (a tap on touch
 * screens focuses it too). The tip is placed in screen coordinates and kept inside the window, so it
 * never widens the narrow side panels or gets clipped by their scrolling.
 */
export function InfoTip({ text }: { text: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(Math.max(8, r.left - 8), window.innerWidth - W - 8);
    const below = r.bottom + 6;
    setPos({ x, y: below + 120 > window.innerHeight ? Math.max(8, r.top - 126) : below });
  };
  const hide = () => setPos(null);
  return (
    <span className="relative ml-1 inline-flex align-middle">
      <button ref={btn} type="button" aria-label={text} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
              className="grid size-3.5 place-items-center rounded-full border border-line-2 font-mono text-[9px] leading-none text-ink-3 hover:border-ink-3 hover:text-ink focus:border-ink focus:text-ink focus:outline-none">
        ?
      </button>
      {pos && (
        <span role="tooltip" style={{ left: pos.x, top: pos.y, width: W }}
              className="pointer-events-none fixed z-[60] border border-line-2 bg-[#141416] px-2.5 py-2 text-left text-[11.5px] leading-snug font-normal tracking-normal text-ink-2 normal-case shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}
