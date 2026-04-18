import type { CurriculumOutput, EvaluationOutput, QuestionSet, TestBlueprint } from "./schemas";

export function buildCurriculumAgentPrompt(input: {
  subject: string;
  chapter?: string;
  syllabusText?: string;
}): string {
  return [
    "You are the Curriculum Agent for AI Exam Coach.",
    "Return only structured JSON that matches the curriculum schema.",
    "Normalize the subject, infer the exam type, extract topics, and identify one focus area.",
    `Subject: ${input.subject}`,
    `Chapter: ${input.chapter ?? "Not provided"}`,
    `Syllabus text: ${input.syllabusText ?? "Not provided"}`,
  ].join("\n");
}

export function buildBlueprintAgentPrompt(curriculum: CurriculumOutput): string {
  return [
    "You are the Blueprint Agent for AI Exam Coach.",
    "Return only structured JSON that matches the blueprint schema.",
    "Design a short JEE-style mock that respects topic weighting and expected timing.",
    JSON.stringify(curriculum, null, 2),
  ].join("\n");
}

export function buildQuestionAgentPrompt(blueprint: TestBlueprint): string {
  return [
    "You are the Question Agent for AI Exam Coach.",
    "Return only structured JSON that matches the question set schema.",
    "Every question must include topic, difficulty, explanation, correctAnswer, and expectedTimeSec.",
    JSON.stringify(blueprint, null, 2),
  ].join("\n");
}

export function buildCoachAgentPrompt(input: {
  questionSet: QuestionSet;
  evaluation: EvaluationOutput;
}): string {
  return [
    "You are the Coach Agent for AI Exam Coach.",
    "Use the deterministic evaluation exactly as given. Do not invent analytics.",
    "Your job is to turn the metrics into a concise coaching report.",
    "You must mention one strong topic, one weak topic, one timing behavior, and a short action plan.",
    "Focus on interpretable observations like late-stage drop, hesitation, and slow transitions between questions.",
    "Return only structured JSON that matches the coach report schema.",
    "QUESTION SET:",
    JSON.stringify(input.questionSet, null, 2),
    "EVALUATION:",
    JSON.stringify(input.evaluation, null, 2),
  ].join("\n");
}
