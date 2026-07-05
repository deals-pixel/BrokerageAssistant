import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const workflowStatusSchema = z.enum(["not_started", "open", "complete", "blocked"]);
const stepStatusSchema = z.enum(["not_started", "in_progress", "completed", "blocked", "skipped"]);

const updateSchema = z
  .object({
    tradeNumber: z.string().trim().max(40).nullable().optional(),
    subTrade: z.string().trim().max(40).nullable().optional(),
    status: workflowStatusSchema.optional(),
    keyInfoStatus: stepStatusSchema.optional(),
    peopleStatus: stepStatusSchema.optional(),
    outsideBrokersStatus: stepStatusSchema.optional(),
    commissionsStatus: stepStatusSchema.optional(),
    initialDocumentsStatus: stepStatusSchema.optional(),
    tradeRecordSheetStatus: stepStatusSchema.optional(),
    signedTradeRecordSheetStatus: stepStatusSchema.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

type UpdatePayload = z.infer<typeof updateSchema>;

const FIELD_MAP: Record<keyof UpdatePayload, string> = {
  tradeNumber: "trade_number",
  subTrade: "sub_trade",
  status: "status",
  keyInfoStatus: "key_info_status",
  peopleStatus: "people_status",
  outsideBrokersStatus: "outside_brokers_status",
  commissionsStatus: "commissions_status",
  initialDocumentsStatus: "initial_documents_status",
  tradeRecordSheetStatus: "trade_record_sheet_status",
  signedTradeRecordSheetStatus: "signed_trade_record_sheet_status",
  notes: "notes",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Lone Wolf workspace update" }, { status: 400 });
  }

  const update: Record<string, string | null> = {};
  for (const [inputKey, column] of Object.entries(FIELD_MAP) as Array<[keyof UpdatePayload, string]>) {
    if (parsed.data[inputKey] !== undefined) {
      update[column] = normalizeNullableText(parsed.data[inputKey]);
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No Lone Wolf workspace fields provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("deal_lonewolf_workspaces")
    .upsert(
      {
        deal_id: id,
        ...update,
        updated_by: user.id,
      },
      { onConflict: "deal_id" },
    )
    .select(
      "deal_id, trade_number, sub_trade, status, key_info_status, people_status, outside_brokers_status, commissions_status, initial_documents_status, trade_record_sheet_status, signed_trade_record_sheet_status, notes, updated_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not update Lone Wolf workspace" },
      { status: 500 },
    );
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "lonewolf_workspace_updated",
    details: {
      updated_fields: Object.keys(update),
      trade_number: data.trade_number,
      status: data.status,
    },
  });

  return NextResponse.json({ workspace: data });
}

function normalizeNullableText(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
