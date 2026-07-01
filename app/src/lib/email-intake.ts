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
  email_body_fields?: EmailBodyFieldGuess[];
  document_type_guesses: {
    filename: string;
    document_type: string;
    confidence: number;
  }[];
  routing_confidence: number;
  transaction_code: string;
};

export type EmailBodyFieldGuess = {
  field_key: string;
  label: string;
  raw_label: string;
  value: string;
  confidence: number;
  source: "email_body";
};

export const EXISTING_DEAL_MATCH_THRESHOLD = 50;

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
  return buildHeuristicRouteEmail(email, { includeQuotedThreadContext: false });
}

export function heuristicRouteEmailForThreadContext(email: InboundEmailInput): LightRoutingResult {
  return buildHeuristicRouteEmail(email, { includeQuotedThreadContext: true });
}

function buildHeuristicRouteEmail(
  email: InboundEmailInput,
  { includeQuotedThreadContext }: { includeQuotedThreadContext: boolean },
): LightRoutingResult {
  const subjectText = email.subject?.trim() ?? "";
  const bodyText = inboundEmailPlainText(email);
  const searchableBodyText = includeQuotedThreadContext
    ? unquoteEmailThread(bodyText)
    : contentBeforeSignatureAndQuotedReply(bodyText);
  const text = [subjectText, bodyText].filter(Boolean).join("\n");
  const normalized = text.toLowerCase();
  const emailBodyFields = extractEmailBodyFields(email);
  const transactionCode = text.match(/\bTX-\d{4}-\d{4,}\b/i)?.[0]?.toUpperCase() ?? "";
  const mlsNumber = text.match(/\b[A-Z]?\d{7,9}\b/i)?.[0] ?? "";
  const propertyAddress =
    emailBodyFields.find((field) => field.field_key === "property_address")?.value ||
    extractLikelyAddressFromFilenames(email.attachments.map((item) => item.name)) ||
    extractLikelyAddress(subjectText) ||
    extractLikelyAddress(searchableBodyText);
  const transactionTypeGuess = inferTransactionType(normalized, email.attachments.map((item) => item.name));
  const documentTypeGuesses = email.attachments.map((attachment) => classifyAttachmentFilename(attachment.name));
  const knownDocumentCount = documentTypeGuesses.filter((guess) => guess.confidence >= 0.55).length;
  const routingConfidence = Math.min(
    0.95,
    (transactionCode ? 0.4 : 0) +
      (mlsNumber ? 0.2 : 0) +
      (propertyAddress ? 0.25 : 0) +
      (emailBodyFields.length > 0 ? 0.1 : 0) +
      (knownDocumentCount > 0 ? 0.15 : 0),
  );

  return {
    property_address: propertyAddress,
    mls_number: mlsNumber,
    transaction_type_guess: transactionTypeGuess,
    party_names: [],
    agent_names: [],
    email_body_fields: emailBodyFields,
    document_type_guesses: documentTypeGuesses,
    routing_confidence: Number(routingConfidence.toFixed(2)),
    transaction_code: transactionCode,
  };
}

export const lightRouteEmail = heuristicRouteEmail;

