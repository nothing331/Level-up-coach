import { NextRequest, NextResponse } from "next/server";

import { proxyExamCoachJson } from "@/lib/exam-coach-proxy";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    return proxyExamCoachJson("/api/exam-coach/start-attempt", {
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
          "Unable to start the timed attempt. Check that the backend is running and the request payload is valid.",
      },
      { status: 400 },
    );
  }
}
