/* End-to-end test: uploads a pre-rendered example package (original PDF +
   page JPEGs) exactly as the browser uploader would, then runs the AI
   pipeline and prints results.
   Usage: npx tsx --env-file=.env.local scripts/e2e.ts */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { processDeal } from "../src/lib/ai/pipeline";

const PDF = "D:/01_Project/08_BrokerageAssistant/Example/1 Valleyview - docs.pdf";
const PAGES_DIR = "D:/01_Project/08_BrokerageAssistant/_e2e/valleyview";
const USER_EMAIL = "sylviewang979@gmail.com";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", USER_EMAIL)
    .single();
  if (!profile) throw new Error("Staff user not found");

  const pageFiles = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".jpg")).sort();
  console.log(`Creating deal (${pageFiles.length} pages)…`);

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .insert({
      created_by: profile.id,
      file_name: "1 Valleyview - docs.pdf",
      file_size: readFileSync(PDF).length,
      page_count: pageFiles.length,
      status: "uploaded",
      delete_original_after: new Date(Date.now() + 14 * 86400_000).toISOString(),
    })
    .select()
    .single();
  if (dealErr || !deal) throw new Error(dealErr?.message);

  const originalPath = `${deal.id}/original.pdf`;
  const { error: pdfErr } = await supabase.storage
    .from("deals")
    .upload(originalPath, readFileSync(PDF), { contentType: "application/pdf" });
  if (pdfErr) throw new Error(`PDF upload: ${pdfErr.message}`);
  await supabase.from("deals").update({ original_pdf_path: originalPath }).eq("id", deal.id);

  for (let i = 0; i < pageFiles.length; i++) {
    const pageNum = i + 1;
    const imagePath = `${deal.id}/pages/p${String(pageNum).padStart(3, "0")}.jpg`;
    const { error: imgErr } = await supabase.storage
      .from("deals")
      .upload(imagePath, readFileSync(join(PAGES_DIR, pageFiles[i])), {
        contentType: "image/jpeg",
      });
    if (imgErr) throw new Error(`Page ${pageNum} upload: ${imgErr.message}`);
    const { error: rowErr } = await supabase
      .from("deal_pages")
      .insert({ deal_id: deal.id, page_number: pageNum, image_path: imagePath });
    if (rowErr) throw new Error(`Page ${pageNum} row: ${rowErr.message}`);
  }
  console.log(`Uploaded. Deal id: ${deal.id}`);

  console.log("Running AI pipeline (classify → extract → merge → validate)…");
  const started = Date.now();
  await processDeal(deal.id);
  console.log(`Pipeline finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const { data: pages } = await supabase
    .from("deal_pages")
    .select("page_number, doc_type, doc_confidence")
    .eq("deal_id", deal.id)
    .order("page_number");
  console.log("\n=== Page classification ===");
  for (const p of pages ?? []) {
    console.log(`  p${p.page_number}: ${p.doc_type} (${p.doc_confidence})`);
  }

  const { data: fields } = await supabase
    .from("deal_fields")
    .select("field_key, value, confidence, source_doc_type, source_page, needs_review, notes")
    .eq("deal_id", deal.id)
    .order("field_key");
  console.log(`\n=== Extracted fields (${fields?.length ?? 0}) ===`);
  for (const f of fields ?? []) {
    const flags = [f.confidence, f.needs_review ? "REVIEW" : null].filter(Boolean).join(", ");
    console.log(`  ${f.field_key} = ${JSON.stringify(f.value)} [${flags}] (src: ${f.source_doc_type} p.${f.source_page})${f.notes ? ` — ${f.notes}` : ""}`);
  }

  const { data: dealAfter } = await supabase
    .from("deals")
    .select("status, transaction_type, property_address")
    .eq("id", deal.id)
    .single();
  console.log(`\nDeal status: ${dealAfter?.status}, type: ${dealAfter?.transaction_type}, address: ${dealAfter?.property_address}`);
  console.log(`Review at: http://localhost:3000/deals/${deal.id}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
