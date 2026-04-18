"""FastAPI application for the Exam Coach backend."""

from __future__ import annotations

from functools import lru_cache

from fastapi import FastAPI, HTTPException

from .models import (
    AttemptStateResponse,
    EvaluateRequest,
    EvaluateResponse,
    ExamCoachInput,
    GenerateResponse,
    StartAttemptRequest,
    StartAttemptResponse,
    TopicsResponse,
)
from .orchestrator import ExamCoachRuntime


@lru_cache(maxsize=1)
def get_runtime() -> ExamCoachRuntime:
    return ExamCoachRuntime()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Exam Coach API",
        version="0.1.0",
        description="Hybrid question-bank and timed quiz generation backend for JEE Physics.",
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/topics", response_model=TopicsResponse)
    def list_topics() -> TopicsResponse:
        runtime = get_runtime()
        try:
            return runtime.list_topics()
        except Exception as exc:  # pragma: no cover - defensive server boundary
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/exam-coach/generate", response_model=GenerateResponse)
    def generate_exam(exam_input: ExamCoachInput) -> GenerateResponse:
        runtime = get_runtime()
        try:
            response = runtime.run_exam_coach_flow(exam_input)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive server boundary
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        if isinstance(response, GenerateResponse):
            return response

        raise HTTPException(status_code=500, detail="Unexpected response type from generate flow.")

    @app.post("/api/exam-coach/start-attempt", response_model=StartAttemptResponse)
    def start_attempt(request: StartAttemptRequest) -> StartAttemptResponse:
        runtime = get_runtime()
        try:
            return runtime.start_attempt(request.question_set_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Unknown question_set_id") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive server boundary
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.get("/api/exam-coach/attempt/{attempt_id}", response_model=AttemptStateResponse)
    def get_attempt(attempt_id: str) -> AttemptStateResponse:
        runtime = get_runtime()
        try:
            return runtime.get_attempt_state(attempt_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Unknown attempt_id") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive server boundary
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @app.post("/api/exam-coach/evaluate", response_model=EvaluateResponse)
    def evaluate_exam(request: EvaluateRequest) -> EvaluateResponse:
        runtime = get_runtime()
        try:
            return runtime.evaluate_attempt(request)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Unknown question_set_id or attempt_id") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - defensive server boundary
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return app


app = create_app()
