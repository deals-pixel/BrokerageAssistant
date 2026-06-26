import { NextResponse } from "next/server";
import { sendPostmarkEmail } from "@/lib/postmark";
import { createClient } from "@/lib/supabase/server";
import { markReminderSent } from "@/lib/workflow";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; reminderId: string }> },
) {
  const { id, reminderId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { data: draft, error: draftError } = await supabase
      .from("reminder_emails")
      .select("id, recipient, subject, body, status")
      .eq("deal_id", id)
      .eq("id", reminderId)
      .single();
    if (draftError || !draft) throw new Error(draftError?.message ?? "Reminder draft not found");
    if (draft.status === "sent") throw new Error("This reminder has already been sent.");

    const delivery = await sendPostmarkEmail({
      to: draft.recipient,
      subject: draft.subject,
      textBody: draft.body,
    });

    const reminder = await markReminderSent(supabase, id, reminderId, user.id, {
      provider: "postmark",
      messageId: delivery.messageId,
      submittedAt: delivery.submittedAt,
    });
    return NextResponse.json({ reminder });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not send reminder" },
      { status: 500 },
    );
  }
}
