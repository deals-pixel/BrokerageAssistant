import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { note?: string | null } | null;
  const note = body?.note?.trim() || null;

  const { data: fields, error: fieldsError } = await supabase
    .from("deal_fields")
    .select("field_key, value")
    .eq("deal_id", id)
    .in("field_key", ["deposit_amount", "deposit_holder", "deposit_method"]);
  if (fieldsError) {
    return NextResponse.json({ error: fieldsError.message }, { status: 500 });
  }

  const fieldMap = new Map((fields ?? []).map((field) => [field.field_key, field.value ?? ""]));
  const proofAmount = fieldMap.get("deposit_amount")?.trim() || null;
  const confirmedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("deal_deposit_verifications")
    .upsert(
      {
        deal_id: id,
        status: "confirmed",
        proof_amount: proofAmount,
        confirmed_amount: proofAmount,
        note,
        confirmed_by: user.id,
        confirmed_at: confirmedAt,
      },
      { onConflict: "deal_id" },
    )
    .select("id, status, proof_amount, confirmed_amount, note, confirmed_by, confirmed_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not confirm deposit" },
      { status: 500 },
    );
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "deposit_verified",
    details: {
      proof_amount: proofAmount,
      confirmed_amount: proofAmount,
      deposit_holder: fieldMap.get("deposit_holder") || null,
      deposit_method: fieldMap.get("deposit_method") || null,
      confirmed_at: confirmedAt,
      confirmed_by_email: user.email ?? null,
      note,
    },
  });

  return NextResponse.json({ verification: data });
}
