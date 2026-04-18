"""Main orchestration entrypoint for Exam Coach."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from .ingestion import IngestionService
from .models import (
    AttemptSession,
    AttemptStateResponse,
    EvaluateRequest,
    EvaluateResponse,
    ExamCoachInput,
    GenerateResponse,
    PerformanceReport,
    StartAttemptResponse,
    StudentAnswer,
    TopicApiItem,
    TopicsResponse,
    utc_now,
)
from .topic_catalog import load_topic_configs
from .services import BlueprintService, EvaluationService, GenerationService, RetrievalService
from .storage import QuestionBankStore, RunArtifactStore
from .vector_index import LocalVectorIndex


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DOCS_ROOT = PROJECT_ROOT / "docs" / "mathongo" / "physics"
DEFAULT_DATA_ROOT = PROJECT_ROOT / "data"
DEFAULT_DB_PATH = DEFAULT_DATA_ROOT / "question_bank.sqlite"
DEFAULT_VECTOR_ROOT = DEFAULT_DATA_ROOT / "vector_index"
DEFAULT_RUNS_ROOT = DEFAULT_DATA_ROOT / "runs"


class ExamCoachRuntime:
    def __init__(self, docs_root: Path = DEFAULT_DOCS_ROOT, data_root: Path = DEFAULT_DATA_ROOT) -> None:
        self.docs_root = docs_root
        self.data_root = data_root
        self.question_bank_store = QuestionBankStore(self.data_root / "question_bank.sqlite")
        self.vector_index = LocalVectorIndex(self.data_root / "vector_index")
        self.run_store = RunArtifactStore(self.data_root / "runs")

    def ingest(self, pilot_only: bool = True):
        service = IngestionService(self.docs_root, self.question_bank_store, self.vector_index)
        return service.ingest(pilot_only=pilot_only)

    def ensure_ingested(self):
        if not self.question_bank_store.list_questions() or not self.vector_index.has_index():
            raise RuntimeError(
                "Question bank has not been ingested yet. Run scripts/ingest_question_bank.py before generating exams."
            )

    def run_exam_coach_flow(
        self,
        exam_input: ExamCoachInput,
        student_answers: list[StudentAnswer] | None = None,
    ) -> GenerateResponse | EvaluateResponse:
        self.ensure_ingested()
        blueprint = BlueprintService(self.question_bank_store).build(exam_input)
        retrieval_service = RetrievalService(self.question_bank_store, self.vector_index)
        question_set_internal = GenerationService(self.question_bank_store).generate(blueprint, retrieval_service)
        self.run_store.save_blueprint(question_set_internal.question_set_id, blueprint)
        self.run_store.save_question_set_internal(question_set_internal)

        if student_answers is None:
            return GenerateResponse(blueprint=blueprint, question_set=question_set_internal.to_public())

        report = EvaluationService().evaluate(question_set_internal, student_answers)
        self.run_store.save_report(question_set_internal.question_set_id, report.model_dump_json(indent=2))
        return EvaluateResponse(performance_report=report)

    def start_attempt(self, question_set_id: str) -> StartAttemptResponse:
        question_set = self.run_store.load_question_set_public(question_set_id)
        blueprint = self.run_store.load_blueprint(question_set_id)
        started_at = utc_now()
        attempt = AttemptSession(
            question_set_id=question_set.question_set_id,
            started_at=started_at,
            deadline_at=started_at + timedelta(minutes=blueprint.time_limit_minutes),
            duration_seconds=blueprint.time_limit_minutes * 60,
        )
        self.run_store.save_attempt_session(attempt)
        return StartAttemptResponse(attempt=attempt)

    def get_attempt_state(self, attempt_id: str) -> AttemptStateResponse:
        attempt = self._sync_attempt_status(self.run_store.load_attempt_session(attempt_id))
        question_set = self.run_store.load_question_set_public(attempt.question_set_id)
        performance_report = self.run_store.load_attempt_report(attempt_id)
        return AttemptStateResponse(
            attempt=attempt,
            question_set=question_set,
            performance_report=performance_report,
        )

    def evaluate_attempt(self, request: EvaluateRequest) -> EvaluateResponse:
        if request.attempt_id is None:
            report = self.evaluate_existing(
                request.question_set_id,
                request.student_answers,
                submitted_at=request.submitted_at,
                timeline_events=request.timeline_events,
                auto_submitted=request.auto_submitted,
            )
            return EvaluateResponse(performance_report=report)

        attempt = self._sync_attempt_status(self.run_store.load_attempt_session(request.attempt_id))
        stored_report = self.run_store.load_attempt_report(request.attempt_id)
        if stored_report is not None:
            return EvaluateResponse(performance_report=stored_report, attempt=attempt)

        if attempt.question_set_id != request.question_set_id:
            raise ValueError("attempt_id does not match question_set_id.")

        submitted_at = request.submitted_at or utc_now()
        auto_submitted = request.auto_submitted or submitted_at > attempt.deadline_at
        question_set_internal = self.run_store.load_question_set_internal(request.question_set_id)
        report = EvaluationService().evaluate(
            question_set_internal,
            request.student_answers,
            timeline_events=request.timeline_events,
            attempt=attempt,
            submitted_at=submitted_at,
            auto_submitted=auto_submitted,
        )

        finalized_attempt = attempt.model_copy(
            update={
                "status": "expired" if auto_submitted else "submitted",
                "submitted_at": submitted_at,
                "auto_submitted": auto_submitted,
            }
        )
        self.run_store.save_attempt_submission(
            request.question_set_id,
            request.attempt_id,
            request.model_dump_json(indent=2),
        )
        self.run_store.save_attempt_session(finalized_attempt)
        self.run_store.save_attempt_report(request.question_set_id, request.attempt_id, report)
        self.run_store.save_report(request.question_set_id, report.model_dump_json(indent=2))
        return EvaluateResponse(performance_report=report, attempt=finalized_attempt)

    def evaluate_existing(
        self,
        question_set_id: str,
        student_answers: list[StudentAnswer],
        *,
        submitted_at: datetime | None = None,
        timeline_events=None,
        auto_submitted: bool = False,
    ) -> PerformanceReport:
        question_set_internal = self.run_store.load_question_set_internal(question_set_id)
        report = EvaluationService().evaluate(
            question_set_internal,
            student_answers,
            timeline_events=timeline_events or [],
            submitted_at=submitted_at,
            auto_submitted=auto_submitted,
        )
        self.run_store.save_report(question_set_id, report.model_dump_json(indent=2))
        return report

    def list_topics(self) -> TopicsResponse:
        ingested_topics = {topic.topic_id for topic in self.question_bank_store.list_topics()}
        topic_configs = load_topic_configs()
        return TopicsResponse(
            topics=[
                TopicApiItem(
                    topic_id=item.topic_id,
                    topic_name=item.topic_name,
                    aliases=item.aliases,
                    status=item.status,
                    is_ingested=item.topic_id in ingested_topics,
                    selected_files=item.selected_files,
                )
                for item in topic_configs
                if item.status != "archived"
            ]
        )

    def _sync_attempt_status(self, attempt: AttemptSession) -> AttemptSession:
        if attempt.status == "active" and utc_now() > attempt.deadline_at:
            updated = attempt.model_copy(update={"status": "expired", "auto_submitted": True})
            self.run_store.save_attempt_session(updated)
            return updated
        return attempt


def run_exam_coach_flow(
    exam_input: ExamCoachInput,
    student_answers: list[StudentAnswer] | None = None,
) -> GenerateResponse | EvaluateResponse:
    runtime = ExamCoachRuntime()
    return runtime.run_exam_coach_flow(exam_input, student_answers)
