import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { renderAttachmentPages } from "@/lib/pdf-render-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_TYPES, type Confidence, type DocumentType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const INGESTIBLE_STATUSES = ["stored", "light_classified", "linked_to_transaction"];

type EmailAttachmentRow = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  status: string;
  light_classification_type: string | null;
  light_classification_confidence: number | null;
  received_at: string | null;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { attachmentIds?: string[]; force?: boolean } | null;
  const requestedIds = new Set((body?.attachmentIds ?? []).filter(Boolean));
  const admin = createAdminClient();

  try {
    const { data: deal, error: dealError } = await admin.from("deals").select("id").eq("id", dealId).single();
    if (dealError || !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });

    const { data: existingPages, error: existingPagesError } = await admin
      .from("deal_pages")
      .select("id, image_path, email_attachment_id")
      .eq("deal_id", dealId);
    if (existingPagesError) throw new Error(existingPagesError.message);

    const existingAttachmentIds = new Set(
      (existingPages ?? [])
        .map((page) => page.email_attachment_id)
        .filter((attachmentId): attachmentId is string => Boolean(attachmentId)),
    );

    let query = admin
      .from("email_attachments")
      .select(
        "id, original_filename, mime_type, file_size, storage_path, status, light_classification_type, light_classification_confidence, received_at",
      )
      .eq("deal_id", dealId)
      .in("status", INGESTIBLE_STATUSES);
    if (requestedIds.size > 0) query = query.in("id", [...requestedIds]);

    const { data: attachments, error: attachmentError } = await query;
    if (attachmentError) throw new Error(attachmentError.message);

    const pending = ((attachments ?? []) as EmailAttachmentRow[]).filter(
      (attachment) => body?.force || !existingAttachmentIds.has(attachment.id),
    );
    if (pending.length === 0) {
      return NextResponse.json({ uploadedPages: 0, pageCount: existingPages?.length ?? 0, preparedFiles: [] });
    }

    if (body?.force) {
      const pageIdsToRemove = (existingPages ?? [])
        .filter((page) => page.email_attachment_id && pending.some((attachment) => attachment.id === page.email_attachment_id))
        .map((page) => page.id);
      const pathsToRemove = (existingPages ?? [])
        .filter((page) => page.email_attachment_id && pending.some((attachment) => attachment.id === page.email_attachment_id))
        .map((page) => page.image_path)
        .filter((path): path is string => Boolean(path));
      if (pathsToRemove.length > 0) await admin.storage.from("deals").remove(pathsToRemove);
      if (pageIdsToRemove.length > 0) await admin.from("deal_pages").delete().in("id", pageIdsToRemove);
    }

    const { data: lastPage } = await admin
      .from("deal_pages")
      .select("page_number")
      .eq("deal_id", dealId)
      .order("page_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextPageNumber = (lastPage?.page_number ?? 0) + 1;
    let uploadedPages = 0;
    const preparedFiles: { name: string; pages: number; qualityWarnings: number }[] = [];
    const qualityEvents: unknown[] = [];

    for (const attachment of pending) {
      if (!attachment.storage_path) throw new Error(`${attachment.original_filename ?? attachment.id} has no stored file.`);

      const filename = attachment.original_filename ?? `email-attachment-${attachment.id}.pdf`;
      const { data: blob, error: downloadError } = await admin.storage.from("deals").download(attachment.storage_path);
      if (downloadError || !blob) throw new Error(downloadError?.message ?? `Could not download ${filename}`);

      const sourceBuffer = Buffer.from(await blob.arrayBuffer());
      const pages = await renderAttachmentPages({
        buffer: sourceBuffer,
        filename,
        mimeType: attachment.mime_type,
      });
      const reusableClassification = reusableLightClassification(attachment, pages.length);
      let qualityWarnings = 0;

      for (const pageUpload of pages) {
        const pageNumber = nextPageNumber++;
        const imagePath = `${dealId}/pages/p${String(pageNumber).padStart(3, "0")}-${attachment.id}.jpg`;
        const pageHash = createHash("sha256").update(pageUpload.buffer).digest("hex");
        const { error: imageError } = await admin.storage.from("deals").upload(imagePath, pageUpload.buffer, {
          contentType: "image/jpeg",
        });
        if (imageError) throw new Error(`Page ${pageNumber} upload failed: ${imageError.message}`);

        const { error: pageError } = await admin.from("deal_pages").insert({
          deal_id: dealId,
          page_number: pageNumber,
          image_path: imagePath,
          page_hash: pageHash,
          doc_type: reusableClassification?.docType ?? null,
          doc_confidence: reusableClassification?.confidence ?? null,
          email_attachment_id: attachment.id,
          source: "email",
          received_at: attachment.received_at,
          classification_status: "unclassified",
          light_classification_type: attachment.light_classification_type,
          light_classification_confidence: attachment.light_classification_confidence,
          processing_status: "awaiting_admin_process",
          lonewolf_status: "pending_upload",
        });
        if (pageError) throw new Error(`Page ${pageNumber} record failed: ${pageError.message}`);

        if (pageUpload.quality.warning) qualityWarnings += 1;
        qualityEvents.push({
          attachment_id: attachment.id,
          page: pageNumber,
          width: pageUpload.width,
          height: pageUpload.height,
          quality: pageUpload.quality,
        });
        uploadedPages += 1;
      }

      await admin
        .from("email_attachments")
        .update({ status: "linked_to_transaction", linked_at: new Date().toISOString() })
        .eq("id", attachment.id);
      preparedFiles.push({ name: filename, pages: pages.length, qualityWarnings });
    }

    const { count } = await admin
      .from("deal_pages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    await admin
      .from("deals")
      .update({
        page_count: count ?? uploadedPages,
        status: "awaiting_admin_process",
        error_message: null,
      })
      .eq("id", dealId);

    await admin.from("audit_logs").insert({
      user_id: user.id,
      deal_id: dealId,
      action: "email_attachments_prepared",
      details: {
        renderer: "pdfium_server",
        attachments: preparedFiles,
        pages_added: uploadedPages,
        page_count: count ?? uploadedPages,
        quality: qualityEvents,
      },
    });

    return NextResponse.json({
      uploadedPages,
      pageCount: count ?? uploadedPages,
      preparedFiles,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not prepare attachments" }, { status: 500 });
  }
}

function reusableLightClassification(attachment: EmailAttachmentRow, renderedPageCount: number) {
  const docType = attachment.light_classification_type;
  const confidence = attachment.light_classification_confidence ?? 0;
  if (!docType || docType === "unknown" || docType === "other") return null;
  if (!(docType in DOCUMENT_TYPES)) return null;
  if (confidence < 0.9 || renderedPageCount > 6) return null;

  return {
    docType: docType as DocumentType,
    confidence: confidence >= 0.97 ? ("high" as Confidence) : ("medium" as Confidence),
  };
}
