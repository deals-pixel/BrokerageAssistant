import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import sharp from "sharp";
import {
  ALL_FIELD_KEYS,
  DERIVED_DEAL_SHEET_FIELD_KEYS,
  FIELD_LABELS,
  type DocumentType,
  type SourceBox,
} from "@/lib/types";
import {
  extractionTemplateGuide,
  standardFormByKey,
  type StandardFormMatch,
} from "@/lib/standard-forms";
import { anthropic, EXTRACTION_AI_MODEL } from "./client";
import {
  extractionCacheKey,
  readCachedExtraction,
  writeCachedExtraction,
} from "./extraction-cache";
import { FieldExtractionSchema, type FieldExtraction } from "./schemas";
import { logAiUsage, usageFromResponse } from "./usage";

const EXTRACTABLE_FIELD_KEYS = ALL_FIELD_KEYS.filter((key) => !DERIVED_DEAL_SHEET_FIELD_KEYS.has(key));
const FIELD_GUIDE = EXTRACTABLE_FIELD_KEYS.map((key) => `- ${key}: ${FIELD_LABELS[key]}`).join("\n");

const SYSTEM = `You extract deal fields from scanned Ontario real estate documents for Sutton Group-Admiral Realty. The goal is to fill the brokerage's Deal Information Sheet and compliance workflow from source documents. Values may be handwritten or typed.

Extract only fields visibly present in the supplied pages. Allowed field keys:

${FIELD_GUIDE}

Rules:
- Return one entry per field you can read from these pages; omit fields not shown.
- Dates in YYYY-MM-DD. Money as plain numbers without $ or commas, for example 850000. Percentages as numbers, for example 2.5. If a commission is written as text, return that visible text.
- Agent and side fields are from Sutton Group-Admiral's perspective. agent_name is the Sutton Group-Admiral agent shown as "Your Name" or the SGA-side representative. listing_agent_name/listing_brokerage are the listing/seller/landlord side shown in the source. cooperating_agent_name/cooperating_brokerage are the co-operating/buyer/tenant side shown in the source. If a source document uses "selling brokerage" or "selling agent", treat that wording as the co-operating side, not the seller side.
- representation_side means which side Sutton Group-Admiral represents: listing, cooperating, or both. Use listing for seller/landlord-side SGA representation, cooperating for buyer/tenant-side SGA representation, and both only when Sutton Group-Admiral is shown on both sides.
- When both listing and co-operating sides are visible, extract listing_agent_name and cooperating_agent_name exactly as shown. Same-name vs different-name determines whether the both-side scenario is same-agent or different-agent.
- A visible other-side brokerage name means that side is represented by a brokerage, not self-represented. Only mark seller_representation or buyer_representation as self-represented when the source explicitly says self-represented/unrepresented or the self-represented disclosure applies and no brokerage name is visible for that side.
- Commission extraction fields are source-side facts, not scenario-derived results. listing_commission_pct is the commission payable to the listing/seller/landlord-side brokerage. cooperating_commission_pct is the commission payable/offered to the co-operating/buyer/tenant-side brokerage. total_commission_pct is only the combined total of both side amounts when the document explicitly gives a total or the two side amounts can be safely added. Do not copy a one-sided commission into total_commission_pct.
- Do not extract derived Deal Information Sheet fields directly from source documents, including price_or_rent, seller_landlord_*, buyer_tenant_*, your_commission_pct, outside_agent_name, outside_brokerage, outside_brokerage_commission_pct, deposit_holder, or deposit_held_by_sutton. Those are derived later after scenario detection and source-field normalization.
- transaction_type is purchase or lease. firm_or_conditional is firm or conditional. multiple_offer is yes (N) or no.
- seller_representation and buyer_representation can be Sutton Group-Admiral, other brokerage, self-represented, or unknown when visible. For leases, seller_representation means landlord representation and buyer_representation means tenant representation.
- scenario_hint should capture explicit phrases such as referral, co-brokerage, pre-construction, buyer self-represented, tenant self-represented, or multiple representation when visible.
- seller_is_corporation and buyer_is_corporation should be yes, no, or unknown when visible.
- additional_payees, rebate_to_clients, and referral should be yes or no when visible.
- additional_payee_1_commission_pct, additional_payee_2_commission_pct, cooperating_commission_pct, listing_commission_pct, and total_commission_pct are percentages. marketing_fee_amount and rebate_amount are money amounts.
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
    "The listing agreement shows listing period, seller/landlord names, listing agent, listing brokerage, and commission terms. In the commission section, the amount payable to the Listing Brokerage is listing_commission_pct. The amount offered/payable to any co-operating brokerage is cooperating_commission_pct. These are source-side facts; the app derives Your Commission after scenario detection. Only fill total_commission_pct if the form explicitly gives a combined total or you can safely add both side amounts.",
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
const PROMPT_SIGNATURE = createHash("sha256")
  .update(SYSTEM)
  .update("|field-extraction-schema-v2")
  .digest("hex");
const REGION_SYSTEM = `You read small cropped field regions from known Ontario real estate standard forms.

