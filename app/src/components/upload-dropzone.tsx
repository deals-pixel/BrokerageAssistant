"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProcessDealButton } from "@/components/process-deal-button";
import { toast } from "sonner";
import type { DocumentType } from "@/lib/types";
import {
  ACCEPTED_UPLOAD_TYPES,
  MAX_FILE_MB,
  RETENTION_DAYS,
  fileKey,
  formatPackageName,
  formatSize,
  isJpeg,
  isPdf,
  renderFilePages,
  safeStorageFileName,
} from "@/lib/pdf-render-client";

type Phase = "idle" | "preparing" | "rendering" | "uploading";

type UploadDropzoneProps = {
  dealId?: string;
  compact?: boolean;
  replaceDocType?: DocumentType | "";
};

export function UploadDropzone({
  dealId,
  compact = false,
  replaceDocType = "",
}: UploadDropzoneProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [readyToProcessPageCount, setReadyToProcessPageCount] = useState<number | null>(null);

  const stageFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const invalid = incoming.find((file) => !isPdf(file) && !isJpeg(file));
    if (invalid) {
      toast.error(`${invalid.name} is not a PDF or JPEG file.`);
      return;
    }

    const oversized = incoming.find((file) => file.size > MAX_FILE_MB * 1024 * 1024);
    if (oversized) {
      toast.error(`${oversized.name} exceeds the ${MAX_FILE_MB} MB limit.`);
      return;
    }

    setReadyToProcessPageCount(null);
    setSelectedFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];
      for (const file of incoming) {
        if (seen.has(fileKey(file))) continue;
        next.push(file);
        seen.add(fileKey(file));
      }
      return next;
    });
  }, []);

  async function submitFiles() {
    if (selectedFiles.length === 0) {
      toast.error("Add at least one PDF or JPEG before submitting.");
      return;
    }

    const supabase = createClient();
    let activeDealId = dealId ?? null;
    let uploadedPages = 0;
    let firstPdfPath: string | null = null;

    try {
      setPhase("preparing");
      setProgress("Preparing package...");

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
            file_name: formatPackageName(selectedFiles),
            file_size: selectedFiles.reduce((sum, file) => sum + file.size, 0),
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

      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        const sourcePath = `${activeDealId}/sources/${String(fileIndex + 1).padStart(3, "0")}-${Date.now()}-${crypto.randomUUID()}-${safeStorageFileName(file.name)}`;

        setPhase("uploading");
        setProgress(`Uploading source ${fileIndex + 1} of ${selectedFiles.length}...`);
        const { error: sourceErr } = await supabase.storage
          .from("deals")
          .upload(sourcePath, file, {
            contentType: isPdf(file) ? "application/pdf" : "image/jpeg",
          });
        if (sourceErr) throw new Error(`${file.name} upload failed: ${sourceErr.message}`);
        if (isPdf(file) && !firstPdfPath) firstPdfPath = sourcePath;

        setPhase(isPdf(file) ? "rendering" : "uploading");
        const pages = await renderFilePages(file, setProgress);

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
        update.file_name = formatPackageName(selectedFiles);
        update.file_size = selectedFiles.reduce((sum, file) => sum + file.size, 0);
      }

      await supabase.from("deal_fields").delete().eq("deal_id", activeDealId);
      await supabase.from("deals").update(update).eq("id", activeDealId);
      await supabase.from("audit_logs").insert({
        user_id: user.id,
        deal_id: activeDealId,
        action: replaceDocType ? "document_type_replaced" : dealId ? "files_submitted" : "package_submitted",
        details: {
          files: selectedFiles.map((file) => ({ name: file.name, size: file.size, type: file.type })),
          pages_added: uploadedPages,
          page_count: count ?? uploadedPages,
          replaced_doc_type: replaceDocType || null,
          processing_started: false,
        },
      });

      toast.success(
        dealId
          ? `${uploadedPages} page${uploadedPages === 1 ? "" : "s"} submitted. Run extraction when ready.`
          : "Package submitted. Run extraction when ready.",
      );
      setSelectedFiles([]);
      setReadyToProcessPageCount(count ?? uploadedPages);

      if (dealId) {
        router.refresh();
      } else {
        router.push(`/deals/${activeDealId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Package submission failed");
      router.refresh();
    } finally {
      setPhase("idle");
      setProgress("");
    }
  }

  const busy = phase !== "idle";
  const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);

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
        stageFiles(e.dataTransfer.files);
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
        ) : dealId && readyToProcessPageCount ? (
          <div className="w-full space-y-3 text-center">
            <p className="text-sm font-medium">Package submitted</p>
            <p className="text-xs text-muted-foreground">
              Review the uploaded documents, then run extraction when ready.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <ProcessDealButton
                dealId={dealId}
                status="uploaded"
                pageCount={readyToProcessPageCount}
                variant="default"
              />
              <Button variant="outline" onClick={() => setReadyToProcessPageCount(null)}>
                Add more files
              </Button>
            </div>
          </div>
        ) : (
          <div className="w-full space-y-4">
            <div className="text-center">
              <p className="text-sm font-medium">
                {dealId
                  ? replaceDocType
                    ? "Stage a replacement PDF or JPEG"
                    : "Stage PDFs/JPEGs to update this package"
                  : "Stage PDFs or JPEG files"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add files in one or more batches. Nothing uploads or processes until Submit.
              </p>
            </div>

            {selectedFiles.length > 0 && (
              <div className="space-y-2 rounded border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    Pending upload: {selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} /{" "}
                    {formatSize(totalSize)}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setSelectedFiles([])}>
                    Clear
                  </Button>
                </div>
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {selectedFiles.map((file) => (
                    <div
                      key={fileKey(file)}
                      className="flex items-center justify-between gap-3 rounded bg-background px-2 py-1 text-sm"
                    >
                      <span className="min-w-0 truncate">{file.name}</span>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatSize(file.size)}</span>
                        <button
                          type="button"
                          className="text-foreground hover:underline"
                          onClick={() =>
                            setSelectedFiles((prev) => prev.filter((candidate) => fileKey(candidate) !== fileKey(file)))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => inputRef.current?.click()}>
                {selectedFiles.length > 0 ? "Add more files" : "Choose files"}
              </Button>
              <Button onClick={submitFiles} disabled={selectedFiles.length === 0}>
                Submit package
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              .pdf, .jpg, .jpeg - max {MAX_FILE_MB} MB per file
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_UPLOAD_TYPES}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) stageFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
