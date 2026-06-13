import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildChecklist } from "@/lib/checklist";
import { ReviewScreen } from "@/components/review/review-screen";

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: deal } = await supabase.from("deals").select("*").eq("id", id).single();
  if (!deal) notFound();

  const { data: pages } = await supabase
    .from("deal_pages")
    .select("page_number, doc_type, doc_confidence")
    .eq("deal_id", id)
    .order("page_number");

  const { data: fields } = await supabase
    .from("deal_fields")
    .select("field_key, value, confidence, source_doc_type, source_page, needs_review, notes")
    .eq("deal_id", id);

  const checklist = buildChecklist(deal.transaction_type, pages ?? []);

  return (
    <ReviewScreen
      deal={deal}
      pages={pages ?? []}
      fields={fields ?? []}
      checklist={checklist}
    />
  );
}
