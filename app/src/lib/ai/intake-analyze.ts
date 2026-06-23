import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { DOCUMENT_TYPES } from "@/lib/types";
import {
  heuristicRouteEmail,
  type EmailBodyFieldGuess,
  type InboundAttachmentInput,
  type InboundEmailInput,
} from "@/lib/email-intake";
import { anthropic, CLASSIFICATION_AI_MODEL } from "./client";
import { logAiUsage, usageFromResponse } from "./usage";

const MAX_ATTACHMENTS = Number(process.env.INTAKE_ANALYSIS_MAX_ATTACHMENTS ?? 4);
const MAX_PDF_PAGES = Number(process.env.INTAKE_ANALYSIS_MAX_PDF_PAGES ?? 3);
const MAX_FILE_BYTES = Number(process.env.INTAKE_ANALYSIS_MAX_FILE_MB ?? 12) * 1024 * 1024;
const DOCUMENT_TYPE_KEYS = ["unknown", ...Object.keys(DOCUMENT_TYPES)] as [string, ...string[]];

const IntakeAnalysisSchema = z.object({
  is_deal_package: z.boolean(),
  not_deal_reason: z.string(),
  property_address: z.string(),
  mls_number: z.string(),
  transaction_type_guess: z.enum([
    "sale",
    "lease",
    "referral",
    "co_brokerage",
    "preconstruction",
    "unknown",
  ]),
  party_names: z.array(z.string()),
  agent_names: z.array(z.string()),
  document_type_guesses: z.array(
    z.object({
      filename: z.string(),
      document_type: z.enum(DOCUMENT_TYPE_KEYS),
      confidence: z.number().min(0).max(1),
    }),
  ),
  routing_confidence: z.number().min(0).max(1),
  transaction_code: z.string(),
  recommended_action: z.enum(["existing_deal", "new_deal", "not_deal", "manual_review"]),
});

export type IntakeAnalysisResult = z.infer<typeof IntakeAnalysisSchema> & {
  email_body_fields?: EmailBodyFieldGuess[];
};

export type IntakeAnalysisAttachmentInput = InboundAttachmentInput & {
  id?: string;
  buffer: Buffer;
};

const SYSTEM = `You are an admin-approved intake analysis layer for a brokerage transaction platform.

This is not full compliance processing. Do not extract every field. Only decide whether the email package appears to be a real estate transaction package and identify routing signals.

Return strict JSON only through the provided schema.

Rules:
- is_deal_package is true only when the attachment/email appears to contain real estate transaction documents.
- not_deal_reason explains why is_deal_package is false; otherwise return an empty string.
- property_address is the transaction property address only. Leave empty if unclear.
- transaction_code must be a TX-YYYY-NNNN style code only when visible.
- transaction_type_guess is sale, lease, referral, co_brokerage, preconstruction, or unknown.
- document_type must be exactly one known document type key or unknown.
- recommended_action is existing_deal when a transaction code, address, parties, or sender make an existing-deal match likely; new_deal when it appears to be a new transaction package; not_deal when it is not a transaction package; manual_review when unclear.
- Do not infer facts from brokerage boilerplate, email signatures, disclaimers, logos, or footers.`;

export async function analyzeInboundPackage(
  email: InboundEmailInput,
  attachments: IntakeAnalysisAttachmentInput[],
  options: { inboundEmailId?: string | null } = {},
): Promise<IntakeAnalysisResult> {
  const fallback = heuristicRouteEmail(email);
  if (!process.env.ANTHROPIC_API_KEY) return fallbackAnalysis(fallback, attachments);

  const content = await buildAnalysisContent(email, attachments);
  const response = await anthropic.messages.parse({
    model: CLASSIFICATION_AI_MODEL,
    max_tokens: 2500,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(IntakeAnalysisSchema) },
  });

  await logAiUsage({
    layer: "intake_analysis",
    model: CLASSIFICATION_AI_MODEL,
    inboundEmailId: options.inboundEmailId,
    usage: usageFromResponse(response),
    inputAttachments: attachments.length,
    metadata: {
      max_attachments: MAX_ATTACHMENTS,
      max_pdf_pages: MAX_PDF_PAGES,
    },
  });

  const parsed = response.parsed_output;
  return parsed ? mergeFallback(parsed, fallback) : fallbackAnalysis(fallback, attachments);
}

