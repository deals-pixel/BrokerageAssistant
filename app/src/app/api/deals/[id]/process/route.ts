import { after, NextResponse } from "next/server";
import { enqueueDealProcessingJob, runDealProcessingJob } from "@/lib/deal-processing-jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { inboundEmailId?: string | null } | null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const job = await enqueueDealProcessingJob({
      supabase: admin,
      dealId: id,
      inboundEmailId: body?.inboundEmailId,
      requestedBy: user.id,
      metadata: { source: "manual_request" },
    });
    await admin.from("audit_logs").insert({
      user_id: user.id,
      deal_id: id,
      action: "processing_job_enqueued",
      details: { job_id: job.id, inbound_email_id: body?.inboundEmailId ?? null },
    });
    after(async () => {
      try {
        await runDealProcessingJob(job.id);
      } catch (err) {
        console.error("Deal processing worker failed", err);
      }
    });
    return NextResponse.json({ ok: true, job }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      deal_id: id,
      action: "processing_enqueue_failed",
      details: { error: message },
    });
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
