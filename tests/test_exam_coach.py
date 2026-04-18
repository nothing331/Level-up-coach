from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from exam_coach.ingestion import IngestionService
from exam_coach.models import ExamCoachInput, StudentAnswer
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
            "Alternating Current - JEE Main 2026 (Jan) - MathonGo.pdf",
            "Laws of Motion - JEE Main 2026 (Jan) - MathonGo.pdf",
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
        self.assertGreaterEqual(len(topics), 25)
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
        electrostatics = next(topic for topic in runtime.question_bank_store.list_topics() if topic.topic_name == "Electrostatics")
        response = runtime.run_exam_coach_flow(
            ExamCoachInput(mode="chapter_quiz", selected_topic_ids=[electrostatics.topic_id])
        )
        self.assertTrue(all(question.topic_id == electrostatics.topic_id for question in response.question_set.questions))
        self.assertEqual(len(response.question_set.questions), 9)

    def test_full_mix_returns_hard_to_easy(self) -> None:
        data_root = self.temp_dir / "runtime-data-mix"
        runtime = ExamCoachRuntime(docs_root=self.test_docs_root, data_root=data_root)
        runtime.ingest()
        response = runtime.run_exam_coach_flow(ExamCoachInput(mode="full_physics_mix"))
        labels = [question.difficulty_label for question in response.question_set.questions]
        self.assertEqual(len(labels), 15)
        self.assertEqual(labels, sorted(labels, key=lambda label: {"hard": 0, "medium": 1, "easy": 2}[label]))

    def test_evaluation_produces_report(self) -> None:
        data_root = self.temp_dir / "runtime-data-report"
        runtime = ExamCoachRuntime(docs_root=self.test_docs_root, data_root=data_root)
        runtime.ingest()
        generated = runtime.run_exam_coach_flow(ExamCoachInput(mode="full_physics_mix"))
        answers = [
            StudentAnswer(question_id=question.question_id, selected_option_id=question.options[0].option_id)
            for question in generated.question_set.questions[:3]
        ]
        report = runtime.evaluate_existing(generated.question_set.question_set_id, answers)
        self.assertEqual(report.score_summary.attempted, 3)
        self.assertEqual(len(report.question_review), len(generated.question_set.questions))


if __name__ == "__main__":
    unittest.main()
