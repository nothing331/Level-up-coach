"""Main orchestration entrypoint for Exam Coach."""

from __future__ import annotations

from pathlib import Path

from .ingestion import IngestionService
from .models import (
    EvaluateResponse,
    ExamCoachInput,
    GenerateResponse,
    PerformanceReport,
    StudentAnswer,
    TopicApiItem,
    TopicsResponse,
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

    def evaluate_existing(self, question_set_id: str, student_answers: list[StudentAnswer]) -> PerformanceReport:
        question_set_internal = self.run_store.load_question_set_internal(question_set_id)
        report = EvaluationService().evaluate(question_set_internal, student_answers)
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


def run_exam_coach_flow(
    exam_input: ExamCoachInput,
    student_answers: list[StudentAnswer] | None = None,
) -> GenerateResponse | EvaluateResponse:
    runtime = ExamCoachRuntime()
    return runtime.run_exam_coach_flow(exam_input, student_answers)
