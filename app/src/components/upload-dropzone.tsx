"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 50);
const RETENTION_DAYS = Number(process.env.NEXT_PUBLIC_PDF_RETENTION_DAYS ?? 14);
const RENDER_SCALE = 2.0; // ~144dpi — enough for handwriting legibility
const JPEG_QUALITY = 0.8;

type Phase = "idle" | "rendering" | "uploading" | "processing";

export function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf") || file.type !== "application/pdf") {
        toast.error("Only PDF files are accepted.");
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`File exceeds the ${MAX_FILE_MB} MB limit.`);
        return;
      }

      const supabase = createClient();
      let dealId: string | null = null;

      try {
        // Render pages in the browser (packages are scanned images; the
        // server pipeline works from page JPEGs).
        setPhase("rendering");
        setProgress("Opening PDF…");
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const bytes = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const pageCount = pdf.numPages;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in");

        const deleteAfter = new Date(Date.now() + RETENTION_DAYS * 86400_000).toISOString();
        const { data: deal, error: dealErr } = await supabase
          .from("deals")
          .insert({
            created_by: user.id,
            file_name: file.name,
            file_size: file.size,
            page_count: pageCount,
            status: "uploaded",
            delete_original_after: deleteAfter,
          })
          .select()
          .single();
        if (dealErr || !deal) throw new Error(dealErr?.message ?? "Could not create deal");
        dealId = deal.id;

        setPhase("uploading");
        setProgress("Uploading original PDF…");
        const originalPath = `${deal.id}/original.pdf`;
        const { error: upErr } = await supabase.storage
          .from("deals")
          .upload(originalPath, file, { contentType: "application/pdf" });
        if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
        await supabase.from("deals").update({ original_pdf_path: originalPath }).eq("id", deal.id);

        for (let i = 1; i <= pageCount; i++) {
          setProgress(`Rendering & uploading page ${i} of ${pageCount}…`);
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d")!;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;

          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) => (b ? resolve(b) : reject(new Error("Canvas render failed"))),
              "image/jpeg",
              JPEG_QUALITY,
            ),
          );
          const imagePath = `${deal.id}/pages/p${String(i).padStart(3, "0")}.jpg`;
          const { error: imgErr } = await supabase.storage
            .from("deals")
            .upload(imagePath, blob, { contentType: "image/jpeg" });
          if (imgErr) throw new Error(`Page ${i} upload failed: ${imgErr.message}`);

          const { error: rowErr } = await supabase.from("deal_pages").insert({
            deal_id: deal.id,
            page_number: i,
            image_path: imagePath,
          });
          if (rowErr) throw new Error(`Page ${i} record failed: ${rowErr.message}`);
        }

        await supabase.from("audit_logs").insert({
          user_id: user.id,
          deal_id: deal.id,
          action: "package_uploaded",
          details: { file_name: file.name, pages: pageCount, size: file.size },
        });

        setPhase("processing");
        setProgress("Running AI extraction — this can take a few minutes…");
        const res = await fetch(`/api/deals/${deal.id}/process`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Processing failed");
        }

        toast.success("Package processed. Opening review screen…");
        router.push(`/deals/${deal.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
        if (dealId) router.refresh();
        setPhase("idle");
        setProgress("");
      }
    },
    [router],
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
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10">
        {busy ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">{progress}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              Drop a transaction package PDF here, or
            </p>
            <Button onClick={() => inputRef.current?.click()}>Choose PDF</Button>
            <p className="text-xs text-muted-foreground">
              .pdf only · max {MAX_FILE_MB} MB · originals auto-delete after {RETENTION_DAYS} days
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
