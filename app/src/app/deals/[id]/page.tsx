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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", id).single();
  if (!deal) notFound();

  if (
    user &&
    deal.attention_at &&
    (!deal.attention_cleared_at ||
      new Date(deal.attention_cleared_at).getTime() < new Date(deal.attention_at).getTime())
  ) {
    await supabase
      .from("deals")
      .update({
        attention_cleared_at: new Date().toISOString(),
        attention_cleared_by: user.id,
      })
      .eq("id", id);
  }

  const { data: pages } = await supabase
    .from("deal_pages")
    .select(
      "page_number, doc_type, doc_confidence, email_attachment_id, standard_form_key, standard_form_number, standard_form_title, standard_form_confidence, page_role, page_role_confidence, extraction_skip_reason, classification_reviewed_at, classification_reviewed_by",
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
    .select(
      "id, recipient, subject, body, status, drafted_at, sent_at, created_at, requested_documents, followup_enabled, next_followup_at, max_followups, followup_count, followup_delay_business_days, escalate_after_days, paused_at",
    )
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  const { data: emailLinks } = await supabase
    .from("deal_email_links")
    .select("inbound_email_id, inbound_emails(id, subject, from_email, from_name, received_at, routing_json)")
    .eq("deal_id", id);

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, email, phone, brokerage")
    .order("name", { ascending: true });

  const { data: requirementStatuses } = await supabase
    .from("deal_requirement_statuses")
    .select("requirement_id, lonewolf_status, lonewolf_uploaded_at, lonewolf_uploaded_by")
    .eq("deal_id", id);

  const { data: loneWolfWorkspace } = await supabase
    .from("deal_lonewolf_workspaces")
    .select(
      "deal_id, trade_number, sub_trade, status, key_info_status, people_status, outside_brokers_status, commissions_status, initial_documents_status, trade_record_sheet_status, signed_trade_record_sheet_status, notes, updated_at",
    )
    .eq("deal_id", id)
    .maybeSingle();

  const { data: conditions } = await supabase
    .from("deal_conditions")
    .select("id, condition_type, due_date, met_date, completed, sort_order")
    .eq("deal_id", id)
    .order("sort_order", { ascending: true });

  const { data: depositVerification } = await supabase
    .from("deal_deposit_verifications")
    .select("id, status, proof_amount, confirmed_amount, note, source_inbound_email_id, source_email, source_name, source_received_at, confirmed_by, confirmed_at, profiles(email, full_name)")
    .eq("deal_id", id)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: emailAttachments } = await supabase
    .from("email_attachments")
    .select(
      "id, original_filename, mime_type, file_size, status, ignore_reason, light_classification_type, light_classification_confidence, received_at, created_at",
    )
    .eq("deal_id", id)
    .order("created_at", { ascending: false });

  const { data: auditLogs } = await supabase
    .from("audit_logs")
    .select("id, user_id, action, details, created_at, profiles(email, full_name)")
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
      inboundEmailContacts={
        (emailLinks ?? [])
          .map((link) => {
            const email = Array.isArray(link.inbound_emails) ? link.inbound_emails[0] : link.inbound_emails;
            return email?.from_email ? { email: email.from_email, name: email.from_name ?? null } : null;
          })
          .filter((item): item is { email: string; name: string | null } => Boolean(item))
      }
      linkedInboundEmails={
        (emailLinks ?? [])
          .map((link) => {
            const email = Array.isArray(link.inbound_emails) ? link.inbound_emails[0] : link.inbound_emails;
            return email
              ? {
                  id: email.id ?? link.inbound_email_id,
                  subject: email.subject ?? null,
                  from_email: email.from_email ?? null,
                  from_name: email.from_name ?? null,
                  received_at: email.received_at ?? null,
                  routing_json: email.routing_json ?? null,
                }
              : null;
          })
          .filter(
            (item): item is {
              id: string;
              subject: string | null;
              from_email: string | null;
              from_name: string | null;
              received_at: string | null;
              routing_json: Record<string, unknown> | null;
            } => Boolean(item),
          )
      }
      agents={agents ?? []}
      requirementStatuses={requirementStatuses ?? []}
      conditions={conditions ?? []}
      loneWolfWorkspace={loneWolfWorkspace ?? null}
      depositVerification={depositVerification ?? null}
      emailAttachments={emailAttachments ?? []}
      auditLogs={auditLogs ?? []}
      initialReminderOpen={query?.reminder === "1"}
    />
  );
}
