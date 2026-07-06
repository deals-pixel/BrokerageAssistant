import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { sortOrder?: number } | null;

  const { data, error } = await supabase
    .from("deal_conditions")
    .insert({
      deal_id: id,
      sort_order: body?.sortOrder ?? 0,
    })
    .select("id, condition_type, due_date, met_date, completed, sort_order")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not add condition" }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "condition_added",
    details: { condition_id: data.id },
  });

  return NextResponse.json({ condition: data });
}
