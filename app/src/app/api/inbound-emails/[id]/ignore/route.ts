import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ignoreInboundEmail } from "@/lib/email-intake-actions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { reason?: string } | null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await ignoreInboundEmail({
      supabase,
      inboundEmailId: id,
      userId: user.id,
      reason: body?.reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not ignore email" },
      { status: 500 },
    );
  }
}