export function hasReviewableEmailContent(email: InboundEmailInput) {
  const bodyText = inboundEmailPlainText(email);
  const text = [email.subject, bodyText].filter(Boolean).join("\n").trim();
  if (text.length < 40) return false;

  if (extractEmailBodyFields(email).length > 0) return true;
  const normalized = text.toLowerCase();
  if (/\bTX-\d{4}-\d{4,}\b/i.test(text)) return true;
  if (extractLikelyAddress([email.subject, contentBeforeSignatureAndQuotedReply(bodyText)].filter(Boolean).join("\n"))) return true;
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

export function extractEmailBodyFields(email: Pick<InboundEmailInput, "bodyText" | "bodyHtml">): EmailBodyFieldGuess[] {
  const text = contentBeforeSignatureAndQuotedReply(inboundEmailPlainText(email));
  if (!text) return [];

  const fields = new Map<string, EmailBodyFieldGuess>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    if (!line || /^field\s+value$/i.test(line)) continue;

    const match = line.match(/^([A-Za-z][A-Za-z0-9 /()&$.'-]{1,72})\s*:\s*(.+)$/);
    if (!match) continue;

    const rawLabel = match[1].trim();
    const rawValue = match[2].trim();
    if (!rawValue || rawValue === "-" || /^n\/?a$/i.test(rawValue)) continue;

    const mapping = mapEmailBodyLabel(rawLabel);
    if (!mapping) continue;

    const value = normalizeEmailBodyFieldValue(mapping.field_key, rawValue);
    if (!value) continue;

    fields.set(mapping.field_key, {
      field_key: mapping.field_key,
      label: mapping.label,
      raw_label: rawLabel,
      value,
      confidence: mapping.confidence,
      source: "email_body",
    });
  }

  for (const field of extractSolicitorFields(text)) {
    if (!fields.has(field.field_key)) fields.set(field.field_key, field);
  }

  return Array.from(fields.values());
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

function mapEmailBodyLabel(label: string) {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  const mappings: {
    field_key: string;
    label: string;
    confidence: number;
    patterns: RegExp[];
  }[] = [
    {
      field_key: "property_address",
      label: "Property Address",
      confidence: 0.9,
      patterns: [/^property address$/, /^address$/, /^subject property$/, /^subject property address$/],
    },
    {
      field_key: "closing_date",
      label: "Closing Date",
      confidence: 0.85,
      patterns: [/^closing date$/, /^closing$/, /^completion date$/],
    },
    {
      field_key: "representation_side",
      label: "Representation Side",
      confidence: 0.75,
      patterns: [/^we represent( the)?$/, /^represented side$/, /^representation side$/, /^our side$/],
    },
    {
      field_key: "seller_lawyer_name",
      label: "Seller Lawyer Info",
      confidence: 0.65,
      patterns: [/^seller lawyer( info)?( \(if available\))?$/, /^seller solicitor( info)?$/],
    },
    {
      field_key: "buyer_lawyer_name",
      label: "Buyer Lawyer Info",
      confidence: 0.65,
      patterns: [/^buyer lawyer( info)?( \(if available\))?$/, /^buyer solicitor( info)?$/],
    },
    {
      field_key: "mls_number",
      label: "MLS Number",
      confidence: 0.85,
      patterns: [/^mls$/, /^mls number$/, /^listing number$/],
    },
    {
      field_key: "price_or_rent",
      label: "Price / Rent",
      confidence: 0.75,
      patterns: [/^sale price$/, /^purchase price$/, /^price$/, /^rent$/, /^lease price$/],
    },
    {
      field_key: "transaction_type",
      label: "Transaction Type",
      confidence: 0.75,
      patterns: [/^transaction type$/, /^deal type$/],
    },
  ];

  return mappings.find((mapping) => mapping.patterns.some((pattern) => pattern.test(normalized))) ?? null;
}

function extractSolicitorFields(text: string): EmailBodyFieldGuess[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanEmailLine(line))
    .filter(Boolean);
  const sections = collectSolicitorSections(lines);
  const fields: EmailBodyFieldGuess[] = [];

  for (const section of sections) {
    const parsed = parseSolicitorSection(section.lines);
    for (const [suffix, value] of Object.entries(parsed)) {
      if (!value) continue;
      const fieldKey = `${section.side}_lawyer_${suffix}`;
      fields.push({
        field_key: fieldKey,
        label: `${section.side === "seller" ? "Seller/Landlord" : "Buyer/Tenant"} Lawyer ${labelForLawyerSuffix(suffix)}`,
        raw_label: section.header,
        value: normalizeEmailBodyFieldValue(fieldKey, value),
        confidence: 0.82,
        source: "email_body",
      });
    }
  }

  return fields;
}

function collectSolicitorSections(lines: string[]) {
  const sections: { side: "seller" | "buyer"; header: string; lines: string[] }[] = [];
  let current: { side: "seller" | "buyer"; header: string; lines: string[] } | null = null;

  for (const line of lines) {
    const side = solicitorHeaderSide(line);
    if (side) {
      if (current) sections.push(current);
      current = { side, header: line, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function solicitorHeaderSide(line: string): "seller" | "buyer" | null {
  const normalized = line.toLowerCase();
  const hasLawyerSignal = /\b(solicitor|lawyer)\b/.test(normalized);
  if (!hasLawyerSignal) return null;
  if (/\b(seller|landlord)\b/.test(normalized)) return "seller";
  if (/\b(buyer|tenant)\b/.test(normalized)) return "buyer";
  return null;
}

function parseSolicitorSection(lines: string[]) {
  const usefulLines = lines
    .map((line) => line.replace(/<mailto:[^>]+>/gi, "").trim())
    .filter((line) => line && !isBoilerplateSolicitorLine(line));
  const email = firstEmail(usefulLines);
  const phone = firstPhone(usefulLines);
  const name = firstSolicitorName(usefulLines);
  const firm = firstSolicitorFirm(usefulLines, name);
  return { name, firm, email, phone };
}

function firstEmail(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return match[0];
  }
  return "";
}

function firstPhone(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d+)?/i);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }
  return "";
}

function firstSolicitorName(lines: string[]) {
  return lines.find((line) => isLikelyPersonName(line)) ?? "";
}

function firstSolicitorFirm(lines: string[], name: string) {
  const firm = lines.find((line) => {
    if (line === name) return false;
    if (line.includes("@")) return false;
    if (firstPhone([line])) return false;
    return /\b(llp|law|legal|barrister|solicitor|professional corporation|pc|p\.c\.|firm)\b/i.test(line);
  });
  return firm ?? "";
}

function isLikelyPersonName(line: string) {
  if (line.includes("@") || firstPhone([line])) return false;
  if (/\b(solicitor|lawyer|clerk|founder|principal|real estate|conveyancing|office|fax|email|phone|tel|direct|suite|avenue|street|road|drive|crescent)\b/i.test(line)) {
    return false;
  }
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Z][A-Za-z'.-]+$/.test(word));
}

function isBoilerplateSolicitorLine(line: string) {
  return (
    /^\[.*\]$/.test(line) ||
    /^description automatically generated$/i.test(line) ||
    /^\(?[A-Za-z ]+ office\)?$/i.test(line) ||
    /^thank(s| you)?[,!]?$/i.test(line)
  );
}

function cleanEmailLine(line: string) {
  return line
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/\bmailto:/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+-\s*$/, "")
    .replace(/\s+[-–]\s*$/, "");
}

function labelForLawyerSuffix(suffix: string) {
  if (suffix === "name") return "Name";
  if (suffix === "firm") return "Firm";
  if (suffix === "email") return "Email";
  if (suffix === "phone") return "Phone";
  return suffix;
}

function normalizeEmailBodyFieldValue(fieldKey: string, value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (fieldKey === "closing_date") return normalizeEmailDate(cleaned) || cleaned;
  if (fieldKey === "representation_side") return normalizeRepresentationSide(cleaned);
  if (fieldKey === "transaction_type") return normalizeEmailTransactionType(cleaned);
  return cleaned.slice(0, 240);
}

function normalizeEmailDate(value: string) {
  const numeric = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (numeric) {
    const year = normalizeYear(numeric[3]);
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    if (isValidDateParts(year, month, day)) return formatDateParts(year, month, day);
  }

  const named = value.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s*(\d{2,4})\b/i,
  );
  if (named) {
    const year = normalizeYear(named[3]);
    const month = monthNumber(named[1]);
    const day = Number(named[2]);
    if (month && isValidDateParts(year, month, day)) return formatDateParts(year, month, day);
  }

  return "";
}

function normalizeYear(value: string) {
  const year = Number(value);
  return value.length === 2 ? 2000 + year : year;
}

function monthNumber(value: string) {
  const short = value.slice(0, 3).toLowerCase();
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(short) + 1;
}

function isValidDateParts(year: number, month: number, day: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatDateParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeRepresentationSide(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("seller")) return "Seller";
  if (normalized.includes("buyer")) return "Buyer";
  if (normalized.includes("landlord")) return "Landlord";
  if (normalized.includes("tenant")) return "Tenant";
  return value.slice(0, 120);
}

function normalizeEmailTransactionType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("lease")) return "Lease";
  if (normalized.includes("sale") || normalized.includes("purchase")) return "Purchase";
  if (normalized.includes("referral")) return "Referral";
  return value.slice(0, 120);
}

