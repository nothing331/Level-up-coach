from __future__ import annotations

import shutil
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from exam_coach.ingestion import IngestionService
from exam_coach.models import AttemptTimelineEvent, EvaluateRequest, ExamCoachInput, StudentAnswer, utc_now
from exam_coach.orchestrator import ExamCoachRuntime
from exam_coach.services import RetrievalService
from exam_coach.storage import QuestionBankStore
from exam_coach.vector_index import LocalVectorIndex


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DOCS_ROOT = PROJECT_ROOT / "docs" / "mathongo" / "physics"


class ExamCoachTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = Path(tempfile.mkdtemp(prefix="exam-coach-tests-"))
        cls.test_docs_root = cls.temp_dir / "docs"
        cls.test_docs_root.mkdir(parents=True, exist_ok=True)
        for filename in [
            "Physics - JEE Main 2025 January Chapter-wise Question Bank - MathonGo.pdf",
            "Electrostatics - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Current Electricity - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Laws of Motion - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Atomic Physics - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Ray Optics - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Thermodynamics - JEE Main 2026 (Jan) - MathonGo.pdf",
        ]:
            shutil.copy2(DOCS_ROOT / filename, cls.test_docs_root / filename)
        cls.store = QuestionBankStore(cls.temp_dir / "question_bank.sqlite")
        cls.vector_index = LocalVectorIndex(cls.temp_dir / "vector_index")
        cls.ingestion = IngestionService(cls.test_docs_root, cls.store, cls.vector_index)
        cls.summary = cls.ingestion.ingest()

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_ingestion_builds_topics_and_questions(self) -> None:
        topics = self.store.list_topics()
        questions = self.store.list_questions()
        self.assertGreaterEqual(len(topics), 6)
        self.assertGreaterEqual(len(questions), 20)
        self.assertTrue(self.vector_index.has_index())

    def test_retrieval_filters_by_topic(self) -> None:
        topics = self.store.list_topics()
        electrostatics = next(topic for topic in topics if topic.topic_name == "Electrostatics")
        service = RetrievalService(self.store, self.vector_index)
        results = service.retrieve(
            topic_ids=[electrostatics.topic_id],
            difficulty_label="hard",
            limit=5,
            query_text="electrostatics hard concept",
        )
        self.assertTrue(results)
        self.assertTrue(all(result.topic_id == electrostatics.topic_id for result in results))

    def test_chapter_quiz_stays_in_selected_topic(self) -> None:
        data_root = self.temp_dir / "runtime-data"
        runtime = ExamCoachRuntime(docs_root=self.test_docs_root, data_root=data_root)
        runtime.ingest()
        electrostatics = next(
            topic for topic in runtime.question_bank_store.list_topics() if topic.topic_name == "Electrostatics"
        )
        response = runtime.run_exam_coach_flow(
            ExamCoachInput(mode="chapter_quiz", selected_topic_ids=[electrostatics.topic_id])
        )
        self.assertTrue(
            all(question.topic_id == electrostatics.topic_id for question in response.question_set.questions)
        )
        self.assertEqual(len(response.question_set.questions), 9)

    def test_full_mix_returns_hard_to_easy(self) -> None:
        data_root = self.temp_dir / "runtime-data-mix"
        runtime = ExamCoachRuntime(docs_root=self.test_docs_root, data_root=data_root)
        runtime.ingest()
        response = runtime.run_exam_coach_flow(ExamCoachInput(mode="full_physics_mix"))
        labels = [question.difficulty_label for question in response.question_set.questions]
        self.assertEqual(len(labels), 15)
        self.assertEqual(
            labels,
            sorted(labels, key=lambda label: {"hard": 0, "medium": 1, "easy": 2}[label]),
        )

    def test_start_attempt_returns_timestamps(self) -> None:
        runtime, generated = self._build_runtime_and_generated_quiz("runtime-data-attempt-start")
        response = runtime.start_attempt(generated.question_set.question_set_id)
        self.assertEqual(response.attempt.question_set_id, generated.question_set.question_set_id)
        self.assertEqual(response.attempt.status, "active")
        self.assertGreater(response.attempt.duration_seconds, 0)
        self.assertGreater(response.attempt.deadline_at, response.attempt.started_at)

    def test_evaluate_attempt_is_idempotent(self) -> None:
        runtime, generated = self._build_runtime_and_generated_quiz("runtime-data-idempotent")
        attempt = runtime.start_attempt(generated.question_set.question_set_id).attempt
        first_question = generated.question_set.questions[0]
        submitted_at = utc_now()
        request = EvaluateRequest(
            question_set_id=generated.question_set.question_set_id,
            attempt_id=attempt.attempt_id,
            submitted_at=submitted_at,
            auto_submitted=False,
            student_answers=[
                StudentAnswer(question_id=first_question.question_id, selected_option_id=first_question.options[0].option_id)
            ],
            timeline_events=[
                AttemptTimelineEvent(type="question_entered", at=submitted_at - timedelta(seconds=30), question_id=first_question.question_id),
                AttemptTimelineEvent(type="answer_selected", at=submitted_at - timedelta(seconds=20), question_id=first_question.question_id, selected_option_id=first_question.options[0].option_id),
                AttemptTimelineEvent(type="question_left", at=submitted_at - timedelta(seconds=5), question_id=first_question.question_id),
                AttemptTimelineEvent(type="submitted", at=submitted_at, question_id=first_question.question_id),
            ],
        )

        first_response = runtime.evaluate_attempt(request)
        second_response = runtime.evaluate_attempt(request)

        self.assertEqual(first_response.performance_report.report_id, second_response.performance_report.report_id)
        self.assertEqual(second_response.attempt.status, "submitted")

    def test_evaluate_attempt_after_deadline_marks_expired(self) -> None:
        runtime, generated = self._build_runtime_and_generated_quiz("runtime-data-expired")
        attempt = runtime.start_attempt(generated.question_set.question_set_id).attempt
        expired_attempt = attempt.model_copy(
            update={"deadline_at": utc_now() - timedelta(seconds=1)}
        )
        runtime.run_store.save_attempt_session(expired_attempt)
        submitted_at = utc_now()

        response = runtime.evaluate_attempt(
            EvaluateRequest(
                question_set_id=generated.question_set.question_set_id,
                attempt_id=attempt.attempt_id,
                submitted_at=submitted_at,
                auto_submitted=False,
                student_answers=[],
                timeline_events=[
                    AttemptTimelineEvent(type="auto_submitted", at=submitted_at),
                ],
            )
        )

        self.assertTrue(response.performance_report.auto_submitted)
        self.assertEqual(response.attempt.status, "expired")

    def test_get_attempt_state_returns_report_after_submission(self) -> None:
        runtime, generated = self._build_runtime_and_generated_quiz("runtime-data-report")
        attempt = runtime.start_attempt(generated.question_set.question_set_id).attempt
        question = generated.question_set.questions[0]
        submitted_at = utc_now()
        runtime.evaluate_attempt(
            EvaluateRequest(
                question_set_id=generated.question_set.question_set_id,
                attempt_id=attempt.attempt_id,
                submitted_at=submitted_at,
                auto_submitted=False,
                student_answers=[
                    StudentAnswer(question_id=question.question_id, selected_option_id=question.options[0].option_id)
                ],
                timeline_events=[
                    AttemptTimelineEvent(type="question_entered", at=submitted_at - timedelta(seconds=25), question_id=question.question_id),
                    AttemptTimelineEvent(type="answer_selected", at=submitted_at - timedelta(seconds=10), question_id=question.question_id, selected_option_id=question.options[0].option_id),
                    AttemptTimelineEvent(type="submitted", at=submitted_at),
                ],
            )
        )

        state = runtime.get_attempt_state(attempt.attempt_id)
        self.assertIsNotNone(state.question_set)
        self.assertIsNotNone(state.performance_report)
        self.assertEqual(state.performance_report.attempt_id, attempt.attempt_id)

    def test_evaluation_derives_timing_metrics(self) -> None:
        runtime, generated = self._build_runtime_and_generated_quiz("runtime-data-metrics")
        attempt = runtime.start_attempt(generated.question_set.question_set_id).attempt
        first_question, second_question = generated.question_set.questions[:2]
        submitted_at = utc_now()

        response = runtime.evaluate_attempt(
            EvaluateRequest(
                question_set_id=generated.question_set.question_set_id,
                attempt_id=attempt.attempt_id,
                submitted_at=submitted_at,
                auto_submitted=False,
                student_answers=[
                    StudentAnswer(question_id=first_question.question_id, selected_option_id=first_question.options[0].option_id),
                    StudentAnswer(question_id=second_question.question_id, selected_option_id=second_question.options[1].option_id),
                ],
                timeline_events=[
                    AttemptTimelineEvent(type="question_entered", at=submitted_at - timedelta(seconds=120), question_id=first_question.question_id),
                    AttemptTimelineEvent(type="answer_selected", at=submitted_at - timedelta(seconds=100), question_id=first_question.question_id, selected_option_id=first_question.options[0].option_id),
                    AttemptTimelineEvent(type="question_left", at=submitted_at - timedelta(seconds=90), question_id=first_question.question_id),
                    AttemptTimelineEvent(type="question_entered", at=submitted_at - timedelta(seconds=70), question_id=second_question.question_id),
                    AttemptTimelineEvent(type="answer_selected", at=submitted_at - timedelta(seconds=40), question_id=second_question.question_id, selected_option_id=second_question.options[1].option_id),
                    AttemptTimelineEvent(type="submitted", at=submitted_at),
                ],
            )
        )

        self.assertGreater(response.performance_report.timing_summary.total_duration_seconds, 0)
        self.assertEqual(
            len(response.performance_report.timing_summary.question_timings),
            len(generated.question_set.questions),
        )
        self.assertTrue(
            any(
                timing.question_id == first_question.question_id and timing.visited_count >= 1
                for timing in response.performance_report.timing_summary.question_timings
            )
        )

    def _build_runtime_and_generated_quiz(self, data_dir_name: str):
        data_root = self.temp_dir / data_dir_name
        runtime = ExamCoachRuntime(docs_root=self.test_docs_root, data_root=data_root)
        runtime.ingest()
        generated = runtime.run_exam_coach_flow(ExamCoachInput(mode="full_physics_mix"))
        return runtime, generated


if __name__ == "__main__":
    unittest.main()
