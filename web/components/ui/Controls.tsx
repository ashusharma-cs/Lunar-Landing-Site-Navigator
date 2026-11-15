"use client";

import type { ReactNode } from "react";
import { InfoTip } from "@/components/ui/InfoTip";

/** Segmented control: hairline frame, active segment filled with ink. */
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-line-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} role="radio" aria-checked={on} onClick={() => onChange(o.value)}
                  className={`px-2.5 py-1 font-mono text-[11.5px] transition-colors ${on ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Text tab with an underline when active. */
export function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
            className={`relative py-1 text-[12.5px] transition-colors ${active ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
      {children}
      <span className={`absolute inset-x-0 -bottom-px h-px transition-opacity ${active ? "bg-ink opacity-100" : "opacity-0"}`} />
    </button>
  );
}

/** Square checkbox row. */
export function Toggle({ checked, onChange, children, swatch }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  swatch?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1 text-[12.5px] text-ink-2 hover:text-ink">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={`grid size-3 place-items-center border ${checked ? "border-ink bg-ink" : "border-line-2"} peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink-2`}>
        {checked && <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden><path d="M1.2 4.2 3.1 6 6.8 2" stroke="var(--bg)" strokeWidth="1.4" fill="none" /></svg>}
      </span>
      {swatch && <span className="h-px w-3" style={{ background: swatch }} />}
      {children}
    </label>
  );
}

/** Square icon button. */
export function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick}
            className="grid size-8 place-items-center border border-line-2 bg-panel text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
      {children}
    </button>
  );
}

/** Label/value row with a hairline under it. */
export function Readout({ label, value, unit, tone, tip }: { label: string; value: string; unit?: string; tone?: "ok" | "partial" | "bad"; tip?: string }) {
  const color = tone === "ok" ? "text-ok" : tone === "partial" ? "text-sun" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
      <span className="text-[12px] text-ink-3">{label}{tip && <InfoTip text={tip} />}</span>
      <span className={`font-mono text-[12.5px] tabular-nums ${color}`}>
        {value}
        {unit && <span className="ml-1 text-ink-3">{unit}</span>}
      </span>
    </div>
  );
}
