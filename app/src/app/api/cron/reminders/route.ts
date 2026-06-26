import { NextResponse } from "next/server";
import { sendPostmarkEmail } from "@/lib/postmark";
import { createAdminClient } from "@/lib/supabase/admin";
import { addBusinessDays } from "@/lib/workflow";

type RequestedDocument = {
  id?: string;
  title?: string;
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
  deals?: { status: string | null } | { status: string | null }[] | null;
};

export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: due, error } = await supabase
    .from("reminder_emails")
    .select(
      "id, deal_id, recipient, subject, body, requested_documents, followup_count, max_followups, followup_delay_business_days, deals(status)",
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
    const delivery = await sendPostmarkEmail({
      to: reminder.recipient,
      subject: `Follow-up ${followupNumber}: ${reminder.subject}`,
      textBody: followupBody(reminder.body),
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

function followupBody(originalBody: string) {
  return [
    "Hello,",
    "",
    "This is a follow-up on the missing documents below.",
    "",
    originalBody.replace(/^Hello,\s*/i, "").trim(),
  ].join("\n");
}