Each image is already cropped to one labelled field region. Read only the handwritten or typed value inside that crop.

Rules:
- Return one field entry only when a value is visible in the crop.
- Omit blank fields, labels-only crops, boilerplate text, and unreadable marks.
- Use exactly the provided field_key.
- Dates in YYYY-MM-DD when clear. Money as plain numbers without $ or commas. Percentages as numbers.
- Multiple people in one field: join with "; ".
- confidence is high when clearly legible, medium when readable but ambiguous, low when partially illegible.
- source_page must be the package page number supplied for the region.
- source_box can be null; the application will restore the calibrated full-page region.`;
const REGION_PROMPT_SIGNATURE = createHash("sha256")
  .update(REGION_SYSTEM)
  .update("|region-field-extraction-v1")
  .digest("hex");

export type RegionPageMatch = {
  pageNumber: number;
  templatePageNumber: number | null;
  match: StandardFormMatch | null;
};

export async function extractFromDocument(
  docType: DocumentType,
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png"; pageHash?: string | null }[],
  options: {
    standardForms?: StandardFormMatch[];
    dealId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<FieldExtraction> {
  if (pageImages.length > MAX_PAGES_PER_CALL) {
    const chunks: FieldExtraction[] = [];
    for (let index = 0; index < pageImages.length; index += MAX_PAGES_PER_CALL) {
      chunks.push(
        await extractDocumentChunk(docType, pageImages.slice(index, index + MAX_PAGES_PER_CALL), {
          ...options,
          metadata: {
            ...options.metadata,
            chunk_index: Math.floor(index / MAX_PAGES_PER_CALL) + 1,
            chunk_count: Math.ceil(pageImages.length / MAX_PAGES_PER_CALL),
          },
        }),
      );
    }
    return { fields: chunks.flatMap((chunk) => chunk.fields) };
  }

  return extractDocumentChunk(docType, pageImages, options);
}

export async function extractFromStandardFormRegions(
  docType: DocumentType,
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png"; pageHash?: string | null }[],
  pageMatches: RegionPageMatch[],
  options: {
    dealId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<{ extraction: FieldExtraction; regionCount: number; extractedCount: number } | null> {
  const regionInputs = await regionInputsForPages(pageImages, pageMatches);
  if (regionInputs.length === 0) return null;

  const cacheKey = extractionCacheKey({
    model: EXTRACTION_AI_MODEL,
    docType,
    pages: pageImages,
    standardFormKeys: [...new Set(regionInputs.map((input) => input.formKey))].sort(),
    promptSignature: REGION_PROMPT_SIGNATURE,
  });

  if (cacheKey) {
    const cached = await readCachedExtraction(cacheKey);
    if (cached) {
      await logAiUsage({
        layer: "extraction",
        model: EXTRACTION_AI_MODEL,
        dealId: options.dealId,
        cached: true,
        inputPages: pageImages.length,
        metadata: {
          doc_type: docType,
          cache_key: cacheKey,
          extraction_mode: "region_first",
          regions: regionInputs.length,
          ...options.metadata,
        },
      });
      return { extraction: cached, regionCount: regionInputs.length, extractedCount: cached.fields.length };
    }
  }

  const content: Anthropic.ContentBlockParam[] = [];
  for (const [index, input] of regionInputs.entries()) {
    content.push({
      type: "text",
      text:
        `Region ${index + 1}: field_key=${input.fieldKey}; label=${input.label}; ` +
        `package_page=${input.pageNumber}; form=${input.formTitle}; template_page=${input.templatePageNumber ?? "unknown"}.`,
    });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: input.cropBase64 },
    });
  }
  content.push({
    type: "text",
    text: "Read the visible values in these cropped regions. Return only nonblank values.",
  });

  const response = await anthropic.messages.parse({
    model: EXTRACTION_AI_MODEL,
    max_tokens: Math.min(8000, 600 + regionInputs.length * 120),
    system: REGION_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(FieldExtractionSchema) },
  });
  await logAiUsage({
    layer: "extraction",
    model: EXTRACTION_AI_MODEL,
    dealId: options.dealId,
    usage: usageFromResponse(response),
    inputPages: pageImages.length,
    metadata: {
      doc_type: docType,
      cache_key: cacheKey,
      extraction_mode: "region_first",
      regions: regionInputs.length,
      ...options.metadata,
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Region extraction returned no parseable output for ${docType}`);
  const fields: FieldExtraction["fields"] = [];
  for (const field of parsed.fields) {
    const input = regionInputs.find(
      (region) => region.fieldKey === field.field_key && region.pageNumber === field.source_page,
    ) ?? regionInputs.find((region) => region.fieldKey === field.field_key);
    const value = field.value?.trim();
    if (!input || !value || !EXTRACTABLE_FIELD_KEYS.includes(field.field_key)) continue;
    fields.push({
      ...field,
      value,
      source_page: input.pageNumber,
      source_box: input.sourceBox,
      source_box_origin: "template",
    });
  }

  const extraction = { fields };
  if (cacheKey) {
    await writeCachedExtraction({
      cacheKey,
      model: EXTRACTION_AI_MODEL,
      docType,
      pageHashes: pageImages.map((page) => page.pageHash).filter((hash): hash is string => Boolean(hash)),
      extraction,
    });
  }
  return { extraction, regionCount: regionInputs.length, extractedCount: extraction.fields.length };
}

