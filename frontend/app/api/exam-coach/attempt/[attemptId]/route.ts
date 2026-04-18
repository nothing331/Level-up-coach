import { proxyExamCoachJson } from "@/lib/exam-coach-proxy";

type RouteContext = {
  params: Promise<{
    attemptId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { attemptId } = await context.params;
  return proxyExamCoachJson(`/api/exam-coach/attempt/${attemptId}`);
}
