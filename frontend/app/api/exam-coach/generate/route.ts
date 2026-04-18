import { NextRequest, NextResponse } from "next/server";

import { proxyExamCoachJson } from "@/lib/exam-coach-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return proxyExamCoachJson("/api/exam-coach/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      {
        detail:
          "Unable to reach the Exam Coach backend. Start the FastAPI server on http://127.0.0.1:8000.",
      },
      { status: 503 },
    );
  }
}