type RegionInput = {
  fieldKey: string;
  label: string;
  pageNumber: number;
  templatePageNumber: number | null;
  formKey: string;
  formTitle: string;
  sourceBox: SourceBox;
  cropBase64: string;
};

async function regionInputsForPages(
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png"; pageHash?: string | null }[],
  pageMatches: RegionPageMatch[],
): Promise<RegionInput[]> {
  const inputs: RegionInput[] = [];
  const imageByPage = new Map(pageImages.map((image) => [image.pageNumber, image]));

  for (const pageMatch of pageMatches) {
    const match = pageMatch.match;
    const image = imageByPage.get(pageMatch.pageNumber);
    if (!match || !image) continue;

    const form = standardFormByKey(match.key);
    if (!form?.fieldRegions?.length) continue;

    const regions = form.fieldRegions.filter(
      (region) =>
        EXTRACTABLE_FIELD_KEYS.includes(region.fieldKey) &&
        (pageMatch.templatePageNumber == null || region.page == null || region.page === pageMatch.templatePageNumber),
    );
    if (regions.length === 0) continue;

    const buffer = Buffer.from(image.base64, "base64");
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) continue;

    for (const region of regions) {
      for (const box of region.boxes) {
        const crop = cropBox(metadata.width, metadata.height, box);
        if (!crop) continue;
        const cropBuffer = await sharp(buffer)
          .extract(crop)
          .jpeg({ quality: 86, mozjpeg: true })
          .toBuffer();
        inputs.push({
          fieldKey: region.fieldKey,
          label: region.label,
          pageNumber: pageMatch.pageNumber,
          templatePageNumber: pageMatch.templatePageNumber,
          formKey: form.key,
          formTitle: form.title,
          sourceBox: box,
          cropBase64: cropBuffer.toString("base64"),
        });
      }
    }
  }

  return inputs;
}

