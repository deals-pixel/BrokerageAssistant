import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createReminderDraft } from "@/lib/workflow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    agentId?: string | null;
    recipient?: string | null;
  } | null;

  try {
    const reminder = await createReminderDraft(supabase, id, {
      agentId: body?.agentId,
      recipient: body?.recipient,
      createdBy: user.id,
    });
    return NextResponse.json({ reminder });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create reminder draft" },
      { status: 500 },
    );
  }
}
