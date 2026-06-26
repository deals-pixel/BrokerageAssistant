import sharp from "sharp";
import { PDFiumLibrary } from "@hyzyla/pdfium";

const PDF_SIGNATURE = "%PDF";
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const RENDER_SCALE = 2.5;
const JPEG_QUALITY = 92;
const LOW_CONTRAST_MEAN = 248;
const LOW_CONTRAST_STDDEV = 26;

export type ServerRenderedPage = {
  pageNumber: number;
  buffer: Buffer;
  width: number;
  height: number;
  quality: RenderQuality;
};

export type RenderQuality = {
  mean: number;
  stddev: number;
  repaired: boolean;
  warning: string | null;
};

type RenderInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string | null;
};

export async function renderAttachmentPages({ buffer, filename, mimeType }: RenderInput): Promise<ServerRenderedPage[]> {
  const kind = detectFileKind(buffer, filename, mimeType);
  if (kind === "pdf") return renderPdfPages(buffer);
  if (kind === "image") {
    const normalized = await normalizeImagePage(buffer);
    return [{ pageNumber: 1, ...normalized }];
  }
  throw new Error(`${filename} is not a PDF or supported image file.`);
}

function detectFileKind(buffer: Buffer, filename: string, mimeType: string | null) {
  const name = filename.toLowerCase();
  const header = buffer.subarray(0, 8);
  if (header.subarray(0, 4).toString("ascii") === PDF_SIGNATURE) return "pdf";
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (JPEG_SIGNATURE.every((byte, index) => header[index] === byte)) return "image";
  if (PNG_SIGNATURE.every((byte, index) => header[index] === byte)) return "image";
  if (mimeType?.startsWith("image/") || /\.(jpe?g|png)$/i.test(name)) return "image";
  return "unknown";
}

async function renderPdfPages(buffer: Buffer): Promise<ServerRenderedPage[]> {
  const library = await PDFiumLibrary.init();
  const document = await library.loadDocument(buffer);

  try {
    const pages: ServerRenderedPage[] = [];
    for (const page of document.pages()) {
      const image = await page.render({
        scale: RENDER_SCALE,
        render: async (options) =>
          sharp(options.data, {
            raw: {
              width: options.width,
              height: options.height,
              channels: 4,
            },
          })
            .flatten({ background: "#fff" })
            .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
            .toBuffer(),
      });
      const normalized = await normalizeRenderedJpeg(Buffer.from(image.data));
      pages.push({
        pageNumber: page.number,
        width: image.width,
        height: image.height,
        ...normalized,
      });
    }
    return pages;
  } finally {
    document.destroy();
    library.destroy();
  }
}

async function normalizeImagePage(buffer: Buffer) {
  const image = sharp(buffer).rotate();
  const metadata = await image.metadata();
  const jpeg = await image.flatten({ background: "#fff" }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
  const normalized = await normalizeRenderedJpeg(jpeg);
  return {
    buffer: normalized.buffer,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
    quality: normalized.quality,
  };
}

async function normalizeRenderedJpeg(buffer: Buffer) {
  const quality = await measureRenderQuality(buffer);
  if (!isLowContrast(quality)) {
    return { buffer, quality: { ...quality, repaired: false, warning: null } };
  }

  const repaired = await sharp(buffer)
    .grayscale()
    .normalize()
    .linear(1.12, -8)
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  const repairedQuality = await measureRenderQuality(repaired);
  const stillWeak = isLowContrast(repairedQuality);
  return {
    buffer: repaired,
    quality: {
      ...repairedQuality,
      repaired: true,
      warning: stillWeak ? "low_contrast_after_repair" : "low_contrast_repaired",
    },
  };
}

async function measureRenderQuality(buffer: Buffer) {
  const stats = await sharp(buffer).grayscale().stats();
  const channel = stats.channels[0];
  return {
    mean: Number(channel.mean.toFixed(2)),
    stddev: Number(channel.stdev.toFixed(2)),
  };
}

function isLowContrast(quality: { mean: number; stddev: number }) {
  return quality.mean >= LOW_CONTRAST_MEAN && quality.stddev <= LOW_CONTRAST_STDDEV;
}
