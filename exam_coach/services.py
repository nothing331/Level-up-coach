"""Runtime services used by the exam coach orchestrator."""

from __future__ import annotations

import random
import re
from collections import defaultdict

from .llm_agents import AnalysisAgent, OpenAIResponsesClient, QuestionAgent
from .models import (
    CoachingReport,
    DifficultyPerformance,
    DifficultyPlanItem,
    ExamCoachInput,
    InternalQuestionRecord,
    PerformanceReport,
    QuestionOption,
    QuestionReview,
    QuestionSetInternal,
    ScoreSummary,
    StudentAnswer,
    TestBlueprint,
    TopicPerformance,
)
from .storage import QuestionBankStore
from .text_utils import clean_question_text, split_sentences
from .vector_index import LocalVectorIndex


class RetrievalService:
    def __init__(self, store: QuestionBankStore, vector_index: LocalVectorIndex) -> None:
        self.store = store
        self.vector_index = vector_index

    def retrieve(
        self,
        *,
        topic_ids: list[str],
        difficulty_label: str | None,
        limit: int,
        query_text: str,
        exclude_question_ids: set[str] | None = None,
    ):
        candidates = self.store.get_questions(
            topic_ids=topic_ids or None,
            difficulty_labels=[difficulty_label] if difficulty_label else None,
            limit=max(limit * 6, 24),
        )
        if not candidates:
            candidates = self.store.get_questions(
                topic_ids=topic_ids or None,
                limit=max(limit * 6, 24),
            )
        exclude_question_ids = exclude_question_ids or set()
        filtered = [candidate for candidate in candidates if candidate.question_id not in exclude_question_ids]
        if not filtered:
            return []

        if self.vector_index.has_index():
            ranked_ids = self.vector_index.search(
                query_text=query_text,
                allowed_ids=[candidate.question_id for candidate in filtered],
                top_k=max(limit * 3, 10),
                exclude_ids=exclude_question_ids,
            )
            id_to_candidate = {candidate.question_id: candidate for candidate in filtered}
            ranked = [id_to_candidate[item_id] for item_id in ranked_ids if item_id in id_to_candidate]
        else:
            ranked = filtered

        selected = []
        seen_signatures: set[str] = set()
        for candidate in ranked:
            signature = clean_question_text(candidate.stem).lower()[:140]
            if signature in seen_signatures:
                continue
            seen_signatures.add(signature)
            selected.append(candidate)
            if len(selected) >= limit:
                break
        return selected


class BlueprintService:
    def __init__(self, store: QuestionBankStore) -> None:
        self.store = store

    def build(self, exam_input: ExamCoachInput) -> TestBlueprint:
        topics = self.store.list_topics()
        available_topic_ids = [topic.topic_id for topic in topics]
        available_topic_id_set = set(available_topic_ids)

        invalid_topic_ids = [
            topic_id for topic_id in exam_input.selected_topic_ids if topic_id not in available_topic_id_set
        ]
        if invalid_topic_ids:
            available_topic_text = ", ".join(sorted(available_topic_ids))
            raise ValueError(
                "Invalid selected_topic_ids: "
                + ", ".join(invalid_topic_ids)
                + f". Available topic ids: {available_topic_text}"
            )

        if exam_input.mode == "chapter_quiz":
            if not exam_input.selected_topic_ids:
                raise ValueError("chapter_quiz mode requires one selected topic.")
            selected_topic_ids = [exam_input.selected_topic_ids[0]]
            total_questions = exam_input.total_questions or 9
            difficulty_plan = [
                DifficultyPlanItem(difficulty_label="hard", question_count=3),
                DifficultyPlanItem(difficulty_label="medium", question_count=3),
                DifficultyPlanItem(difficulty_label="easy", question_count=3),
            ]
        else:
            selected_topic_ids = exam_input.selected_topic_ids or available_topic_ids
            total_questions = exam_input.total_questions or 15
            difficulty_plan = [
                DifficultyPlanItem(difficulty_label="hard", question_count=5),
                DifficultyPlanItem(difficulty_label="medium", question_count=5),
                DifficultyPlanItem(difficulty_label="easy", question_count=5),
            ]

        return TestBlueprint(
            mode=exam_input.mode,
            subject=exam_input.subject,
            selected_topic_ids=selected_topic_ids,
            difficulty_plan=difficulty_plan,
            ordering_rule="hard_to_easy",
            total_questions=total_questions,
            time_limit_minutes=exam_input.time_limit_minutes or max(total_questions * 2, 20),
            question_type=exam_input.question_type,
            retrieval_criteria={
                "topic_ids": selected_topic_ids,
                "difficulty_labels": [item.difficulty_label for item in difficulty_plan],
                "source_years": [],
                "max_candidates_per_slot": 8,
            },
        )


