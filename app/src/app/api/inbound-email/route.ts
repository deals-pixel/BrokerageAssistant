import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAttachmentStoragePath,
  hashAttachment,
  heuristicRouteEmail,
  normalizeInboundEmailPayload,
  shouldStoreAttachment,
  transactionTypeForDeal,
} from "@/lib/email-intake";

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
    let storedSize = 0;
    let ignoredCount = 0;
    let duplicateCount = 0;
    const storedAttachmentIds: string[] = [];

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
      storedSize += fileSize;
      storedAttachmentIds.push(attachmentRow.id);
    }

    if (storedCount > 0) {
      const routing = heuristicRouteEmail(inbound);
      const { data: draftDeal, error: draftError } = await supabase
        .from("deals")
        .insert({
          created_by: null,
          file_name: inbound.subject || "Email intake package",
          file_size: storedSize,
          page_count: 0,
          status: "draft_from_email",
          transaction_type: transactionTypeForDeal(routing.transaction_type_guess),
          property_address: routing.property_address || null,
          source: "email",
          transaction_code: await nextTransactionCode(supabase),
        })
        .select("id")
        .single();
      if (draftError || !draftDeal) throw new Error(draftError?.message ?? "Could not create draft deal");

      await supabase.from("deal_email_links").insert({
        deal_id: draftDeal.id,
        inbound_email_id: inboundEmailId,
        match_score: 0,
        match_reason: "Draft created from inbound email; admin review required",
        match_status: "manually_confirmed",
      });

      await supabase
        .from("email_attachments")
        .update({ deal_id: draftDeal.id, status: "linked_to_transaction", linked_at: new Date().toISOString() })
        .in("id", storedAttachmentIds);

      await supabase
        .from("inbound_emails")
        .update({
          status: "draft_transaction_created",
          routing_json: routing,
          routing_completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", inboundEmailId);

      await supabase.from("audit_logs").insert({
        deal_id: draftDeal.id,
        action: "draft_deal_created_from_email",
        details: {
          inbound_email_id: inboundEmailId,
          attachments: storedCount,
          ignored_attachments: ignoredCount,
          duplicate_attachments: duplicateCount,
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
          error_message: "No valid document attachments found",
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

async function nextTransactionCode(supabase: ReturnType<typeof createAdminClient>) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${year}-01-01T00:00:00.000Z`);
  return `TX-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
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
