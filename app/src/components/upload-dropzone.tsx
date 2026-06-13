"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProcessDealButton } from "@/components/process-deal-button";
import { toast } from "sonner";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/types";

const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 50);
const RETENTION_DAYS = Number(process.env.NEXT_PUBLIC_PDF_RETENTION_DAYS ?? 14);
const RENDER_SCALE = 2.0;
const JPEG_QUALITY = 0.8;
const ACCEPTED_TYPES = "application/pdf,image/jpeg,.pdf,.jpg,.jpeg";

type Phase = "idle" | "preparing" | "rendering" | "uploading";

type PageUpload = {
  blob: Blob;
  sourceName: string;
  docType?: DocumentType;
  confidence?: "high" | "medium" | "low";
};

type PendingBatch = {
  files: File[];
  pages: PageUpload[];
  incomingDocTypes: DocumentType[];
  conflicts: DocumentType[];
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

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read page image"));
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1] ?? "";
}

async function filesToPageUploads(files: File[], onProgress: (message: string) => void) {
  const pages: PageUpload[] = [];
  for (const file of files) {
    if (isPdf(file)) {
      pages.push(...(await renderPdfPages(file, onProgress)));
    } else {
      pages.push({ blob: file, sourceName: file.name });
    }
  }
  return pages;
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
  const [pendingBatch, setPendingBatch] = useState<PendingBatch | null>(null);
  const [replaceChoices, setReplaceChoices] = useState<Set<DocumentType>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [readyToProcessPageCount, setReadyToProcessPageCount] = useState<number | null>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;
      setPendingBatch(null);
      setReplaceChoices(new Set());
      setReadyToProcessPageCount(null);

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

        if (dealId && !replaceDocType) {
          setPhase("rendering");
          const pages = await filesToPageUploads(files, setProgress);
          const images = await Promise.all(
            pages.map(async (page, index) => ({
              pageNumber: index + 1,
              base64: await blobToBase64(page.blob),
              mediaType: "image/jpeg" as const,
            })),
          );

          setPhase("preparing");
          setProgress("Identifying document types...");
          const res = await fetch(`/api/deals/${dealId}/classify-upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ images }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error ?? "Could not identify document types");
          }
          const result = (await res.json()) as {
            classification: {
              pages: {
                page_number: number;
                doc_type: DocumentType;
                confidence: "high" | "medium" | "low";
              }[];
            };
            incomingDocTypes: DocumentType[];
            conflicts: DocumentType[];
          };
          const classifiedPages = pages.map((page, index) => {
            const classification = result.classification.pages.find((p) => p.page_number === index + 1);
            return {
              ...page,
              docType: classification?.doc_type,
              confidence: classification?.confidence,
            };
          });

          setPendingBatch({
            files,
            pages: classifiedPages,
            incomingDocTypes: result.incomingDocTypes,
            conflicts: result.conflicts,
          });
          setReplaceChoices(new Set(result.conflicts));
          toast.success("Document types identified. Confirm how to update the package.");
          return;
        }

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

  async function confirmPendingUpload() {
    if (!dealId || !pendingBatch) return;

    const supabase = createClient();
    setCommitting(true);
    setPhase("uploading");
    setProgress("Updating package...");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const docTypesToReplace = Array.from(replaceChoices);
      for (const docType of docTypesToReplace) {
        const { data: pagesToReplace, error: lookupErr } = await supabase
          .from("deal_pages")
          .select("image_path")
          .eq("deal_id", dealId)
          .eq("doc_type", docType);
        if (lookupErr) throw new Error(lookupErr.message);

        const imagePaths = (pagesToReplace ?? []).map((page) => page.image_path);
        if (imagePaths.length > 0) {
          const { error: removeErr } = await supabase.storage.from("deals").remove(imagePaths);
          if (removeErr) throw new Error(`Could not remove old ${DOCUMENT_TYPES[docType]} pages`);
        }

        const { error: deleteErr } = await supabase
          .from("deal_pages")
          .delete()
          .eq("deal_id", dealId)
          .eq("doc_type", docType);
        if (deleteErr) throw new Error(deleteErr.message);
      }

      const { data: lastPage } = await supabase
        .from("deal_pages")
        .select("page_number")
        .eq("deal_id", dealId)
        .order("page_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      let nextPageNumber = (lastPage?.page_number ?? 0) + 1;
      let firstPdfPath: string | null = null;

      for (let fileIndex = 0; fileIndex < pendingBatch.files.length; fileIndex++) {
        const file = pendingBatch.files[fileIndex];
        const sourcePath = `${dealId}/sources/${String(fileIndex + 1).padStart(3, "0")}-${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;
        const { error: sourceErr } = await supabase.storage
          .from("deals")
          .upload(sourcePath, file, {
            contentType: isPdf(file) ? "application/pdf" : "image/jpeg",
          });
        if (sourceErr) throw new Error(`${file.name} upload failed: ${sourceErr.message}`);
        if (isPdf(file) && !firstPdfPath) firstPdfPath = sourcePath;
      }

      for (const page of pendingBatch.pages) {
        const pageNumber = nextPageNumber++;
        setProgress(`Uploading page ${pageNumber}...`);
        const imagePath = `${dealId}/pages/p${String(pageNumber).padStart(3, "0")}.jpg`;
        const { error: imageErr } = await supabase.storage
          .from("deals")
          .upload(imagePath, page.blob, { contentType: "image/jpeg" });
        if (imageErr) throw new Error(`Page ${pageNumber} upload failed: ${imageErr.message}`);

        const { error: rowErr } = await supabase.from("deal_pages").insert({
          deal_id: dealId,
          page_number: pageNumber,
          image_path: imagePath,
          doc_type: page.docType ?? null,
          doc_confidence: page.confidence ?? null,
        });
        if (rowErr) throw new Error(`Page ${pageNumber} record failed: ${rowErr.message}`);
      }

      const { count } = await supabase
        .from("deal_pages")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId);

      const update: Record<string, unknown> = {
        page_count: count ?? nextPageNumber - 1,
        status: "uploaded",
        error_message: null,
      };
      if (firstPdfPath) update.original_pdf_path = firstPdfPath;

      await supabase.from("deal_fields").delete().eq("deal_id", dealId);
      await supabase.from("deals").update(update).eq("id", dealId);
      await supabase.from("audit_logs").insert({
        user_id: user.id,
        deal_id: dealId,
        action: "pending_upload_confirmed",
        details: {
          incoming_doc_types: pendingBatch.incomingDocTypes,
          replaced_doc_types: docTypesToReplace,
          pages_added: pendingBatch.pages.length,
          page_count: count ?? nextPageNumber - 1,
        },
      });

      toast.success("Package updated. Click Process when ready.");
      setPendingBatch(null);
      setReplaceChoices(new Set());
      setReadyToProcessPageCount(count ?? nextPageNumber - 1);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Package update failed");
      router.refresh();
    } finally {
      setCommitting(false);
      setPhase("idle");
      setProgress("");
    }
  }

  const busy = phase !== "idle" || committing;

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
        ) : pendingBatch ? (
          <div className="w-full space-y-3">
            <div className="space-y-1 text-sm">
              <p className="font-medium">Recognized documents</p>
              <p className="text-xs text-muted-foreground">
                {pendingBatch.files.length} file{pendingBatch.files.length === 1 ? "" : "s"} -{" "}
                {pendingBatch.pages.length} page{pendingBatch.pages.length === 1 ? "" : "s"}
              </p>
              <div className="flex flex-wrap gap-1">
                {pendingBatch.incomingDocTypes.map((docType) => (
                  <span key={docType} className="rounded border px-2 py-0.5 text-xs">
                    {DOCUMENT_TYPES[docType]}
                  </span>
                ))}
              </div>
            </div>

            {pendingBatch.conflicts.length > 0 ? (
              <div className="space-y-2 rounded border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Existing document types found
                </p>
                {pendingBatch.conflicts.map((docType) => (
                  <label key={docType} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={replaceChoices.has(docType)}
                      onChange={(e) =>
                        setReplaceChoices((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            next.add(docType);
                          } else {
                            next.delete(docType);
                          }
                          return next;
                        })
                      }
                    />
                    <span>
                      Replace existing {DOCUMENT_TYPES[docType]}
                      <span className="block text-xs text-muted-foreground">
                        Unchecked keeps both copies in the package.
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded border p-3 text-sm text-muted-foreground">
                No matching existing document types were found. These pages will be added to the package.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={confirmPendingUpload}>Confirm update</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingBatch(null);
                  setReplaceChoices(new Set());
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : dealId && readyToProcessPageCount ? (
          <div className="w-full space-y-3 text-center">
            <p className="text-sm font-medium">Package update saved</p>
            <p className="text-xs text-muted-foreground">
              Review the updated package, then run extraction when ready.
            </p>
            <div className="flex justify-center">
              <ProcessDealButton
                dealId={dealId}
                status="uploaded"
                pageCount={readyToProcessPageCount}
                variant="default"
              />
            </div>
            <Button variant="outline" onClick={() => setReadyToProcessPageCount(null)}>
              Add more files
            </Button>
          </div>
        ) : (
          <>
            <p className="text-center text-sm font-medium">
              {dealId
                ? replaceDocType
                  ? "Drop a replacement PDF or JPEG"
                  : "Drop one or more PDFs/JPEGs to update this package"
                : "Drop PDFs or JPEG files here"}
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              {dealId ? (replaceDocType ? "Choose replacement" : "Add files") : "Choose files"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Select multiple files at once. .pdf, .jpg, .jpeg - max {MAX_FILE_MB} MB per file
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
