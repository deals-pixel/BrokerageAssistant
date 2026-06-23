import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAttachmentStoragePath,
  hasReviewableEmailContent,
  hashAttachment,
  heuristicRouteEmail,
  normalizeInboundEmailPayload,
  shouldStoreAttachment,
} from "@/lib/email-intake";
import { matchDeal } from "@/lib/email-routing-job";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!verifyInboundSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = parseContentLength(req.headers.get("content-length"));
  const maxWebhookBytes = inboundWebhookMaxBytes();
  if (contentLength && contentLength > maxWebhookBytes) {
    return recordUnparsedInboundEmail({
      reason: `Inbound webhook body was ${formatBytes(contentLength)}, above the ${formatBytes(maxWebhookBytes)} processing limit. Ask the sender to split the package into smaller PDFs or upload it manually.`,
      statusCodeForProvider: 200,
    });
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return recordUnparsedInboundEmail({
      reason: "Inbound webhook JSON could not be parsed. This usually means the provider payload was truncated before it reached the app.",
      statusCodeForProvider: 200,
    });
  }

  const supabase = createAdminClient();
  const inbound = normalizeInboundEmailPayload(payload);

  const duplicateMessage = inbound.messageId
    ? await supabase
        .from("inbound_emails")
        .select("id")
        .eq("message_id", inbound.messageId)
        .maybeSingle()
    : null;
  if (duplicateMessage?.data?.id) {
    return NextResponse.json({ ok: true, duplicate: true, inboundEmailId: duplicateMessage.data.id });
  }

  const { data: email, error: emailError } = await supabase
    .from("inbound_emails")
    .insert({
      from_email: inbound.fromEmail,
      from_name: inbound.fromName,
      to_email: inbound.toEmail,
      original_recipient: inbound.originalRecipient,
      forwarding_admin_email: inbound.forwardingAdminEmail,
      subject: inbound.subject,
      body_text: inbound.bodyText,
      body_html: inbound.bodyHtml,
      message_id: inbound.messageId,
      thread_id: inbound.threadId,
      received_at: inbound.receivedAt,
      status: "attachments_queued",
    })
    .select("id")
    .single();
  if (emailError || !email) {
    return NextResponse.json({ error: emailError?.message ?? "Could not save inbound email" }, { status: 500 });
  }

  storeAttachmentsAfterResponse(req, email.id, inbound);

  return NextResponse.json({
    ok: true,
    status: "attachments_queued",
    inboundEmailId: email.id,
    attachments: inbound.attachments.length,
  });
}

function storeAttachmentsAfterResponse(req: Request, inboundEmailId: string, inbound: ReturnType<typeof normalizeInboundEmailPayload>) {
  after(async () => {
    await storeInboundAttachments(req, inboundEmailId, inbound);
  });
}

