import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, AI_MODEL } from "./client";
import { FieldExtractionSchema, type FieldExtraction } from "./schemas";
import { ALL_FIELD_KEYS, FIELD_LABELS, type DocumentType } from "@/lib/types";

const FIELD_GUIDE = ALL_FIELD_KEYS.map((k) => `- ${k}: ${FIELD_LABELS[k]}`).join("\n");

const SYSTEM = `You extract deal fields from scanned Ontario real estate documents (OREA forms, leases, deposit proofs, representation agreements). The goal is to fill out the brokerage's Deal Information Sheet from these source documents. Values may be handwritten or typed.

Extract only fields visibly present in the supplied pages. Allowed field keys:

${FIELD_GUIDE}

Rules:
- Return one entry per field you can read from these pages; omit fields not shown.
- Dates in YYYY-MM-DD. Money as plain numbers without $ or commas (e.g. "850000"). Percentages as numbers (e.g. "2.5"). If a commission is written as text instead of a percentage (for example "1/2 months rent plus HST"), return that visible text rather than omitting it.
- transaction_type is "purchase" or "lease". firm_or_conditional is "firm" or "conditional". multiple_offer is "yes (N)" or "no".
- representation_side: "listing", "cooperating", or "both" (multiple representation).
- Multiple people in one field: join with "; ".
- confidence: "high" if clearly legible/typed, "medium" if handwriting is readable but ambiguous, "low" if partially illegible or inferred.
- source_page is the package page number labeled above each image.`;

// Documents worth extracting from, in priority order (used by merge).
// deal_information_sheet is deliberately excluded — it is the output form
// this app fills out, never an extraction source (even if one happens to be
// in the package).
export const EXTRACTABLE_DOCS: DocumentType[] = [
  "agreement_of_purchase_and_sale",
  "lease_agreement",
  "form_801_offer_summary",
  "form_320_confirmation_cooperation",
  "form_124_notice_fulfillment",
  "deposit_proof",
  "form_635_receipt_of_funds",
  "listing_agreement",
  "buyer_representation_agreement",
];

// Where key values live on each form — appended to the extraction request.
const DOC_HINTS: Partial<Record<DocumentType, string>> = {
  form_801_offer_summary:
    "Form 801 shows the property address, the offer date, irrevocable date/time, signature/acceptance dates, buyer and seller names, and both brokerages with their agents. It does NOT normally show the dollar amount — never infer sale_price from this form.",
  deposit_proof:
    "Bank drafts / wire confirmations / receipts show deposit_amount, deposit_method (wire transfer / bank draft / cheque), the payee holding the deposit (deposit_held_by), and often the buyer's name and address.",
  form_124_notice_fulfillment:
    "Form 124 quotes the condition text verbatim (conditions_summary) and proves the deal was conditional (firm_or_conditional = 'conditional'). It also shows the property address and parties.",
  agreement_of_purchase_and_sale:
    "The APS (Form 100) shows purchase price, deposit, irrevocable date, completion/closing date, buyer/seller names and addresses, and conditions in Schedule A.",
  lease_agreement:
    "The lease agreement shows monthly rent (sale_price for leases), lease_start_date/lease_end_date, tenant and landlord names and contact info, and deposit details. OREA Form 400 may also show the MLS number in the header/property line. For lease packages, if the brokerage form needs a closing_date and there is no separate closing/completion date, use the lease commencement date as closing_date.",
  form_320_confirmation_cooperation:
    "Form 320/324 shows the commission offered to the co-operating brokerage (cooperating_commission_pct) and which side(s) each brokerage represents (representation_side; both boxes for the same brokerage = 'both' / multiple representation). The trade/MLS number may appear in the header. For tenant/landlord deals, the commission is often written as a rent-based phrase such as '1/2 months rent plus HST'; capture that exact text as cooperating_commission_pct. Do not infer total_commission_pct or listing_commission_pct if only the co-operating commission is shown.",
  listing_agreement:
    "The listing agreement shows the total commission (total_commission_pct), the listing period, the seller/landlord names, and MLS listing details.",
  buyer_representation_agreement:
    "The BRA shows the commission payable to the buyer's brokerage and the buyer names and contact info.",
};

const MAX_PAGES_PER_CALL = 12;

export async function extractFromDocument(
  docType: DocumentType,
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png" }[],
): Promise<FieldExtraction> {
  const pages = pageImages.slice(0, MAX_PAGES_PER_CALL);

  const content: Anthropic.ContentBlockParam[] = pages.flatMap((p) => [
    { type: "text" as const, text: `Page ${p.pageNumber}:` },
    {
      type: "image" as const,
      source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
    },
  ]);
  const hint = DOC_HINTS[docType];
  content.push({
    type: "text",
    text:
      `These pages were classified as: ${docType}. Extract all readable deal fields.` +
      (hint ? `\n\nHint for this document type: ${hint}` : ""),
  });

  const response = await anthropic.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(FieldExtractionSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Extraction returned no parseable output for ${docType}`);
  // Drop hallucinated keys
  parsed.fields = parsed.fields.filter((f) => ALL_FIELD_KEYS.includes(f.field_key));
  return parsed;
}
