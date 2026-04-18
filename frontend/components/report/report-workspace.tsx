"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AttemptStateResponse, PerformanceReport } from "@/lib/exam-coach-api";

export function ReportWorkspace() {
  const searchParams = useSearchParams();
  const attemptId = searchParams.get("attempt");

  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadReport() {
      if (!attemptId) {
        setError("Open the report from a submitted quiz attempt.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/exam-coach/attempt/${attemptId}`, {
          headers: {
            Accept: "application/json",
          },
          cache: "no-store",
        });
        const payload = (await response.json()) as AttemptStateResponse | { detail?: string };

        if (!response.ok) {
          throw new Error(readErrorDetail(payload, "Unable to load the report."));
        }

        const attemptState = payload as AttemptStateResponse;
        if (!attemptState.performance_report) {
          throw new Error("This attempt has not been submitted yet.");
        }

        if (isActive) {
          setReport(attemptState.performance_report);
        }
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Unable to load the report.";
        setError(message);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      isActive = false;
    };
  }, [attemptId]);

  const slowestQuestions = useMemo(() => {
    if (!report) {
      return [];
    }

    return report.timing_summary.slowest_question_ids.map((questionId) => {
      const review = report.question_review.find((item) => item.question_id === questionId);
      return {
        questionId,
        seconds: review?.time_spent_seconds ?? 0,
        result: review?.result ?? "unattempted",
      };
    });
  }, [report]);

  if (isLoading) {
    return (
      <section className="surface rounded-[28px] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.26em] text-signal">
          Loading report
        </p>
        <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
          Building the evaluation summary from your timed attempt.
        </h3>
      </section>
    );
  }

  if (error || !report) {
    return (
      <section className="surface rounded-[28px] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.26em] text-warning">
          Report unavailable
        </p>
        <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
          {error ?? "The report could not be loaded."}
        </h3>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-signal px-5 font-semibold text-slate-950 hover:-translate-y-0.5"
        >
          Start another quiz
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6">
      <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
        <article className="surface rounded-[30px] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-signal">
            Timed attempt summary
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-none md:text-6xl">
            {report.auto_submitted
              ? "Time ran out, and the quiz was auto-submitted."
              : "Your timed attempt has been fully evaluated."}
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-8 text-muted">
            Use the score, timing behavior, and chapter-specific diagnostics below to decide
            what to tighten before the next quiz.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <MetricCard
              label="Score"
              value={`${report.score_summary.correct} / ${report.question_review.length}`}
              note={`${report.score_summary.percentage}% overall accuracy`}
            />
            <MetricCard
              label="Attempted"
              value={`${report.score_summary.attempted}`}
              note={`${report.score_summary.unattempted} left blank`}
            />
            <MetricCard
              label="Average pace"
              value={`${Math.round(report.timing_summary.average_time_per_question_seconds)} sec`}
              note={`${report.timing_summary.total_duration_seconds.toFixed(0)} sec total active time`}
            />
          </div>
        </article>

        <aside className="surface rounded-[30px] p-6 md:p-8">
          <div className="grid gap-6">
            <MetricGroup
              title="Topic accuracy"
              caption="Attempted chapter performance"
              items={report.topic_performance.map((item) => ({
                label: item.topic_id.replaceAll("-", " "),
                value: `${item.accuracy}%`,
                width: `${Math.max(item.accuracy, 6)}%`,
                note: `${item.average_time_seconds.toFixed(0)} sec avg`,
              }))}
            />
            <MetricGroup
              title="Difficulty accuracy"
              caption="How the paper bands behaved"
              items={report.difficulty_performance.map((item) => ({
                label: item.difficulty_label,
                value: `${item.accuracy}%`,
                width: `${Math.max(item.accuracy, 6)}%`,
                note: `${item.average_time_seconds.toFixed(0)} sec avg`,
              }))}
            />
          </div>
        </aside>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <InsightCard
          title="Strengths"
          tone="signal"
          items={report.coaching.strengths.length ? report.coaching.strengths : ["No clear strengths identified yet."]}
        />
        <InsightCard
          title="Weak topics"
          tone="warning"
          items={
            report.coaching.weak_topics.length
              ? report.coaching.weak_topics
              : ["No weak topic cluster stood out strongly in this attempt."]
          }
        />
        <InsightCard
          title="Next actions"
          tone="signal"
          items={report.coaching.next_actions.length ? report.coaching.next_actions : ["Retake a similar timed quiz within 24 hours."]}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <article className="surface rounded-[30px] p-6 md:p-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted">
                Timing insights
              </p>
              <h3 className="mt-3 font-display text-3xl leading-none md:text-4xl">
                Where the clock helped and hurt.
              </h3>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <StatPanel
              label="Transition delay"
              value={`${report.timing_summary.average_transition_delay_seconds.toFixed(1)} sec`}
              note={`${report.timing_summary.idle_transition_count} idle transitions`}
            />
            <StatPanel
              label="Late-stage accuracy"
              value={
                report.timing_summary.late_stage_accuracy_drop ? "Dropped" : "Stable"
              }
              note={`${report.timing_summary.first_half_accuracy}% first half vs ${report.timing_summary.second_half_accuracy}% second half`}
            />
            <StatPanel
              label="Correct-answer pace"
              value={`${report.timing_summary.average_time_on_correct_seconds.toFixed(1)} sec`}
              note="Average time spent on correct responses"
            />
            <StatPanel
              label="Wrong-answer pace"
              value={`${report.timing_summary.average_time_on_wrong_seconds.toFixed(1)} sec`}
              note="Average time spent on incorrect responses"
            />
          </div>

          <div className="mt-6 rounded-[24px] border border-line bg-white/[0.02] p-5">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-warning">
              Slowest questions
            </p>
            <div className="mt-4 grid gap-3">
              {slowestQuestions.length ? (
                slowestQuestions.map((item) => (
                  <div key={item.questionId} className="flex items-center justify-between gap-4 rounded-[18px] border border-line px-4 py-3">
                    <span className="text-sm text-white/90">{item.questionId}</span>
                    <span className="text-sm text-white/70">
                      {item.seconds.toFixed(1)} sec • {item.result}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-white/70">No slow-question data was captured.</p>
              )}
            </div>
          </div>

          {report.behavior_signals.length ? (
            <div className="mt-6 grid gap-3">
              {report.behavior_signals.map((signal) => (
                <div key={signal.code} className="rounded-[20px] border border-line bg-white/[0.02] p-4">
                  <p className="font-semibold text-white">{signal.label}</p>
                  <p className="mt-2 text-sm leading-6 text-white/75">{signal.detail}</p>
                </div>
              ))}
            </div>
          ) : null}
        </article>

        <aside className="surface rounded-[30px] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted">
            Question review
          </p>
          <div className="mt-5 grid gap-3">
            {report.question_review.map((item) => (
              <div key={item.question_id} className="rounded-[20px] border border-line bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-semibold text-white">{item.question_id}</p>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                      item.result === "correct"
                        ? "bg-emerald-400/15 text-emerald-200"
                        : item.result === "incorrect"
                          ? "bg-amber-300/15 text-amber-200"
                          : "bg-white/10 text-white/70"
                    }`}
                  >
                    {item.result}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/75">{item.explanation}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.16em] text-muted">
                  {item.time_spent_seconds.toFixed(1)} sec • {item.visited_count} visits • {item.answer_changed_count} changes
                </p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="surface rounded-[30px] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-signal">
          Practice plan
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {report.coaching.recommended_practice_plan.map((item) => (
            <div key={item} className="rounded-[20px] border border-line bg-white/[0.02] p-4 text-sm leading-6 text-white/85">
              {item}
            </div>
          ))}
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-signal px-5 font-semibold text-slate-950 hover:-translate-y-0.5"
        >
          Start another timed quiz
        </Link>
      </section>
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[22px] border border-line bg-white/[0.02] p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-3 font-display text-4xl">{value}</p>
      <p className="mt-2 text-sm text-white/70">{note}</p>
    </div>
  );
}

function MetricGroup({
  title,
  caption,
  items,
}: {
  title: string;
  caption: string;
  items: Array<{ label: string; value: string; width: string; note: string }>;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="font-display text-2xl">{title}</h3>
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted">{caption}</span>
      </div>

      <div className="grid gap-4">
        {items.map((item) => (
          <div key={item.label}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-white/90">{item.label}</span>
              <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted">{item.value}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/[0.05]">
              <div className="metric-bar h-full rounded-full" style={{ width: item.width }} />
            </div>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted">{item.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function InsightCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "signal" | "warning";
  items: string[];
}) {
  return (
    <article className="surface rounded-[26px] p-6">
      <p
        className={`font-mono text-xs uppercase tracking-[0.24em] ${
          tone === "signal" ? "text-signal" : "text-warning"
        }`}
      >
        {title}
      </p>
      <ul className="mt-5 space-y-3 text-sm leading-7 text-muted md:text-base">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function StatPanel({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-[22px] border border-line bg-white/[0.02] p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-3 font-display text-3xl">{value}</p>
      <p className="mt-2 text-sm text-white/70">{note}</p>
    </div>
  );
}

function readErrorDetail(payload: AttemptStateResponse | { detail?: string }, fallback: string) {
  if ("detail" in payload && payload.detail) {
    return payload.detail;
  }

  return fallback;
}