class GenerationService:
    def __init__(self, store: QuestionBankStore) -> None:
        self.store = store
        self.question_agent = QuestionAgent(OpenAIResponsesClient())

    def generate(self, blueprint: TestBlueprint, retrieval_service: RetrievalService) -> QuestionSetInternal:
        topic_name_by_id = {topic.topic_id: topic.topic_name for topic in self.store.list_topics()}
        selected_questions = []
        used_source_ids: set[str] = set()
        topic_cursor = 0
        ordered_topics = blueprint.selected_topic_ids or list(topic_name_by_id)
        source_packets: list[dict[str, object]] = []

        for plan_item in blueprint.difficulty_plan:
            plan_sources = self._collect_sources_for_plan_item(
                plan_item=plan_item,
                retrieval_service=retrieval_service,
                blueprint=blueprint,
                ordered_topics=ordered_topics,
                topic_name_by_id=topic_name_by_id,
                topic_cursor=topic_cursor,
                used_source_ids=used_source_ids,
            )
            topic_cursor += plan_item.question_count
            for source in plan_sources:
                used_source_ids.add(source.question_id)
                source_packets.append(
                    {
                        "question_id": source.question_id,
                        "topic_id": source.topic_id,
                        "topic_name": source.topic_name,
                        "difficulty_label": source.difficulty_label,
                        "difficulty_score": source.difficulty_score,
                        "stem": source.stem,
                        "options": source.options,
                        "answer_key": source.answer_key,
                        "solution_text": source.solution_text,
                    }
                )

        generation_mode = "fallback"
        if self.question_agent.is_available() and len(source_packets) >= blueprint.total_questions:
            try:
                selected_questions = self.question_agent.generate_questions(
                    mode=blueprint.mode,
                    subject=blueprint.subject,
                    total_questions=blueprint.total_questions,
                    source_packets=source_packets[: blueprint.total_questions],
                )
                generation_mode = "agentic"
            except Exception:
                selected_questions = []

        if not selected_questions:
            question_lookup = {question.question_id: question for question in self.store.list_questions()}
            for ordinal, packet in enumerate(source_packets[: blueprint.total_questions], start=1):
                source = question_lookup[packet["question_id"]]
                selected_questions.append(self._build_variant(source, ordinal, topic_name_by_id.get(source.topic_id, source.topic_id)))

        selected_questions.sort(
            key=lambda question: {"hard": 0, "medium": 1, "easy": 2}[question.difficulty_label]
        )
        question_set_id = f"{blueprint.blueprint_id.replace('blueprint', 'qset')}"
        return QuestionSetInternal(
            question_set_id=question_set_id,
            blueprint_id=blueprint.blueprint_id,
            instructions=(
                "Answer all questions in sequence. The set is ordered from harder items to easier items "
                "so you can practice pacing as well as accuracy."
            ),
            questions=selected_questions[: blueprint.total_questions],
            meta={
                "mode": blueprint.mode,
                "total_questions": len(selected_questions[: blueprint.total_questions]),
                "ordering_rule": blueprint.ordering_rule,
                "generation_mode": generation_mode,
            },
        )

    def _collect_sources_for_plan_item(
        self,
        *,
        plan_item,
        retrieval_service: RetrievalService,
        blueprint: TestBlueprint,
        ordered_topics: list[str],
        topic_name_by_id: dict[str, str],
        topic_cursor: int,
        used_source_ids: set[str],
    ) -> list:
        selected = []
        selected_ids: set[str] = set()

        for slot_index in range(plan_item.question_count):
            topic_id = ordered_topics[(topic_cursor + slot_index) % len(ordered_topics)]
            query_text = f"{topic_name_by_id.get(topic_id, topic_id)} {plan_item.difficulty_label} physics concept"
            candidates = retrieval_service.retrieve(
                topic_ids=[topic_id] if blueprint.mode == "chapter_quiz" else blueprint.selected_topic_ids,
                difficulty_label=plan_item.difficulty_label,
                limit=max(plan_item.question_count * 3, 8),
                query_text=query_text,
                exclude_question_ids=used_source_ids | selected_ids,
            )
            for candidate in candidates:
                if candidate.question_id in selected_ids:
                    continue
                selected.append(candidate)
                selected_ids.add(candidate.question_id)
                break

        if len(selected) < plan_item.question_count:
            backup_candidates = retrieval_service.retrieve(
                topic_ids=blueprint.selected_topic_ids,
                difficulty_label=None,
                limit=max(plan_item.question_count * 4, 12),
                query_text=f"{blueprint.subject} {plan_item.difficulty_label} revision set",
                exclude_question_ids=used_source_ids | selected_ids,
            )
            for candidate in backup_candidates:
                if len(selected) >= plan_item.question_count:
                    break
                selected.append(candidate)
                selected_ids.add(candidate.question_id)

        return selected[: plan_item.question_count]

    def _build_variant(self, source, ordinal: int, topic_name: str) -> InternalQuestionRecord:
        correct_text, distractors = self._build_answer_choices(source)
        options = [QuestionOption(option_id=f"option-{idx + 1}", text=text) for idx, text in enumerate([correct_text, *distractors])]
        rng = random.Random(source.question_id)
        rng.shuffle(options)
        correct_option_id = next(option.option_id for option in options if option.text == correct_text)

        stem = clean_question_text(source.stem)
        if source.options and len(source.options) >= 4:
            stem = f"Practice Variant {ordinal} - {topic_name}\n{stem}"
            options = [QuestionOption(option_id=f"option-{idx + 1}", text=text) for idx, text in enumerate(source.options[:4])]
            correct_index = self._answer_key_to_index(source.answer_key)
            if correct_index is not None and correct_index < len(options):
                correct_option_id = options[correct_index].option_id
        else:
            stem = (
                f"Practice Variant {ordinal} - {topic_name}\n"
                f"A source JEE question on this topic was used as grounding. Which reasoning step best matches the "
                f"physics needed to solve a closely related problem?\n{stem}"
            )

        return InternalQuestionRecord(
            question_id=f"generated-{source.question_id}",
            topic_id=source.topic_id,
            stem=stem,
            options=options,
            difficulty_label=source.difficulty_label,
            difficulty_score=source.difficulty_score,
            correct_option_id=correct_option_id,
            explanation=source.solution_text,
            source_question_refs=[source.question_id],
            retrieval_trace=[source.question_id, source.source_file],
        )

    def _build_answer_choices(self, source) -> tuple[str, list[str]]:
        sentences = split_sentences(source.solution_text)
        correct_text = clean_question_text(sentences[0] if sentences else source.solution_text[:120])
        if len(correct_text) < 20:
            correct_text = f"The correct approach follows the {source.topic_name.lower()} principle identified in the solution."
        distractors = [
            f"It can be solved by assuming the quantity stays constant without checking the governing law.",
            f"It depends only on substituting values directly, without using the core {source.topic_name.lower()} relation.",
            f"The first step should be to ignore boundary conditions and compare only magnitudes.",
        ]
        return correct_text, distractors

    def _answer_key_to_index(self, answer_key: str) -> int | None:
        match = re.search(r"([1-4])", answer_key)
        if not match:
            return None
        return int(match.group(1)) - 1


