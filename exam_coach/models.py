"""Pydantic models for the Exam Coach backend."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


DifficultyLabel = Literal["easy", "medium", "hard"]
ExamMode = Literal["chapter_quiz", "full_physics_mix"]
QuestionType = Literal["mcq"]
AttemptStatus = Literal["active", "submitted", "expired"]
TimelineEventType = Literal[
    "question_entered",
    "answer_selected",
    "question_left",
    "flag_toggled",
    "submitted",
    "auto_submitted",
]
BehaviorSignalCode = Literal[
    "overinvests_in_hard_questions",
    "slow_between_questions",
    "hesitates_before_committing",
    "accuracy_drops_late",
    "revisits_without_improvement",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


class TopicCatalogItem(BaseModel):
    topic_id: str
    topic_name: str
    aliases: list[str] = Field(default_factory=list)
    source_files: list[str] = Field(default_factory=list)


class TopicConfigItem(BaseModel):
    topic_id: str
    topic_name: str
    aliases: list[str] = Field(default_factory=list)
    source_files: list[str] = Field(default_factory=list)
    selected_files: list[str] = Field(default_factory=list)
    status: Literal["pilot_ready", "queued", "archived"] = "queued"


class TopicApiItem(BaseModel):
    topic_id: str
    topic_name: str
    aliases: list[str] = Field(default_factory=list)
    status: Literal["pilot_ready", "queued", "archived"]
    is_ingested: bool
    selected_files: list[str] = Field(default_factory=list)


class TopicsResponse(BaseModel):
    topics: list[TopicApiItem]


class QuestionBankRecord(BaseModel):
    question_id: str
    topic_id: str
    topic_name: str
    source_file: str
    source_year: int | None = None
    source_session: str | None = None
    source_question_number: int
    stem: str
    options: list[str] = Field(default_factory=list)
    answer_key: str
    solution_text: str
    exam_type: str = "JEE Main Physics"
    difficulty_label: DifficultyLabel
    difficulty_score: float
    difficulty_reasons: list[str] = Field(default_factory=list)
    confidence: float = 0.5
    embedding_text: str


class DifficultyPlanItem(BaseModel):
    difficulty_label: DifficultyLabel
    question_count: int


class RetrievalCriteria(BaseModel):
    topic_ids: list[str] = Field(default_factory=list)
    difficulty_labels: list[DifficultyLabel] = Field(default_factory=list)
    source_years: list[int] = Field(default_factory=list)
    max_candidates_per_slot: int = 8


class ExamCoachInput(BaseModel):
    mode: ExamMode
    subject: str = "JEE Physics"
    selected_topic_ids: list[str] = Field(default_factory=list)
    total_questions: int | None = None
    time_limit_minutes: int | None = None
    question_type: QuestionType = "mcq"
    difficulty_preference: DifficultyLabel | Literal["balanced"] = "balanced"
    student_level: str | None = None


class TestBlueprint(BaseModel):
    blueprint_id: str = Field(default_factory=lambda: new_id("blueprint"))
    mode: ExamMode
    subject: str
    selected_topic_ids: list[str]
    difficulty_plan: list[DifficultyPlanItem]
    ordering_rule: str
    total_questions: int
    time_limit_minutes: int
    question_type: QuestionType
    retrieval_criteria: RetrievalCriteria
    created_at: datetime = Field(default_factory=utc_now)


class QuestionOption(BaseModel):
    option_id: str
    text: str


class GeneratedQuestion(BaseModel):
    question_id: str
    topic_id: str
    stem: str
    options: list[QuestionOption]
    difficulty_label: DifficultyLabel
    difficulty_score: float


class InternalQuestionRecord(BaseModel):
    question_id: str
    topic_id: str
    stem: str
    options: list[QuestionOption]
    difficulty_label: DifficultyLabel
    difficulty_score: float
    correct_option_id: str
    explanation: str
    source_question_refs: list[str] = Field(default_factory=list)
    retrieval_trace: list[str] = Field(default_factory=list)


class QuestionSet(BaseModel):
    question_set_id: str = Field(default_factory=lambda: new_id("qset"))
    blueprint_id: str
    instructions: str
    questions: list[GeneratedQuestion]
    meta: dict[str, str | int | float]


class QuestionSetInternal(BaseModel):
    question_set_id: str
    blueprint_id: str
    instructions: str
    questions: list[InternalQuestionRecord]
    meta: dict[str, str | int | float]

    def to_public(self) -> QuestionSet:
        return QuestionSet(
            question_set_id=self.question_set_id,
            blueprint_id=self.blueprint_id,
            instructions=self.instructions,
            questions=[
                GeneratedQuestion(
                    question_id=item.question_id,
                    topic_id=item.topic_id,
                    stem=item.stem,
                    options=item.options,
                    difficulty_label=item.difficulty_label,
                    difficulty_score=item.difficulty_score,
                )
                for item in self.questions
            ],
            meta=self.meta,
        )


class StudentAnswer(BaseModel):
    question_id: str
    selected_option_id: str | None = None


class AttemptTimelineEvent(BaseModel):
    type: TimelineEventType
    at: datetime
    question_id: str | None = None
    selected_option_id: str | None = None
    flagged: bool | None = None


class AttemptSession(BaseModel):
    attempt_id: str = Field(default_factory=lambda: new_id("attempt"))
    question_set_id: str
    status: AttemptStatus = "active"
    started_at: datetime = Field(default_factory=utc_now)
    deadline_at: datetime
    submitted_at: datetime | None = None
    duration_seconds: int
    auto_submitted: bool = False


class StartAttemptRequest(BaseModel):
    question_set_id: str


class StartAttemptResponse(BaseModel):
    attempt: AttemptSession


class ScoreSummary(BaseModel):
    attempted: int
    correct: int
    incorrect: int
    unattempted: int
    percentage: float


class TopicPerformance(BaseModel):
    topic_id: str
    accuracy: float
    attempted: int
    weakness_level: Literal["low", "medium", "high"]
    average_time_seconds: float = 0.0


class DifficultyPerformance(BaseModel):
    difficulty_label: DifficultyLabel
    accuracy: float
    attempted: int
    average_time_seconds: float = 0.0


class QuestionTimingSummary(BaseModel):
    question_id: str
    time_spent_seconds: float = 0.0
    visited_count: int = 0
    answer_changed_count: int = 0
    time_to_first_answer_seconds: float | None = None
    average_gap_before_visit_seconds: float = 0.0
    max_gap_before_visit_seconds: float = 0.0


class TimingSummary(BaseModel):
    total_duration_seconds: float = 0.0
    average_time_per_question_seconds: float = 0.0
    average_transition_delay_seconds: float = 0.0
    total_transition_delay_seconds: float = 0.0
    idle_transition_count: int = 0
    slowest_question_ids: list[str] = Field(default_factory=list)
    first_half_accuracy: float = 0.0
    second_half_accuracy: float = 0.0
    late_stage_accuracy_drop: bool = False
    average_time_on_correct_seconds: float = 0.0
    average_time_on_wrong_seconds: float = 0.0
    question_timings: list[QuestionTimingSummary] = Field(default_factory=list)


class BehaviorSignal(BaseModel):
    code: BehaviorSignalCode
    label: str
    detail: str
    evidence: dict[str, str | int | float | bool] = Field(default_factory=dict)


class QuestionReview(BaseModel):
    question_id: str
    selected_option_id: str | None = None
    correct_option_id: str
    result: Literal["correct", "incorrect", "unattempted"]
    explanation: str
    time_spent_seconds: float = 0.0
    visited_count: int = 0
    answer_changed_count: int = 0


class CoachingReport(BaseModel):
    strengths: list[str] = Field(default_factory=list)
    weak_topics: list[str] = Field(default_factory=list)
    next_actions: list[str] = Field(default_factory=list)
    recommended_practice_plan: list[str] = Field(default_factory=list)


class PerformanceReport(BaseModel):
    report_id: str = Field(default_factory=lambda: new_id("report"))
    question_set_id: str
    attempt_id: str | None = None
    auto_submitted: bool = False
    submitted_at: datetime | None = None
    score_summary: ScoreSummary
    topic_performance: list[TopicPerformance]
    difficulty_performance: list[DifficultyPerformance]
    question_review: list[QuestionReview]
    timing_summary: TimingSummary = Field(default_factory=TimingSummary)
    behavior_signals: list[BehaviorSignal] = Field(default_factory=list)
    coaching: CoachingReport
    generated_at: datetime = Field(default_factory=utc_now)


class GenerateResponse(BaseModel):
    blueprint: TestBlueprint
    question_set: QuestionSet


class EvaluateRequest(BaseModel):
    question_set_id: str
    attempt_id: str | None = None
    submitted_at: datetime | None = None
    auto_submitted: bool = False
    student_answers: list[StudentAnswer]
    timeline_events: list[AttemptTimelineEvent] = Field(default_factory=list)


class EvaluateResponse(BaseModel):
    performance_report: PerformanceReport
    attempt: AttemptSession | None = None


class AttemptStateResponse(BaseModel):
    attempt: AttemptSession
    question_set: QuestionSet | None = None
    performance_report: PerformanceReport | None = None


class IngestionSummary(BaseModel):
    topic_count: int
    question_count: int
    indexed_count: int
    source_files: list[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=utc_now)


class ParsedDocument(BaseModel):
    topic_id: str
    topic_name: str
    source_file: str
    parser: Literal["llamaparse"]
    parsed_at: datetime = Field(default_factory=utc_now)
    content_format: Literal["markdown", "json"]
    page_count: int | None = None
    content: str
    metadata: dict[str, str | int | float | bool | list | dict | None] = Field(default_factory=dict)


class ParseCacheSummary(BaseModel):
    parsed_count: int
    skipped_count: int
    failed_count: int
    source_files: list[str] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=utc_now)


class TopicFilter(BaseModel):
    topic_ids: list[str] = Field(default_factory=list)
    difficulty_labels: list[DifficultyLabel] = Field(default_factory=list)
    limit: int = 50

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, value: int) -> int:
        return max(1, min(value, 500))