async function buildAnalysisContent(
  email: InboundEmailInput,
  attachments: IntakeAnalysisAttachmentInput[],
): Promise<Anthropic.ContentBlockParam[]> {
  const usableAttachments = attachments
    .filter((attachment) => attachment.buffer.byteLength <= MAX_FILE_BYTES)
    .slice(0, MAX_ATTACHMENTS);
  const text = [
    "Inbound email metadata:",
    `From: ${email.fromName ?? ""} <${email.fromEmail ?? ""}>`,
    `To: ${email.toEmail ?? ""}`,
    `Subject: ${email.subject ?? ""}`,
    "",
    "Body text:",
    truncate(email.bodyText ?? "", 6000),
    "",
    "Attachments:",
    ...email.attachments.map((attachment) =>
      `- ${attachment.name} (${attachment.contentType ?? "unknown"}, ${attachment.contentLength ?? "unknown"} bytes)`,
    ),
  ].join("\n");

  const content: Anthropic.ContentBlockParam[] = [{ type: "text", text }];

  for (const attachment of usableAttachments) {
    const name = attachment.name;
    const contentType = attachment.contentType ?? "";
    if (isPdfAttachment(name, contentType)) {
      const pdf = await firstPagesPdf(attachment.buffer, MAX_PDF_PAGES);
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: pdf.toString("base64"),
        },
        context: `First ${MAX_PDF_PAGES} page(s) for attachment: ${name}`,
        title: name,
      });
      continue;
    }

    if (contentType === "image/jpeg" || contentType === "image/png") {
      content.push({ type: "text", text: `Image attachment: ${name}` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: contentType,
          data: attachment.buffer.toString("base64"),
        },
      });
    }
  }

  content.push({
    type: "text",
    text: "Analyze this inbound package. Return one document_type_guess for every attachment filename listed above.",
  });

  return content;
}

async function firstPagesPdf(buffer: Buffer, maxPages: number) {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const pageIndexes = source.getPageIndices().slice(0, Math.max(1, maxPages));
  const pages = await target.copyPages(source, pageIndexes);
  for (const page of pages) target.addPage(page);
  return Buffer.from(await target.save());
}

function mergeFallback(ai: IntakeAnalysisResult, fallback: ReturnType<typeof heuristicRouteEmail>): IntakeAnalysisResult {
  const fallbackAnalysisResult = fallbackAnalysis(fallback, []);
  return {
    ...ai,
    property_address: ai.property_address || fallback.property_address,
    mls_number: ai.mls_number || fallback.mls_number,
    transaction_type_guess:
      ai.transaction_type_guess !== "unknown" ? ai.transaction_type_guess : fallback.transaction_type_guess,
    party_names: dedupeStrings([...ai.party_names, ...fallback.party_names]),
    agent_names: dedupeStrings([...ai.agent_names, ...fallback.agent_names]),
    document_type_guesses: mergeDocumentGuesses(ai.document_type_guesses, fallback.document_type_guesses),
    routing_confidence: Math.max(ai.routing_confidence, fallback.routing_confidence),
    transaction_code: ai.transaction_code || fallback.transaction_code,
    recommended_action: ai.recommended_action || fallbackAnalysisResult.recommended_action,
    email_body_fields: fallback.email_body_fields ?? [],
  };
}

function fallbackAnalysis(
  fallback: ReturnType<typeof heuristicRouteEmail>,
  attachments: IntakeAnalysisAttachmentInput[],
): IntakeAnalysisResult {
  const hasLikelyDoc =
    fallback.document_type_guesses.some((guess) => guess.document_type !== "unknown" && guess.confidence >= 0.55) ||
    attachments.some((attachment) => isPdfAttachment(attachment.name, attachment.contentType ?? ""));
  const hasBodySignals = Boolean(fallback.property_address || fallback.email_body_fields?.length);
  const isDealPackage = hasLikelyDoc || hasBodySignals;
  return {
    is_deal_package: isDealPackage,
    not_deal_reason: isDealPackage ? "" : "No clear deal-document signals found.",
    ...fallback,
    recommended_action: fallback.transaction_code || fallback.property_address ? "existing_deal" : hasLikelyDoc ? "manual_review" : "not_deal",
  };
}

function mergeDocumentGuesses(
  ai: IntakeAnalysisResult["document_type_guesses"],
  fallback: ReturnType<typeof heuristicRouteEmail>["document_type_guesses"],
) {
  const fallbackByName = new Map(fallback.map((guess) => [guess.filename, guess]));
  const merged = ai.map((guess) => {
    const fallbackGuess = fallbackByName.get(guess.filename);
    if (!fallbackGuess) return guess;
    if (guess.document_type === "unknown" && fallbackGuess.document_type !== "unknown") return fallbackGuess;
    return guess;
  });
  for (const guess of fallback) {
    if (!merged.some((candidate) => candidate.filename === guess.filename)) merged.push(guess);
  }
  return merged;
}

function isPdfAttachment(name: string, contentType: string) {
  return contentType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value.trim());
  }
  return result;
}
