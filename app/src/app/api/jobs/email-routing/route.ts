import { NextResponse } from "next/server";
import { processInboundEmailRouting, processQueuedInboundEmails } from "@/lib/email-routing-job";

export const maxDuration = 600;

export async function GET(req: Request) {
  if (!verifyJobSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 5), 20);
  const results = await processQueuedInboundEmails(limit);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function POST(req: Request) {
  if (!verifyJobSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { inboundEmailId?: string; limit?: number } | null;
  if (body?.inboundEmailId) {
    const result = await processInboundEmailRouting(body.inboundEmailId);
    return NextResponse.json({ ok: true, processed: 1, results: [result] });
  }

  const limit = Math.min(Number(body?.limit ?? 5), 20);
  const results = await processQueuedInboundEmails(limit);
  return NextResponse.json({ ok: true, processed: results.length, results });
}

function verifyJobSecret(req: Request) {
  const expected = process.env.EMAIL_ROUTING_JOB_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const headerSecret = req.headers.get("x-cron-secret") ?? req.headers.get("x-job-secret");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  return headerSecret === expected || bearer === expected || urlSecret === expected;
}
