import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAttachmentStoragePath,
  hashAttachment,
  normalizeInboundEmailPayload,
  shouldStoreAttachment,
} from "@/lib/email-intake";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!verifyInboundSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });

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

    const nextStatus = storedCount > 0 ? "routing_queued" : "ignored";
    await supabase
        .from("inbound_emails")
        .update({
          status: nextStatus,
          error_message: storedCount > 0 ? null : "No valid document attachments found",
        })
      .eq("id", inboundEmailId);

    if (storedCount > 0) {
      await triggerLightRouting(req, inboundEmailId);
    }
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

async function triggerLightRouting(req: Request, inboundEmailId: string) {
  const jobSecret = process.env.EMAIL_ROUTING_JOB_SECRET ?? process.env.CRON_SECRET;
  if (!jobSecret && process.env.NODE_ENV === "production") return;

  try {
    const url = new URL("/api/jobs/email-routing", req.url);
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(jobSecret ? { authorization: `Bearer ${jobSecret}` } : {}),
      },
      body: JSON.stringify({ inboundEmailId }),
    });
  } catch (err) {
    console.error("Email routing trigger failed", err);
  }
}
