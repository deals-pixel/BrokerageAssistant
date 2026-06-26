import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DOCUMENT_TYPES } from "@/lib/types";
import { compactClassificationGuideFromStandardForms } from "@/lib/standard-forms";
import { anthropic, CLASSIFICATION_AI_MODEL } from "./client";
import { PageClassificationSchema, type PageClassification } from "./schemas";
import { logAiUsage, usageFromResponse } from "./usage";
import {
  classificationCacheKey,
  readCachedPageClassifications,
  readCachedClassification,
  writeCachedClassification,
  writeCachedPageClassifications,
} from "./classification-cache";

const DOC_TYPE_GUIDE = Object.entries(DOCUMENT_TYPES)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n");
const STANDARD_FORM_GUIDE = compactClassificationGuideFromStandardForms();

const SYSTEM = `You classify pages of Ontario real estate transaction packages for a brokerage (Sutton Group). Each page is a scanned form. Classify every page into exactly one document type:

${DOC_TYPE_GUIDE}

Guidance:
- The Deal Information Sheet is the brokerage's internal one-page summary form titled "DEAL INFORMATION SHEET".
- OREA forms show their form number bottom-left or in the header. Use this compact standard form registry:
${STANDARD_FORM_GUIDE}
- For each page, also return standard_form_key, standard_form_number, standard_form_title, and standard_form_confidence when the visible title, form number, or signature text matches the registry. Use null for all standard-form fields when no registry form matches.
- standard_form_key must be exactly one key from the registry above. Do not invent keys.
- Also return page_role, page_role_confidence, and extraction_skip_reason for each page:
  - data_entry_page: a page with visible deal-specific blanks, filled fields, parties, property, money, dates, brokerage details, checkboxes, or typed/handwritten transaction data.
  - possible_data_page: mostly boilerplate but has handwriting, typed insertions, selected checkboxes, initials beside changed terms, signatures with dates, or any visible filled blank. Use this when unsure.
  - signature_page: signature/date/name blocks where the page may still identify parties or execution dates.
  - standard_clause_page: fixed printed legal/standard clauses with no filled blanks, no handwriting, no typed insertions, no selected checkboxes, and no visible deal-specific values.
  - schedule_clause_page: schedule/extra terms page. Use possible_data_page instead if there are custom clauses, handwritten/typed additions, or filled blanks.
  - empty_or_instruction_page: blank, cover, instruction, separator, or guide page with no transaction values.
- Be conservative: if there is any visible filled field, handwriting, typed addition, selected checkbox, signature/date block, or uncertainty, do not use standard_clause_page or empty_or_instruction_page.
- extraction_skip_reason must be a short reason only when page_role is standard_clause_page or empty_or_instruction_page; otherwise return null.
- Schedule A/B pages belong to their parent document: APS and Office Schedule B pages are agreement_of_purchase_and_sale for sales, Office Schedule B Lease pages are agreement_to_lease, listing schedules are listing_agreement, buyer representation schedules are buyer_representation_agreement, and tenant representation schedules are tenant_representation_agreement.
- Use agreement_to_lease for OREA Agreement to Lease forms. Use ontario_residential_tenancy_agreement for the Ontario Standard Lease. Use lease_agreement only when the page is a lease document but not clearly one of those two.
- Continuation pages without their own title belong to the same document as the preceding page.
- Bank drafts, cheque images, wire confirmations, and deposit receipts are deposit_proof unless the page clearly says it is a copy from another brokerage.
- Referral agreements, co-brokerage agreements, corporate articles, beneficial ownership attestations, tenant representation agreements, and builder confirmations have their own document types; do not collapse them into other.
- The RECO Information Guide acknowledgement page is a single page titled "Acknowledgement" referencing the RECO Information Guide.
- Determine the overall transaction_type: "purchase" if an Agreement of Purchase and Sale or pre-construction APS page is present, "lease" if an agreement to lease or tenancy agreement is present, otherwise your best judgment from the Deal Information Sheet.`;

const BATCH_SIZE = Math.max(1, Number(process.env.CLASSIFICATION_BATCH_SIZE ?? 10) || 10);
const PROMPT_SIGNATURE = createHash("sha256")
  .update(SYSTEM)
  .update("|page-classification-schema-v4-compact-guide-page-cache")
  .digest("hex");

