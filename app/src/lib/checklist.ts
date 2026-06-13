import {
  DOCUMENT_TYPES,
  REQUIRED_DOCS,
  OPTIONAL_DOCS,
  type DocumentType,
  type TransactionType,
} from "@/lib/types";

export type ChecklistItem = {
  docType: DocumentType;
  label: string;
  required: boolean;
  found: boolean;
  pages: number[];
};

export function buildChecklist(
  transactionType: TransactionType,
  pages: { page_number: number; doc_type: string | null }[],
): ChecklistItem[] {
  const tx = transactionType === "lease" ? "lease" : "purchase";
  const found = new Map<string, number[]>();
  for (const p of pages) {
    if (!p.doc_type) continue;
    found.set(p.doc_type, [...(found.get(p.doc_type) ?? []), p.page_number]);
  }

  const items: ChecklistItem[] = [];
  for (const docType of REQUIRED_DOCS[tx]) {
    items.push({
      docType,
      label: DOCUMENT_TYPES[docType],
      required: true,
      found: found.has(docType),
      pages: found.get(docType) ?? [],
    });
  }
  for (const docType of OPTIONAL_DOCS[tx]) {
    items.push({
      docType,
      label: DOCUMENT_TYPES[docType],
      required: false,
      found: found.has(docType),
      pages: found.get(docType) ?? [],
    });
  }
  // Found documents not in either list (e.g. mls_data_form) — show as informational
  for (const [docType, pageNums] of found) {
    if (items.some((i) => i.docType === docType) || docType === "other") continue;
    items.push({
      docType: docType as DocumentType,
      label: DOCUMENT_TYPES[docType as DocumentType] ?? docType,
      required: false,
      found: true,
      pages: pageNums,
    });
  }
  return items;
}
