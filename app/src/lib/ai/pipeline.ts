import { createAdminClient } from "@/lib/supabase/admin";
import { classifyPages } from "./classify";
import { extractFromDocument, EXTRACTABLE_DOCS } from "./extract";
import { mergeExtractions } from "./merge";
import { validateFields } from "./validate";
import { buildChecklistResult } from "@/lib/checklist";
import { syncMissingDocumentTasks } from "@/lib/workflow";
import type { DocumentType } from "@/lib/types";
import type { FieldExtraction } from "./schemas";

type PageImage = { pageNumber: number; base64: string; mediaType: "image/jpeg" };

/**
 * Full pipeline for one deal: download page images from storage,
 * classify → extract per document → merge → validate → persist.
 */
export async function processDeal(dealId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: deal, error: dealErr } = await supabase
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .single();
  if (dealErr || !deal) throw new Error(`Deal not found: ${dealErr?.message}`);

  await supabase.from("deals").update({ status: "processing", error_message: null }).eq("id", dealId);

  try {
    const { data: pages, error: pagesErr } = await supabase
      .from("deal_pages")
      .select("*")
      .eq("deal_id", dealId)
      .order("page_number");
    if (pagesErr || !pages?.length) throw new Error("No pages found for deal");

    // Download page images
    const images: PageImage[] = [];
    for (const p of pages) {
      const { data: blob, error: dlErr } = await supabase.storage
        .from("deals")
        .download(p.image_path);
      if (dlErr || !blob) throw new Error(`Failed to download page ${p.page_number}: ${dlErr?.message}`);
      images.push({
        pageNumber: p.page_number,
        base64: Buffer.from(await blob.arrayBuffer()).toString("base64"),
        mediaType: "image/jpeg",
      });
    }

    // Step 2: classify
    const classification = await classifyPages(images);
    for (const c of classification.pages) {
      await supabase
        .from("deal_pages")
        .update({ doc_type: c.doc_type, doc_confidence: c.confidence })
        .eq("deal_id", dealId)
        .eq("page_number", c.page_number);
    }

    // Step 3: extract per document group
    const byDoc = new Map<DocumentType, PageImage[]>();
    for (const c of classification.pages) {
      const img = images.find((i) => i.pageNumber === c.page_number);
      if (!img) continue;
      const dt = c.doc_type as DocumentType;
      if (!EXTRACTABLE_DOCS.includes(dt)) continue;
      byDoc.set(dt, [...(byDoc.get(dt) ?? []), img]);
    }

    const extractions: { docType: DocumentType; extraction: FieldExtraction }[] = [];
    for (const [docType, docImages] of byDoc) {
      const extraction = await extractFromDocument(docType, docImages);
      extractions.push({ docType, extraction });
    }

    // Steps 4–5: merge + validate
    let merged = mergeExtractions(extractions);
    merged = validateFields(merged, classification.transaction_type);

    // Persist fields
    await supabase.from("deal_fields").delete().eq("deal_id", dealId);
    if (merged.length > 0) {
      const rows = merged.map((f) => ({
        deal_id: dealId,
        field_key: f.key,
        value: f.value,
        confidence: f.confidence,
        source_doc_type: f.sourceDocumentType ?? null,
        source_page: f.sourcePage ?? null,
        source_box: f.sourceBox ?? null,
        conflict_sources: f.conflictSources ?? null,
        needs_review: f.needsReview,
        notes: f.notes ?? null,
      }));
      const { error: insErr } = await supabase.from("deal_fields").insert(rows);
      if (insErr) throw new Error(`Failed to save fields: ${insErr.message}`);
    }

    const address = merged.find((f) => f.key === "property_address")?.value ?? null;
    const checklist = buildChecklistResult(
      classification.transaction_type,
      classification.pages.map((page) => ({
        page_number: page.page_number,
        doc_type: page.doc_type,
      })),
      null,
      merged.map((field) => ({ field_key: field.key, value: field.value })),
    );
    await supabase
      .from("deals")
      .update({
        status: "extracted",
        transaction_type: classification.transaction_type,
        property_address: address,
        scenario_key: checklist.scenario.key,
        scenario_label: checklist.scenario.label,
      })
      .eq("id", dealId);

    await syncMissingDocumentTasks(supabase, dealId);

    await supabase.from("audit_logs").insert({
      deal_id: dealId,
      action: "pipeline_completed",
      details: {
        pages: classification.pages.length,
        documents: [...byDoc.keys()],
        fields: merged.length,
        scenario: checklist.scenario.key,
        missing_required: checklist.missingRequired.map((item) => item.label),
      },
    });
  } catch (err) {
    await supabase
      .from("deals")
      .update({ status: "error", error_message: err instanceof Error ? err.message : String(err) })
      .eq("id", dealId);
    await supabase.from("audit_logs").insert({
      deal_id: dealId,
      action: "pipeline_failed",
      details: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
