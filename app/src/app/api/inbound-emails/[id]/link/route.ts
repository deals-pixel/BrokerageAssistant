import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { confirmInboundEmailMatch } from "@/lib/email-intake-actions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    dealId?: string;
    matchScore?: number;
    matchReason?: string;
  } | null;
  if (!body?.dealId) return NextResponse.json({ error: "Transaction is required" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await confirmInboundEmailMatch({
      supabase,
      inboundEmailId: id,
      dealId: body.dealId,
      userId: user.id,
      matchScore: body.matchScore,
      matchReason: body.matchReason,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not link email" },
      { status: 500 },
    );
  }
}
