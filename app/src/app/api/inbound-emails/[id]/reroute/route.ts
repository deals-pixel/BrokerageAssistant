import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { queueInboundEmailForRouting } from "@/lib/email-intake-actions";
import { processInboundEmailRouting } from "@/lib/email-routing-job";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await queueInboundEmailForRouting({ supabase, inboundEmailId: id, userId: user.id });
    const result = await processInboundEmailRouting(id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reroute email" },
      { status: 500 },
    );
  }
}