function extractLikelyAddress(text: string) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].replace(/^\s*>+\s?/, "");
    const hasAddressLabel = /^\s*(property|property address|subject property|subject property address|address)\s*:/i.test(rawLine);
    const line = rawLine.trim().replace(/^(?:property|property address|subject property|subject property address|address)\s*:\s*/i, "");
    if (!hasAddressLabel && isLikelySignatureAddressLine(lines, index)) continue;
    for (const candidate of addressLineCandidates(line, lines[index + 1] ?? "")) {
      const address = candidate.match(
        /\b(\d{1,6}\s+.{2,80}\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|crescent|cres|blvd|boulevard)\b\.?)/i,
      );
      if (address) return address[1].trim().replace(/[.,;:]+$/, "").slice(0, 180);
    }
  }
  return "";
}

function addressLineCandidates(line: string, nextRawLine: string) {
  const candidates = [line];
  const nextLine = nextRawLine.replace(/^\s*>+\s?/, "").trim();
  if (nextLine && /\b\d{1,6}\s*$/.test(line) && /^\D{2,80}\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|crescent|cres|blvd|boulevard)\b\.?/i.test(nextLine)) {
    candidates.push(`${line} ${nextLine}`);
  }
  return candidates;
}

function extractLikelyAddressFromFilenames(filenames: string[]) {
  for (const filename of filenames) {
    const candidate = normalizeFilenameForAddress(filename);
    const unitAddress = candidate.match(
      /^(\d{1,6})\s+(\d{1,6})\s+(.{2,80}\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|crescent|cres|blvd|boulevard)\b\.?)/i,
    );
    if (unitAddress) {
      return `${unitAddress[1]} - ${unitAddress[2]} ${titleCaseAddress(unitAddress[3])}`.slice(0, 180);
    }

    const address = candidate.match(
      /\b(\d{1,6}\s+.{2,80}\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|crescent|cres|blvd|boulevard)\b\.?)/i,
    );
    if (address) return titleCaseAddress(address[1]).slice(0, 180);
  }
  return "";
}