class EvaluationService:
    def evaluate(self, question_set: QuestionSetInternal, student_answers: list[StudentAnswer]) -> PerformanceReport:
        answer_map = {answer.question_id: answer.selected_option_id for answer in student_answers}
        attempted = correct = incorrect = 0
        topic_results: dict[str, list[int]] = defaultdict(list)
        difficulty_results: dict[str, list[int]] = defaultdict(list)
        question_reviews: list[QuestionReview] = []

        for question in question_set.questions:
            selected_option_id = answer_map.get(question.question_id)
            if selected_option_id:
                attempted += 1
            if selected_option_id == question.correct_option_id:
                correct += 1
                result = "correct"
                score_value = 1
            elif selected_option_id is None:
                result = "unattempted"
                score_value = -1
            else:
                incorrect += 1
                result = "incorrect"
                score_value = 0

            topic_results[question.topic_id].append(score_value)
            difficulty_results[question.difficulty_label].append(score_value)
            question_reviews.append(
                QuestionReview(
                    question_id=question.question_id,
                    selected_option_id=selected_option_id,
                    correct_option_id=question.correct_option_id,
                    result=result,
                    explanation=question.explanation,
                )
            )

        unattempted = len(question_set.questions) - attempted
        percentage = round((correct / len(question_set.questions)) * 100.0, 2) if question_set.questions else 0.0

        topic_performance = [
            TopicPerformance(
                topic_id=topic_id,
                attempted=sum(1 for item in values if item >= 0),
                accuracy=round((sum(1 for item in values if item == 1) / max(sum(1 for item in values if item >= 0), 1)) * 100.0, 2),
                weakness_level=self._weakness_level(values),
            )
            for topic_id, values in sorted(topic_results.items())
        ]
        difficulty_performance = [
            DifficultyPerformance(
                difficulty_label=label,
                attempted=sum(1 for item in values if item >= 0),
                accuracy=round((sum(1 for item in values if item == 1) / max(sum(1 for item in values if item >= 0), 1)) * 100.0, 2),
            )
            for label, values in sorted(difficulty_results.items(), key=lambda item: {"hard": 0, "medium": 1, "easy": 2}[item[0]])
        ]

        coaching = AnalysisService().analyze(topic_performance, difficulty_performance)
        return PerformanceReport(
            question_set_id=question_set.question_set_id,
            score_summary=ScoreSummary(
                attempted=attempted,
                correct=correct,
                incorrect=incorrect,
                unattempted=unattempted,
                percentage=percentage,
            ),
            topic_performance=topic_performance,
            difficulty_performance=difficulty_performance,
            question_review=question_reviews,
            coaching=coaching,
        )

    def _weakness_level(self, values: list[int]) -> str:
        attempted_values = [value for value in values if value >= 0]
        accuracy = sum(1 for value in attempted_values if value == 1) / max(len(attempted_values), 1)
        if accuracy >= 0.75:
            return "low"
        if accuracy >= 0.45:
            return "medium"
        return "high"


