import type { SupabaseClient } from "@supabase/supabase-js";
import { buildChecklistResult, type ChecklistItem } from "@/lib/checklist";
import { SCENARIO_BY_KEY } from "@/lib/scenario-rules";
import { DOCUMENT_TYPES, type TransactionType } from "@/lib/types";

type TaskRow = {
  id: string;
  requirement_id: string | null;
  status: "open" | "completed" | "dismissed";
};

type ReminderDraftInput = {
  agentId?: string | null;
  recipient?: string | null;
  createdBy?: string | null;
  requestedDocumentIds?: string[];
  followupEnabled?: boolean;
  followupDelayBusinessDays?: number;
  maxFollowups?: number;
  escalateAfterDays?: number;
};

type ReminderDelivery = {
  provider: "postmark";
  messageId?: string | null;
  submittedAt?: string | null;
};

type ReminderDocument = {
  id: string;
  title: string;
  documentType: string | null;
};

export async function syncMissingDocumentTasks(
  supabase: SupabaseClient,
  dealId: string,
  userId?: string | null,
) {
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, transaction_type, scenario_key")
    .eq("id", dealId)
    .single();
  if (dealError || !deal) throw new Error(dealError?.message ?? "Deal not found");

  const [{ data: pages, error: pagesError }, { data: fields, error: fieldsError }] =
    await Promise.all([
      supabase.from("deal_pages").select("page_number, doc_type").eq("deal_id", dealId),
      supabase.from("deal_fields").select("field_key, value").eq("deal_id", dealId),
    ]);

  if (pagesError) throw new Error(pagesError.message);
  if (fieldsError) throw new Error(fieldsError.message);

  const checklist = buildChecklistResult(
    deal.transaction_type as TransactionType,
    pages ?? [],
    deal.scenario_key,
    fields ?? [],
  );
  const missing = checklist.missingRequired;
  const missingIds = new Set(missing.map((item) => item.id));

  const { data: existingTasks, error: taskError } = await supabase
    .from("deal_tasks")
    .select("id, requirement_id, status")
    .eq("deal_id", dealId)
    .eq("auto_created", true);
  if (taskError) throw new Error(taskError.message);

  const existingByRequirement = new Map(
    ((existingTasks ?? []) as TaskRow[])
      .filter((task) => task.requirement_id)
      .map((task) => [task.requirement_id as string, task]),
  );

  let changed = 0;
  for (const item of missing) {
    const existing = existingByRequirement.get(item.id);
    if (!existing) {
      const { error } = await supabase.from("deal_tasks").insert(taskFromChecklistItem(dealId, item));
      if (error) throw new Error(error.message);
      changed += 1;
      continue;
    }

    if (existing.status === "completed") {
      const { error } = await supabase
        .from("deal_tasks")
        .update({ status: "open", completed_at: null })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      changed += 1;
    }
  }

  const completedCandidates = ((existingTasks ?? []) as TaskRow[]).filter(
    (task) => task.requirement_id && !missingIds.has(task.requirement_id) && task.status === "open",
  );
  for (const task of completedCandidates) {
    const { error } = await supabase
      .from("deal_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) throw new Error(error.message);
    changed += 1;
  }

  if (changed > 0) {
    await supabase.from("audit_logs").insert({
      user_id: userId ?? null,
      deal_id: dealId,
      action: "tasks_synced",
      details: {
        missing_required: missing.map((item) => item.label),
        changed,
      },
    });
  }

  return { changed, missingRequired: missing };
}

export async function createReminderDraft(
  supabase: SupabaseClient,
  dealId: string,
  input: ReminderDraftInput,
) {
  const [{ data: deal, error: dealError }, { data: initialTasks, error: tasksError }] =
    await Promise.all([
      supabase
        .from("deals")
        .select("id, property_address, file_name, scenario_key, scenario_label")
        .eq("id", dealId)
        .single(),
      supabase
        .from("deal_tasks")
        .select("id, title, document_type, status")
        .eq("deal_id", dealId)
        .eq("status", "open")
        .order("created_at", { ascending: true }),
    ]);

  if (dealError || !deal) throw new Error(dealError?.message ?? "Deal not found");
  if (tasksError) throw new Error(tasksError.message);

  let tasks = initialTasks ?? [];
  if (tasks.length === 0) {
    await syncMissingDocumentTasks(supabase, dealId, input.createdBy);
    const { data: syncedTasks, error: syncedTasksError } = await supabase
      .from("deal_tasks")
      .select("id, title, document_type, status")
      .eq("deal_id", dealId)
      .eq("status", "open")
      .order("created_at", { ascending: true });
    if (syncedTasksError) throw new Error(syncedTasksError.message);
    tasks = syncedTasks ?? [];
  }

  const selectedIds = new Set(input.requestedDocumentIds?.filter(Boolean) ?? []);
  if (selectedIds.size > 0) {
    tasks = tasks.filter((task) => selectedIds.has(task.id));
  }
  if (!tasks || tasks.length === 0) throw new Error("There are no open missing-document tasks.");

  let recipient = input.recipient?.trim() ?? "";
  if (!recipient && input.agentId) {
    const { data: agent, error } = await supabase
      .from("agents")
      .select("email")
      .eq("id", input.agentId)
      .single();
    if (error) throw new Error(error.message);
    recipient = agent?.email ?? "";
  }
  if (!recipient) throw new Error("Choose or enter a reminder recipient.");

  const address = deal.property_address ?? deal.file_name;
  const scenario = deal.scenario_label ?? (deal.scenario_key ? SCENARIO_BY_KEY[deal.scenario_key]?.label : null);
  const requestedDocuments: ReminderDocument[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    documentType: task.document_type,
  }));
  const missingLines = tasks.map((task, index) => `${index + 1}. ${task.title.replace(/^Request\s+/i, "")}`).join("\n");
  const subject = `Action required: Missing documents for ${address}`;
  const uploadUrl = reminderUploadUrl(dealId);
  const body = [
    "Hello,",
    "",
    "We are completing the compliance package for:",
    "",
    address,
    scenario ? `Scenario: ${scenario}` : null,
    "",
    "The following documents are still required:",
    "",
    missingLines,
    "",
    "Please reply to this email with the documents attached, or upload them using the transaction intake link below:",
    "",
    uploadUrl,
    "",
    "If these have already been sent, please disregard this reminder or reply and let us know.",
    "",
    "Thank you,",
    "Team Admiral",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const followupDelayBusinessDays = clampNumber(input.followupDelayBusinessDays, 1, 10, 2);
  const maxFollowups = clampNumber(input.maxFollowups, 0, 5, 2);
  const escalateAfterDays = clampNumber(input.escalateAfterDays, 1, 30, 7);
  const followupEnabled = Boolean(input.followupEnabled);

  const { data: reminder, error: insertError } = await supabase
    .from("reminder_emails")
    .insert({
      deal_id: dealId,
      recipient,
      subject,
      body,
      status: "draft",
      drafted_at: new Date().toISOString(),
      created_by: input.createdBy ?? null,
      requested_documents: requestedDocuments,
      followup_enabled: followupEnabled,
      next_followup_at: null,
      max_followups: followupEnabled ? maxFollowups : 0,
      followup_delay_business_days: followupDelayBusinessDays,
      escalate_after_days: escalateAfterDays,
    })
    .select()
    .single();
  if (insertError || !reminder) throw new Error(insertError?.message ?? "Could not create reminder");

  await supabase.from("audit_logs").insert({
    user_id: input.createdBy ?? null,
    deal_id: dealId,
    action: "reminder_drafted",
    details: {
      reminder_id: reminder.id,
      recipient,
      missing_documents: requestedDocuments.map((task) => task.title),
      followup_enabled: followupEnabled,
      followup_delay_business_days: followupDelayBusinessDays,
      max_followups: followupEnabled ? maxFollowups : 0,
      escalate_after_days: escalateAfterDays,
    },
  });

  return reminder;
}

