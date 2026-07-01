import { processDeal, type ProcessingStep } from "@/lib/ai/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

type SupabaseClient = ReturnType<typeof createAdminClient>;

export type DealProcessingJob = {
  id: string;
  deal_id: string;
  inbound_email_id: string | null;
  requested_by: string | null;
  status: ProcessingJobStatus;
  step: ProcessingJobStep;
  current_attempt: number;
  max_attempts: number;
  next_run_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
  heartbeat_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type ProcessingJobStatus =
  | "queued"
  | "running"
  | "retrying"
  | "completed"
  | "failed_retryable"
  | "failed_final"
  | "cancelled";
type ProcessingJobStep =
  | "queued"
  | "preparing_pages"
  | "classifying"
  | "extracting_fields"
  | "syncing_tasks"
  | "completed"
  | "failed";

const ACTIVE_JOB_STATUSES: ProcessingJobStatus[] = ["queued", "running", "retrying", "failed_retryable"];
const RETRYABLE_JOB_STATUSES: ProcessingJobStatus[] = ["queued", "retrying", "failed_retryable"];
const STALE_RUNNING_MINUTES = 20;

export async function enqueueDealProcessingJob({
  supabase,
  dealId,
  inboundEmailId,
  requestedBy,
  metadata = {},
}: {
  supabase: SupabaseClient;
  dealId: string;
  inboundEmailId?: string | null;
  requestedBy?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const active = await latestActiveJob(supabase, dealId);
  if (active) return active;

  const { data, error } = await supabase
    .from("deal_processing_jobs")
    .insert({
      deal_id: dealId,
      inbound_email_id: inboundEmailId ?? null,
      requested_by: requestedBy ?? null,
      status: "queued",
      step: "queued",
      metadata,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not enqueue processing job");

  await supabase.from("deals").update({ status: "processing", error_message: null }).eq("id", dealId);
  return data as DealProcessingJob;
}

export async function latestDealProcessingJob(supabase: SupabaseClient, dealId: string) {
  const { data, error } = await supabase
    .from("deal_processing_jobs")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DealProcessingJob | null) ?? null;
}

export async function runDealProcessingJobs(limit = 1) {
  const supabase = createAdminClient();
  const results: unknown[] = [];
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(supabase);
    if (!job) break;
    results.push(await runClaimedJob(supabase, job));
  }
  return results;
}

export async function runDealProcessingJob(jobId: string) {
  const supabase = createAdminClient();
  const job = await claimJobById(supabase, jobId);
  if (!job) return { jobId, status: "skipped", reason: "not claimable" };
  return runClaimedJob(supabase, job);
}

async function latestActiveJob(supabase: SupabaseClient, dealId: string) {
  const { data, error } = await supabase
    .from("deal_processing_jobs")
    .select("*")
    .eq("deal_id", dealId)
    .in("status", ACTIVE_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DealProcessingJob | null) ?? null;
}

async function claimNextJob(supabase: SupabaseClient) {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000).toISOString();
  const { data: dueJob, error: dueError } = await supabase
    .from("deal_processing_jobs")
    .select("*")
    .in("status", RETRYABLE_JOB_STATUSES)
    .lte("next_run_at", now)
    .order("next_run_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (dueError) throw new Error(dueError.message);
  if (dueJob) return claimJob(supabase, dueJob as DealProcessingJob);

  const { data: staleJob, error: staleError } = await supabase
    .from("deal_processing_jobs")
    .select("*")
    .eq("status", "running")
    .lt("locked_at", staleBefore)
    .order("locked_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (staleError) throw new Error(staleError.message);
  if (!staleJob) return null;
  return claimJob(supabase, staleJob as DealProcessingJob);
}

async function claimJobById(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("deal_processing_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !isClaimable(data as DealProcessingJob)) return null;
  return claimJob(supabase, data as DealProcessingJob);
}

async function claimJob(supabase: SupabaseClient, job: DealProcessingJob) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("deal_processing_jobs")
    .update({
      status: "running",
      step: "preparing_pages",
      current_attempt: job.current_attempt + 1,
      started_at: job.started_at ?? now,
      locked_at: now,
      locked_by: workerId(),
      heartbeat_at: now,
      last_error: null,
    })
    .eq("id", job.id)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not claim processing job");
  return data as DealProcessingJob;
}

async function runClaimedJob(supabase: SupabaseClient, job: DealProcessingJob) {
  try {
    const pageCount = await preparedPageCount(supabase, job.deal_id);
    if (pageCount <= 0) throw new Error("No prepared pages found for deal. Prepare attachments before processing.");

    await setJobStep(supabase, job.id, "preparing_pages");
    await supabase.from("deals").update({ status: "processing", error_message: null }).eq("id", job.deal_id);
    await supabase.from("audit_logs").insert({
      user_id: job.requested_by,
      deal_id: job.deal_id,
      action: "processing_job_started",
      details: { job_id: job.id, attempt: job.current_attempt, max_attempts: job.max_attempts },
    });

    await processDeal(job.deal_id, {
      onStep: (step) => setJobStep(supabase, job.id, stepToJobStep(step)),
    });

    const completedAt = new Date().toISOString();
    await supabase
      .from("deal_processing_jobs")
      .update({
        status: "completed",
        step: "completed",
        completed_at: completedAt,
        locked_at: null,
        locked_by: null,
        heartbeat_at: completedAt,
        result_json: { page_count: pageCount },
      })
      .eq("id", job.id);
    if (job.inbound_email_id) {
      await supabase
        .from("inbound_emails")
        .update({ status: "matched", error_message: null })
        .eq("id", job.inbound_email_id);
    }
    await supabase.from("audit_logs").insert({
      user_id: job.requested_by,
      deal_id: job.deal_id,
      action: "processing_job_completed",
      details: { job_id: job.id, attempt: job.current_attempt },
    });
    return { jobId: job.id, dealId: job.deal_id, status: "completed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = isRetryableError(message) && job.current_attempt < job.max_attempts;
    const nextRunAt = retryable ? nextRetryAt(job.current_attempt) : null;
    await supabase
      .from("deal_processing_jobs")
      .update({
        status: retryable ? "failed_retryable" : "failed_final",
        step: "failed",
        failed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        heartbeat_at: new Date().toISOString(),
        next_run_at: nextRunAt ?? job.next_run_at,
        last_error: message,
      })
      .eq("id", job.id);
    await supabase
      .from("deals")
      .update({ status: "awaiting_admin_process", error_message: message })
      .eq("id", job.deal_id);
    if (job.inbound_email_id && !retryable) {
      await supabase
        .from("inbound_emails")
        .update({ status: "error", error_message: message })
        .eq("id", job.inbound_email_id);
    }
    await supabase.from("audit_logs").insert({
      user_id: job.requested_by,
      deal_id: job.deal_id,
      action: retryable ? "processing_job_retry_scheduled" : "processing_job_failed",
      details: {
        job_id: job.id,
        attempt: job.current_attempt,
        max_attempts: job.max_attempts,
        error: message,
        next_run_at: nextRunAt,
      },
    });
    return { jobId: job.id, dealId: job.deal_id, status: retryable ? "failed_retryable" : "failed_final", error: message };
  }
}

async function preparedPageCount(supabase: SupabaseClient, dealId: string) {
  const { count, error } = await supabase
    .from("deal_pages")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function setJobStep(supabase: SupabaseClient, jobId: string, step: ProcessingJobStep) {
  const { error } = await supabase
    .from("deal_processing_jobs")
    .update({ step, heartbeat_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
}

function stepToJobStep(step: ProcessingStep): ProcessingJobStep {
  return step;
}

function isClaimable(job: DealProcessingJob) {
  if (RETRYABLE_JOB_STATUSES.includes(job.status)) return new Date(job.next_run_at).getTime() <= Date.now();
  if (job.status !== "running" || !job.locked_at) return false;
  return new Date(job.locked_at).getTime() < Date.now() - STALE_RUNNING_MINUTES * 60_000;
}

function isRetryableError(message: string) {
  return !/(no prepared pages|no pages found|not a valid rendered image|schema|invalid|permission denied|deal not found)/i.test(message);
}

function nextRetryAt(attempt: number) {
  const delayMinutes = [1, 5, 15][Math.max(0, Math.min(attempt - 1, 2))] ?? 15;
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

function workerId() {
  return `deal-processing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
