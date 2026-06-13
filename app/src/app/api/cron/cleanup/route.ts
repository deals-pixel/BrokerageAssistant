import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Deletes original PDFs past their retention window (security requirement).
// Call from a scheduler (Railway cron / GitHub Action): GET with x-cron-secret header.
export async function GET(req: Request) {
  if (req.headers.get("x-cron-secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: due } = await supabase
    .from("deals")
    .select("id, original_pdf_path")
    .lte("delete_original_after", new Date().toISOString())
    .is("original_deleted_at", null)
    .not("original_pdf_path", "is", null);

  let deleted = 0;
  for (const deal of due ?? []) {
    const { error } = await supabase.storage.from("deals").remove([deal.original_pdf_path]);
    if (!error) {
      await supabase
        .from("deals")
        .update({ original_deleted_at: new Date().toISOString() })
        .eq("id", deal.id);
      await supabase.from("audit_logs").insert({
        deal_id: deal.id,
        action: "original_pdf_deleted",
        details: { path: deal.original_pdf_path, reason: "retention_policy" },
      });
      deleted++;
    }
  }

  return NextResponse.json({ ok: true, deleted });
}
