import type { DocumentType } from "@/lib/types";

export const MAX_FILE_MB = Number(process.env.NEXT_PUBLIC_MAX_FILE_MB ?? 50);
export const RETENTION_DAYS = Number(process.env.NEXT_PUBLIC_PDF_RETENTION_DAYS ?? 14);
export const ACCEPTED_UPLOAD_TYPES = "application/pdf,image/jpeg,.pdf,.jpg,.jpeg";

const RENDER_SCALE = 2.5;
const JPEG_QUALITY = 0.92;
const PDF_SIGNATURE = "%PDF";
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

export type PageUpload = {
  blob: Blob;
  sourceName: string;
};

export function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isJpeg(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "image/jpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg");
}

export function formatPackageName(files: File[]) {
  if (files.length === 1) return files[0].name;
  const first = files[0].name;
  return `${first} + ${files.length - 1} more`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function safeStorageFileName(name: string) {
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

export async function renderFilePages(
  file: File,
  onProgress: (message: string) => void,
): Promise<PageUpload[]> {
  const kind = await detectFileKind(file);
  if (kind === "pdf") return renderPdfPages(file, onProgress);
  if (kind === "jpeg") return [{ blob: file, sourceName: file.name }];
  throw new Error(`${file.name} is not a PDF or JPEG file.`);
}

export function confidenceFromLightClassification(confidence: number | null): "high" | "medium" | "low" | null {
  if (confidence == null) return null;
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function documentTypeFromLightClassification(docType: string | null): DocumentType | null {
  if (!docType || docType === "unknown") return null;
  return docType as DocumentType;
}

async function renderPdfPages(
  file: File,
  onProgress: (message: string) => void,
): Promise<PageUpload[]> {
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

async function detectFileKind(file: File): Promise<"pdf" | "jpeg" | "unknown"> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const textHeader = new TextDecoder("ascii").decode(header.slice(0, 4));
  if (textHeader === PDF_SIGNATURE) return "pdf";
  if (JPEG_SIGNATURE.every((byte, index) => header[index] === byte)) return "jpeg";
  if (isPdf(file)) return "pdf";
  if (isJpeg(file)) return "jpeg";
  return "unknown";
}
