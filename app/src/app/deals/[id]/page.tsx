import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildChecklistResult } from "@/lib/checklist";
import { ReviewScreen } from "@/components/review/review-screen";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", id).single();
  if (!deal) notFound();

  const { data: pages } = await supabase
    .from("deal_pages")
    .select("page_number, doc_type, doc_confidence")
    .eq("deal_id", id)
    .order("page_number");

  const { data: fields } = await supabase
    .from("deal_fields")
    .select("field_key, value, confidence, source_doc_type, source_page, source_box, conflict_sources, needs_review, notes")
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
      auditLogs={auditLogs ?? []}
    />
  );
}
