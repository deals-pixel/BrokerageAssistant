import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { DOCUMENT_TYPES } from "@/lib/types";
import type { InboundAttachmentInput, InboundEmailInput, LightRoutingResult } from "@/lib/email-intake";
import { heuristicRouteEmail } from "@/lib/email-intake";
import { anthropic, LIGHT_AI_MODEL } from "./client";
import { logAiUsage, usageFromResponse } from "./usage";

const MAX_ATTACHMENTS = Number(process.env.LIGHT_ROUTING_MAX_ATTACHMENTS ?? 5);
const MAX_PDF_PAGES = Number(process.env.LIGHT_ROUTING_MAX_PDF_PAGES ?? 3);
const MAX_FILE_BYTES = Number(process.env.LIGHT_ROUTING_MAX_FILE_MB ?? 12) * 1024 * 1024;
const SKIP_AI_MIN_CONFIDENCE = Number(process.env.LIGHT_ROUTING_SKIP_AI_MIN_CONFIDENCE ?? 0.9);
const DOCUMENT_TYPE_KEYS = ["unknown", ...Object.keys(DOCUMENT_TYPES)] as [string, ...string[]];

const LightRoutingSchema = z.object({
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
});

const SYSTEM = `You are the low-cost routing layer for a brokerage transaction intake platform.

Your job is not full compliance parsing. Only identify routing signals needed to match an email package to an existing transaction or create a draft transaction.

Return strict JSON only through the provided schema.

Rules:
- Prefer visible document evidence over email subject guesses.
- property_address should be the transaction property address only. Leave empty if unclear.
- mls_number should be an MLS-style identifier only. Leave empty if unclear.
- transaction_code must be a TX-YYYY-NNNN style code only when visible.
- transaction_type_guess is sale, lease, referral, co_brokerage, preconstruction, or unknown.
- party_names are buyers, sellers, tenants, landlords, or clients visible in the email/documents.
- agent_names are real estate agent names visible in the email/documents.
- document_type must be exactly one known document type key or unknown.
- confidence is 0-1. Use lower confidence for generic scans, ambiguous filenames, or unreadable pages.
- routing_confidence is the confidence that the package belongs to a single identifiable transaction, not confidence in compliance completeness.
- Do not infer facts from brokerage boilerplate, email signatures, disclaimers, logos, or footers.`;

export type LightRouteAttachmentInput = InboundAttachmentInput & {
  id?: string;
  buffer: Buffer;
};

export async function routeEmailWithLightAI(
  email: InboundEmailInput,
  attachments: LightRouteAttachmentInput[],
  options: { inboundEmailId?: string | null } = {},
): Promise<LightRoutingResult> {
  const fallback = heuristicRouteEmail(email);
  if (fallback.transaction_code && fallback.routing_confidence >= SKIP_AI_MIN_CONFIDENCE) {
    await logAiUsage({
      layer: "light_routing",
      model: LIGHT_AI_MODEL,
      inboundEmailId: options.inboundEmailId,
      cached: true,
      inputAttachments: attachments.length,
      metadata: {
        reason: "heuristic_transaction_code_high_confidence",
        routing_confidence: fallback.routing_confidence,
      },
    });
    return fallback;
  }
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const content = await buildRoutingContent(email, attachments);
    const response = await anthropic.messages.parse({
      model: LIGHT_AI_MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(LightRoutingSchema) },
    });
    await logAiUsage({
      layer: "light_routing",
      model: LIGHT_AI_MODEL,
      inboundEmailId: options.inboundEmailId,
      usage: usageFromResponse(response),
      inputAttachments: attachments.length,
      metadata: {
        max_attachments: MAX_ATTACHMENTS,
        max_pdf_pages: MAX_PDF_PAGES,
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) return fallback;
    return mergeRoutingFallback(parsed, fallback);
  } catch (err) {
    console.error("Light routing AI failed; using heuristic fallback", err);
    return fallback;
  }
}

async function buildRoutingContent(
  email: InboundEmailInput,
  attachments: LightRouteAttachmentInput[],
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
    truncate(email.bodyText ?? "", 8000),
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
      content.push({
        type: "text",
        text: `Image attachment: ${name}`,
      });
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
    text: "Route this transaction package. Return one document_type_guess for every attachment filename listed above.",
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

function mergeRoutingFallback(
  ai: z.infer<typeof LightRoutingSchema>,
  fallback: LightRoutingResult,
): LightRoutingResult {
  const aiGuesses = new Map(ai.document_type_guesses.map((guess) => [guess.filename, guess]));
  const mergedGuesses = fallback.document_type_guesses.map((guess) => {
    const aiGuess = aiGuesses.get(guess.filename);
    if (!aiGuess) return guess;
    if (aiGuess.document_type === "unknown" && guess.document_type !== "unknown") return guess;
    return aiGuess;
  });

  for (const guess of ai.document_type_guesses) {
    if (!mergedGuesses.some((candidate) => candidate.filename === guess.filename)) {
      mergedGuesses.push(guess);
    }
  }

  return {
    property_address: ai.property_address || fallback.property_address,
    mls_number: ai.mls_number || fallback.mls_number,
    transaction_type_guess:
      ai.transaction_type_guess !== "unknown"
        ? ai.transaction_type_guess
        : fallback.transaction_type_guess,
    party_names: dedupeStrings([...ai.party_names, ...fallback.party_names]),
    agent_names: dedupeStrings([...ai.agent_names, ...fallback.agent_names]),
    document_type_guesses: mergedGuesses,
    routing_confidence: Math.max(ai.routing_confidence, fallback.routing_confidence),
    transaction_code: ai.transaction_code || fallback.transaction_code,
  };
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