export async function markReminderSent(
  supabase: SupabaseClient,
  dealId: string,
  reminderId: string,
  userId?: string | null,
  delivery?: ReminderDelivery,
) {
  const sentAt = new Date().toISOString();
  const { data: current, error: currentError } = await supabase
    .from("reminder_emails")
    .select("followup_enabled, followup_delay_business_days, max_followups")
    .eq("deal_id", dealId)
    .eq("id", reminderId)
    .single();
  if (currentError || !current) throw new Error(currentError?.message ?? "Reminder not found");

  const nextFollowupAt =
    current.followup_enabled && current.max_followups > 0
      ? addBusinessDays(new Date(sentAt), current.followup_delay_business_days ?? 2).toISOString()
      : null;
  const { data: reminder, error } = await supabase
    .from("reminder_emails")
    .update({ status: "sent", sent_at: sentAt, next_followup_at: nextFollowupAt })
    .eq("deal_id", dealId)
    .eq("id", reminderId)
    .select("id, recipient")
    .single();
  if (error || !reminder) throw new Error(error?.message ?? "Could not mark reminder sent");

  await supabase.from("audit_logs").insert({
    user_id: userId ?? null,
    deal_id: dealId,
    action: "reminder_sent",
    details: {
      reminder_id: reminder.id,
      recipient: reminder.recipient,
      sent_at: sentAt,
      next_followup_at: nextFollowupAt,
      delivery: delivery ?? null,
    },
  });

  return reminder;
}

function reminderUploadUrl(dealId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!baseUrl) return "Upload missing documents through the transaction intake link.";
  return `${baseUrl}/deals/${dealId}?reminder=1`;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function addBusinessDays(start: Date, businessDays: number) {
  const date = new Date(start);
  let remaining = businessDays;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return date;
}

function taskFromChecklistItem(dealId: string, item: ChecklistItem) {
  const docLabel = DOCUMENT_TYPES[item.docType] ?? item.label;
  const referenceForms = item.standardForms?.length
    ? ` Expected standard form${item.standardForms.length === 1 ? "" : "s"}: ${item.standardForms.join("; ")}.`
    : "";
  return {
    deal_id: dealId,
    requirement_id: item.id,
    document_type: item.docType,
    title: item.taskTitle ?? `Request ${item.label}`,
    description: item.condition
      ? `${item.label}. ${item.condition}${referenceForms}`
      : `Missing required document: ${docLabel}.${referenceForms}`,
    status: "open",
    auto_created: true,
  };
}
