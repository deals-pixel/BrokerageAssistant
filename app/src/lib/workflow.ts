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
  const [{ data: deal, error: dealError }, { data: tasks, error: tasksError }] =
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
  const missingLines = tasks.map((task) => `- ${task.title}`).join("\n");
  const subject = `Missing transaction documents for ${address}`;
  const body = [
    "Hello,",
    "",
    `Please send the following missing document${tasks.length === 1 ? "" : "s"} for ${address}:`,
    "",
    missingLines,
    "",
    scenario ? `Scenario: ${scenario}` : null,
    "",
    "Once received, we will update the transaction file for compliance review.",
  ]
    .filter((line) => line !== null)
    .join("\n");

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
      missing_documents: tasks.map((task) => task.title),
    },
  });

  return reminder;
}

export async function markReminderSent(
  supabase: SupabaseClient,
  dealId: string,
  reminderId: string,
  userId?: string | null,
) {
  const sentAt = new Date().toISOString();
  const { data: reminder, error } = await supabase
    .from("reminder_emails")
    .update({ status: "sent", sent_at: sentAt })
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
    },
  });

  return reminder;
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
