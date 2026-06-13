import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processDeal } from "@/lib/ai/pipeline";

export const maxDuration = 600;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "process_started",
  });

  try {
    await processDeal(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Processing failed" },
      { status: 500 },
    );
  }
}
