import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDraftDealFromInboundEmail } from "@/lib/email-intake-actions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    propertyAddress?: string;
    transactionType?: string;
  } | null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await createDraftDealFromInboundEmail({
      supabase,
      inboundEmailId: id,
      userId: user.id,
      propertyAddress: body?.propertyAddress,
      transactionType: body?.transactionType,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create draft transaction" },
      { status: 500 },
    );
  }
}
