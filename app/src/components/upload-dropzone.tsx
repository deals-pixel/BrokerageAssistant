"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { DocumentType } from "@/lib/types";

const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 50);
const RETENTION_DAYS = Number(process.env.NEXT_PUBLIC_PDF_RETENTION_DAYS ?? 14);
const RENDER_SCALE = 2.0;
const JPEG_QUALITY = 0.8;
const ACCEPTED_TYPES = "application/pdf,image/jpeg,.pdf,.jpg,.jpeg";

type Phase = "idle" | "preparing" | "rendering" | "uploading";

type PageUpload = {
  blob: Blob;
  sourceName: string;
};

type UploadDropzoneProps = {
  dealId?: string;
  compact?: boolean;
  replaceDocType?: DocumentType | "";
};

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function isJpeg(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

function formatPackageName(files: File[]) {
  if (files.length === 1) return files[0].name;
  const first = files[0].name;
  return `${first} + ${files.length - 1} more`;
}

function safeStorageFileName(name: string) {
  const extension = name.includes(".") ? `.${name.split(".").pop()}` : "";
  const baseName = extension ? name.slice(0, -extension.length) : name;
  const safeBaseName =
    baseName
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document";

  return `${safeBaseName}${extension.toLowerCase().replace(/[^\w.]/g, "")}`;
}

async function renderPdfPages(file: File, onProgress: (message: string) => void): Promise<PageUpload[]> {
  onProgress(`Opening ${file.name}...`);
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const bytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: PageUpload[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress(`Rendering ${file.name}, page ${i} of ${pdf.numPages}...`);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Canvas render failed"))),
        "image/jpeg",
        JPEG_QUALITY,
      ),
    );
    pages.push({ blob, sourceName: file.name });
  }

  return pages;
}

