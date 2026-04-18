import { proxyExamCoachJson } from "@/lib/exam-coach-proxy";

export async function GET() {
  return proxyExamCoachJson("/api/topics");
}
