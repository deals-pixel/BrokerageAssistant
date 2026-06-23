import crypto from "node:crypto";
export { INTAKE_ADDRESS } from "@/lib/intake-address";
import { type DocumentType, type TransactionType } from "@/lib/types";

export type InboundAttachmentInput = {
  name: string;
  contentType: string | null;
  contentLength: number | null;
  contentBase64: string;
};

export type InboundEmailInput = {
  fromEmail: string | null;
  fromName: string | null;
  toEmail: string | null;
  originalRecipient: string | null;
  forwardingAdminEmail: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  messageId: string | null;
  threadId: string | null;
  receivedAt: string | null;
  attachments: InboundAttachmentInput[];
};

export type LightRoutingResult = {
  property_address: string;
  mls_number: string;
  transaction_type_guess: "sale" | "lease" | "referral" | "co_brokerage" | "preconstruction" | "unknown";
  party_names: string[];
  agent_names: string[];
  document_type_guesses: {
    filename: string;
    document_type: string;
    confidence: number;
  }[];
  routing_confidence: number;
  transaction_code: string;
};

const DOC_TYPE_FILENAME_HINTS: Partial<Record<DocumentType, string[]>> = {
  agreement_of_purchase_and_sale: ["aps", "agreement of purchase", "purchase and sale"],
  agreement_to_lease: ["agreement to lease", "lease agreement", "atl"],
  deposit_proof: ["deposit", "bank draft", "wire", "cheque", "receipt"],
  listing_agreement: ["listing agreement", "form 200", "form 270", "schedule a"],
  buyer_representation_agreement: ["buyer representation", "bra"],
  tenant_representation_agreement: ["tenant representation", "tra"],
  reco_information_guide_ack: ["reco", "information guide"],
  form_320_confirmation_cooperation: ["confirmation of cooperation", "form 320", "form 324"],
  form_801_offer_summary: ["form 801", "offer summary"],
  referral_agreement: ["referral"],
  co_brokerage_agreement: ["co-brokerage", "cobrokerage"],
  ontario_residential_tenancy_agreement: ["residential tenancy", "standard lease"],
  form_630_individual_identification: ["fintrac", "individual identification"],
  form_631_pep_checklist: ["pep", "politically exposed"],
};

const ACCEPTED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"]);
const IGNORED_EXTENSIONS = new Set([".vcf", ".ics"]);

export function normalizeInboundEmailPayload(payload: Record<string, unknown>): InboundEmailInput {
  const attachments = Array.isArray(payload.Attachments)
    ? payload.Attachments.map((item) => normalizePostmarkAttachment(item)).filter(isInboundAttachment)
    : [];

  return {
    fromEmail: stringOrNull(payload.From),
    fromName: stringOrNull(payload.FromName),
    toEmail: stringOrNull(payload.To),
    originalRecipient: stringOrNull(payload.OriginalRecipient),
    forwardingAdminEmail: stringOrNull(payload.From),
    subject: stringOrNull(payload.Subject),
    bodyText: stringOrNull(payload.TextBody),
    bodyHtml: stringOrNull(payload.HtmlBody),
    messageId: stringOrNull(payload.MessageID) ?? stringOrNull(payload.MessageId),
    threadId: stringOrNull(payload.ThreadID) ?? stringOrNull(payload.ThreadId),
    receivedAt: stringOrNull(payload.Date) ?? new Date().toISOString(),
    attachments,
  };
}

export function shouldStoreAttachment(attachment: InboundAttachmentInput) {
  const extension = extensionOf(attachment.name);
  const size = attachment.contentLength ?? Buffer.byteLength(attachment.contentBase64, "base64");

  if (IGNORED_EXTENSIONS.has(extension)) {
    return { store: false, reason: "unsupported_email_metadata_file" };
  }
  if (!ACCEPTED_EXTENSIONS.has(extension)) {
    return { store: false, reason: "unsupported_file_type" };
  }
  if (extension !== ".pdf" && size < 20 * 1024) {
    return { store: false, reason: "likely_signature_asset" };
  }

  return { store: true, reason: null };
}

