import { NextResponse } from "next/server";
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
    const reminder = await markReminderSent(supabase, id, reminderId, user.id);
    return NextResponse.json({ reminder });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not mark reminder sent" },
      { status: 500 },
    );
  }
}
