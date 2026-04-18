export type Difficulty = "easy" | "medium" | "hard";

export interface TopicWeight {
  name: string;
  weight: number;
}

export interface CurriculumOutput {
  subject: string;
  examType: string;
  topics: TopicWeight[];
  focusArea?: string;
  notes?: string;
  sourceConfidence?: number;
}

export interface TopicDistributionItem {
  topic: string;
  count: number;
}

export interface TestBlueprint {
  examType: string;
  subject: string;
  questionCount: number;
  durationMinutes: number;
  difficultyMix: Record<Difficulty, number>;
  topicDistribution: TopicDistributionItem[];
  patternNotes?: string[];
}

export interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  difficulty: Difficulty;
  expectedTimeSec: number;
}

export interface QuestionSet {
  questions: Question[];
}

export type AttemptEventType =
  | "question_entered"
  | "answer_selected"
  | "question_left"
  | "submitted";

export interface AttemptEvent {
  type: AttemptEventType;
  atMs: number;
  questionId?: string;
  selectedAnswer?: string;
  transitionReason?: "next" | "previous" | "navigator" | "submit" | "restore";
}

export interface QuestionVisitWindow {
  enteredAtMs: number;
  leftAtMs: number;
  activeTimeSec: number;
  gapBeforeEnterSec: number;
}

export interface AttemptAnswer {
  questionId: string;
  selectedAnswer: string | null;
  timeSpentSec: number;
  visitedCount: number;
  answerChangedCount: number;
  timeToFirstAnswerSec: number | null;
  timeAfterLastAnswerSec: number | null;
  averageGapBeforeVisitSec: number;
  maxGapBeforeVisitSec: number;
  visitWindows: QuestionVisitWindow[];
}

export interface AttemptSubmission {
  attemptId: string;
  startedAtMs: number;
  submittedAtMs: number;
  questionOrder: string[];
  answers: AttemptAnswer[];
  timeline: AttemptEvent[];
}

export interface TopicBreakdown {
  topic: string;
  attempted: number;
  correct: number;
  accuracy: number;
  averageTimeSec: number;
  averageGapBeforeVisitSec: number;
}

export interface DifficultyBreakdown {
  difficulty: Difficulty;
  attempted: number;
  correct: number;
  accuracy: number;
  averageTimeSec: number;
  expectedTimeSec: number;
}

export type BehaviorFlagCode =
  | "overinvests_in_hard_questions"
  | "slow_between_questions"
  | "hesitates_before_committing"
  | "accuracy_drops_late"
  | "revisits_without_improvement"
  | "rushes_easy_questions"
  | "strong_in_topic"
  | "weak_in_topic";

export interface BehaviorSignal {
  code: BehaviorFlagCode;
  label: string;
  detail: string;
  evidence: Record<string, number | string | boolean>;
}

export interface QuestionDiagnostic {
  questionId: string;
  index: number;
  topic: string;
  difficulty: Difficulty;
  selectedAnswer: string | null;
  correctAnswer: string;
  isAttempted: boolean;
  isCorrect: boolean;
  timeSpentSec: number;
  expectedTimeSec: number;
  overtimeSec: number;
  visitedCount: number;
  answerChangedCount: number;
  timeToFirstAnswerSec: number | null;
  averageGapBeforeVisitSec: number;
  maxGapBeforeVisitSec: number;
}

export interface TimeMetrics {
  averageTimePerQuestionSec: number;
  averageTransitionDelaySec: number;
  totalTransitionDelaySec: number;
  idleTransitionCount: number;
  slowestQuestionId: string | null;
  fastestCorrectQuestionId: string | null;
  lateStageAccuracyDrop: boolean;
  firstHalfAccuracy: number;
  secondHalfAccuracy: number;
  averageTimeOnCorrectSec: number;
  averageTimeOnWrongSec: number;
}

export interface EvaluationOutput {
  score: number;
  totalQuestions: number;
  attempted: number;
  unattempted: number;
  accuracy: number;
  topicBreakdown: TopicBreakdown[];
  difficultyBreakdown: DifficultyBreakdown[];
  timeMetrics: TimeMetrics;
  behaviorFlags: BehaviorFlagCode[];
  behaviorSignals: BehaviorSignal[];
  questionDiagnostics: QuestionDiagnostic[];
}

export interface CoachReport {
  headline: string;
  strengths: string[];
  weaknesses: string[];
  timeStrategy: string[];
  actionPlan: string[];
  motivation: string;
}