export function hashAttachment(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function safeStorageFileName(name: string) {
  const extension = extensionOf(name);
  const baseName = extension ? name.slice(0, -extension.length) : name;
  const safeBaseName =
    baseName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "attachment";

  return `${safeBaseName}${extension}`;
}

export function buildAttachmentStoragePath({
  emailId,
  attachmentId,
  filename,
}: {
  emailId: string;
  attachmentId: string;
  filename: string;
}) {
  return `brokerages/default/emails/${emailId}/attachments/${attachmentId}/${safeStorageFileName(filename)}`;
}

export function heuristicRouteEmail(email: InboundEmailInput): LightRoutingResult {
  const text = [email.subject, inboundEmailPlainText(email)].filter(Boolean).join("\n");
  const normalized = text.toLowerCase();
  const transactionCode = text.match(/\bTX-\d{4}-\d{4,}\b/i)?.[0]?.toUpperCase() ?? "";
  const mlsNumber = text.match(/\b[A-Z]?\d{7,9}\b/i)?.[0] ?? "";
  const propertyAddress = extractLikelyAddress(text);
  const transactionTypeGuess = inferTransactionType(normalized, email.attachments.map((item) => item.name));
  const documentTypeGuesses = email.attachments.map((attachment) => classifyAttachmentFilename(attachment.name));
  const knownDocumentCount = documentTypeGuesses.filter((guess) => guess.confidence >= 0.55).length;
  const routingConfidence = Math.min(
    0.95,
    (transactionCode ? 0.4 : 0) +
      (mlsNumber ? 0.2 : 0) +
      (propertyAddress ? 0.25 : 0) +
      (knownDocumentCount > 0 ? 0.15 : 0),
  );

  return {
    property_address: propertyAddress,
    mls_number: mlsNumber,
    transaction_type_guess: transactionTypeGuess,
    party_names: [],
    agent_names: [],
    document_type_guesses: documentTypeGuesses,
    routing_confidence: Number(routingConfidence.toFixed(2)),
    transaction_code: transactionCode,
  };
}

export const lightRouteEmail = heuristicRouteEmail;

export function hasReviewableEmailContent(email: InboundEmailInput) {
  const text = [email.subject, inboundEmailPlainText(email)].filter(Boolean).join("\n").trim();
  if (text.length < 40) return false;

  const normalized = text.toLowerCase();
  if (/\bTX-\d{4}-\d{4,}\b/i.test(text)) return true;
  if (extractLikelyAddress(text)) return true;
  if (/\b[A-Z]?\d{7,9}\b/i.test(text) && /\b(mls|listing)\b/i.test(text)) return true;

  const transactionSignals = [
    "agreement",
    "buyer",
    "closing",
    "commission",
    "deal",
    "deposit",
    "fintrac",
    "landlord",
    "lease",
    "listing",
    "offer",
    "property",
    "seller",
    "tenant",
  ];
  const signalCount = transactionSignals.filter((signal) => normalized.includes(signal)).length;
  return text.length >= 120 && signalCount >= 2;
}

export function inboundEmailPlainText(email: Pick<InboundEmailInput, "bodyText" | "bodyHtml">) {
  if (email.bodyText?.trim()) return email.bodyText.trim();
  if (!email.bodyHtml) return "";
  return email.bodyHtml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function transactionTypeForDeal(
  guess: LightRoutingResult["transaction_type_guess"],
): TransactionType {
  if (guess === "sale") return "purchase";
  if (guess === "lease") return "lease";
  return "unknown";
}

function normalizePostmarkAttachment(item: unknown): InboundAttachmentInput | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const name = stringOrNull(value.Name);
  const content = stringOrNull(value.Content);
  if (!name || !content) return null;
  return {
    name,
    contentType: stringOrNull(value.ContentType),
    contentLength: numberOrNull(value.ContentLength),
    contentBase64: content,
  };
}

function isInboundAttachment(value: InboundAttachmentInput | null): value is InboundAttachmentInput {
  return value !== null;
}

function classifyAttachmentFilename(filename: string): LightRoutingResult["document_type_guesses"][number] {
  const normalized = filename.toLowerCase();
  let best: { docType: string; confidence: number } = { docType: "unknown", confidence: 0.2 };

  for (const [docType, hints] of Object.entries(DOC_TYPE_FILENAME_HINTS)) {
    const match = hints?.find((hint) => normalized.includes(hint));
    if (!match) continue;
    const confidence = match.length > 8 ? 0.75 : 0.6;
    if (confidence > best.confidence) best = { docType, confidence };
  }

  return {
    filename,
    document_type: best.docType,
    confidence: best.confidence,
  };
}

function inferTransactionType(
  normalizedText: string,
  filenames: string[],
): LightRoutingResult["transaction_type_guess"] {
  const allText = `${normalizedText}\n${filenames.join("\n").toLowerCase()}`;
  if (allText.includes("pre-construction") || allText.includes("preconstruction")) return "preconstruction";
  if (allText.includes("referral")) return "referral";
  if (allText.includes("co-brokerage") || allText.includes("cobrokerage")) return "co_brokerage";
  if (allText.includes("lease") || allText.includes("tenant") || allText.includes("landlord")) return "lease";
  if (allText.includes("purchase") || allText.includes("sale") || allText.includes("aps")) return "sale";
  return "unknown";
}

function extractLikelyAddress(text: string) {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /^\d{1,6}\s+/.test(item) && /(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|blvd|boulevard)/i.test(item));
  return line?.replace(/^property\s*:\s*/i, "").slice(0, 180) ?? "";
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
