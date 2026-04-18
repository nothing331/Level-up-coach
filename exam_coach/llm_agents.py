"""Grounded agent helpers for question generation and coaching analysis."""

from __future__ import annotations

import json
from typing import Any

import requests

from .env import load_local_env
from .models import (
    BehaviorSignal,
    CoachingReport,
    DifficultyPerformance,
    InternalQuestionRecord,
    QuestionOption,
    TimingSummary,
    TopicPerformance,
)


class OpenAIResponsesClient:
    def __init__(self) -> None:
        load_local_env()
        import os

        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.model = os.getenv("OPENAI_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")

    def is_available(self) -> bool:
        return bool(self.api_key)

    def generate_structured_output(
        self,
        *,
        instructions: str,
        prompt: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured.")

        response = requests.post(
            f"{self.base_url}/responses",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "instructions": instructions,
                "input": prompt,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": schema_name,
                        "schema": schema,
                        "strict": True,
                    }
                },
            },
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        raw_text = payload.get("output_text")
        if not raw_text:
            for item in payload.get("output", []):
                if item.get("type") != "message":
                    continue
                for content_item in item.get("content", []):
                    if content_item.get("type") == "output_text" and content_item.get("text"):
                        raw_text = content_item["text"]
                        break
                if raw_text:
                    break
        if not raw_text:
            raise RuntimeError("Responses API did not return structured output text.")
        return json.loads(raw_text)


class QuestionAgent:
    def __init__(self, client: OpenAIResponsesClient) -> None:
        self.client = client

    def is_available(self) -> bool:
        return self.client.is_available()

    def generate_questions(
        self,
        *,
        mode: str,
        subject: str,
        total_questions: int,
        source_packets: list[dict[str, Any]],
    ) -> list[InternalQuestionRecord]:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "questions": {
                    "type": "array",
                    "minItems": total_questions,
                    "maxItems": total_questions,
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "question_id": {"type": "string"},
                            "topic_id": {"type": "string"},
                            "stem": {"type": "string"},
                            "difficulty_label": {"type": "string", "enum": ["easy", "medium", "hard"]},
                            "difficulty_score": {"type": "number"},
                            "correct_option_index": {"type": "integer", "minimum": 0, "maximum": 3},
                            "options": {
                                "type": "array",
                                "minItems": 4,
                                "maxItems": 4,
                                "items": {"type": "string"},
                            },
                            "explanation": {"type": "string"},
                            "source_question_refs": {
                                "type": "array",
                                "minItems": 1,
                                "items": {"type": "string"},
                            },
                        },
                        "required": [
                            "question_id",
                            "topic_id",
                            "stem",
                            "difficulty_label",
                            "difficulty_score",
                            "correct_option_index",
                            "options",
                            "explanation",
                            "source_question_refs",
                        ],
                    },
                }
            },
            "required": ["questions"],
        }

        instructions = (
            "You are the questionAgent for an exam-coach hackathon app. "
            "Generate fresh JEE Physics MCQs grounded in the supplied source questions. "
            "Do not copy the original stem or option wording verbatim. "
            "Preserve the source topic and approximate difficulty. "
            "Each question must have exactly one correct answer. "
            "Use clean student-facing language and concise explanations."
        )
        prompt = json.dumps(
            {
                "mode": mode,
                "subject": subject,
                "total_questions": total_questions,
                "source_packets": source_packets,
            },
            ensure_ascii=False,
            indent=2,
        )
        payload = self.client.generate_structured_output(
            instructions=instructions,
            prompt=prompt,
            schema_name="exam_coach_question_set",
            schema=schema,
        )
        questions: list[InternalQuestionRecord] = []
        for item in payload["questions"]:
            options = [
                QuestionOption(option_id=f"option-{idx + 1}", text=text)
                for idx, text in enumerate(item["options"])
            ]
            correct_option_id = options[item["correct_option_index"]].option_id
            questions.append(
                InternalQuestionRecord(
                    question_id=item["question_id"],
                    topic_id=item["topic_id"],
                    stem=item["stem"],
                    options=options,
                    difficulty_label=item["difficulty_label"],
                    difficulty_score=float(item["difficulty_score"]),
                    correct_option_id=correct_option_id,
                    explanation=item["explanation"],
                    source_question_refs=item["source_question_refs"],
                    retrieval_trace=item["source_question_refs"],
                )
            )
        return questions


class AnalysisAgent:
    def __init__(self, client: OpenAIResponsesClient) -> None:
        self.client = client

    def is_available(self) -> bool:
        return self.client.is_available()

    def analyze(
        self,
        *,
        topic_performance: list[TopicPerformance],
        difficulty_performance: list[DifficultyPerformance],
        timing_summary: TimingSummary,
        behavior_signals: list[BehaviorSignal],
    ) -> CoachingReport:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "strengths": {"type": "array", "items": {"type": "string"}},
                "weak_topics": {"type": "array", "items": {"type": "string"}},
                "next_actions": {"type": "array", "items": {"type": "string"}},
                "recommended_practice_plan": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["strengths", "weak_topics", "next_actions", "recommended_practice_plan"],
        }
        instructions = (
            "You are the analysisAgent for an exam coach. "
            "Convert topic accuracy, difficulty accuracy, timing signals, and behavior patterns into concise coaching insights. "
            "Prioritize actionable study advice over generic encouragement."
        )
        prompt = json.dumps(
            {
                "topic_performance": [item.model_dump(mode="json") for item in topic_performance],
                "difficulty_performance": [item.model_dump(mode="json") for item in difficulty_performance],
                "timing_summary": timing_summary.model_dump(mode="json"),
                "behavior_signals": [item.model_dump(mode="json") for item in behavior_signals],
            },
            ensure_ascii=False,
            indent=2,
        )
        payload = self.client.generate_structured_output(
            instructions=instructions,
            prompt=prompt,
            schema_name="exam_coach_coaching_report",
            schema=schema,
        )
        return CoachingReport.model_validate(payload)
