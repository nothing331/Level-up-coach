"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  AttemptSession,
  AttemptStateResponse,
  buildAttemptDraftKey,
  buildChapterQuizRequest,
  buildEvaluateAttemptRequest,
  buildStartAttemptRequest,
  EXAM_COACH_ACTIVE_ATTEMPT_KEY,
  EXAM_COACH_STORAGE_KEY,
  formatRemainingTime,
  GenerateResponse,
  getQuestionStatus,
  StartAttemptResponse,
  StoredAttemptDraft,
  StoredGeneratedQuiz,
  TimelineEvent,
} from "@/lib/exam-coach-api";

type SubmitState = "idle" | "submitting";

export function QuizWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topicId = searchParams.get("topic");
  const attemptIdParam = searchParams.get("attempt");

  const [quiz, setQuiz] = useState<StoredGeneratedQuiz | null>(null);
  const [attempt, setAttempt] = useState<AttemptSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flaggedQuestionIds, setFlaggedQuestionIds] = useState<string[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentQuestionEnteredAt, setCurrentQuestionEnteredAt] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [nowMs, setNowMs] = useState(Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const autoSubmitTriggeredRef = useRef(false);

  const currentQuestion = quiz?.response.question_set.questions[currentQuestionIndex] ?? null;
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);
  const remainingSeconds = useMemo(() => {
    if (!attempt) {
      return 0;
    }
    return Math.max(0, Math.floor((new Date(attempt.deadline_at).getTime() - nowMs) / 1000));
  }, [attempt, nowMs]);
  const isTimeWarning = remainingSeconds > 0 && remainingSeconds <= 60;
  const isLocked = submitState === "submitting" || remainingSeconds === 0;

  useEffect(() => {
    let isActive = true;

    async function resolveAttempt() {
      setIsLoading(true);
      setError(null);

      try {
        const storedQuiz = readStoredQuiz();
        const resolvedTopicId = topicId ?? storedQuiz?.topic.topic_id ?? null;
        const candidateAttemptId =
          attemptIdParam ?? storedQuiz?.attempt?.attempt_id ?? readActiveAttemptId();

        if (candidateAttemptId) {
          const restored = await restoreExistingAttempt(candidateAttemptId, resolvedTopicId, storedQuiz);
          if (!isActive) {
            return;
          }
          applyResolvedState(restored);
          return;
        }

        if (!resolvedTopicId) {
          throw new Error("Choose a topic from the home screen before opening the quiz page.");
        }

        const generated = await generateQuizAndAttempt(resolvedTopicId, storedQuiz);
        if (!isActive) {
          return;
        }
        applyResolvedState(generated);
      } catch (loadError) {
        if (!isActive) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : "Unable to load the quiz.";
        setError(message);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void resolveAttempt();

    return () => {
      isActive = false;
    };
  }, [attemptIdParam, topicId]);

  useEffect(() => {
    if (!attempt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [attempt?.attempt_id]);

  useEffect(() => {
    if (!attempt || !quiz) {
      return;
    }

    persistDraft({
      attemptId: attempt.attempt_id,
      topicId: topicId ?? quiz.topic.topic_id,
      answers,
      flaggedQuestionIds,
      currentQuestionIndex,
      timelineEvents,
      activeQuestionId: currentQuestion?.question_id ?? null,
      activeQuestionEnteredAt: currentQuestionEnteredAt,
    });
  }, [
    answers,
    attempt,
    currentQuestion?.question_id,
    currentQuestionEnteredAt,
    currentQuestionIndex,
    flaggedQuestionIds,
    quiz,
    timelineEvents,
    topicId,
  ]);

  useEffect(() => {
    if (!attempt || !quiz || submitState !== "idle") {
      return;
    }

    if (remainingSeconds > 0) {
      return;
    }

    if (autoSubmitTriggeredRef.current) {
      return;
    }

    autoSubmitTriggeredRef.current = true;
    void submitAttempt(true);
  }, [attempt, quiz, remainingSeconds, submitState]);

  function applyResolvedState(resolved: ResolvedQuizState) {
    autoSubmitTriggeredRef.current = false;
    setQuiz(resolved.quiz);
    setAttempt(resolved.attempt);
    setAnswers(resolved.answers);
    setFlaggedQuestionIds(resolved.flaggedQuestionIds);
    setTimelineEvents(resolved.timelineEvents);
    setCurrentQuestionIndex(resolved.currentQuestionIndex);
    setCurrentQuestionEnteredAt(resolved.currentQuestionEnteredAt);
    setNowMs(Date.now());
    persistStoredQuiz(resolved.quiz);
    persistActiveAttemptId(resolved.attempt.attempt_id);
    if (resolved.redirectToReport) {
      router.replace(`/report?attempt=${resolved.attempt.attempt_id}`);
    } else if (attemptIdParam !== resolved.attempt.attempt_id) {
      router.replace(`/test?topic=${resolved.quiz.topic.topic_id}&attempt=${resolved.attempt.attempt_id}`);
    }
  }

  async function restoreExistingAttempt(
    attemptId: string,
    resolvedTopicId: string | null,
    storedQuiz: StoredGeneratedQuiz | null,
  ): Promise<ResolvedQuizState> {
    const response = await fetch(`/api/exam-coach/attempt/${attemptId}`, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json()) as AttemptStateResponse | { detail?: string };
    if (!response.ok) {
      throw new Error(readErrorDetail(payload, "Unable to restore the timed attempt."));
    }

    const attemptState = payload as AttemptStateResponse;
    if (attemptState.performance_report) {
      clearAttemptDraft(attemptId);
      clearActiveAttemptId();
      return {
        quiz:
          storedQuiz ??
          buildStoredQuizFromAttemptState(attemptState, resolvedTopicId ?? attemptState.question_set?.questions[0]?.topic_id ?? "physics"),
        attempt: attemptState.attempt,
        answers: {},
        flaggedQuestionIds: [],
        timelineEvents: [],
        currentQuestionIndex: 0,
        currentQuestionEnteredAt: null,
        redirectToReport: true,
      };
    }

    const quizToUse =
      storedQuiz ??
      buildStoredQuizFromAttemptState(attemptState, resolvedTopicId ?? attemptState.question_set?.questions[0]?.topic_id ?? "physics");
    const draft = readAttemptDraft(attemptId);

    if (!draft) {
      const firstQuestionId = attemptState.question_set?.questions[0]?.question_id ?? null;
      return {
        quiz: quizToUse,
        attempt: attemptState.attempt,
        answers: {},
        flaggedQuestionIds: [],
        timelineEvents: firstQuestionId
          ? [{ type: "question_entered", at: new Date().toISOString(), question_id: firstQuestionId }]
          : [],
        currentQuestionIndex: 0,
        currentQuestionEnteredAt: firstQuestionId ? new Date().toISOString() : null,
      };
    }

    const restoredTimeline = reconcileTimelineOnRestore(draft);
    return {
      quiz: quizToUse,
      attempt: attemptState.attempt,
      answers: draft.answers,
      flaggedQuestionIds: draft.flaggedQuestionIds,
      timelineEvents: restoredTimeline.timelineEvents,
      currentQuestionIndex: clampQuestionIndex(
        draft.currentQuestionIndex,
        quizToUse.response.question_set.questions.length,
      ),
      currentQuestionEnteredAt: restoredTimeline.currentQuestionEnteredAt,
    };
  }

  async function generateQuizAndAttempt(
    resolvedTopicId: string,
    storedQuiz: StoredGeneratedQuiz | null,
  ): Promise<ResolvedQuizState> {
    const workingQuiz =
      storedQuiz && storedQuiz.topic.topic_id === resolvedTopicId
        ? storedQuiz
        : await regenerateQuiz(resolvedTopicId);

    const attemptResponse = await fetch("/api/exam-coach/start-attempt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildStartAttemptRequest(workingQuiz.response.question_set.question_set_id)),
    });

    const attemptPayload = (await attemptResponse.json()) as StartAttemptResponse | { detail?: string };
    if (!attemptResponse.ok) {
      throw new Error(readErrorDetail(attemptPayload, "Unable to start the timed attempt."));
    }

    const startedAttempt = (attemptPayload as StartAttemptResponse).attempt;
    const firstQuestionId = workingQuiz.response.question_set.questions[0]?.question_id ?? null;

    return {
      quiz: {
        ...workingQuiz,
        attempt: startedAttempt,
      },
      attempt: startedAttempt,
      answers: {},
      flaggedQuestionIds: [],
      timelineEvents: firstQuestionId
        ? [{ type: "question_entered", at: new Date().toISOString(), question_id: firstQuestionId }]
        : [],
      currentQuestionIndex: 0,
      currentQuestionEnteredAt: firstQuestionId ? new Date().toISOString() : null,
    };
  }

  async function regenerateQuiz(resolvedTopicId: string): Promise<StoredGeneratedQuiz> {
    const response = await fetch("/api/exam-coach/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(buildChapterQuizRequest(resolvedTopicId)),
    });

    const payload = (await response.json()) as GenerateResponse | { detail?: string };

    if (!response.ok) {
      throw new Error(readErrorDetail(payload, "Unable to regenerate the quiz."));
    }

    return {
      topic: {
        topic_id: resolvedTopicId,
        topic_name: resolvedTopicId.replaceAll("-", " "),
        aliases: [],
        is_ingested: true,
        selected_files: [],
        status: "pilot_ready",
      },
      response: payload as GenerateResponse,
    };
  }

  function navigateToQuestion(nextIndex: number) {
    if (!quiz || !currentQuestion) {
      return;
    }
    const safeIndex = clampQuestionIndex(nextIndex, quiz.response.question_set.questions.length);
    if (safeIndex === currentQuestionIndex) {
      return;
    }

    const nextQuestionId = quiz.response.question_set.questions[safeIndex]?.question_id;
    if (!nextQuestionId) {
      return;
    }

    const at = new Date().toISOString();
    setTimelineEvents((currentTimeline) => [
      ...currentTimeline,
      { type: "question_left", at, question_id: currentQuestion.question_id },
      { type: "question_entered", at, question_id: nextQuestionId },
    ]);
    setCurrentQuestionIndex(safeIndex);
    setCurrentQuestionEnteredAt(at);
  }

  function handleAnswerSelect(optionId: string) {
    if (!currentQuestion || isLocked) {
      return;
    }

    const at = new Date().toISOString();
    setAnswers((current) => ({
      ...current,
      [currentQuestion.question_id]: optionId,
    }));
    setTimelineEvents((currentTimeline) => [
      ...currentTimeline,
      {
        type: "answer_selected",
        at,
        question_id: currentQuestion.question_id,
        selected_option_id: optionId,
      },
    ]);
  }

  function handleFlagToggle() {
    if (!currentQuestion || isLocked) {
      return;
    }

    const nextFlagged = flaggedQuestionIds.includes(currentQuestion.question_id)
      ? flaggedQuestionIds.filter((questionId) => questionId !== currentQuestion.question_id)
      : [...flaggedQuestionIds, currentQuestion.question_id];

    setFlaggedQuestionIds(nextFlagged);
    setTimelineEvents((currentTimeline) => [
      ...currentTimeline,
      {
        type: "flag_toggled",
        at: new Date().toISOString(),
        question_id: currentQuestion.question_id,
        flagged: nextFlagged.includes(currentQuestion.question_id),
      },
    ]);
  }

  async function submitAttempt(autoSubmitted: boolean) {
    if (!quiz || !attempt || !currentQuestion || submitState === "submitting") {
      return;
    }

    if (!autoSubmitted) {
      const shouldSubmit = window.confirm(
        "Submit this quiz now? You will be moved to the evaluation screen and answers will lock.",
      );
      if (!shouldSubmit) {
        return;
      }
    }

    setSubmitState("submitting");
    setError(null);

    const submittedAt = new Date().toISOString();
    const finalTimelineEvents = [
      ...timelineEvents,
      { type: "question_left" as const, at: submittedAt, question_id: currentQuestion.question_id },
      {
        type: autoSubmitted ? ("auto_submitted" as const) : ("submitted" as const),
        at: submittedAt,
        question_id: currentQuestion.question_id,
      },
    ];

    setTimelineEvents(finalTimelineEvents);
    setCurrentQuestionEnteredAt(null);

    try {
      const response = await fetch("/api/exam-coach/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(
          buildEvaluateAttemptRequest(
            quiz.response.question_set,
            attempt.attempt_id,
            answers,
            finalTimelineEvents,
            autoSubmitted,
            submittedAt,
          ),
        ),
      });

      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(readErrorDetail(payload, "Unable to submit the timed attempt."));
      }

      clearAttemptDraft(attempt.attempt_id);
      clearActiveAttemptId();
      router.replace(`/report?attempt=${attempt.attempt_id}`);
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unable to submit the timed attempt.";
      setError(message);
      setSubmitState("idle");
      if (autoSubmitted) {
        autoSubmitTriggeredRef.current = false;
      }
    }
  }

  if (isLoading) {
    return (
      <section className="surface rounded-[28px] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.26em] text-signal">
          Loading quiz
        </p>
        <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
          Restoring your timed attempt.
        </h3>
      </section>
    );
  }

  if (error || !quiz || !attempt || !currentQuestion) {
    return (
      <section className="surface rounded-[28px] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.26em] text-warning">
          Quiz unavailable
        </p>
        <h3 className="mt-4 font-display text-3xl leading-none md:text-5xl">
          {error ?? "The quiz could not be loaded."}
        </h3>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-signal px-5 font-semibold text-slate-950 hover:-translate-y-0.5"
        >
          Return to topic selection
        </Link>
      </section>
    );
  }

  const totalQuestions = quiz.response.question_set.questions.length;
  const currentAnswer = answers[currentQuestion.question_id];
  const currentQuestionIsFlagged = flaggedQuestionIds.includes(currentQuestion.question_id);

  return (
    <section className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
      <article className="surface rounded-[30px] p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.26em] text-signal">
              Question {currentQuestionIndex + 1} / {totalQuestions}
            </p>
            <h3 className="mt-3 font-display text-3xl leading-tight md:text-5xl">
              {currentQuestion.stem}
            </h3>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-full border border-line bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-muted">
              {currentQuestion.difficulty_label}
            </span>
            <button
              type="button"
              disabled={isLocked}
              onClick={handleFlagToggle}
              className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                currentQuestionIsFlagged
                  ? "border-warning/30 bg-warning/15 text-warning"
                  : "border-line bg-white/[0.02] text-white/80"
              } ${isLocked ? "cursor-not-allowed opacity-55" : "hover:-translate-y-0.5"}`}
            >
              {currentQuestionIsFlagged ? "Flagged" : "Flag question"}
            </button>
          </div>
        </div>

        <div className="grid gap-3">
          {currentQuestion.options.map((option, optionIndex) => {
            const active = currentAnswer === option.option_id;

            return (
              <button
                key={option.option_id}
                type="button"
                onClick={() => handleAnswerSelect(option.option_id)}
                disabled={isLocked}
                className={`rounded-[22px] border px-5 py-4 text-left ${
                  active
                    ? "border-signal/35 bg-signal-soft text-white"
                    : "border-line bg-white/[0.02] text-muted hover:border-signal/20 hover:text-white"
                } ${isLocked ? "cursor-not-allowed opacity-65" : ""}`}
              >
                <span className="mr-3 inline-flex size-7 items-center justify-center rounded-full border border-current/20 font-mono text-xs">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                {option.text}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <button
            type="button"
            onClick={() => navigateToQuestion(currentQuestionIndex - 1)}
            disabled={isLocked || currentQuestionIndex === 0}
            className="rounded-full border border-line bg-white/[0.02] px-5 py-3 text-sm font-semibold text-white/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void submitAttempt(false)}
              disabled={submitState === "submitting"}
              className="rounded-full border border-warning/25 bg-warning/15 px-5 py-3 text-sm font-semibold text-warning disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitState === "submitting" ? "Submitting..." : "Submit quiz"}
            </button>
            <button
              type="button"
              onClick={() => navigateToQuestion(currentQuestionIndex + 1)}
              disabled={isLocked || currentQuestionIndex === totalQuestions - 1}
              className="rounded-full bg-signal px-5 py-3 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Next question
            </button>
          </div>
        </div>
      </article>

      <aside className="grid gap-6 lg:sticky lg:top-6 lg:self-start">
        <section className="surface rounded-[30px] p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[20px] border border-line bg-white/[0.02] p-4">
              <p className="text-sm text-muted">Time remaining</p>
              <p
                className={`mt-2 font-display text-4xl ${
                  isTimeWarning ? "text-amber-300" : "text-white"
                }`}
              >
                {formatRemainingTime(remainingSeconds)}
              </p>
              <p className="mt-2 text-sm text-white/70">
                {isTimeWarning ? "Last minute. The quiz will auto-submit at zero." : "Backend timer is authoritative."}
              </p>
            </div>
            <div className="rounded-[20px] border border-line bg-white/[0.02] p-4">
              <p className="text-sm text-muted">Progress</p>
              <p className="mt-2 font-display text-4xl">
                {answeredCount} / {totalQuestions}
              </p>
              <p className="mt-2 text-sm text-white/70">
                {flaggedQuestionIds.length} flagged for review
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-[20px] border border-line bg-white/[0.02] p-4">
            <p className="text-sm text-muted">Question set</p>
            <p className="mt-2 font-mono text-sm text-white/80">{attempt.attempt_id}</p>
          </div>
        </section>

        <section className="surface rounded-[30px] p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted">Question palette</p>
            <span className="text-sm text-white/70">Resume-safe</span>
          </div>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
            {quiz.response.question_set.questions.map((question, index) => {
              const status = getQuestionStatus(
                question.question_id,
                answers,
                flaggedQuestionIds,
                currentQuestion.question_id,
              );

              return (
                <button
                  key={question.question_id}
                  type="button"
                  onClick={() => navigateToQuestion(index)}
                  disabled={submitState === "submitting"}
                  className={`rounded-[18px] border px-3 py-3 text-sm font-semibold ${
                    status === "current"
                      ? "border-signal/35 bg-signal-soft text-white"
                      : status === "answered"
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                        : status === "flagged"
                          ? "border-warning/30 bg-warning/15 text-warning"
                          : "border-line bg-white/[0.02] text-white/80"
                  } ${submitState === "submitting" ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5"}`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </section>

        <section className="surface rounded-[30px] p-6">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-warning">
            Instructions
          </p>
          <p className="mt-4 text-sm leading-7 text-white/88 md:text-base">
            {quiz.response.question_set.instructions}
          </p>
          {error ? <p className="mt-4 text-sm text-amber-300">{error}</p> : null}
        </section>
      </aside>
    </section>
  );
}