function cropBox(width: number, height: number, box: SourceBox) {
  const paddingX = Math.max(4, Math.round(width * 0.004));
  const paddingY = Math.max(4, Math.round(height * 0.004));
  const left = clamp(Math.floor(box.x * width) - paddingX, 0, width - 1);
  const top = clamp(Math.floor(box.y * height) - paddingY, 0, height - 1);
  const right = clamp(Math.ceil((box.x + box.width) * width) + paddingX, left + 1, width);
  const bottom = clamp(Math.ceil((box.y + box.height) * height) + paddingY, top + 1, height);
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < 8 || cropHeight < 8) return null;
  return { left, top, width: cropWidth, height: cropHeight };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

async function extractDocumentChunk(
  docType: DocumentType,
  pageImages: { pageNumber: number; base64: string; mediaType: "image/jpeg" | "image/png"; pageHash?: string | null }[],
  options: {
    standardForms?: StandardFormMatch[];
    dealId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<FieldExtraction> {
  const pages = pageImages.slice(0, MAX_PAGES_PER_CALL);
  const standardFormKeys = (options.standardForms ?? [])
    .map((form) => form.key)
    .filter(Boolean)
    .sort();
  const cacheKey = extractionCacheKey({
    model: EXTRACTION_AI_MODEL,
    docType,
    pages,
    standardFormKeys,
    promptSignature: PROMPT_SIGNATURE,
  });

  if (cacheKey) {
    const cached = await readCachedExtraction(cacheKey);
    if (cached) {
      await logAiUsage({
        layer: "extraction",
        model: EXTRACTION_AI_MODEL,
        dealId: options.dealId,
        cached: true,
        inputPages: pages.length,
        metadata: { doc_type: docType, cache_key: cacheKey, ...options.metadata },
      });
      return cached;
    }
  }

  const content: Anthropic.ContentBlockParam[] = pages.flatMap((page) => [
    { type: "text" as const, text: `Page ${page.pageNumber}:` },
    {
      type: "image" as const,
      source: { type: "base64" as const, media_type: page.mediaType, data: page.base64 },
    },
  ]);
  const hint = DOC_HINTS[docType];
  const templateGuide = extractionTemplateGuide(options.standardForms ?? []);
  content.push({
    type: "text",
    text:
      `These pages were classified as: ${docType}. Extract all readable deal and workflow fields.` +
      (hint ? `\n\nHint for this document type: ${hint}` : "") +
      (templateGuide
        ? `\n\nMatched standard form templates:\n${templateGuide}\nUse these regions only as layout priors. The returned source_box must still tightly cover the visible value on the actual uploaded page.`
        : ""),
  });

  const response = await anthropic.messages.parse({
    model: EXTRACTION_AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(FieldExtractionSchema) },
  });
  await logAiUsage({
    layer: "extraction",
    model: EXTRACTION_AI_MODEL,
    dealId: options.dealId,
    usage: usageFromResponse(response),
    inputPages: pages.length,
    metadata: { doc_type: docType, cache_key: cacheKey, ...options.metadata },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error(`Extraction returned no parseable output for ${docType}`);
  parsed.fields = parsed.fields.filter((field) => ALL_FIELD_KEYS.includes(field.field_key));
  if (cacheKey) {
    await writeCachedExtraction({
      cacheKey,
      model: EXTRACTION_AI_MODEL,
      docType,
      pageHashes: pages.map((page) => page.pageHash).filter((hash): hash is string => Boolean(hash)),
      extraction: parsed,
    });
  }
  return parsed;
}
