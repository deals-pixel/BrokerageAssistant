import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { renderAttachmentPages } from "@/lib/pdf-render-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    sourcePath?: string;
    filename?: string;
    mimeType?: string | null;
    replaceDocType?: string | null;
  } | null;
  if (!body?.sourcePath || !body.filename) {
    return NextResponse.json({ error: "sourcePath and filename are required" }, { status: 400 });
  }

  const replaceDocType = normalizeDocumentType(body.replaceDocType);
  const admin = createAdminClient();

  try {
    const { data: blob, error: downloadError } = await admin.storage.from("deals").download(body.sourcePath);
    if (downloadError || !blob) throw new Error(downloadError?.message ?? "Could not download uploaded source");

    const { data: lastPage } = await admin
      .from("deal_pages")
      .select("page_number")
      .eq("deal_id", dealId)
      .order("page_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextPageNumber = (lastPage?.page_number ?? 0) + 1;
    const sourceBuffer = Buffer.from(await blob.arrayBuffer());
    const pages = await renderAttachmentPages({
      buffer: sourceBuffer,
      filename: body.filename,
      mimeType: body.mimeType ?? null,
    });

    const renderedPages: { page: number; imagePath: string; quality: unknown }[] = [];
    for (const pageUpload of pages) {
      const pageNumber = nextPageNumber++;
      const imagePath = `${dealId}/pages/p${String(pageNumber).padStart(3, "0")}.jpg`;
      const pageHash = createHash("sha256").update(pageUpload.buffer).digest("hex");
      const { error: imageErr } = await admin.storage.from("deals").upload(imagePath, pageUpload.buffer, {
        contentType: "image/jpeg",
      });
      if (imageErr) throw new Error(`Page ${pageNumber} upload failed: ${imageErr.message}`);

      const { error: rowErr } = await admin.from("deal_pages").insert({
        deal_id: dealId,
        page_number: pageNumber,
        image_path: imagePath,
        page_hash: pageHash,
        doc_type: replaceDocType,
        doc_confidence: replaceDocType ? "high" : null,
      });
      if (rowErr) throw new Error(`Page ${pageNumber} record failed: ${rowErr.message}`);
      renderedPages.push({ page: pageNumber, imagePath, quality: pageUpload.quality });
    }

    await admin.from("audit_logs").insert({
      user_id: user.id,
      deal_id: dealId,
      action: "source_file_rendered",
      details: {
        renderer: "pdfium_server",
        source_path: body.sourcePath,
        filename: body.filename,
        pages_added: renderedPages.length,
        replaced_doc_type: replaceDocType,
        pages: renderedPages,
      },
    });

    return NextResponse.json({ uploadedPages: renderedPages.length, pages: renderedPages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not render source" }, { status: 500 });
  }
}

function normalizeDocumentType(value: string | null | undefined): DocumentType | null {
  if (!value) return null;
  return value in DOCUMENT_TYPES ? (value as DocumentType) : null;
}
