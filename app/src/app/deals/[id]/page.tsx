import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildChecklistResult } from "@/lib/checklist";
import { ReviewScreen } from "@/components/review/review-screen";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ reminder?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", id).single();
  if (!deal) notFound();

  const { data: pages } = await supabase
    .from("deal_pages")
    .select(
      "page_number, doc_type, doc_confidence, email_attachment_id, standard_form_key, standard_form_number, standard_form_title, standard_form_confidence, classification_reviewed_at, classification_reviewed_by",
    )
    .eq("deal_id", id)
    .order("page_number");

  const { data: fields } = await supabase
    .from("deal_fields")
    .select(
      "field_key, value, confidence, source_doc_type, source_page, source_box, conflict_sources, needs_review, notes, edited_at",
    )
    .eq("deal_id", id);

  const { data: tasks } = await supabase
    .from("deal_tasks")
    .select("id, title, description, status, document_type, requirement_id, auto_created, created_at, completed_at")
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  const { data: reminders } = await supabase
    .from("reminder_emails")
    .select("id, recipient, subject, body, status, drafted_at, sent_at, created_at")
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, email, phone, brokerage")
    .order("name", { ascending: true });

  const { data: requirementStatuses } = await supabase
    .from("deal_requirement_statuses")
    .select("requirement_id, lonewolf_status, lonewolf_uploaded_at, lonewolf_uploaded_by")
    .eq("deal_id", id);

  const { data: emailAttachments } = await supabase
    .from("email_attachments")
    .select(
      "id, original_filename, mime_type, file_size, status, ignore_reason, light_classification_type, light_classification_confidence, received_at, created_at",
    )
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  const { data: auditLogs } = await supabase
    .from("audit_logs")
    .select("id, action, details, created_at")
    .eq("deal_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const checklistResult = buildChecklistResult(
    deal.transaction_type,
    pages ?? [],
    deal.scenario_key,
    fields ?? [],
  );

  return (
    <ReviewScreen
      deal={deal}
      pages={pages ?? []}
      fields={fields ?? []}
      checklistResult={checklistResult}
      tasks={tasks ?? []}
      reminders={reminders ?? []}
      agents={agents ?? []}
      requirementStatuses={requirementStatuses ?? []}
      emailAttachments={emailAttachments ?? []}
      auditLogs={auditLogs ?? []}
      initialReminderOpen={query?.reminder === "1"}
    />
  );
}