class AnalysisService:
    def __init__(self) -> None:
        self.analysis_agent = AnalysisAgent(OpenAIResponsesClient())

    def analyze(
        self,
        topic_performance: list[TopicPerformance],
        difficulty_performance: list[DifficultyPerformance],
    ) -> CoachingReport:
        if self.analysis_agent.is_available():
            try:
                return self.analysis_agent.analyze(
                    topic_performance=topic_performance,
                    difficulty_performance=difficulty_performance,
                )
            except Exception:
                pass

        strong_topics = [topic.topic_id for topic in topic_performance if topic.accuracy >= 70.0]
        weak_topics = [topic.topic_id for topic in topic_performance if topic.weakness_level == "high"]
        hardest_band = min(difficulty_performance, key=lambda item: item.accuracy, default=None)

        strengths = [f"Strong retention in {topic_id.replace('-', ' ')}." for topic_id in strong_topics[:3]]
        if not strengths:
            strengths.append("Your strongest signal is that you attempted the set consistently; now we can sharpen accuracy.")

        next_actions = []
        if hardest_band is not None:
            next_actions.append(
                f"Do one focused revision cycle on {hardest_band.difficulty_label} questions before your next mixed test."
            )
        for topic_id in weak_topics[:3]:
            next_actions.append(f"Rework mistakes from {topic_id.replace('-', ' ')} and solve 5 new problems from that chapter.")
        if not next_actions:
            next_actions.append("Increase volume gradually and keep the hard-to-easy pacing order for the next practice set.")

        practice_plan = []
        for topic_id in weak_topics[:3]:
            practice_plan.append(f"Revise formulas for {topic_id.replace('-', ' ')} and then attempt one timed mini-quiz.")
        if hardest_band is not None:
            practice_plan.append(
                f"End the next session with 3 {hardest_band.difficulty_label}-level items to build confidence under pressure."
            )

        return CoachingReport(
            strengths=strengths,
            weak_topics=[topic_id.replace("-", " ") for topic_id in weak_topics],
            next_actions=next_actions,
            recommended_practice_plan=practice_plan or ["Repeat a chapter quiz on the weakest topic within 24 hours."],
        )
