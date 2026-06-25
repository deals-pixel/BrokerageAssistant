import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DOCUMENT_TYPES } from "@/lib/types";
import { classificationGuideFromStandardForms } from "@/lib/standard-forms";
import { anthropic, CLASSIFICATION_AI_MODEL } from "./client";
import { PageClassificationSchema, type PageClassification } from "./schemas";
import { logAiUsage, usageFromResponse } from "./usage";
import {
  classificationCacheKey,
  readCachedClassification,
  writeCachedClassification,
} from "./classification-cache";

const DOC_TYPE_GUIDE = Object.entries(DOCUMENT_TYPES)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n");
const STANDARD_FORM_GUIDE = classificationGuideFromStandardForms();

const SYSTEM = `You classify pages of Ontario real estate transaction packages for a brokerage (Sutton Group). Each page is a scanned form. Classify every page into exactly one document type:

${DOC_TYPE_GUIDE}

Guidance:
- The Deal Information Sheet is the brokerage's internal one-page summary form titled "DEAL INFORMATION SHEET".
- OREA forms show their form number bottom-left or in the header. Use this standard form registry:
${STANDARD_FORM_GUIDE}
- For each page, also return standard_form_key, standard_form_number, standard_form_title, and standard_form_confidence when the visible title, form number, or signature text matches the registry. Use null for all standard-form fields when no registry form matches.
- standard_form_key must be exactly one key from the registry above. Do not invent keys.
- Schedule A/B pages belong to their parent document: APS and Office Schedule B pages are agreement_of_purchase_and_sale for sales, Office Schedule B Lease pages are agreement_to_lease, listing schedules are listing_agreement, buyer representation schedules are buyer_representation_agreement, and tenant representation schedules are tenant_representation_agreement.
- Use agreement_to_lease for OREA Agreement to Lease forms. Use ontario_residential_tenancy_agreement for the Ontario Standard Lease. Use lease_agreement only when the page is a lease document but not clearly one of those two.
- Continuation pages without their own title belong to the same document as the preceding page.
- Bank drafts, cheque images, wire confirmations, and deposit receipts are deposit_proof unless the page clearly says it is a copy from another brokerage.
- Referral agreements, co-brokerage agreements, corporate articles, beneficial ownership attestations, tenant representation agreements, and builder confirmations have their own document types; do not collapse them into other.
- The RECO Information Guide acknowledgement page is a single page titled "Acknowledgement" referencing the RECO Information Guide.
- Determine the overall transaction_type: "purchase" if an Agreement of Purchase and Sale or pre-construction APS page is present, "lease" if an agreement to lease or tenancy agreement is present, otherwise your best judgment from the Deal Information Sheet.`;

const BATCH_SIZE = 10;
const PROMPT_SIGNATURE = createHash("sha256")
  .update(SYSTEM)
  .update("|page-classification-schema-v2-standard-form-registry")
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
  const txVotes: Record<string, number> = {};

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
        txVotes[cached.transaction_type] = (txVotes[cached.transaction_type] ?? 0) + 1;
        continue;
      }
    }

    const content: Anthropic.ContentBlockParam[] = batch.flatMap((p) => [
      { type: "text" as const, text: `Page ${p.pageNumber}:` },
      {
        type: "image" as const,
        source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
      },
    ]);
    content.push({
      type: "text",
      text: `Classify pages ${batch[0].pageNumber} through ${batch[batch.length - 1].pageNumber}. Return one entry per page.`,
    });

    const response = await anthropic.messages.parse({
      model: CLASSIFICATION_AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(PageClassificationSchema) },
    });
    await logAiUsage({
      layer: "classification",
      model: CLASSIFICATION_AI_MODEL,
      dealId: options.dealId,
      usage: usageFromResponse(response),
      inputPages: batch.length,
      metadata: {
        batch_start_page: batch[0].pageNumber,
        batch_end_page: batch[batch.length - 1].pageNumber,
        cache_key: cacheKey,
        ...options.metadata,
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Classification returned no parseable output");
    results.push(...parsed.pages);
    txVotes[parsed.transaction_type] = (txVotes[parsed.transaction_type] ?? 0) + 1;
    if (cacheKey) {
      await writeCachedClassification({
        cacheKey,
        model: CLASSIFICATION_AI_MODEL,
        pageHashes: batch.map((page) => page.pageHash).filter((hash): hash is string => Boolean(hash)),
        classification: parsed,
      });
    }
  }

  const tx: "purchase" | "lease" =
    (txVotes.lease ?? 0) > (txVotes.purchase ?? 0) ? "lease" : "purchase";
  const transaction_type =
    (txVotes.purchase ?? 0) + (txVotes.lease ?? 0) > 0 ? tx : "unknown";

  return { pages: results, transaction_type };
}
