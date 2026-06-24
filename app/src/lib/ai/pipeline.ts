import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyPages } from "./classify";
import { extractFromDocument, EXTRACTABLE_DOCS } from "./extract";
import { mergeExtractions } from "./merge";
import { validateFields } from "./validate";
import {
  applyTemplateSourceFallbacks,
  buildPageStandardFormMatches,
  standardFormMatchesForDocument,
} from "./template-source";
import { buildChecklistResult } from "@/lib/checklist";
import { syncMissingDocumentTasks } from "@/lib/workflow";
import { CLASSIFICATION_AI_MODEL } from "./client";
import { logAiUsage } from "./usage";
import type { Confidence, DocumentType, TransactionType } from "@/lib/types";
import type { FieldExtraction, PageClassification } from "./schemas";

type PageImage = { pageNumber: number; base64: string; mediaType: "image/jpeg"; pageHash: string };

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
      const buffer = Buffer.from(await blob.arrayBuffer());
      const pageHash = createHash("sha256").update(buffer).digest("hex");
      if (p.page_hash !== pageHash) {
        await supabase.from("deal_pages").update({ page_hash: pageHash }).eq("id", p.id);
      }
      images.push({
        pageNumber: p.page_number,
        base64: buffer.toString("base64"),
        mediaType: "image/jpeg",
        pageHash,
      });
    }

    // Step 2: classify
    const storedClassification = classificationFromStoredPages(deal, pages);
    const classification =
      storedClassification ??
      (await classifyPages(images, {
        dealId,
        metadata: { source: "full_processing" },
      }));
    if (storedClassification) {
      await logAiUsage({
        layer: "classification",
        model: CLASSIFICATION_AI_MODEL,
        dealId,
        cached: true,
        inputPages: images.length,
        metadata: { source: "stored_deal_pages" },
      });
    }
    const pageFormMatches = buildPageStandardFormMatches(classification.pages);
    if (!storedClassification) {
      for (const c of classification.pages) {
        const formMatch = pageFormMatches.find((match) => match.pageNumber === c.page_number)?.match;
        await supabase
          .from("deal_pages")
          .update({
            doc_type: c.doc_type,
            doc_confidence: c.confidence,
            standard_form_key: formMatch?.key ?? null,
            standard_form_number: formMatch?.formNumber ?? null,
            standard_form_title: formMatch?.title ?? null,
            standard_form_confidence: formMatch?.confidence ?? null,
            classification_reviewed_at: null,
            classification_reviewed_by: null,
          })
          .eq("deal_id", dealId)
          .eq("page_number", c.page_number);
      }
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
      const extraction = await extractFromDocument(docType, docImages, {
        standardForms: standardFormMatchesForDocument(docType, pageFormMatches),
        dealId,
        metadata: { source: "full_processing" },
      });
      extractions.push({ docType, extraction });
    }

    // Steps 4–5: merge + validate
    const templateFallbacks = applyTemplateSourceFallbacks(extractions, pageFormMatches);
    let merged = mergeExtractions(templateFallbacks.extractions);
    const preliminaryChecklist = buildChecklistResult(
      classification.transaction_type,
      classification.pages.map((page) => ({
        page_number: page.page_number,
        doc_type: page.doc_type,
      })),
      null,
      merged.map((field) => ({ field_key: field.key, value: field.value })),
    );
    merged = validateFields(merged, classification.transaction_type, {
      scenarioKey: preliminaryChecklist.scenario.key,
      scenarioLabel: preliminaryChecklist.scenario.label,
    });

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
        classification_source: storedClassification ? "stored_deal_pages" : "ai",
        documents: [...byDoc.keys()],
        fields: merged.length,
        scenario: checklist.scenario.key,
        standard_forms: pageFormMatches
          .filter((pageMatch) => pageMatch.match)
          .map((pageMatch) => ({
            page: pageMatch.pageNumber,
            key: pageMatch.match?.key,
            number: pageMatch.match?.formNumber,
            title: pageMatch.match?.title,
            confidence: pageMatch.match?.confidence,
          })),
        template_source_box_fallbacks: templateFallbacks.fallbackCount,
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

function classificationFromStoredPages(
  deal: { transaction_type?: string | null },
  pages: Array<{
    page_number: number;
    doc_type?: string | null;
    doc_confidence?: string | null;
    source?: string | null;
    processing_status?: string | null;
    light_classification_type?: string | null;
    standard_form_key?: string | null;
    standard_form_number?: string | null;
    standard_form_title?: string | null;
    standard_form_confidence?: string | null;
  }>,
): PageClassification | null {
  if (pages.some((page) => isEmailLightClassifiedPage(page))) return null;
  if (!pages.every((page) => page.doc_type && isReusableConfidence(page.doc_confidence))) return null;

  return {
    transaction_type: transactionTypeFromStoredDeal(deal.transaction_type) ?? inferTransactionTypeFromDocs(pages),
    pages: pages.map((page) => ({
      page_number: page.page_number,
      doc_type: page.doc_type as DocumentType,
      confidence: page.doc_confidence as Confidence,
      standard_form_key: page.standard_form_key ?? null,
      standard_form_number: page.standard_form_number ?? null,
      standard_form_title: page.standard_form_title ?? null,
      standard_form_confidence: isConfidence(page.standard_form_confidence)
        ? (page.standard_form_confidence as Confidence)
        : null,
    })),
  };
}

function isEmailLightClassifiedPage(page: {
  source?: string | null;
  processing_status?: string | null;
  light_classification_type?: string | null;
}) {
  return (
    page.source === "email" &&
    page.processing_status === "awaiting_admin_process" &&
    Boolean(page.light_classification_type)
  );
}

function transactionTypeFromStoredDeal(value: string | null | undefined): TransactionType | null {
  return value === "purchase" || value === "lease" ? value : null;
}

function inferTransactionTypeFromDocs(pages: Array<{ doc_type?: string | null }>): TransactionType {
  const docs = new Set(pages.map((page) => page.doc_type).filter(Boolean));
  if (
    docs.has("agreement_to_lease") ||
    docs.has("lease_agreement") ||
    docs.has("ontario_residential_tenancy_agreement") ||
    docs.has("tenant_representation_agreement")
  ) {
    return "lease";
  }
  if (
    docs.has("agreement_of_purchase_and_sale") ||
    docs.has("first_page_aps") ||
    docs.has("buyer_representation_agreement")
  ) {
    return "purchase";
  }
  return "unknown";
}

function isConfidence(value: string | null | undefined): value is Confidence {
  return value === "high" || value === "medium" || value === "low";
}

function isReusableConfidence(value: string | null | undefined): value is Confidence {
  return value === "high" || value === "medium";
}
