export const EXAM_COACH_STORAGE_KEY = "exam-coach:generated-quiz";
export const EXAM_COACH_ACTIVE_ATTEMPT_KEY = "exam-coach:active-attempt";

export type TopicApiItem = {
  topic_id: string;
  topic_name: string;
  aliases?: string[];
  status: "pilot_ready" | "queued" | "archived" | string;
  is_ingested: boolean;
  selected_files: string[];
};

export type TopicsResponse = {
  topics: TopicApiItem[];
};

export type GenerateQuizRequest = {
  mode: "chapter_quiz" | "full_physics_mix";
  subject: "JEE Physics";
  selected_topic_ids?: string[];
  total_questions: number;
  time_limit_minutes: number;
  question_type: "mcq";
  difficulty_preference: "balanced";
  student_level: string;
};

export type QuestionOption = {
  option_id: string;
  text: string;
};

export type GeneratedQuestion = {
  question_id: string;
  topic_id: string;
  stem: string;
  options: QuestionOption[];
  difficulty_label: string;
  difficulty_score: number;
};

export type QuestionSet = {
  question_set_id: string;
  blueprint_id: string;
  instructions: string;
  questions: GeneratedQuestion[];
  meta: {
    mode: string;
    total_questions: number;
    ordering_rule: string;
    generation_mode: string;
  };
};

export type GenerateResponse = {
  blueprint: {
    blueprint_id: string;
    mode: "chapter_quiz" | "full_physics_mix";
    subject: string;
    selected_topic_ids: string[];
    total_questions: number;
    time_limit_minutes: number;
    question_type: string;
    created_at: string;
  };
  question_set: QuestionSet;
};

export type AttemptSession = {
  attempt_id: string;
  question_set_id: string;
  status: "active" | "submitted" | "expired";
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  duration_seconds: number;
  auto_submitted: boolean;
};

export type TimelineEvent = {
  type:
    | "question_entered"
    | "answer_selected"
    | "question_left"
    | "flag_toggled"
    | "submitted"
    | "auto_submitted";
  at: string;
  question_id?: string | null;
  selected_option_id?: string | null;
  flagged?: boolean | null;
};

export type StartAttemptRequest = {
  question_set_id: string;
};

export type StartAttemptResponse = {
  attempt: AttemptSession;
};

export type QuestionTimingSummary = {
  question_id: string;
  time_spent_seconds: number;
  visited_count: number;
  answer_changed_count: number;
  time_to_first_answer_seconds: number | null;
  average_gap_before_visit_seconds: number;
  max_gap_before_visit_seconds: number;
};

export type TimingSummary = {
  total_duration_seconds: number;
  average_time_per_question_seconds: number;
  average_transition_delay_seconds: number;
  total_transition_delay_seconds: number;
  idle_transition_count: number;
  slowest_question_ids: string[];
  first_half_accuracy: number;
  second_half_accuracy: number;
  late_stage_accuracy_drop: boolean;
  average_time_on_correct_seconds: number;
  average_time_on_wrong_seconds: number;
  question_timings: QuestionTimingSummary[];
};

export type TopicPerformance = {
  topic_id: string;
  accuracy: number;
  attempted: number;
  weakness_level: "low" | "medium" | "high";
  average_time_seconds: number;
};

export type DifficultyPerformance = {
  difficulty_label: "easy" | "medium" | "hard";
  accuracy: number;
  attempted: number;
  average_time_seconds: number;
};

export type BehaviorSignal = {
  code: string;
  label: string;
  detail: string;
  evidence: Record<string, string | number | boolean>;
};

export type QuestionReview = {
  question_id: string;
  selected_option_id: string | null;
  correct_option_id: string;
  result: "correct" | "incorrect" | "unattempted";
  explanation: string;
  time_spent_seconds: number;
  visited_count: number;
  answer_changed_count: number;
};

export type PerformanceReport = {
  report_id: string;
  question_set_id: string;
  attempt_id: string | null;
  auto_submitted: boolean;
  submitted_at: string | null;
  score_summary: {
    attempted: number;
    correct: number;
    incorrect: number;
    unattempted: number;
    percentage: number;
  };
  topic_performance: TopicPerformance[];
  difficulty_performance: DifficultyPerformance[];
  question_review: QuestionReview[];
  timing_summary: TimingSummary;
  behavior_signals: BehaviorSignal[];
  coaching: {
    strengths: string[];
    weak_topics: string[];
    next_actions: string[];
    recommended_practice_plan: string[];
  };
  generated_at: string;
};

