import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { STANDARD_FORMS, type StandardFormDefinition } from "../src/lib/standard-forms";
import type { SourceBox } from "../src/lib/types";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type TextLine = {
  page: number;
  text: string;
  box: SourceBox;
};

type FieldAnchor = {
  fieldKey: string;
  label: string;
  page: number;
  phrase: string;
  anchorBox: SourceBox;
  suggestedBox: SourceBox;
};

type CalibratedForm = {
  key: string;
  title: string;
  documentType: string;
  formNumber: string | null;
  representativePdf: string;
  matchedPdfCount: number;
  pageCount: number;
  score: number;
  fieldAnchors: FieldAnchor[];
};

type CalibrationReport = {
  generatedAt: string;
  formsRoot: string;
  totals: {
    pdfsScanned: number;
    matchedPdfs: number;
    unmatchedPdfs: number;
    calibratedForms: number;
    fieldAnchors: number;
  };
  forms: CalibratedForm[];
  unmatchedPdfs: string[];
};

const repoRoot = join(process.cwd(), "..");
const formsRoot = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(repoRoot, "Example", "Standard forms");
const docsRoot = join(repoRoot, "docs");
const jsonOut = join(docsRoot, "standard-form-calibration.json");
const mdOut = join(docsRoot, "standard-form-calibration.md");

const FIELD_PATTERNS: Record<string, { fieldKey: string; label: string; phrases: string[] }[]> = {
  form_100_aps: [
    { fieldKey: "property_address", label: "Property address", phrases: ["real property known as", "municipally known as"] },
    { fieldKey: "sale_price", label: "Purchase price", phrases: ["purchase price", "dollars"] },
    { fieldKey: "deposit_amount", label: "Deposit amount", phrases: ["deposit", "upon acceptance"] },
    { fieldKey: "closing_date", label: "Completion date", phrases: ["completion date", "completion"] },
  ],
  form_320_confirmation: [
    { fieldKey: "representation_side", label: "Representation side", phrases: ["represents", "seller", "buyer"] },
    { fieldKey: "cooperating_commission_pct", label: "Co-operating commission", phrases: ["commission", "co-operating brokerage"] },
  ],
  form_371_buyer_rep: [
    { fieldKey: "buyer_names", label: "Buyer names", phrases: ["buyer", "client"] },
    { fieldKey: "cooperating_commission_pct", label: "Commission", phrases: ["commission", "remuneration"] },
  ],
  form_372_tenant_rep: [
    { fieldKey: "buyer_names", label: "Tenant names", phrases: ["tenant", "client"] },
  ],
  form_400_agreement_to_lease: [
    { fieldKey: "property_address", label: "Leased premises", phrases: ["premises", "municipally known"] },
    { fieldKey: "sale_price", label: "Monthly rent", phrases: ["rent", "monthly"] },
    { fieldKey: "lease_start_date", label: "Lease start", phrases: ["commencing", "term of lease"] },
  ],
  form_630_individual_id: [
    { fieldKey: "buyer_names", label: "Individual name", phrases: ["name of individual", "individual"] },
    { fieldKey: "seller_names", label: "Individual name", phrases: ["name of individual", "individual"] },
  ],
  form_635_receipt_funds: [
    { fieldKey: "deposit_amount", label: "Amount received", phrases: ["amount", "funds received"] },
    { fieldKey: "deposit_method", label: "Funds method/source", phrases: ["method", "source of funds"] },
  ],
};

