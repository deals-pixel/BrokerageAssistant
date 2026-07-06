import { NextResponse } from "next/server";
import { applyEmailBodyFieldsToDeal } from "@/lib/email-intake-actions";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    inboundEmailId?: string;
    fieldKeys?: string[];
  } | null;

  const inboundEmailId = body?.inboundEmailId?.trim();
  const fieldKeys = [...new Set(body?.fieldKeys?.filter((key) => typeof key === "string" && key.trim()) ?? [])];
  if (!inboundEmailId) return NextResponse.json({ error: "Inbound email is required" }, { status: 400 });
  if (fieldKeys.length === 0) return NextResponse.json({ error: "Choose at least one field" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: link, error: linkError } = await supabase
    .from("deal_email_links")
    .select("deal_id")
    .eq("deal_id", id)
    .eq("inbound_email_id", inboundEmailId)
    .maybeSingle();
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });
  if (!link) return NextResponse.json({ error: "Email is not linked to this transaction" }, { status: 404 });

  try {
    const applied = await applyEmailBodyFieldsToDeal(supabase, inboundEmailId, id, {
      fieldKeys,
      userId: user.id,
    });
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      deal_id: id,
      action: "email_body_fields_approved",
      details: { inbound_email_id: inboundEmailId, field_keys: fieldKeys, applied },
    });
    return NextResponse.json({ ok: true, applied });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not apply email body fields" },
      { status: 500 },
    );
  }
}