export type EvaluateAttemptRequest = {
  question_set_id: string;
  attempt_id: string;
  submitted_at: string;
  auto_submitted: boolean;
  student_answers: {
    question_id: string;
    selected_option_id: string | null;
  }[];
  timeline_events: TimelineEvent[];
};

export type EvaluateResponse = {
  performance_report: PerformanceReport;
  attempt: AttemptSession | null;
};

export type AttemptStateResponse = {
  attempt: AttemptSession;
  question_set: QuestionSet | null;
  performance_report: PerformanceReport | null;
};

export type StoredGeneratedQuiz = {
  topic: TopicApiItem;
  response: GenerateResponse;
  attempt?: AttemptSession;
};

export type StoredAttemptDraft = {
  attemptId: string;
  topicId: string | null;
  answers: Record<string, string>;
  flaggedQuestionIds: string[];
  currentQuestionIndex: number;
  timelineEvents: TimelineEvent[];
  activeQuestionId: string | null;
  activeQuestionEnteredAt: string | null;
  savedAt: string;
};

export function getAvailableTopics(topics: TopicApiItem[]) {
  return topics
    .filter((topic) => topic.is_ingested && topic.status !== "archived")
    .sort((left, right) => left.topic_name.localeCompare(right.topic_name));
}

export function buildChapterQuizRequest(topicId: string): GenerateQuizRequest {
  return {
    mode: "chapter_quiz",
    subject: "JEE Physics",
    selected_topic_ids: [topicId],
    total_questions: 9,
    time_limit_minutes: 20,
    question_type: "mcq",
    difficulty_preference: "balanced",
    student_level: "intermediate",
  };
}

export function buildStartAttemptRequest(questionSetId: string): StartAttemptRequest {
  return { question_set_id: questionSetId };
}

export function buildAttemptDraftKey(attemptId: string) {
  return `${EXAM_COACH_ACTIVE_ATTEMPT_KEY}:${attemptId}`;
}

export function buildEvaluateAttemptRequest(
  questionSet: QuestionSet,
  attemptId: string,
  answers: Record<string, string>,
  timelineEvents: TimelineEvent[],
  autoSubmitted: boolean,
  submittedAt: string,
): EvaluateAttemptRequest {
  return {
    question_set_id: questionSet.question_set_id,
    attempt_id: attemptId,
    submitted_at: submittedAt,
    auto_submitted: autoSubmitted,
    student_answers: questionSet.questions.map((question) => ({
      question_id: question.question_id,
      selected_option_id: answers[question.question_id] ?? null,
    })),
    timeline_events: timelineEvents,
  };
}

export function normalizeTopicQuery(value: string) {
  return value.trim().toLowerCase();
}

export function findTopicMatch(topics: TopicApiItem[], query: string) {
  const normalizedQuery = normalizeTopicQuery(query);
  if (!normalizedQuery) {
    return null;
  }

  return (
    topics.find((topic) => normalizeTopicQuery(topic.topic_name) === normalizedQuery) ??
    topics.find((topic) =>
      topic.aliases?.some((alias) => normalizeTopicQuery(alias) === normalizedQuery),
    ) ??
    null
  );
}

export function getFilteredTopics(topics: TopicApiItem[], query: string) {
  const normalizedQuery = normalizeTopicQuery(query);
  if (!normalizedQuery) {
    return topics;
  }

  return topics.filter((topic) => {
    const haystack = [topic.topic_name, ...(topic.aliases ?? [])].map(normalizeTopicQuery);
    return haystack.some((value) => value.includes(normalizedQuery));
  });
}

export function formatRemainingTime(totalSeconds: number) {
  const clampedSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(clampedSeconds / 60);
  const seconds = clampedSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getQuestionStatus(
  questionId: string,
  answers: Record<string, string>,
  flaggedQuestionIds: string[],
  currentQuestionId?: string,
) {
  if (currentQuestionId === questionId) {
    return "current";
  }
  if (answers[questionId]) {
    return "answered";
  }
  if (flaggedQuestionIds.includes(questionId)) {
    return "flagged";
  }
  return "pending";
}
