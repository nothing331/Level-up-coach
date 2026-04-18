import { NextResponse } from "next/server";

const API_BASE_URL = process.env.EXAM_COACH_API_BASE_URL ?? "http://127.0.0.1:8000";
const BACKEND_UNAVAILABLE_DETAIL =
  "Unable to reach the Exam Coach backend. Start the FastAPI server on http://127.0.0.1:8000.";

export async function proxyExamCoachJson(
  path: string,
  init?: RequestInit,
): Promise<NextResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    const payload = await response.json();

    return NextResponse.json(payload, {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      {
        detail: BACKEND_UNAVAILABLE_DETAIL,
      },
      { status: 503 },
    );
  }
}