type ResolvedQuizState = {
  quiz: StoredGeneratedQuiz;
  attempt: AttemptSession;
  answers: Record<string, string>;
  flaggedQuestionIds: string[];
  timelineEvents: TimelineEvent[];
  currentQuestionIndex: number;
  currentQuestionEnteredAt: string | null;
  redirectToReport?: boolean;
};

function readStoredQuiz() {
  const rawValue = sessionStorage.getItem(EXAM_COACH_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredGeneratedQuiz;
  } catch {
    sessionStorage.removeItem(EXAM_COACH_STORAGE_KEY);
    return null;
  }
}

function persistStoredQuiz(quiz: StoredGeneratedQuiz) {
  sessionStorage.setItem(EXAM_COACH_STORAGE_KEY, JSON.stringify(quiz));
}

function readActiveAttemptId() {
  return localStorage.getItem(EXAM_COACH_ACTIVE_ATTEMPT_KEY);
}

function persistActiveAttemptId(attemptId: string) {
  localStorage.setItem(EXAM_COACH_ACTIVE_ATTEMPT_KEY, attemptId);
}

function clearActiveAttemptId() {
  localStorage.removeItem(EXAM_COACH_ACTIVE_ATTEMPT_KEY);
}

function readAttemptDraft(attemptId: string) {
  const rawValue = localStorage.getItem(buildAttemptDraftKey(attemptId));
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as StoredAttemptDraft;
  } catch {
    localStorage.removeItem(buildAttemptDraftKey(attemptId));
    return null;
  }
}

