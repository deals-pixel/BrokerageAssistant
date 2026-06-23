import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { restoreInboundEmailToReview } from "@/lib/email-intake-actions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await restoreInboundEmailToReview({
      supabase,
      inboundEmailId: id,
      userId: user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not restore inbound email" },
      { status: 500 },
    );
  }
}
