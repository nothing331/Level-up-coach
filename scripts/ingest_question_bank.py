#!/usr/bin/env python3
"""Build the local question bank and vector index from the physics PDFs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from exam_coach.orchestrator import ExamCoachRuntime


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the local question bank and vector index.")
    parser.add_argument(
        "--all-topics",
        action="store_true",
        help="Ingest every configured topic instead of the smaller pilot-ready subset.",
    )
    args = parser.parse_args()

    runtime = ExamCoachRuntime()
    summary = runtime.ingest(pilot_only=not args.all_topics)
    print(summary.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
