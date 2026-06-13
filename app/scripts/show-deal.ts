/* Prints classification + fields for a deal.
   Usage: npx tsx --env-file=.env.local scripts/show-deal.ts <dealId> */
import { createClient } from "@supabase/supabase-js";

const dealId = process.argv[2];
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: deal } = await supabase.from("deals").select("*").eq("id", dealId).single();
  console.log(`Deal: ${deal?.file_name}`);
  console.log(`Status: ${deal?.status} | Type: ${deal?.transaction_type} | Address: ${deal?.property_address}`);
  if (deal?.error_message) console.log(`ERROR: ${deal.error_message}`);

  const { data: pages } = await supabase
    .from("deal_pages")
    .select("page_number, doc_type, doc_confidence")
    .eq("deal_id", dealId)
    .order("page_number");
  console.log("\n=== Page classification ===");
  for (const p of pages ?? []) console.log(`  p${p.page_number}: ${p.doc_type} (${p.doc_confidence})`);

  const { data: fields } = await supabase
    .from("deal_fields")
    .select("field_key, value, confidence, source_doc_type, source_page, needs_review, notes")
    .eq("deal_id", dealId)
    .order("field_key");
  console.log(`\n=== Extracted fields (${fields?.length ?? 0}) ===`);
  for (const f of fields ?? []) {
    const flags = [f.confidence, f.needs_review ? "REVIEW" : null].filter(Boolean).join(", ");
    console.log(`  ${f.field_key} = ${JSON.stringify(f.value)} [${flags}] (src: ${f.source_doc_type} p.${f.source_page})${f.notes ? ` — ${f.notes}` : ""}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
