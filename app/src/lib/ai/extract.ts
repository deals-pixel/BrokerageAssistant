import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ALL_FIELD_KEYS, FIELD_LABELS, type DocumentType } from "@/lib/types";
import { anthropic, AI_MODEL } from "./client";
import { FieldExtractionSchema, type FieldExtraction } from "./schemas";

const FIELD_GUIDE = ALL_FIELD_KEYS.map((key) => `- ${key}: ${FIELD_LABELS[key]}`).join("\n");

const SYSTEM = `You extract deal fields from scanned Ontario real estate documents. The goal is to fill the brokerage's Deal Information Sheet and compliance workflow from source documents. Values may be handwritten or typed.

Extract only fields visibly present in the supplied pages. Allowed field keys:

${FIELD_GUIDE}

Rules:
- Return one entry per field you can read from these pages; omit fields not shown.
- Dates in YYYY-MM-DD. Money as plain numbers without $ or commas, for example 850000. Percentages as numbers, for example 2.5. If a commission is written as text, return that visible text.
- transaction_type is purchase or lease. firm_or_conditional is firm or conditional. multiple_offer is yes (N) or no.
- representation_side: listing, cooperating, or both. seller_representation and buyer_representation can be SGA, other brokerage, self-represented, or unknown when visible.
- scenario_hint should capture explicit phrases such as referral, co-brokerage, pre-construction, buyer self-represented, tenant self-represented, or multiple representation when visible.
- seller_is_corporation and buyer_is_corporation should be yes, no, or unknown when visible.
- Multiple people in one field: join with "; ".
- confidence: high if clearly legible/typed, medium if handwriting is readable but ambiguous, low if partially illegible or inferred.
- source_page is the package page number labeled above each image.
- source_box is the tightest rectangle around the exact visible text/value that supports the extracted field.
- Calculate source_box against the full raster page image exactly as shown, including all white margins and page edges. Do not calculate relative to the cropped form content, a table, a section, or the text line only.
- Use normalized decimals from 0 to 1: x = left edge / full image width, y = top edge / full image height, width = box width / full image width, height = box height / full image height.
- Keep the box tight but include the whole readable value; do not add padding. Return null if the field is inferred, combines multiple distant areas, or you cannot localize it confidently.`;

export const EXTRACTABLE_DOCS: DocumentType[] = [
  "agreement_of_purchase_and_sale",
  "first_page_aps",
  "agreement_to_lease",
  "lease_agreement",
  "ontario_residential_tenancy_agreement",
  "form_801_offer_summary",
  "form_320_confirmation_cooperation",
  "form_124_notice_fulfillment",
  "waiver_notice_fulfillment_amendment",
  "deposit_proof",
  "copy_deposit_receipt_other_brokerage",
  "form_635_receipt_of_funds",
  "listing_agreement",
  "buyer_representation_agreement",
  "tenant_representation_agreement",
  "referral_agreement",
  "co_brokerage_agreement",
  "builder_confirmation_cooperation",
];

const DOC_HINTS: Partial<Record<DocumentType, string>> = {
  agreement_of_purchase_and_sale:
    "The APS shows purchase price, deposit, irrevocable date, completion/closing date, buyer/seller names and addresses, and conditions in Schedule A.",
  first_page_aps:
    "The first page of the APS shows property address, buyer/seller names, purchase price, deposit, offer date, and often irrevocable details. Treat this as a pre-construction signal when builder documents are also present.",
  agreement_to_lease:
    "The agreement to lease shows monthly rent, lease start/end dates, tenant and landlord names, property address, and deposit details.",
  lease_agreement:
    "The lease agreement shows monthly rent, lease_start_date/lease_end_date, tenant and landlord names and contact info, and deposit details. On OREA Form 400, lease_start_date comes from section 2, TERM OF LEASE, immediately after the word commencing. For lease packages, closing_date must use the lease_start_date.",
  ontario_residential_tenancy_agreement:
    "The Ontario Standard Lease shows rent, lease start and end dates, tenant and landlord names, service address, and deposit details. Use lease_start_date as closing_date for lease packages.",
  form_801_offer_summary:
    "Form 801 shows property address, offer date, irrevocable date/time, signature/acceptance dates, buyer and seller names, and both brokerages with their agents. It does not normally show sale_price.",
  form_320_confirmation_cooperation:
    "Form 320 shows the commission offered to the co-operating brokerage and which side each brokerage represents. If both boxes are selected for the same brokerage, representation_side is both / multiple representation.",
  form_124_notice_fulfillment:
    "Form 124 quotes condition text and proves the deal was conditional. It also shows property address and parties.",
  waiver_notice_fulfillment_amendment:
    "Waivers, notices of fulfillment, and amendments can change condition status, dates, price, deposit, parties, and closing. Capture only visible revised terms.",
  deposit_proof:
    "Bank drafts, wire confirmations, receipts, and cheques show deposit_amount, deposit_method, deposit_held_by, and often the buyer name/address.",
  copy_deposit_receipt_other_brokerage:
    "Deposit receipts from another brokerage prove deposit amount, who holds the deposit, and sometimes the buyer or tenant name. Mark deposit_method as receipt if no method is visible.",
  form_635_receipt_of_funds:
    "Receipt of funds records show the payer, recipient, amount, deposit source, and method.",
  listing_agreement:
    "The listing agreement shows total commission, listing period, seller/landlord names, listing agent, listing brokerage, and MLS listing details.",
  buyer_representation_agreement:
    "The buyer representation agreement shows buyer names, buyer contact details, representation dates, and commission payable to the buyer brokerage.",
  tenant_representation_agreement:
    "The tenant representation agreement shows tenant names, tenant contact details, representation dates, and commission terms.",
  referral_agreement:
    "The referral agreement shows referral_to, outside brokerage, agent names, referral amount, and property or client details.",
  co_brokerage_agreement:
    "The co-brokerage agreement shows cooperating brokerage, outside agent, commission amount or split, property address, and payment responsibility.",
  builder_confirmation_cooperation:
    "Builder confirmation of cooperation confirms pre-construction cooperation, builder brokerage or representative, property/project, and commission terms.",
};

const MAX_PAGES_PER_CALL = 12;

export async function extractFromDocument(
  docType: DocumentType,
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png" }[],
): Promise<FieldExtraction> {
  const pages = pageImages.slice(0, MAX_PAGES_PER_CALL);

  const content: Anthropic.ContentBlockParam[] = pages.flatMap((page) => [
    { type: "text" as const, text: `Page ${page.pageNumber}:` },
    {
      type: "image" as const,
      source: { type: "base64" as const, media_type: page.mediaType, data: page.base64 },
    },
  ]);
  const hint = DOC_HINTS[docType];
  content.push({
    type: "text",
    text:
      `These pages were classified as: ${docType}. Extract all readable deal and workflow fields.` +
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
  parsed.fields = parsed.fields.filter((field) => ALL_FIELD_KEYS.includes(field.field_key));
  return parsed;
}
