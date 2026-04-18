import { NextRequest, NextResponse } from "next/server";

import { proxyExamCoachJson } from "@/lib/exam-coach-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return proxyExamCoachJson("/api/exam-coach/evaluate", {
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
          "Unable to submit the quiz for evaluation. Check that the payload is valid JSON and the backend is running.",
      },
      { status: 400 },
    );
  }
}
