import { Suspense } from "react";
import CompareView from "@/components/CompareView";

// Search params are read inside Suspense so the route keeps an instant static shell.
export default function ComparePage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-6 py-10 font-mono text-[12px] text-ink-3">Loading</main>}>
      <CompareView />
    </Suspense>
  );
}
