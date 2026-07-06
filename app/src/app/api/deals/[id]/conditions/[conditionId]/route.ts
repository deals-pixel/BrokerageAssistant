import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ConditionPatch = {
  conditionType?: string | null;
  dueDate?: string | null;
  metDate?: string | null;
  completed?: boolean;
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; conditionId: string }> },
) {
  const { id, conditionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ConditionPatch | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.conditionType !== undefined) update.condition_type = body.conditionType || null;
  if (body.dueDate !== undefined) update.due_date = body.dueDate || null;
  if (body.metDate !== undefined) update.met_date = body.metDate || null;
  if (body.completed !== undefined) update.completed = body.completed;

  const { data, error } = await supabase
    .from("deal_conditions")
    .update(update)
    .eq("id", conditionId)
    .eq("deal_id", id)
    .select("id, condition_type, due_date, met_date, completed, sort_order")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not update condition" }, { status: 500 });
  }

  return NextResponse.json({ condition: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; conditionId: string }> },
) {
  const { id, conditionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("deal_conditions")
    .delete()
    .eq("id", conditionId)
    .eq("deal_id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "condition_removed",
    details: { condition_id: conditionId },
  });

  return NextResponse.json({ ok: true });
}
