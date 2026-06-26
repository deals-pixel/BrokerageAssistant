import { NextResponse } from "next/server";
import { INTAKE_ADDRESS } from "@/lib/intake-address";
import { sendPostmarkEmail } from "@/lib/postmark";
import { SCENARIO_BY_KEY } from "@/lib/scenario-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { addBusinessDays } from "@/lib/workflow";

type RequestedDocument = {
  id?: string;
  title?: string;
};

type DealInfo = {
  status: string | null;
  transaction_code: string | null;
  property_address: string | null;
  file_name: string | null;
  scenario_key: string | null;
  scenario_label: string | null;
};

type DueReminder = {
  id: string;
  deal_id: string;
  recipient: string;
  subject: string;
  body: string;
  requested_documents: RequestedDocument[] | null;
  followup_count: number;
  max_followups: number;
  followup_delay_business_days: number;
  deals?: DealInfo | DealInfo[] | null;
};

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: due, error } = await supabase
    .from("reminder_emails")
    .select(
      "id, deal_id, recipient, subject, body, requested_documents, followup_count, max_followups, followup_delay_business_days, deals(status, transaction_code, property_address, file_name, scenario_key, scenario_label)",
    )
    .eq("status", "sent")
    .eq("followup_enabled", true)
    .is("paused_at", null)
    .lte("next_followup_at", new Date().toISOString())
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const reminder of ((due ?? []) as DueReminder[])) {
    if (reminder.followup_count >= reminder.max_followups) continue;
    const stopReason = await reminderStopReason(supabase, reminder);
    if (stopReason) {
      await supabase
        .from("reminder_emails")
        .update({ paused_at: new Date().toISOString(), next_followup_at: null })
        .eq("id", reminder.id);
      await supabase.from("audit_logs").insert({
        deal_id: reminder.deal_id,
        action: "reminder_followup_stopped",
        details: { reminder_id: reminder.id, reason: stopReason },
      });
      results.push({ reminderId: reminder.id, status: "stopped", reason: stopReason });
      continue;
    }

    const followupNumber = reminder.followup_count + 1;
    const followupEmail = await buildFollowupEmail(supabase, reminder, followupNumber);
    const delivery = await sendPostmarkEmail({
      to: reminder.recipient,
      subject: followupEmail.subject,
      textBody: followupEmail.body,
    });
    const nextCount = reminder.followup_count + 1;
    const nextFollowupAt =
      nextCount < reminder.max_followups
        ? addBusinessDays(new Date(), reminder.followup_delay_business_days || 2).toISOString()
        : null;

    await supabase
      .from("reminder_emails")
      .update({
        followup_count: nextCount,
        last_followup_at: new Date().toISOString(),
        next_followup_at: nextFollowupAt,
      })
      .eq("id", reminder.id);
    await supabase.from("audit_logs").insert({
      deal_id: reminder.deal_id,
      action: "reminder_followup_sent",
      details: {
        reminder_id: reminder.id,
        followup_number: followupNumber,
        next_followup_at: nextFollowupAt,
        delivery,
      },
    });
    results.push({ reminderId: reminder.id, status: "sent", followupNumber });
  }

  return NextResponse.json({ ok: true, results });
}

async function reminderStopReason(supabase: ReturnType<typeof createAdminClient>, reminder: DueReminder) {
  const deal = Array.isArray(reminder.deals) ? reminder.deals[0] : reminder.deals;
  if (deal?.status === "closed" || deal?.status === "cancelled" || deal?.status === "archived") {
    return "deal_closed_or_cancelled";
  }

  const requestedIds = (reminder.requested_documents ?? []).map((doc) => doc.id).filter(Boolean);
  if (requestedIds.length === 0) return null;

  const { data: tasks } = await supabase
    .from("deal_tasks")
    .select("id, status")
    .in("id", requestedIds);
  const remaining = (tasks ?? []).filter((task) => task.status === "open");
  return remaining.length === 0 ? "all_requested_documents_resolved" : null;
}

