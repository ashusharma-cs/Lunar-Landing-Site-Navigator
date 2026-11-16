// AI-assisted: written with help from Claude (Anthropic), an AI coding assistant. See README, "AI use".
import { Suspense } from "react";
import AnalysisView from "@/components/AnalysisView";

// Search params are read inside Suspense so the route keeps an instant static shell.
export default function AnalysisPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-6xl px-6 py-10 font-mono text-[12px] text-ink-3">Loading</main>}>
      <AnalysisView />
    </Suspense>
  );
}