export async function classifyPages(
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png"; pageHash?: string | null }[],
  options: { dealId?: string | null; metadata?: Record<string, unknown> } = {},
): Promise<PageClassification> {
  const batches: (typeof pageImages)[] = [];
  for (let i = 0; i < pageImages.length; i += BATCH_SIZE) {
    batches.push(pageImages.slice(i, i + BATCH_SIZE));
  }

  const results: PageClassification["pages"] = [];

  for (const batch of batches) {
    const cacheKey = classificationCacheKey({
      model: CLASSIFICATION_AI_MODEL,
      pages: batch,
      promptSignature: PROMPT_SIGNATURE,
    });
    if (cacheKey) {
      const cached = await readCachedClassification(cacheKey);
      if (cached) {
        await logAiUsage({
          layer: "classification",
          model: CLASSIFICATION_AI_MODEL,
          dealId: options.dealId,
          cached: true,
          inputPages: batch.length,
          metadata: {
            batch_start_page: batch[0].pageNumber,
            batch_end_page: batch[batch.length - 1].pageNumber,
            cache_key: cacheKey,
            ...options.metadata,
          },
        });
        results.push(...cached.pages);
        continue;
      }
    }

    const cachedPages = await readCachedPageClassifications(batch, {
      model: CLASSIFICATION_AI_MODEL,
      promptSignature: PROMPT_SIGNATURE,
    });
    if (cachedPages.size === batch.length) {
      await logAiUsage({
        layer: "classification",
        model: CLASSIFICATION_AI_MODEL,
        dealId: options.dealId,
        cached: true,
        inputPages: batch.length,
        metadata: {
          cache_scope: "page",
          batch_start_page: batch[0].pageNumber,
          batch_end_page: batch[batch.length - 1].pageNumber,
          ...options.metadata,
        },
      });
      results.push(...batch.map((page) => cachedPages.get(page.pageNumber)).filter(isClassifiedPage));
      continue;
    }

    const uncachedBatch = batch.filter((page) => !cachedPages.has(page.pageNumber));
    if (cachedPages.size > 0) {
      await logAiUsage({
        layer: "classification",
        model: CLASSIFICATION_AI_MODEL,
        dealId: options.dealId,
        cached: true,
        inputPages: cachedPages.size,
        metadata: {
          cache_scope: "page",
          batch_start_page: batch[0].pageNumber,
          batch_end_page: batch[batch.length - 1].pageNumber,
          ...options.metadata,
        },
      });
    }

    const content: Anthropic.ContentBlockParam[] = uncachedBatch.flatMap((p) => [
      { type: "text" as const, text: `Page ${p.pageNumber}:` },
      {
        type: "image" as const,
        source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
      },
    ]);
    content.push({
      type: "text",
      text: `Classify pages ${uncachedBatch[0].pageNumber} through ${uncachedBatch[uncachedBatch.length - 1].pageNumber}. Return one entry per provided page.`,
    });

    const response = await anthropic.messages.parse({
      model: CLASSIFICATION_AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(PageClassificationSchema) },
    });
    await logAiUsage({
      layer: "classification",
      model: CLASSIFICATION_AI_MODEL,
      dealId: options.dealId,
      usage: usageFromResponse(response),
      inputPages: uncachedBatch.length,
      metadata: {
        batch_start_page: uncachedBatch[0].pageNumber,
        batch_end_page: uncachedBatch[uncachedBatch.length - 1].pageNumber,
        cache_scope: cachedPages.size > 0 ? "page_partial" : "batch",
        cache_key: cacheKey,
        ...options.metadata,
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Classification returned no parseable output");
    const parsedByPage = new Map(parsed.pages.map((page) => [page.page_number, page]));
    results.push(
      ...batch
        .map((page) => cachedPages.get(page.pageNumber) ?? parsedByPage.get(page.pageNumber))
        .filter(isClassifiedPage),
    );
    if (cacheKey && cachedPages.size === 0) {
      await writeCachedClassification({
        cacheKey,
        model: CLASSIFICATION_AI_MODEL,
        pageHashes: batch.map((page) => page.pageHash).filter((hash): hash is string => Boolean(hash)),
        classification: parsed,
        promptSignature: PROMPT_SIGNATURE,
      });
    }
    await writeCachedPageClassifications({
      model: CLASSIFICATION_AI_MODEL,
      promptSignature: PROMPT_SIGNATURE,
      transactionType: parsed.transaction_type,
      pages: parsed.pages.map((page) => ({
        ...page,
        pageHash: uncachedBatch.find((input) => input.pageNumber === page.page_number)?.pageHash ?? null,
      })),
    });
  }

  const transaction_type = inferTransactionType(results);

  return { pages: results.sort((a, b) => a.page_number - b.page_number), transaction_type };
}

function isClassifiedPage(
  page: PageClassification["pages"][number] | undefined,
): page is PageClassification["pages"][number] {
  return Boolean(page);
}

function inferTransactionType(pages: PageClassification["pages"]): PageClassification["transaction_type"] {
  const docs = new Set(pages.map((page) => page.doc_type));
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
    docs.has("buyer_representation_agreement") ||
    docs.has("form_801_offer_summary")
  ) {
    return "purchase";
  }
  return "unknown";
}
