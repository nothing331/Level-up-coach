"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { entryJourney } from "@/lib/demo-data";
import {
  buildChapterQuizRequest,
  buildStartAttemptRequest,
  EXAM_COACH_STORAGE_KEY,
  StartAttemptResponse,
  findTopicMatch,
  GenerateResponse,
  getAvailableTopics,
  getFilteredTopics,
  StoredGeneratedQuiz,
  TopicApiItem,
  TopicsResponse,
} from "@/lib/exam-coach-api";

export function EntrySurface() {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicApiItem[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<TopicApiItem | null>(null);
  const [query, setQuery] = useState("");
  const [isLoadingTopics, setIsLoadingTopics] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadTopics() {
      setIsLoadingTopics(true);
      setError(null);

      try {
        const response = await fetch("/api/topics", {
          headers: {
            Accept: "application/json",
          },
        });

        const payload = (await response.json()) as TopicsResponse | { detail?: string };

        if (!response.ok) {
          throw new Error(readErrorDetail(payload, "Unable to load available topics."));
        }

        const availableTopics = getAvailableTopics((payload as TopicsResponse).topics);
        const initialTopic = availableTopics[0] ?? null;

        if (!isActive) {
          return;
        }

        setTopics(availableTopics);
        setSelectedTopic(initialTopic);
        setQuery(initialTopic?.topic_name ?? "");
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        const message =
          loadError instanceof Error ? loadError.message : "Unable to load available topics.";
        setError(message);
      } finally {
        if (isActive) {
          setIsLoadingTopics(false);
        }
      }
    }

    void loadTopics();

    return () => {
      isActive = false;
    };
  }, []);

  const filteredTopics = useMemo(() => getFilteredTopics(topics, query).slice(0, 6), [topics, query]);
  const suggestedTopics = useMemo(() => topics.slice(0, 5), [topics]);

  const nextStep = useMemo(() => {
    if (!selectedTopic) {
      return "Pick one ingested topic to generate a quiz and move into the test page.";
    }

    return `${selectedTopic.topic_name} selected. Next: generate a 9-question quiz and open the test page.`;
  }, [selectedTopic]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedTopic) {
      setError("Choose one ingested topic before generating the quiz.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/exam-coach/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildChapterQuizRequest(selectedTopic.topic_id)),
      });

      const payload = (await response.json()) as GenerateResponse | { detail?: string };

      if (!response.ok) {
        throw new Error(readErrorDetail(payload, "Unable to generate the quiz."));
      }

      const generatedQuiz = payload as GenerateResponse;

      const attemptResponse = await fetch("/api/exam-coach/start-attempt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildStartAttemptRequest(generatedQuiz.question_set.question_set_id)),
      });

      const attemptPayload = (await attemptResponse.json()) as
        | StartAttemptResponse
        | { detail?: string };

      if (!attemptResponse.ok) {
        throw new Error(readErrorDetail(attemptPayload, "Unable to start the timed attempt."));
      }

      const storedQuiz: StoredGeneratedQuiz = {
        topic: selectedTopic,
        response: generatedQuiz,
        attempt: (attemptPayload as StartAttemptResponse).attempt,
      };

      sessionStorage.setItem(EXAM_COACH_STORAGE_KEY, JSON.stringify(storedQuiz));
      router.push(
        `/test?topic=${selectedTopic.topic_id}&attempt=${(attemptPayload as StartAttemptResponse).attempt.attempt_id}`,
      );
    } catch (generateError) {
      const message =
        generateError instanceof Error ? generateError.message : "Unable to generate the quiz.";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="page-reveal flex min-h-[calc(100vh-8.5rem)] items-start pt-8 md:pt-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <div className="mb-8 max-w-4xl">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.34em] text-signal">
            AI exam coach
          </p>
          <h2 className="font-display text-4xl leading-none md:text-6xl lg:text-7xl">
            Start with one chapter.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted md:text-base">
            Pick from ingested Physics topics, generate the quiz, and move straight into
            questions.
          </p>
        </div>

        <form className="w-full" onSubmit={handleSubmit}>
          <label htmlFor="study-query" className="sr-only">
            Search ingested topics
          </label>
          <div className="surface relative mx-auto flex w-full max-w-4xl flex-col gap-3 rounded-[30px] p-3 shadow-[0_26px_70px_rgba(0,0,0,0.3)] md:flex-row md:items-center md:rounded-[32px]">
            <div className="pointer-events-none absolute inset-0 rounded-[30px] bg-[radial-gradient(circle_at_top,rgba(105,227,255,0.1),transparent_52%)] md:rounded-[32px]" />
            <input
              id="study-query"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                const nextSelection = findTopicMatch(topics, nextQuery);

                setQuery(nextQuery);
                setSelectedTopic(nextSelection);
                setError(null);
              }}
              placeholder={isLoadingTopics ? "Loading topics..." : "Search an ingested topic"}
              disabled={isLoadingTopics || isGenerating}
              className="relative min-h-16 flex-1 rounded-[22px] border border-transparent bg-white/[0.03] px-5 text-base text-white outline-none placeholder:text-muted focus:border-signal/30 disabled:cursor-not-allowed disabled:opacity-60 md:px-6 md:text-xl"
            />
            <button
              type="submit"
              disabled={isLoadingTopics || isGenerating || !selectedTopic}
              className="relative inline-flex min-h-16 items-center justify-center rounded-[22px] bg-signal px-6 text-base font-semibold text-slate-950 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 md:px-8"
            >
              {isGenerating ? "Generating..." : "Generate quiz"}
            </button>
          </div>
        </form>

        <div className="mt-6 w-full max-w-4xl rounded-[24px] border border-line bg-white/[0.02] p-4 text-left">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-signal">
              Suggested chapter quizzes
            </p>
            <p className="text-sm text-muted">
              First 5 ingested topics from the API
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2.5">
            {suggestedTopics.map((topic) => {
              const active = selectedTopic?.topic_id === topic.topic_id;

              return (
                <button
                  key={topic.topic_id}
                  type="button"
                  onClick={() => {
                    setSelectedTopic(topic);
                    setQuery(topic.topic_name);
                    setError(null);
                  }}
                  className={`rounded-full border px-3.5 py-2.5 text-sm font-semibold ${
                    active
                      ? "border-signal/30 bg-signal-soft text-signal"
                      : "border-line bg-white/[0.02] text-white hover:-translate-y-0.5 hover:border-signal/20"
                  }`}
                >
                  {topic.topic_name}
                </button>
              );
            })}
          </div>
        </div>

        {query && filteredTopics.length > 0 && !suggestedTopics.some((topic) => topic.topic_id === filteredTopics[0]?.topic_id) ? (
          <div className="mt-3 flex max-w-4xl flex-wrap justify-center gap-2.5">
            {filteredTopics.slice(0, 5).map((topic) => (
              <button
                key={`${topic.topic_id}-search`}
                type="button"
                onClick={() => {
                  setSelectedTopic(topic);
                  setQuery(topic.topic_name);
                  setError(null);
                }}
                className="rounded-full border border-line bg-white/[0.02] px-3.5 py-2.5 text-sm font-semibold text-white hover:-translate-y-0.5 hover:border-signal/20"
              >
                {topic.topic_name}
              </button>
            ))}
          </div>
        ) : null}

        <p className="mt-4 text-sm leading-6 text-white/88">{nextStep}</p>
        {error ? <p className="mt-3 text-sm text-amber-300">{error}</p> : null}
        {!isLoadingTopics && topics.length === 0 ? (
          <p className="mt-3 text-sm text-amber-300">
            No ingested topics are available yet. Start the backend ingestion flow first.
          </p>
        ) : null}

        <div className="mt-10 grid w-full max-w-6xl grid-cols-1 gap-4 border-t border-line pt-5 md:grid-cols-4 md:gap-0">
          {entryJourney.map((item, index) => (
            <div
              key={item.title}
              className={`flex items-start gap-4 px-0 text-left md:px-5 ${
                index < entryJourney.length - 1 ? "md:border-r md:border-line" : ""
              }`}
            >
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-signal/20 bg-signal-soft font-mono text-xs text-signal">
                0{index + 1}
              </span>
              <div>
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{item.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function readErrorDetail(
  payload: TopicsResponse | GenerateResponse | StartAttemptResponse | { detail?: string },
  fallback: string,
) {
  if ("detail" in payload && payload.detail) {
    return payload.detail;
  }

  return fallback;
}
