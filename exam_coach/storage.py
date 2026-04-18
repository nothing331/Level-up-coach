"""Storage layer for topics, question bank records, and generated run artifacts."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .models import (
    AttemptSession,
    PerformanceReport,
    QuestionBankRecord,
    QuestionSet,
    QuestionSetInternal,
    TestBlueprint,
    TopicCatalogItem,
)


class QuestionBankStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
        self._initialize()

    def _initialize(self) -> None:
        self.connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS topics (
                topic_id TEXT PRIMARY KEY,
                topic_name TEXT NOT NULL,
                aliases_json TEXT NOT NULL,
                source_files_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS questions (
                question_id TEXT PRIMARY KEY,
                topic_id TEXT NOT NULL,
                topic_name TEXT NOT NULL,
                source_file TEXT NOT NULL,
                source_year INTEGER,
                source_session TEXT,
                source_question_number INTEGER NOT NULL,
                stem TEXT NOT NULL,
                options_json TEXT NOT NULL,
                answer_key TEXT NOT NULL,
                solution_text TEXT NOT NULL,
                exam_type TEXT NOT NULL,
                difficulty_label TEXT NOT NULL,
                difficulty_score REAL NOT NULL,
                difficulty_reasons_json TEXT NOT NULL,
                confidence REAL NOT NULL,
                embedding_text TEXT NOT NULL
            );
            """
        )
        self.connection.commit()

    def replace_topics(self, topics: Iterable[TopicCatalogItem]) -> None:
        with self.connection:
            self.connection.execute("DELETE FROM topics")
            self.connection.executemany(
                """
                INSERT INTO topics (topic_id, topic_name, aliases_json, source_files_json)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        topic.topic_id,
                        topic.topic_name,
                        json.dumps(topic.aliases),
                        json.dumps(topic.source_files),
                    )
                    for topic in topics
                ],
            )

    def replace_questions(self, questions: Iterable[QuestionBankRecord]) -> None:
        with self.connection:
            self.connection.execute("DELETE FROM questions")
            self.connection.executemany(
                """
                INSERT INTO questions (
                    question_id, topic_id, topic_name, source_file, source_year, source_session,
                    source_question_number, stem, options_json, answer_key, solution_text, exam_type,
                    difficulty_label, difficulty_score, difficulty_reasons_json, confidence, embedding_text
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        question.question_id,
                        question.topic_id,
                        question.topic_name,
                        question.source_file,
                        question.source_year,
                        question.source_session,
                        question.source_question_number,
                        question.stem,
                        json.dumps(question.options),
                        question.answer_key,
                        question.solution_text,
                        question.exam_type,
                        question.difficulty_label,
                        question.difficulty_score,
                        json.dumps(question.difficulty_reasons),
                        question.confidence,
                        question.embedding_text,
                    )
                    for question in questions
                ],
            )

    def list_topics(self) -> list[TopicCatalogItem]:
        rows = self.connection.execute(
            "SELECT topic_id, topic_name, aliases_json, source_files_json FROM topics ORDER BY topic_name"
        ).fetchall()
        return [
            TopicCatalogItem(
                topic_id=row["topic_id"],
                topic_name=row["topic_name"],
                aliases=json.loads(row["aliases_json"]),
                source_files=json.loads(row["source_files_json"]),
            )
            for row in rows
        ]

    def list_questions(self) -> list[QuestionBankRecord]:
        rows = self.connection.execute("SELECT * FROM questions").fetchall()
        return [self._row_to_question(row) for row in rows]

    def get_questions(
        self,
        *,
        topic_ids: list[str] | None = None,
        difficulty_labels: list[str] | None = None,
        source_years: list[int] | None = None,
        limit: int | None = None,
    ) -> list[QuestionBankRecord]:
        query = "SELECT * FROM questions"
        clauses: list[str] = []
        params: list[object] = []
        if topic_ids:
            clauses.append(f"topic_id IN ({','.join('?' for _ in topic_ids)})")
            params.extend(topic_ids)
        if difficulty_labels:
            clauses.append(f"difficulty_label IN ({','.join('?' for _ in difficulty_labels)})")
            params.extend(difficulty_labels)
        if source_years:
            clauses.append(f"source_year IN ({','.join('?' for _ in source_years)})")
            params.extend(source_years)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY difficulty_score DESC, source_year DESC, source_question_number ASC"
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        rows = self.connection.execute(query, params).fetchall()
        return [self._row_to_question(row) for row in rows]

    def _row_to_question(self, row: sqlite3.Row) -> QuestionBankRecord:
        return QuestionBankRecord(
            question_id=row["question_id"],
            topic_id=row["topic_id"],
            topic_name=row["topic_name"],
            source_file=row["source_file"],
            source_year=row["source_year"],
            source_session=row["source_session"],
            source_question_number=row["source_question_number"],
            stem=row["stem"],
            options=json.loads(row["options_json"]),
            answer_key=row["answer_key"],
            solution_text=row["solution_text"],
            exam_type=row["exam_type"],
            difficulty_label=row["difficulty_label"],
            difficulty_score=row["difficulty_score"],
            difficulty_reasons=json.loads(row["difficulty_reasons_json"]),
            confidence=row["confidence"],
            embedding_text=row["embedding_text"],
        )


class RunArtifactStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, question_set_id: str) -> Path:
        target = self.root / question_set_id
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _attempt_dir(self, question_set_id: str, attempt_id: str) -> Path:
        target = self._run_dir(question_set_id) / "attempts" / attempt_id
        target.mkdir(parents=True, exist_ok=True)
        return target

    def save_blueprint(self, question_set_id: str, blueprint: TestBlueprint) -> None:
        run_dir = self._run_dir(question_set_id)
        (run_dir / "blueprint.json").write_text(
            blueprint.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_blueprint(self, question_set_id: str) -> TestBlueprint:
        run_path = self._run_dir(question_set_id) / "blueprint.json"
        return TestBlueprint.model_validate_json(run_path.read_text(encoding="utf-8"))

    def save_question_set_internal(self, question_set: QuestionSetInternal) -> None:
        run_dir = self._run_dir(question_set.question_set_id)
        (run_dir / "question_set_internal.json").write_text(
            question_set.model_dump_json(indent=2),
            encoding="utf-8",
        )
        (run_dir / "question_set.json").write_text(
            question_set.to_public().model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_question_set_internal(self, question_set_id: str) -> QuestionSetInternal:
        run_path = self._run_dir(question_set_id) / "question_set_internal.json"
        return QuestionSetInternal.model_validate_json(run_path.read_text(encoding="utf-8"))

    def load_question_set_public(self, question_set_id: str) -> QuestionSet:
        run_path = self._run_dir(question_set_id) / "question_set.json"
        return QuestionSet.model_validate_json(run_path.read_text(encoding="utf-8"))

    def save_report(self, question_set_id: str, report_json: str) -> None:
        run_dir = self._run_dir(question_set_id)
        (run_dir / "performance_report.json").write_text(report_json, encoding="utf-8")

    def save_attempt_session(self, attempt: AttemptSession) -> None:
        attempt_dir = self._attempt_dir(attempt.question_set_id, attempt.attempt_id)
        (attempt_dir / "session.json").write_text(
            attempt.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def save_attempt_submission(self, question_set_id: str, attempt_id: str, submission_json: str) -> None:
        attempt_dir = self._attempt_dir(question_set_id, attempt_id)
        (attempt_dir / "submission.json").write_text(submission_json, encoding="utf-8")

    def save_attempt_report(self, question_set_id: str, attempt_id: str, report: PerformanceReport) -> None:
        attempt_dir = self._attempt_dir(question_set_id, attempt_id)
        (attempt_dir / "performance_report.json").write_text(
            report.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_attempt_session(self, attempt_id: str) -> AttemptSession:
        attempt_dir = self.find_attempt_dir(attempt_id)
        return AttemptSession.model_validate_json((attempt_dir / "session.json").read_text(encoding="utf-8"))

    def load_attempt_report(self, attempt_id: str) -> PerformanceReport | None:
        attempt_dir = self.find_attempt_dir(attempt_id)
        target = attempt_dir / "performance_report.json"
        if not target.exists():
            return None
        return PerformanceReport.model_validate_json(target.read_text(encoding="utf-8"))

    def has_attempt_report(self, attempt_id: str) -> bool:
        attempt_dir = self.find_attempt_dir(attempt_id)
        return (attempt_dir / "performance_report.json").exists()

    def find_attempt_dir(self, attempt_id: str) -> Path:
        for run_dir in self.root.iterdir():
            if not run_dir.is_dir():
                continue
            target = run_dir / "attempts" / attempt_id
            if target.exists():
                return target
        raise FileNotFoundError(attempt_id)