async function main() {
  const pdfs = await listPdfs(formsRoot);
  const bestByForm = new Map<string, CalibratedForm>();
  const countsByForm = new Map<string, number>();
  const unmatchedPdfs: string[] = [];

  for (const pdfPath of pdfs) {
    const analyzed = await analyzePdf(pdfPath);
    if (!analyzed.match) {
      unmatchedPdfs.push(relative(repoRoot, pdfPath));
      continue;
    }

    const { form, score, formNumber } = analyzed.match;
    const resolvedFormNumber = formNumber ?? form.formNumbers?.[0] ?? null;
    const key = `${form.key}:${resolvedFormNumber ?? ""}`;
    countsByForm.set(key, (countsByForm.get(key) ?? 0) + 1);

    const candidate: CalibratedForm = {
      key: form.key,
      title: form.title,
      documentType: form.documentType,
      formNumber: resolvedFormNumber,
      representativePdf: relative(repoRoot, pdfPath),
      matchedPdfCount: 1,
      pageCount: analyzed.pageCount,
      score,
      fieldAnchors: calibrateFieldAnchors(form.key, analyzed.lines),
    };

    const existing = bestByForm.get(key);
    if (!existing || candidate.fieldAnchors.length > existing.fieldAnchors.length || score > existing.score) {
      bestByForm.set(key, candidate);
    }
  }

  const forms = Array.from(bestByForm.entries())
    .map(([key, form]) => ({ ...form, matchedPdfCount: countsByForm.get(key) ?? form.matchedPdfCount }))
    .sort((a, b) => a.key.localeCompare(b.key) || String(a.formNumber).localeCompare(String(b.formNumber)));

  const report: CalibrationReport = {
    generatedAt: new Date().toISOString(),
    formsRoot: relative(repoRoot, formsRoot),
    totals: {
      pdfsScanned: pdfs.length,
      matchedPdfs: pdfs.length - unmatchedPdfs.length,
      unmatchedPdfs: unmatchedPdfs.length,
      calibratedForms: forms.length,
      fieldAnchors: forms.reduce((sum, form) => sum + form.fieldAnchors.length, 0),
    },
    forms,
    unmatchedPdfs,
  };

  await mkdir(docsRoot, { recursive: true });
  await writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdOut, renderMarkdown(report), "utf8");

  console.log(`Scanned ${report.totals.pdfsScanned} PDFs`);
  console.log(`Matched ${report.totals.matchedPdfs}; unmatched ${report.totals.unmatchedPdfs}`);
  console.log(`Calibrated ${report.totals.calibratedForms} form variants with ${report.totals.fieldAnchors} field anchors`);
  console.log(`Wrote ${relative(repoRoot, jsonOut)} and ${relative(repoRoot, mdOut)}`);
}

async function listPdfs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return listPdfs(path);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) return [path];
      return [];
    }),
  );
  return files.flat().sort((a, b) => a.localeCompare(b));
}

async function analyzePdf(pdfPath: string) {
  const data = new Uint8Array(await readFile(pdfPath));
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
  const pageLimit = Math.min(doc.numPages, 2);
  const lines: TextLine[] = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    lines.push(...toTextLines(pageNumber, viewport.width, viewport.height, text.items as PdfTextItem[]));
  }

  return {
    pageCount: doc.numPages,
    lines,
    match: matchStandardForm(pdfPath, lines.map((line) => line.text).join(" ")),
  };
}

function toTextLines(page: number, pageWidth: number, pageHeight: number, items: PdfTextItem[]) {
  const textItems = items
    .filter((item) => item.str.trim())
    .map((item) => {
      const fontHeight = Math.max(item.height || Math.abs(item.transform[3]) || 1, 1);
      const x = item.transform[4];
      const y = item.transform[5];
      return {
        text: item.str.trim(),
        x,
        top: pageHeight - y - fontHeight,
        width: Math.max(item.width, 1),
        height: fontHeight,
      };
    })
    .sort((a, b) => a.top - b.top || a.x - b.x);

  const groups: typeof textItems[] = [];
  for (const item of textItems) {
    const group = groups.find((candidate) => Math.abs(candidate[0].top - item.top) < 3);
    if (group) group.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x);
    const left = Math.min(...group.map((item) => item.x));
    const top = Math.min(...group.map((item) => item.top));
    const right = Math.max(...group.map((item) => item.x + item.width));
    const bottom = Math.max(...group.map((item) => item.top + item.height));
    return {
      page,
      text: group.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim(),
      box: clampBox({
        x: left / pageWidth,
        y: top / pageHeight,
        width: (right - left) / pageWidth,
        height: (bottom - top) / pageHeight,
      }),
    };
  });
}