export function UploadDropzone({ dealId, compact = false, replaceDocType = "" }: UploadDropzoneProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      const invalid = files.find((file) => !isPdf(file) && !isJpeg(file));
      if (invalid) {
        toast.error(`${invalid.name} is not a PDF or JPEG file.`);
        return;
      }

      const oversized = files.find((file) => file.size > MAX_FILE_MB * 1024 * 1024);
      if (oversized) {
        toast.error(`${oversized.name} exceeds the ${MAX_FILE_MB} MB limit.`);
        return;
      }

      const supabase = createClient();
      let activeDealId = dealId ?? null;

      try {
        setPhase("preparing");
        setProgress("Preparing files...");

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in");

        if (!activeDealId) {
          const deleteAfter = new Date(Date.now() + RETENTION_DAYS * 86400_000).toISOString();
          const { data: deal, error } = await supabase
            .from("deals")
            .insert({
              created_by: user.id,
              file_name: formatPackageName(files),
              file_size: files.reduce((sum, file) => sum + file.size, 0),
              page_count: 0,
              status: "uploaded",
              delete_original_after: deleteAfter,
            })
            .select()
            .single();
          if (error || !deal) throw new Error(error?.message ?? "Could not create deal");
          activeDealId = deal.id;
        }

        if (activeDealId && replaceDocType) {
          setProgress("Replacing existing document pages...");
          const { data: pagesToReplace, error: replaceLookupErr } = await supabase
            .from("deal_pages")
            .select("id, image_path")
            .eq("deal_id", activeDealId)
            .eq("doc_type", replaceDocType);
          if (replaceLookupErr) throw new Error(replaceLookupErr.message);

          const imagePaths = (pagesToReplace ?? []).map((page) => page.image_path);
          if (imagePaths.length > 0) {
            const { error: removeErr } = await supabase.storage.from("deals").remove(imagePaths);
            if (removeErr) throw new Error(`Could not remove old pages: ${removeErr.message}`);
          }

          const { error: deletePagesErr } = await supabase
            .from("deal_pages")
            .delete()
            .eq("deal_id", activeDealId)
            .eq("doc_type", replaceDocType);
          if (deletePagesErr) throw new Error(deletePagesErr.message);
        }

        const { data: lastPage } = await supabase
          .from("deal_pages")
          .select("page_number")
          .eq("deal_id", activeDealId)
          .order("page_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        let nextPageNumber = (lastPage?.page_number ?? 0) + 1;
        let uploadedPages = 0;
        let firstPdfPath: string | null = null;

        for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
          const file = files[fileIndex];
          const sourcePath = `${activeDealId}/sources/${String(fileIndex + 1).padStart(3, "0")}-${Date.now()}-${safeStorageFileName(file.name)}`;

          setPhase("uploading");
          setProgress(`Uploading source ${fileIndex + 1} of ${files.length}...`);
          const { error: sourceErr } = await supabase.storage
            .from("deals")
            .upload(sourcePath, file, {
              contentType: isPdf(file) ? "application/pdf" : "image/jpeg",
            });
          if (sourceErr) throw new Error(`${file.name} upload failed: ${sourceErr.message}`);
          if (isPdf(file) && !firstPdfPath) firstPdfPath = sourcePath;

          setPhase(isPdf(file) ? "rendering" : "uploading");
          const pages = isPdf(file)
            ? await renderPdfPages(file, setProgress)
            : [{ blob: file, sourceName: file.name }];

          for (const pageUpload of pages) {
            const pageNumber = nextPageNumber++;
            setPhase("uploading");
            setProgress(`Uploading page ${pageNumber}...`);
            const imagePath = `${activeDealId}/pages/p${String(pageNumber).padStart(3, "0")}.jpg`;
            const { error: imageErr } = await supabase.storage
              .from("deals")
              .upload(imagePath, pageUpload.blob, { contentType: "image/jpeg" });
            if (imageErr) throw new Error(`Page ${pageNumber} upload failed: ${imageErr.message}`);

            const { error: rowErr } = await supabase.from("deal_pages").insert({
              deal_id: activeDealId,
              page_number: pageNumber,
              image_path: imagePath,
              doc_type: replaceDocType || null,
              doc_confidence: replaceDocType ? "high" : null,
            });
            if (rowErr) throw new Error(`Page ${pageNumber} record failed: ${rowErr.message}`);
            uploadedPages += 1;
          }
        }

        const { count } = await supabase
          .from("deal_pages")
          .select("id", { count: "exact", head: true })
          .eq("deal_id", activeDealId);

        const update: Record<string, unknown> = {
          page_count: count ?? uploadedPages,
          status: "uploaded",
          error_message: null,
        };
        if (firstPdfPath) update.original_pdf_path = firstPdfPath;
        if (!dealId) {
          update.file_name = formatPackageName(files);
          update.file_size = files.reduce((sum, file) => sum + file.size, 0);
        }

        await supabase.from("deal_fields").delete().eq("deal_id", activeDealId);
        await supabase.from("deals").update(update).eq("id", activeDealId);
        await supabase.from("audit_logs").insert({
          user_id: user.id,
          deal_id: activeDealId,
          action: replaceDocType ? "document_type_replaced" : dealId ? "files_added" : "package_uploaded",
          details: {
            files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
            pages_added: uploadedPages,
            page_count: count ?? uploadedPages,
            replaced_doc_type: replaceDocType || null,
          },
        });

        toast.success(
          dealId
            ? replaceDocType
              ? `${uploadedPages} replacement page${uploadedPages === 1 ? "" : "s"} uploaded.`
              : `${uploadedPages} page${uploadedPages === 1 ? "" : "s"} added.`
            : "Files uploaded. Click Process when ready.",
        );
        if (dealId) {
          router.refresh();
        } else {
          router.push(`/deals/${activeDealId}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
        router.refresh();
      } finally {
        setPhase("idle");
        setProgress("");
      }
    },
    [dealId, replaceDocType, router],
  );

  const busy = phase !== "idle";

  return (
    <Card
      className={`border-2 border-dashed transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (busy) return;
        handleFiles(e.dataTransfer.files);
      }}
    >
      <CardContent
        className={`flex flex-col items-center justify-center gap-3 ${
          compact ? "py-5" : "py-10"
        }`}
      >
        {busy ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-center text-sm text-muted-foreground">{progress}</p>
          </>
        ) : (
          <>
            <p className="text-center text-sm font-medium">
              {dealId
                ? replaceDocType
                  ? "Drop a replacement PDF or JPEG"
                  : "Drop PDFs or JPEGs to add more pages"
                : "Drop PDFs or JPEG files here"}
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              {dealId ? (replaceDocType ? "Choose replacement" : "Add files") : "Choose files"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              .pdf, .jpg, .jpeg - max {MAX_FILE_MB} MB per file - process manually when ready
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