function persistDraft(input: {
  attemptId: string;
  topicId: string | null;
  answers: Record<string, string>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  timelineEvents: TimelineEvent[];
  activeQuestionId: string | null;
  activeQuestionEnteredAt: string | null;
}) {
  const payload: StoredAttemptDraft = {
    attemptId: input.attemptId,
    topicId: input.topicId,
    answers: input.answers,
    flaggedQuestionIds: input.flaggedQuestionIds,
    currentQuestionIndex: input.currentQuestionIndex,
    timelineEvents: input.timelineEvents,
    activeQuestionId: input.activeQuestionId,
    activeQuestionEnteredAt: input.activeQuestionEnteredAt,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(buildAttemptDraftKey(input.attemptId), JSON.stringify(payload));
}

function clearAttemptDraft(attemptId: string) {
  localStorage.removeItem(buildAttemptDraftKey(attemptId));
}

function buildStoredQuizFromAttemptState(
  attemptState: AttemptStateResponse,
  fallbackTopicId: string,
): StoredGeneratedQuiz {
  const resolvedTopicId = fallbackTopicId;
  return {
    topic: {
      topic_id: resolvedTopicId,
      topic_name: resolvedTopicId.replaceAll("-", " "),
      aliases: [],
      is_ingested: true,
      selected_files: [],
      status: "pilot_ready",
    },
    response: {
      blueprint: {
        blueprint_id: attemptState.question_set?.blueprint_id ?? "blueprint-restored",
        mode: (attemptState.question_set?.meta.mode as "chapter_quiz" | "full_physics_mix") ?? "chapter_quiz",
        subject: "JEE Physics",
        selected_topic_ids: [resolvedTopicId],
        total_questions: attemptState.question_set?.questions.length ?? 0,
        time_limit_minutes: Math.max(1, Math.round(attemptState.attempt.duration_seconds / 60)),
        question_type: "mcq",
        created_at: attemptState.attempt.started_at,
      },
      question_set:
        attemptState.question_set ?? {
          question_set_id: attemptState.attempt.question_set_id,
          blueprint_id: "blueprint-restored",
          instructions: "",
          questions: [],
          meta: {
            mode: "chapter_quiz",
            total_questions: 0,
            ordering_rule: "hard_to_easy",
            generation_mode: "fallback",
          },
        },
    },
    attempt: attemptState.attempt,
  };
}

function reconcileTimelineOnRestore(draft: StoredAttemptDraft) {
  const now = new Date().toISOString();
  if (!draft.activeQuestionId || !draft.activeQuestionEnteredAt) {
    return {
      timelineEvents: draft.timelineEvents,
      currentQuestionEnteredAt: null,
    };
  }

  const timelineEvents = [...draft.timelineEvents];
  const lastEvent = timelineEvents.at(-1);
  if (lastEvent?.type !== "question_left" && lastEvent?.type !== "submitted" && lastEvent?.type !== "auto_submitted") {
    timelineEvents.push({
      type: "question_left",
      at: draft.savedAt,
      question_id: draft.activeQuestionId,
    });
  }
  timelineEvents.push({
    type: "question_entered",
    at: now,
    question_id: draft.activeQuestionId,
  });

  return {
    timelineEvents,
    currentQuestionEnteredAt: now,
  };
}

function clampQuestionIndex(index: number, questionCount: number) {
  if (questionCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), questionCount - 1);
}

function readErrorDetail(
  payload:
    | GenerateResponse
    | StartAttemptResponse
    | AttemptStateResponse
    | { detail?: string },
  fallback: string,
) {
  if ("detail" in payload && payload.detail) {
    return payload.detail;
  }

  return fallback;
}