async function buildFollowupEmail(
  supabase: ReturnType<typeof createAdminClient>,
  reminder: DueReminder,
  followupNumber: number,
) {
  const deal = currentDeal(reminder);
  const dealNumber = formatDealNumber(deal?.transaction_code ?? null);
  const address = deal?.property_address ?? deal?.file_name ?? null;
  const dealTitle = formatDealTitle(dealNumber, address);
  const scenario =
    deal?.scenario_label ?? (deal?.scenario_key ? SCENARIO_BY_KEY[deal.scenario_key]?.label : null) ?? "Not specified";
  const agentName = await resolveAgentName(supabase, reminder.recipient);
  const missingDocumentList = numberedDocumentList(reminder.requested_documents ?? []);
  const uploadLink = reminderUploadUrl({ dealNumber, address });

  if (followupNumber === 1) {
    return {
      subject: `Follow-up: Missing documents for transaction ${dealTitle}`,
      body: [
        `Hello ${agentName},`,
        "",
        "This is a follow-up regarding the transaction file for:",
        "",
        dealTitle,
        `Scenario: ${scenario}`,
        "",
        "The following documents are still outstanding:",
        "",
        missingDocumentList,
        "",
        "Please send the missing documents by replying to this email, or upload them using the link below:",
        "",
        uploadLink,
        "",
        "Once received, we will update the deal file.",
        "",
        "If these documents have already been sent, please reply and let us know so we can update the file status.",
        "",
        "Thank you,",
        "Team Admiral",
      ].join("\n"),
    };
  }

  const subjectPrefix = followupNumber === 2 ? "Second follow-up" : `Follow-up ${followupNumber}`;
  return {
    subject: `${subjectPrefix}: Documents still required for transaction ${dealNumber ?? dealTitle}`,
    body: [
      `Hello ${agentName},`,
      "",
      "We are following up again regarding the transaction file for:",
      "",
      dealTitle,
      "",
      "The file is still missing the following required documents:",
      "",
      missingDocumentList,
      "",
      "These documents are needed before the file can be completed.",
      "",
      "Please send the documents by replying to this email, or upload them here:",
      "",
      uploadLink,
      "",
      "If you have already provided these documents, please reply to this email so we can confirm and update the file.",
      "",
      "Thank you,",
      "Team Admiral",
    ].join("\n"),
  };
}

function currentDeal(reminder: DueReminder) {
  return Array.isArray(reminder.deals) ? reminder.deals[0] : reminder.deals;
}

async function resolveAgentName(supabase: ReturnType<typeof createAdminClient>, recipient: string) {
  const { data } = await supabase
    .from("agents")
    .select("name")
    .eq("email", recipient)
    .maybeSingle();
  return data?.name?.trim() || recipientNameFromEmail(recipient);
}

function numberedDocumentList(documents: RequestedDocument[]) {
  if (documents.length === 0) return "1. Missing transaction documents";
  return documents.map((doc, index) => `${index + 1}. ${cleanDocumentTitle(doc.title ?? "Missing transaction document")}`).join("\n");
}

function cleanDocumentTitle(title: string) {
  return title.replace(/^Request\s+/i, "").trim();
}

function formatDealNumber(transactionCode: string | null) {
  const value = transactionCode?.trim();
  if (!value) return null;
  return value.startsWith("#") ? value : `#${value}`;
}

function formatDealTitle(dealNumber: string | null, address: string | null) {
  if (dealNumber && address) return `${dealNumber} - ${address}`;
  return dealNumber ?? address ?? "this transaction";
}

function reminderUploadUrl({ dealNumber, address }: { dealNumber: string | null; address: string | null }) {
  const subject = encodeURIComponent(`Missing documents for ${formatDealTitle(dealNumber, address)}`);
  return `mailto:${INTAKE_ADDRESS}?subject=${subject}`;
}

function recipientNameFromEmail(recipient: string) {
  const localPart = recipient.split("@")[0]?.trim();
  if (!localPart) return "there";
  const words = localPart
    .split(/[._-]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return "there";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
