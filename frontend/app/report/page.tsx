import { Suspense } from "react";

import { SiteShell } from "@/components/layout/site-shell";
import { ReportWorkspace } from "@/components/report/report-workspace";

export default function ReportPage() {
  return (
    <SiteShell
      eyebrow="Performance Report"
      title="Timed quiz diagnostics with pace, accuracy, and coaching signals."
      description="This report is driven by the backend evaluation output, including score, time behavior, chapter patterns, and next actions."
    >
      <Suspense fallback={<ReportLoadingFallback />}>
        <ReportWorkspace />
      </Suspense>
    </SiteShell>
  );
}

function ReportLoadingFallback() {
  return (
    <section className="surface rounded-[28px] p-6 md:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.26em] text-signal">
        Loading report
      </p>
      <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
        Preparing the timed attempt analysis.
      </h3>
    </section>
  );
}
