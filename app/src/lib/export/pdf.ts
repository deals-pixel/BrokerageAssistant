import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { FIELD_SECTIONS } from "@/lib/types";
import type { ChecklistItem } from "@/lib/checklist";

type FieldRow = { field_key: string; value: string | null };

const MARGIN = 50;
const PAGE_W = 612; // letter
const PAGE_H = 792;

/**
 * Generate the filled Deal Information Sheet PDF — the output form the AI
 * fills out from the package's source documents — including the mandatory
 * document checklist.
 */
export async function generateDealSheetPdf(
  fields: FieldRow[],
  meta: {
    fileName: string;
    transactionType: string;
    reviewedBy?: string;
    checklist?: ChecklistItem[];
  },
): Promise<Uint8Array> {
  const byKey = new Map(fields.map((f) => [f.field_key, f.value]));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  };

  // Header
  drawCentered(page, bold, "DEAL INFORMATION SHEET", 16, y);
  y -= 22;
  drawCentered(
    page,
    font,
    `Transaction type: ${meta.transactionType.toUpperCase()}  |  Generated ${new Date().toISOString().slice(0, 10)}`,
    9,
    y,
  );
  y -= 12;
  drawCentered(page, font, `Source package: ${meta.fileName}`, 9, y);
  y -= 24;

  for (const section of FIELD_SECTIONS) {
    const present = section.fields.filter((f) => byKey.get(f.key));
    if (present.length === 0) continue;

    newPageIfNeeded(40 + present.length * 18);

    page.drawText(section.title.toUpperCase(), {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: rgb(0.15, 0.15, 0.35),
    });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.7,
      color: rgb(0.6, 0.6, 0.7),
    });
    y -= 16;

    for (const f of present) {
      newPageIfNeeded(18);
      page.drawText(`${f.label}:`, { x: MARGIN, y, size: 9, font: bold });
      const value = String(byKey.get(f.key) ?? "");
      const wrapped = wrapText(value, font, 9, PAGE_W - MARGIN * 2 - 170);
      for (let i = 0; i < wrapped.length; i++) {
        if (i > 0) {
          y -= 13;
          newPageIfNeeded(13);
        }
        page.drawText(wrapped[i], { x: MARGIN + 170, y, size: 9, font });
      }
      y -= 16;
    }
    y -= 8;
  }

  // Mandatory document checklist (mirrors the brokerage form's checklist block)
  if (meta.checklist && meta.checklist.length > 0) {
    newPageIfNeeded(40 + meta.checklist.length * 14);
    page.drawText("DOCUMENT CHECKLIST", {
      x: MARGIN,
      y,
      size: 11,
      font: bold,
      color: rgb(0.15, 0.15, 0.35),
    });
    y -= 6;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.7,
      color: rgb(0.6, 0.6, 0.7),
    });
    y -= 16;

    for (const item of meta.checklist) {
      newPageIfNeeded(14);
      const mark = item.found ? "[x]" : "[ ]";
      const suffix = item.found
        ? `  (p. ${item.pages.join(", ")})`
        : item.required
          ? "  — MISSING"
          : "  (not included)";
      const label = `${mark} ${item.label}${item.required ? "" : " (optional)"}${suffix}`;
      page.drawText(label, {
        x: MARGIN,
        y,
        size: 9,
        font: item.required && !item.found ? bold : font,
        color: item.required && !item.found ? rgb(0.7, 0.1, 0.1) : rgb(0, 0, 0),
      });
      y -= 14;
    }
    y -= 8;
  }

  if (meta.reviewedBy) {
    newPageIfNeeded(30);
    y -= 10;
    page.drawText(`Reviewed by: ${meta.reviewedBy}`, { x: MARGIN, y, size: 9, font });
  }

  return doc.save();
}

function drawCentered(page: PDFPage, font: PDFFont, text: string, size: number, y: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - w) / 2, y, size, font });
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(tryLine, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = tryLine;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
