import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dealToCsv, dealToSummaryText } from "@/lib/export/csv";
import { generateDealSheetPdf } from "@/lib/export/pdf";
import { buildChecklist } from "@/lib/checklist";

// GET /api/deals/:id/export?format=csv|summary|pdf
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") ?? "csv";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: deal } = await supabase.from("deals").select("*").eq("id", id).single();
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

  const { data: fields } = await supabase
    .from("deal_fields")
    .select("field_key, value")
    .eq("deal_id", id);
  if (!fields) return NextResponse.json({ error: "No fields" }, { status: 404 });

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: `export_${format}`,
  });
  await supabase.from("deals").update({ status: "exported" }).eq("id", id);

  const baseName = (deal.property_address ?? deal.file_name ?? "deal")
    .replace(/[^\w\- ]/g, "")
    .slice(0, 60)
    .trim()
    .replace(/\s+/g, "_");

  if (format === "csv") {
    return new NextResponse(dealToCsv(fields), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  }

  if (format === "summary") {
    return new NextResponse(
      dealToSummaryText(fields, {
        fileName: deal.file_name,
        transactionType: deal.transaction_type,
      }),
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  if (format === "pdf") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .single();
    const { data: pages } = await supabase
      .from("deal_pages")
      .select("page_number, doc_type")
      .eq("deal_id", id)
      .order("page_number");
    const pdf = await generateDealSheetPdf(fields, {
      fileName: deal.file_name,
      transactionType: deal.transaction_type,
      reviewedBy: profile?.full_name || profile?.email,
      checklist: buildChecklist(deal.transaction_type, pages ?? []),
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}_deal_sheet.pdf"`,
      },
    });
  }

  return NextResponse.json({ error: "Unknown format" }, { status: 400 });
}