async function storeInboundAttachments(
  req: Request,
  inboundEmailId: string,
  inbound: ReturnType<typeof normalizeInboundEmailPayload>,
) {
  const supabase = createAdminClient();

  try {
    let storedCount = 0;
    let ignoredCount = 0;
    let duplicateCount = 0;

    for (const attachment of inbound.attachments) {
      const buffer = Buffer.from(attachment.contentBase64, "base64");
      const fileHash = hashAttachment(buffer);
      const fileSize = attachment.contentLength ?? buffer.byteLength;
      const filter = shouldStoreAttachment({ ...attachment, contentLength: fileSize });

      if (!filter.store) {
        await supabase.from("email_attachments").insert({
          inbound_email_id: inboundEmailId,
          original_filename: attachment.name,
          mime_type: attachment.contentType,
          file_size: fileSize,
          file_hash: fileHash,
          status: "ignored",
          ignore_reason: filter.reason,
          received_at: inbound.receivedAt,
        });
        ignoredCount += 1;
        continue;
      }

      const existingHash = await supabase
        .from("email_attachments")
        .select("id")
        .eq("file_hash", fileHash)
        .limit(1)
        .maybeSingle();
      if (existingHash.data?.id) {
        await supabase.from("email_attachments").insert({
          inbound_email_id: inboundEmailId,
          original_filename: attachment.name,
          mime_type: attachment.contentType,
          file_size: fileSize,
          file_hash: fileHash,
          status: "duplicate",
          ignore_reason: "duplicate_attachment_hash",
          received_at: inbound.receivedAt,
        });
        duplicateCount += 1;
        continue;
      }

      const { data: attachmentRow, error: attachmentError } = await supabase
        .from("email_attachments")
        .insert({
          inbound_email_id: inboundEmailId,
          original_filename: attachment.name,
          mime_type: attachment.contentType,
          file_size: fileSize,
          file_hash: fileHash,
          status: "stored",
          received_at: inbound.receivedAt,
        })
        .select("id")
        .single();
      if (attachmentError || !attachmentRow) throw new Error(attachmentError?.message ?? "Attachment insert failed");

      const storagePath = buildAttachmentStoragePath({
        emailId: inboundEmailId,
        attachmentId: attachmentRow.id,
        filename: attachment.name,
      });
      const { error: uploadError } = await supabase.storage.from("deals").upload(storagePath, buffer, {
        contentType: attachment.contentType ?? "application/octet-stream",
      });
      if (uploadError) throw new Error(`Attachment upload failed: ${uploadError.message}`);

      await supabase
        .from("email_attachments")
        .update({ storage_path: storagePath })
        .eq("id", attachmentRow.id);
      storedCount += 1;
    }

    if (storedCount > 0) {
      const routing = heuristicRouteEmail(inbound);
      const match = await matchDeal(supabase, routing, inbound.fromEmail);
      const strongMatch = match.best && match.score >= 80 ? match.best : null;
      if (strongMatch) {
        await supabase.from("deal_email_links").upsert(
          {
            deal_id: strongMatch.id,
            inbound_email_id: inboundEmailId,
            match_score: match.score,
            match_reason: match.reason,
            match_status: "needs_review",
          },
          { onConflict: "deal_id,inbound_email_id" },
        );
      }

      await supabase
        .from("inbound_emails")
        .update({
          status: strongMatch ? "needs_match_review" : "intake_review",
          routing_json: routing,
          routing_completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", inboundEmailId);

      await supabase.from("audit_logs").insert({
        deal_id: strongMatch ? strongMatch.id : null,
        action: strongMatch ? "inbound_email_match_suggested" : "inbound_email_ready_for_review",
        details: {
          inbound_email_id: inboundEmailId,
          attachments: storedCount,
          ignored_attachments: ignoredCount,
          duplicate_attachments: duplicateCount,
          match_score: strongMatch ? match.score : 0,
          match_reason: strongMatch ? match.reason : null,
          routing,
          ai_used: false,
        },
      });
      return;
    }

    if (hasReviewableEmailContent(inbound)) {
      const routing = heuristicRouteEmail(inbound);
      const match = await matchDeal(supabase, routing, inbound.fromEmail);
      const strongMatch = match.best && match.score >= 80 ? match.best : null;
      if (strongMatch) {
        await supabase.from("deal_email_links").upsert(
          {
            deal_id: strongMatch.id,
            inbound_email_id: inboundEmailId,
            match_score: match.score,
            match_reason: match.reason,
            match_status: "needs_review",
          },
          { onConflict: "deal_id,inbound_email_id" },
        );
      }

      await supabase
        .from("inbound_emails")
        .update({
          status: strongMatch ? "needs_match_review" : "intake_review",
          routing_json: routing,
          routing_completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", inboundEmailId);

      await supabase.from("audit_logs").insert({
        deal_id: strongMatch ? strongMatch.id : null,
        action: strongMatch ? "inbound_email_match_suggested" : "inbound_email_ready_for_review",
        details: {
          inbound_email_id: inboundEmailId,
          attachments: 0,
          ignored_attachments: ignoredCount,
          duplicate_attachments: duplicateCount,
          content_only: true,
          match_score: strongMatch ? match.score : 0,
          match_reason: strongMatch ? match.reason : null,
          routing,
          ai_used: false,
        },
      });
      return;
    }

    await supabase
      .from("inbound_emails")
      .update({
        status: "ignored",
        error_message: "No valid document attachments or reviewable email content found",
      })
      .eq("id", inboundEmailId);

    // No AI runs during intake. Full parsing starts only after admin review.
  } catch (err) {
    console.error("Inbound email attachment storage failed", err);
    await supabase
      .from("inbound_emails")
      .update({
        status: "error",
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq("id", inboundEmailId);
  }
}

function verifyInboundSecret(req: Request) {
  const expected = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const headerSecret = req.headers.get("x-inbound-email-secret");
  const auth = req.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const urlSecret = new URL(req.url).searchParams.get("secret");
  return headerSecret === expected || bearer === expected || urlSecret === expected;
}

async function recordUnparsedInboundEmail({
  reason,
  statusCodeForProvider,
}: {
  reason: string;
  statusCodeForProvider: number;
}) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("inbound_emails")
    .insert({
      subject: "Unparsed inbound email",
      received_at: new Date().toISOString(),
      status: "error",
      error_message: reason,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("Could not record unparsed inbound email", error);
    return NextResponse.json(
      { ok: false, error: "Inbound email could not be recorded" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: "error",
      inboundEmailId: data.id,
      error: reason,
    },
    { status: statusCodeForProvider },
  );
}

function inboundWebhookMaxBytes() {
  const configured = Number(process.env.INBOUND_EMAIL_MAX_WEBHOOK_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000_000;
}

function parseContentLength(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} bytes`;
}
