import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, attention_at, attention_cleared_at")
    .eq("id", id)
    .single();

  if (dealError || !deal) {
    return NextResponse.json({ error: dealError?.message ?? "Transaction not found" }, { status: 404 });
  }

  if (!deal.attention_at || isAttentionCleared(deal.attention_at, deal.attention_cleared_at)) {
    return NextResponse.json({ ok: true, cleared: false });
  }

  const { error } = await supabase
    .from("deals")
    .update({
      attention_cleared_at: new Date().toISOString(),
      attention_cleared_by: user.id,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared: true });
}

function isAttentionCleared(attentionAt: string, clearedAt: string | null) {
  if (!clearedAt) return false;
  return new Date(clearedAt).getTime() >= new Date(attentionAt).getTime();
}
