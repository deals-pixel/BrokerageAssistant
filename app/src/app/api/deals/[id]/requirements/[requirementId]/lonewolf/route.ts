import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type LoneWolfStatus = "not_required" | "pending_upload" | "uploaded" | "unknown";

const ALLOWED_STATUSES = new Set<LoneWolfStatus>([
  "not_required",
  "pending_upload",
  "uploaded",
  "unknown",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; requirementId: string }> },
) {
  const { id, requirementId: encodedRequirementId } = await params;
  const requirementId = decodeURIComponent(encodedRequirementId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { status?: LoneWolfStatus } | null;
  const status = body?.status ?? "uploaded";
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid Lone Wolf status" }, { status: 400 });
  }

  const uploaded = status === "uploaded";
  const { data, error } = await supabase
    .from("deal_requirement_statuses")
    .upsert(
      {
        deal_id: id,
        requirement_id: requirementId,
        lonewolf_status: status,
        lonewolf_uploaded_at: uploaded ? new Date().toISOString() : null,
        lonewolf_uploaded_by: uploaded ? user.id : null,
      },
      { onConflict: "deal_id,requirement_id" },
    )
    .select("id, lonewolf_status, lonewolf_uploaded_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not update Lone Wolf status" },
      { status: 500 },
    );
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: status === "uploaded" ? "document_marked_lonewolf_uploaded" : "lonewolf_status_updated",
    details: {
      requirement_id: requirementId,
      lonewolf_status: status,
      lonewolf_uploaded_at: data.lonewolf_uploaded_at,
    },
  });

  return NextResponse.json({ status: data.lonewolf_status, uploadedAt: data.lonewolf_uploaded_at });
}
