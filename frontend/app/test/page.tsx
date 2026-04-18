import { Suspense } from "react";

import { QuizWorkspace } from "@/components/exam/quiz-workspace";
import { SiteShell } from "@/components/layout/site-shell";

export default function TestPage() {
  return (
    <SiteShell
      eyebrow="Quiz Workspace"
      title="Generated questions from the ingested topic set."
      description="This page uses the generated question set from the Exam Coach backend and keeps the student inside the actual quiz flow."
    >
      <Suspense fallback={<QuizLoadingFallback />}>
        <QuizWorkspace />
      </Suspense>
    </SiteShell>
  );
}

function QuizLoadingFallback() {
  return (
    <section className="surface rounded-[28px] p-6 md:p-8">
      <p className="font-mono text-xs uppercase tracking-[0.26em] text-signal">
        Loading quiz
      </p>
      <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
        Preparing the generated question set.
      </h3>
    </section>
  );
}