function matchStandardForm(pdfPath: string, extractedText: string) {
  const haystack = normalize(`${basename(pdfPath)} ${extractedText.slice(0, 6000)}`);
  let best: { form: StandardFormDefinition; score: number; formNumber: string | null } | null = null;

  for (const form of STANDARD_FORMS) {
    let score = 0;
    let formNumber: string | null = null;

    for (const number of form.formNumbers ?? []) {
      if (new RegExp(`\\bform\\s*-?\\s*${escapeRegExp(number)}\\b`).test(haystack)) {
        score += 12;
        formNumber = number;
      } else if (new RegExp(`\\b${escapeRegExp(number)}\\b`).test(normalize(basename(pdfPath)))) {
        score += 6;
        formNumber = number;
      }
    }

    if (haystack.includes(normalize(form.title))) score += 8;
    for (const alias of form.aliases) {
      if (haystack.includes(normalize(alias))) score += 4;
    }
    for (const signature of form.signatures ?? []) {
      if (haystack.includes(normalize(signature))) score += 2;
    }

    const threshold = form.formNumbers?.length ? 8 : 4;
    if (score >= threshold && score > (best?.score ?? 0)) {
      best = { form, score, formNumber };
    }
  }

  return best;
}

function calibrateFieldAnchors(formKey: string, lines: TextLine[]): FieldAnchor[] {
  const patterns = FIELD_PATTERNS[formKey] ?? [];
  const anchors: FieldAnchor[] = [];

  for (const pattern of patterns) {
    const found = findBestLine(lines, pattern.phrases);
    if (!found) continue;
    anchors.push({
      fieldKey: pattern.fieldKey,
      label: pattern.label,
      page: found.line.page,
      phrase: found.phrase,
      anchorBox: found.line.box,
      suggestedBox: suggestEntryBox(found.line.box),
    });
  }

  return anchors;
}

function findBestLine(lines: TextLine[], phrases: string[]) {
  for (const phrase of phrases) {
    const normalizedPhrase = normalize(phrase);
    const line = lines.find((candidate) => normalize(candidate.text).includes(normalizedPhrase));
    if (line) return { line, phrase };
  }
  return null;
}

function suggestEntryBox(anchor: SourceBox): SourceBox {
  const below = anchor.y < 0.82;
  const y = below ? anchor.y + anchor.height + 0.006 : Math.max(0, anchor.y - 0.055);
  return clampBox({
    x: Math.max(0.06, anchor.x),
    y,
    width: Math.min(0.88, Math.max(anchor.width, 0.72)),
    height: 0.05,
  });
}

function renderMarkdown(report: CalibrationReport) {
  const rows = report.forms
    .map(
      (form) =>
        `| ${form.key} | ${form.formNumber ?? ""} | ${form.matchedPdfCount} | ${form.fieldAnchors.length} | ${form.representativePdf} |`,
    )
    .join("\n");
  const anchors = report.forms
    .filter((form) => form.fieldAnchors.length > 0)
    .map((form) => {
      const fieldRows = form.fieldAnchors
        .map(
          (anchor) =>
            `| ${anchor.fieldKey} | ${anchor.page} | ${anchor.phrase} | ${formatBox(anchor.anchorBox)} | ${formatBox(anchor.suggestedBox)} |`,
        )
        .join("\n");
      return `\n### ${form.title}${form.formNumber ? ` (Form ${form.formNumber})` : ""}\n\nRepresentative: \`${form.representativePdf}\`\n\n| Field | Page | Matched phrase | Anchor box | Suggested value box |\n|---|---:|---|---|---|\n${fieldRows}`;
    })
    .join("\n");

  return `# Standard Form Calibration\n\nGenerated: ${report.generatedAt}\n\nSource folder: \`${report.formsRoot}\`\n\n## Summary\n\n- PDFs scanned: ${report.totals.pdfsScanned}\n- Matched PDFs: ${report.totals.matchedPdfs}\n- Unmatched PDFs: ${report.totals.unmatchedPdfs}\n- Calibrated form variants: ${report.totals.calibratedForms}\n- Field anchors found: ${report.totals.fieldAnchors}\n\n## Form Coverage\n\n| Form key | Form number | Matched PDFs | Field anchors | Representative PDF |\n|---|---:|---:|---:|---|\n${rows}\n\n## Field Anchors\n${anchors || "\nNo field anchors found."}\n\n## Unmatched PDFs\n\n${report.unmatchedPdfs.map((pdf) => `- ${pdf}`).join("\n") || "None"}\n`;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampBox(box: SourceBox): SourceBox {
  const x = clamp(box.x);
  const y = clamp(box.y);
  const width = Math.min(clamp(box.width), 1 - x);
  const height = Math.min(clamp(box.height), 1 - y);
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function formatBox(box: SourceBox) {
  return `x ${box.x}, y ${box.y}, w ${box.width}, h ${box.height}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
