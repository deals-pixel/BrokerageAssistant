import { NextResponse } from "next/server";
import { analyzeInboundPackage, type IntakeAnalysisAttachmentInput } from "@/lib/ai/intake-analyze";
import { matchDealWithThreadContext } from "@/lib/email-routing-job";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hasReviewableEmailContent, heuristicRouteEmail, type InboundEmailInput } from "@/lib/email-intake";
import { markDealNeedsAttention } from "@/lib/deal-attention";

type InboundEmailRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  original_recipient: string | null;
  forwarding_admin_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
  thread_id: string | null;
  received_at: string | null;
};

type EmailAttachmentRow = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  status: string;
};

export const maxDuration = 90;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const body = (await req.json().catch(() => null)) as { forceAi?: boolean } | null;

  try {
    const { data: email, error: emailError } = await admin
      .from("inbound_emails")
      .select(
        "id, from_email, from_name, to_email, original_recipient, forwarding_admin_email, subject, body_text, body_html, message_id, thread_id, received_at",
      )
      .eq("id", id)
      .single();
    if (emailError || !email) throw new Error(emailError?.message ?? "Inbound email not found");

    const { data: attachmentRows, error: attachmentError } = await admin
      .from("email_attachments")
      .select("id, original_filename, mime_type, file_size, storage_path, status")
      .eq("inbound_email_id", id)
      .in("status", ["stored", "light_classified", "linked_to_transaction"]);
    if (attachmentError) throw new Error(attachmentError.message);

    const lightweightAttachments = (attachmentRows ?? []).map((row) => ({
      id: row.id,
      name: row.original_filename ?? "email-attachment.pdf",
      contentType: row.mime_type,
      contentLength: row.file_size,
      contentBase64: "",
      buffer: Buffer.alloc(0),
    }));
    const lightweightInbound = emailRowToInboundInput(email as InboundEmailRow, lightweightAttachments);
    if (lightweightAttachments.length === 0 && !hasReviewableEmailContent(lightweightInbound)) {
      await admin
        .from("inbound_emails")
        .update({
          status: "not_deal_suggested",
          error_message: "No valid stored attachments available for analysis.",
          routing_completed_at: new Date().toISOString(),
        })
        .eq("id", id);
      return NextResponse.json({ ok: true, status: "not_deal_suggested", analysis: null });
    }

    const heuristic = heuristicRouteEmail(lightweightInbound);
    const useAi = body?.forceAi === true || shouldUseAiIntakeAnalysis(heuristic, lightweightAttachments.length);
    const attachments = useAi ? await downloadAttachments(admin, attachmentRows ?? []) : lightweightAttachments;
    const inbound = useAi ? emailRowToInboundInput(email as InboundEmailRow, attachments) : lightweightInbound;
    let analysis = useAi
      ? await analyzeInboundPackage(inbound, attachments, { inboundEmailId: id })
      : heuristicAnalysis(heuristic, lightweightAttachments.length);
    analysis = normalizeCommunicationOnlyAnalysis(analysis);
    const {
      match,
      routing: routingForMatch,
      usedThreadContext,
    } = await matchDealWithThreadContext(admin, analysis, inbound);
    if (usedThreadContext) {
      analysis = {
        ...analysis,
        property_address: analysis.property_address || routingForMatch.property_address,
        mls_number: analysis.mls_number || routingForMatch.mls_number,
        transaction_code: analysis.transaction_code || routingForMatch.transaction_code,
        transaction_type_guess:
          analysis.transaction_type_guess === "unknown" ? routingForMatch.transaction_type_guess : analysis.transaction_type_guess,
        routing_confidence: Math.max(analysis.routing_confidence, routingForMatch.routing_confidence),
        recommended_action: "existing_deal",
      };
    }
    const matchedDeal = match.best && match.score >= 50 ? match.best : null;
    const completedAt = new Date().toISOString();

    for (const attachment of attachments) {
      const guess = analysis.document_type_guesses.find((item) => item.filename === attachment.name);
      await admin
        .from("email_attachments")
        .update({
          status: "light_classified",
          light_classification_type: guess?.document_type ?? "unknown",
          light_classification_confidence: guess?.confidence ?? 0.2,
        })
        .eq("id", attachment.id);
    }

    if (matchedDeal) {
      await admin.from("deal_email_links").upsert(
        {
          deal_id: matchedDeal.id,
          inbound_email_id: id,
          match_score: match.score,
          match_reason: match.reason,
          match_status: "needs_review",
        },
        { onConflict: "deal_id,inbound_email_id" },
      );
      await markDealNeedsAttention(admin, matchedDeal.id);
    }

    const communicationOnly = !analysis.is_deal_package && Boolean(matchedDeal);
    const status = communicationOnly
      ? "not_deal_suggested"
      : matchedDeal
        ? "needs_match_review"
        : !analysis.is_deal_package
        ? "not_deal_suggested"
        : "new_deal_suggested";

    await admin
      .from("inbound_emails")
      .update({
        status,
        routing_json: analysis,
        routing_completed_at: completedAt,
        error_message:
          status === "not_deal_suggested" && !matchedDeal
            ? analysis.not_deal_reason || "AI did not identify a deal package."
            : null,
      })
      .eq("id", id);

    await admin.from("audit_logs").insert({
      user_id: user.id,
      deal_id: matchedDeal?.id ?? null,
      action: "inbound_email_analyzed",
      details: {
        inbound_email_id: id,
        status,
        match_score: matchedDeal ? match.score : 0,
        match_reason: matchedDeal ? match.reason : null,
        recommended_action: analysis.recommended_action,
        communication_only: communicationOnly,
        thread_context_match: usedThreadContext,
        ai_used: useAi,
      },
    });

    return NextResponse.json({ ok: true, status, analysis, match: { deal: matchedDeal, score: match.score, reason: match.reason } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not analyze intake";
    await admin.from("inbound_emails").update({ status: "error", error_message: message }).eq("id", id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function shouldUseAiIntakeAnalysis(
  routing: ReturnType<typeof heuristicRouteEmail>,
  attachmentCount: number,
) {
  if (process.env.INTAKE_ANALYSIS_AI === "0") return false;
  if (process.env.INTAKE_ANALYSIS_AI === "1") return true;
  if (routing.transaction_code) return false;
  if (routing.routing_confidence >= 0.65) return false;
  if (routing.property_address && routing.document_type_guesses.some((guess) => guess.confidence >= 0.55)) {
    return false;
  }
  return attachmentCount > 0 || routing.routing_confidence >= 0.25;
}

function heuristicAnalysis(
  routing: ReturnType<typeof heuristicRouteEmail>,
  attachmentCount: number,
) {
  const hasKnownDocument = routing.document_type_guesses.some((guess) => guess.confidence >= 0.55);
  const hasDealContext = Boolean(routing.property_address || routing.email_body_fields?.length);
  const isDealPackage = attachmentCount > 0 || hasKnownDocument;
  return {
    is_deal_package: isDealPackage,
    not_deal_reason: isDealPackage
      ? ""
      : hasDealContext
        ? "Email appears to be deal communication, but not a new document package."
        : "No clear deal-document signals found.",
    ...routing,
    recommended_action: routing.transaction_code || hasDealContext
      ? "existing_deal"
      : isDealPackage
        ? "new_deal"
        : "not_deal",
  };
}

function normalizeCommunicationOnlyAnalysis<T extends ReturnType<typeof heuristicAnalysis>>(analysis: T): T {
  const hasDealContext = Boolean(analysis.property_address || analysis.email_body_fields?.length);
  if (analysis.is_deal_package || !hasDealContext) return analysis;
  return {
    ...analysis,
    not_deal_reason: "Email appears to be deal communication, but not a new document package.",
    recommended_action: "existing_deal",
  };
}

async function downloadAttachments(
  admin: ReturnType<typeof createAdminClient>,
  rows: EmailAttachmentRow[],
): Promise<IntakeAnalysisAttachmentInput[]> {
  const results: IntakeAnalysisAttachmentInput[] = [];
  for (const row of rows) {
    if (!row.storage_path) continue;
    const { data, error } = await admin.storage.from("deals").download(row.storage_path);
    if (error || !data) continue;
    const arrayBuffer = await data.arrayBuffer();
    results.push({
      id: row.id,
      name: row.original_filename ?? "email-attachment.pdf",
      contentType: row.mime_type,
      contentLength: row.file_size,
      contentBase64: "",
      buffer: Buffer.from(arrayBuffer),
    });
  }
  return results;
}

function emailRowToInboundInput(
  email: InboundEmailRow,
  attachments: IntakeAnalysisAttachmentInput[],
): InboundEmailInput {
  return {
    fromEmail: email.from_email,
    fromName: email.from_name,
    toEmail: email.to_email,
    originalRecipient: email.original_recipient,
    forwardingAdminEmail: email.forwarding_admin_email,
    subject: email.subject,
    bodyText: email.body_text,
    bodyHtml: email.body_html,
    messageId: email.message_id,
    threadId: email.thread_id,
    receivedAt: email.received_at,
    attachments: attachments.map((attachment) => ({
      name: attachment.name,
      contentType: attachment.contentType,
      contentLength: attachment.contentLength,
      contentBase64: "",
    })),
  };
}
