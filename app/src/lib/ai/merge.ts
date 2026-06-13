import type { Confidence, DocumentType, FieldReview } from "@/lib/types";
import type { FieldExtraction } from "./schemas";
import { EXTRACTABLE_DOCS } from "./extract";

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export type MergedField = FieldReview & { key: string };

/**
 * Merge per-document extractions into one field set.
 * Precedence: higher confidence wins; on ties, the more authoritative document
 * (earlier in EXTRACTABLE_DOCS — APS/lease first, then offer/confirmation forms) wins.
 * Cross-check: if another document disagrees with the chosen value, flag for review.
 */
export function mergeExtractions(
  perDoc: { docType: DocumentType; extraction: FieldExtraction }[],
): MergedField[] {
  const byKey = new Map<
    string,
    { value: string; confidence: Confidence; docType: DocumentType; sourcePage: number | null }[]
  >();

  for (const { docType, extraction } of perDoc) {
    for (const f of extraction.fields) {
      if (f.value == null || f.value.trim() === "") continue;
      const list = byKey.get(f.field_key) ?? [];
      list.push({
        value: f.value.trim(),
        confidence: f.confidence,
        docType,
        sourcePage: f.source_page,
      });
      byKey.set(f.field_key, list);
    }
  }

  const merged: MergedField[] = [];
  for (const [key, candidates] of byKey) {
    candidates.sort((a, b) => {
      const conf = CONF_RANK[b.confidence] - CONF_RANK[a.confidence];
      if (conf !== 0) return conf;
      return docPriority(a.docType) - docPriority(b.docType);
    });
    const winner = candidates[0];

    const disagreeing = candidates.filter((c) => !valuesAgree(key, c.value, winner.value));
    const conflict = disagreeing.length > 0;

    merged.push({
      key,
      value: winner.value,
      confidence: conflict && winner.confidence === "high" ? "medium" : winner.confidence,
      sourceDocumentType: winner.docType,
      sourcePage: winner.sourcePage ?? undefined,
      needsReview: conflict || winner.confidence !== "high",
      notes: conflict
        ? `Conflicts: ${disagreeing.map((d) => `${d.docType} p.${d.sourcePage ?? "?"} = "${d.value}"`).join("; ")}`
        : undefined,
    });
  }
  return merged;
}

function docPriority(d: DocumentType): number {
  const i = EXTRACTABLE_DOCS.indexOf(d);
  return i === -1 ? 99 : i;
}

// Tolerant comparison: numbers compared numerically, names case-insensitively.
function valuesAgree(key: string, a: string, b: string): boolean {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (na !== null && nb !== null) return Math.abs(na - nb) < 0.005;
  return a.toLowerCase().replace(/\s+/g, " ") === b.toLowerCase().replace(/\s+/g, " ");
}

function normalizeNumber(s: string): number | null {
  const cleaned = s.replace(/[$,%\s]/g, "");
  if (cleaned === "" || isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}