function normalizeFilenameForAddress(filename: string) {
  return filename
    .replace(/\.[A-Za-z0-9]{1,8}$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseAddress(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (/^\d+[a-z]?$/i.test(part)) return part.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function contentBeforeSignatureAndQuotedReply(text: string) {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (isSignatureBoundary(line)) break;
    kept.push(rawLine);
  }
  return kept.join("\n").trim();
}

function unquoteEmailThread(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*>+\s?/, "").trim())
    .filter((line) => line && !/^on .+\bwrote:$/i.test(line))
    .join("\n");
}

function isSignatureBoundary(line: string) {
  if (!line) return false;
  return (
    /^--\s*$/.test(line) ||
    /^(thanks|thank you|regards|best regards|kind regards|warm regards|sincerely|cheers)[,!. ]*$/i.test(line) ||
    /^sent from\b/i.test(line) ||
    /^on .+\bwrote:$/i.test(line) ||
    /^(confidentiality notice|disclaimer)\b/i.test(line)
  );
}

function isLikelySignatureAddressLine(lines: string[], index: number) {
  const window = lines
    .slice(Math.max(0, index - 2), Math.min(lines.length, index + 4))
    .filter((line) => !isQuotedAttributionLine(line))
    .join(" ")
    .toLowerCase();
  const hasContactInfo = /\b(email|e-mail|cell|mobile|phone|tel|fax|website|www\.)\b|@/.test(window);
  const hasBrokerageBrand = /\b(re\/max|royal lepage|sutton|century 21|right at home|homelife|team admiral)\b/i.test(window);
  return hasContactInfo || hasBrokerageBrand;
}

function isQuotedAttributionLine(line: string) {
  const cleaned = line.replace(/^\s*>+\s?/, "").trim();
  return /^on .+\bwrote:?$/i.test(cleaned) || /^wrote:?$/i.test(cleaned);
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
