import { NextResponse } from "next/server";
import { runDealProcessingJob, runDealProcessingJobs } from "@/lib/deal-processing-jobs";

export const maxDuration = 600;

export async function GET(req: Request) {
  if (!verifyJobSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 1);
  const results = await runDealProcessingJobs(Math.max(1, Math.min(limit, 3)));
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function POST(req: Request) {
  if (!verifyJobSecret(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { jobId?: string; limit?: number } | null;
  if (body?.jobId) {
    const result = await runDealProcessingJob(body.jobId);
    return NextResponse.json({ ok: true, processed: 1, results: [result] });
  }
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 1), 3));
  const results = await runDealProcessingJobs(limit);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

function verifyJobSecret(req: Request) {
  const expected = process.env.DEAL_PROCESSING_JOB_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-cron-secret") === expected || req.headers.get("x-deal-processing-secret") === expected;
}
