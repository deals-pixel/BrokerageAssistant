import { createHash } from "node:crypto";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyPages } from "./classify";
import { extractFromDocument, extractFromStandardFormRegions, EXTRACTABLE_DOCS } from "./extract";
import { mergeExtractions, type MergedField } from "./merge";
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
import type { PageClassification } from "./schemas";

type PageImage = { pageNumber: number; base64: string; mediaType: "image/jpeg"; pageHash: string };
type ExistingDealFieldRow = {
  field_key: string;
  value: string | null;
  confidence: Confidence | null;
  source_doc_type: string | null;
  source_page: number | null;
  source_box: unknown;
  conflict_sources: unknown;
  needs_review: boolean | null;
  notes: string | null;
  edited_at: string | null;
  edited_by: string | null;
};
type PipelineField = MergedField & {
  editedAt?: string | null;
  editedBy?: string | null;
};
type ExtractionModeSummary = {
  docType: DocumentType;
  mode: "region_first" | "full_page" | "region_fallback_full_page";
  regions?: number;
  regionFields?: number;
  pages?: number;
  skippedPages?: number[];
};

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
      await assertValidRenderedImage(buffer, p.page_number, p.image_path);
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
            page_role: c.page_role ?? "data_entry_page",
            page_role_confidence: c.page_role_confidence ?? c.confidence,
            extraction_skip_reason: c.extraction_skip_reason ?? null,
            classification_reviewed_at: null,
            classification_reviewed_by: null,
          })
          .eq("deal_id", dealId)
          .eq("page_number", c.page_number);
      }
    }

    // Step 3: extract per document group
    const byDoc = new Map<DocumentType, PageImage[]>();
    const skippedExtractionPages: Array<{
      page: number;
      docType: DocumentType;
      role: string;
      reason: string | null;
    }> = [];
    for (const c of classification.pages) {
      const img = images.find((i) => i.pageNumber === c.page_number);
      if (!img) continue;
      const dt = c.doc_type as DocumentType;
      if (!EXTRACTABLE_DOCS.includes(dt)) continue;
      if (shouldSkipPageForExtraction(c)) {
        skippedExtractionPages.push({
          page: c.page_number,
          docType: dt,
          role: c.page_role ?? "data_entry_page",
          reason: c.extraction_skip_reason ?? null,
        });
        continue;
      }
      byDoc.set(dt, [...(byDoc.get(dt) ?? []), img]);
    }

    const extractionModes: ExtractionModeSummary[] = [];
    const extractions = await runWithConcurrency([...byDoc.entries()], 3, async ([docType, docImages]) => {
      const regionResult = await extractFromStandardFormRegions(
        docType,
        docImages,
        pageFormMatches.filter((pageMatch) => pageMatch.docType === docType),
        {
          dealId,
          metadata: { source: "full_processing" },
        },
      );
      if (regionResult && shouldUseRegionExtraction(docType, regionResult)) {
        extractionModes.push({
          docType,
          mode: "region_first",
          pages: docImages.length,
          regions: regionResult.regionCount,
          regionFields: regionResult.extractedCount,
          skippedPages: skippedExtractionPages
            .filter((page) => page.docType === docType)
            .map((page) => page.page),
        });
        return { docType, extraction: regionResult.extraction };
      }

      const extraction = await extractFromDocument(docType, docImages, {
        standardForms: standardFormMatchesForDocument(docType, pageFormMatches),
        dealId,
        metadata: {
          source: "full_processing",
          region_first_fallback:
            regionResult && !shouldUseRegionExtraction(docType, regionResult)
              ? `${regionResult.extractedCount}/${regionResult.regionCount}`
              : null,
        },
      });
      extractionModes.push({
        docType,
        mode: regionResult ? "region_fallback_full_page" : "full_page",
        pages: docImages.length,
        regions: regionResult?.regionCount,
        regionFields: regionResult?.extractedCount,
        skippedPages: skippedExtractionPages
          .filter((page) => page.docType === docType)
          .map((page) => page.page),
      });
      return { docType, extraction };
    });

    // Steps 4–5: merge + validate
    const templateFallbacks = applyTemplateSourceFallbacks(extractions, pageFormMatches);
    const existingRows = await loadExistingDealFields(supabase, dealId);
    let merged: PipelineField[] = mergeExistingFields(
      mergeExtractions(templateFallbacks.extractions),
      existingRowsToMergedFields(existingRows),
    );
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
    }) as PipelineField[];

    // Persist fields
    await supabase.from("deal_fields").delete().eq("deal_id", dealId);
    if (merged.length > 0) {
      const rows = fieldRowsForPersistence(dealId, merged, existingRows);
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
        extraction_skipped_pages: skippedExtractionPages,
        extraction_modes: extractionModes,
        fields: merged.length,
        existing_fields_preserved: merged.filter(
          (field) => field.editedAt || field.sourceDocumentType === "email_body",
        ).length,
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

async function assertValidRenderedImage(buffer: Buffer, pageNumber: number, imagePath: string) {
  try {
    await sharp(buffer).metadata();
  } catch {
    const actualType = buffer.subarray(0, 4).toString("ascii") === "%PDF" ? "PDF" : "unsupported file";
    throw new Error(
      `Page ${pageNumber} is not a valid rendered image. The stored page file is ${actualType} data at ${imagePath}. Re-prepare the source attachment so it renders to JPEG before processing.`,
    );
  }
}

async function loadExistingDealFields(
  supabase: ReturnType<typeof createAdminClient>,
  dealId: string,
): Promise<ExistingDealFieldRow[]> {
  const { data, error } = await supabase
    .from("deal_fields")
    .select(
      "field_key, value, confidence, source_doc_type, source_page, source_box, conflict_sources, needs_review, notes, edited_at, edited_by",
    )
    .eq("deal_id", dealId);
  if (error) throw new Error(`Failed to load existing fields: ${error.message}`);
  return (data ?? []) as ExistingDealFieldRow[];
}

function shouldUseRegionExtraction(
  docType: DocumentType,
  result: { extraction: { fields: { field_key: string }[] }; regionCount: number; extractedCount: number },
) {
  if (process.env.REGION_FIRST_EXTRACTION === "0") return false;
  if (result.extractedCount <= 0) return false;

  const fieldKeys = new Set(result.extraction.fields.map((field) => field.field_key));
  const anchorHits = regionExtractionAnchorFields(docType).filter((key) => fieldKeys.has(key)).length;
  if (anchorHits >= 2) return true;

  if (result.regionCount < 4) return true;
  if (docType === "deal_information_sheet" && result.extractedCount >= 3) return true;
  if (result.regionCount <= 8 && result.extractedCount >= 2) return true;
  return result.extractedCount / result.regionCount >= 0.2;
}

function regionExtractionAnchorFields(docType: DocumentType) {
  switch (docType) {
    case "deal_information_sheet":
      return ["agent_name", "property_address", "price_or_rent", "closing_date"];
    case "agreement_to_lease":
    case "lease_agreement":
    case "ontario_residential_tenancy_agreement":
      return ["property_address", "price_or_rent", "lease_start_date", "buyer_tenant_names", "seller_landlord_names"];
    case "agreement_of_purchase_and_sale":
    case "first_page_aps":
      return ["property_address", "price_or_rent", "buyer_tenant_names", "seller_landlord_names", "closing_date"];
    case "form_320_confirmation_cooperation":
      return ["listing_brokerage", "cooperating_brokerage", "cooperating_commission_pct", "representation_side"];
    default:
      return ["property_address", "price_or_rent", "buyer_tenant_names", "seller_landlord_names"];
  }
}

function existingRowsToMergedFields(rows: ExistingDealFieldRow[]): PipelineField[] {
  return rows
    .filter((row) => row.value?.trim())
    .map((row) => ({
      key: row.field_key,
      value: row.value?.trim() ?? null,
      confidence: isConfidence(row.confidence) ? row.confidence : "medium",
      sourceDocumentType: row.source_doc_type ?? undefined,
      sourcePage: row.source_page ?? undefined,
      sourceBox: sourceBoxFromUnknown(row.source_box),
      conflictSources: Array.isArray(row.conflict_sources) ? row.conflict_sources : undefined,
      needsReview: row.needs_review ?? true,
      notes: row.notes ?? undefined,
      editedAt: row.edited_at,
      editedBy: row.edited_by,
    }));
}

function mergeExistingFields(aiFields: MergedField[], existingFields: PipelineField[]): PipelineField[] {
  const byKey = new Map<string, PipelineField>(aiFields.map((field) => [field.key, { ...field }]));

  for (const existing of existingFields) {
    const current = byKey.get(existing.key);
    if (!current) {
      byKey.set(existing.key, existing);
      continue;
    }

    if (existing.editedAt) {
      byKey.set(existing.key, {
        ...existing,
        conflictSources: conflictSourcesFor(existing, current),
        needsReview: existing.needsReview || !valuesAgree(existing.value, current.value),
        notes: appendNote(existing.notes, "Manual edit preserved during AI reprocessing."),
      });
      continue;
    }

    if (existing.sourceDocumentType === "email_body" && !valuesAgree(existing.value, current.value)) {
      byKey.set(existing.key, {
        ...current,
        conflictSources: conflictSourcesFor(current, existing),
        needsReview: true,
        notes: appendNote(current.notes, "Email body had a different value; verify against documents."),
      });
    }
  }

  return [...byKey.values()];
}

function fieldRowsForPersistence(dealId: string, fields: PipelineField[], existingRows: ExistingDealFieldRow[]) {
  const existingByKey = new Map(existingRows.map((row) => [row.field_key, row]));
  return fields.map((field) => {
    const existing = existingByKey.get(field.key);
    const preserveEdit = Boolean(existing?.edited_at) && valuesAgree(existing?.value ?? null, field.value);
    return {
      deal_id: dealId,
      field_key: field.key,
      value: field.value,
      confidence: field.confidence,
      source_doc_type: field.sourceDocumentType ?? null,
      source_page: field.sourcePage ?? null,
      source_box: field.sourceBox ?? null,
      conflict_sources: field.conflictSources ?? null,
      needs_review: field.needsReview,
      notes: field.notes ?? null,
      edited_at: preserveEdit ? existing?.edited_at : field.editedAt ?? null,
      edited_by: preserveEdit ? existing?.edited_by : field.editedBy ?? null,
    };
  });
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function runNext() {
    const current = index;
    index += 1;
    if (current >= items.length) return;
    results[current] = await worker(items[current]);
    await runNext();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

function conflictSourcesFor(primary: PipelineField, secondary: PipelineField) {
  return [primary, secondary].map((field) => ({
    value: field.value ?? "",
    confidence: field.confidence,
    sourceDocumentType: field.sourceDocumentType,
    sourcePage: field.sourcePage,
    sourceBox: field.sourceBox,
  }));
}

function sourceBoxFromUnknown(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const box = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof box.x !== "number" ||
    typeof box.y !== "number" ||
    typeof box.width !== "number" ||
    typeof box.height !== "number"
  ) {
    return null;
  }
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

function appendNote(existing: string | undefined, note: string) {
  return existing ? `${existing}; ${note}` : note;
}

function valuesAgree(a: string | null | undefined, b: string | null | undefined) {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return true;
  const leftNumber = normalizeNumber(left);
  const rightNumber = normalizeNumber(right);
  if (leftNumber !== null && rightNumber !== null) return Math.abs(leftNumber - rightNumber) < 0.005;
  return left.toLowerCase().replace(/\s+/g, " ") === right.toLowerCase().replace(/\s+/g, " ");
}

function normalizeNumber(value: string) {
  const cleaned = value.replace(/[$,%\s]/g, "");
  if (cleaned === "" || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
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
    page_role?: string | null;
    page_role_confidence?: string | null;
    extraction_skip_reason?: string | null;
}>,
): PageClassification | null {
  if (!pages.every((page) => page.doc_type && isReusableConfidence(page.doc_confidence))) return null;
  if (process.env.SKIP_LOW_VALUE_PAGES !== "0" && pages.some((page) => !isPageRole(page.page_role))) {
    return null;
  }

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
      page_role: isPageRole(page.page_role) ? page.page_role : "data_entry_page",
      page_role_confidence: isConfidence(page.page_role_confidence)
        ? (page.page_role_confidence as Confidence)
        : page.doc_confidence === "low"
          ? "low"
          : "medium",
      extraction_skip_reason: page.extraction_skip_reason ?? null,
    })),
  };
}

function shouldSkipPageForExtraction(page: PageClassification["pages"][number]) {
  if (process.env.SKIP_LOW_VALUE_PAGES === "0") return false;
  return page.page_role === "standard_clause_page" || page.page_role === "empty_or_instruction_page";
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

function isPageRole(value: string | null | undefined): value is PageClassification["pages"][number]["page_role"] {
  return (
    value === "data_entry_page" ||
    value === "signature_page" ||
    value === "standard_clause_page" ||
    value === "schedule_clause_page" ||
    value === "empty_or_instruction_page" ||
    value === "possible_data_page"
  );
}
