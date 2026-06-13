import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, AI_MODEL } from "./client";
import { PageClassificationSchema, type PageClassification } from "./schemas";
import { DOCUMENT_TYPES } from "@/lib/types";

const DOC_TYPE_GUIDE = Object.entries(DOCUMENT_TYPES)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n");

const SYSTEM = `You classify pages of Ontario real estate transaction packages for a brokerage (Sutton Group). Each page is a scanned form. Classify every page into exactly one document type:

${DOC_TYPE_GUIDE}

Guidance:
- The Deal Information Sheet is the brokerage's internal one-page summary form titled "DEAL INFORMATION SHEET".
- OREA forms show their form number bottom-left or in the header (e.g. "Form 100", "Form 801", "Form 630").
- Schedule A/B pages belong to their parent document (APS schedules → agreement_of_purchase_and_sale; lease schedules and Ontario Standard Lease appendix pages → lease_agreement; listing agreement schedules → listing_agreement; BRA schedules → buyer_representation_agreement).
- Continuation pages without their own title belong to the same document as the preceding page.
- Bank drafts, cheque images, wire confirmations, and deposit receipts → deposit_proof.
- The RECO Information Guide acknowledgement page is a single page titled "Acknowledgement" referencing the RECO Information Guide.
- Determine the overall transaction_type: "purchase" if an Agreement of Purchase and Sale is present, "lease" if a tenancy/lease agreement is present, otherwise your best judgment from the Deal Information Sheet.`;

const BATCH_SIZE = 10;

export async function classifyPages(
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png" }[],
): Promise<PageClassification> {
  const batches: (typeof pageImages)[] = [];
  for (let i = 0; i < pageImages.length; i += BATCH_SIZE) {
    batches.push(pageImages.slice(i, i + BATCH_SIZE));
  }

  const results: PageClassification["pages"] = [];
  const txVotes: Record<string, number> = {};

  for (const batch of batches) {
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
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(PageClassificationSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("Classification returned no parseable output");
    results.push(...parsed.pages);
    txVotes[parsed.transaction_type] = (txVotes[parsed.transaction_type] ?? 0) + 1;
  }

  // Majority vote across batches; explicit purchase/lease beats unknown.
  const tx: "purchase" | "lease" =
    (txVotes["lease"] ?? 0) > (txVotes["purchase"] ?? 0) ? "lease" : "purchase";
  const transaction_type =
    (txVotes["purchase"] ?? 0) + (txVotes["lease"] ?? 0) > 0 ? tx : "unknown";

  return { pages: results, transaction_type };
}
