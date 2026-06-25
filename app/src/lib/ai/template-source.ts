import type { DocumentType } from "@/lib/types";
import {
  defaultStandardFormMatchForDocumentType,
  standardFormMatchFromKey,
  templateRegionsForStandardForm,
  type StandardFormMatch,
} from "@/lib/standard-forms";
import type { FieldExtraction, PageClassification } from "./schemas";

export type PageStandardFormMatch = {
  pageNumber: number;
  templatePageNumber: number | null;
  docType: DocumentType;
  match: StandardFormMatch | null;
};

export function buildPageStandardFormMatches(
  pages: PageClassification["pages"],
): PageStandardFormMatch[] {
  const matches = pages.map((page) => {
    const docType = page.doc_type as DocumentType;
    const classifierMatch = standardFormMatchFromKey(
      page.standard_form_key,
      page.standard_form_confidence ?? page.confidence,
      page.standard_form_number,
    );
    const match =
      classifierMatch && classifierMatch.documentType === docType
        ? {
            ...classifierMatch,
            formNumber: page.standard_form_number ?? classifierMatch.formNumber,
            title: page.standard_form_title ?? classifierMatch.title,
          }
        : defaultStandardFormMatchForDocumentType(docType);

    return {
      pageNumber: page.page_number,
      templatePageNumber: null,
      docType,
      match,
    };
  });

  let previousGroupKey = "";
  let templatePageNumber = 0;
  return matches.map((pageMatch) => {
    const groupKey = pageMatch.match
      ? `${pageMatch.docType}:${pageMatch.match.key}`
      : `${pageMatch.docType}:unmatched`;
    templatePageNumber = groupKey === previousGroupKey ? templatePageNumber + 1 : 1;
    previousGroupKey = groupKey;
    return {
      ...pageMatch,
      templatePageNumber: pageMatch.match ? templatePageNumber : null,
    };
  });
}

export function standardFormMatchesForDocument(
  docType: DocumentType,
  pageMatches: PageStandardFormMatch[],
) {
  return pageMatches
    .filter((pageMatch) => pageMatch.docType === docType && pageMatch.match)
    .map((pageMatch) => pageMatch.match as StandardFormMatch);
}

export function applyTemplateSourceFallbacks(
  perDoc: { docType: DocumentType; extraction: FieldExtraction }[],
  pageMatches: PageStandardFormMatch[],
): { extractions: { docType: DocumentType; extraction: FieldExtraction }[]; fallbackCount: number } {
  let fallbackCount = 0;

  const extractions = perDoc.map(({ docType, extraction }) => {
    const matchedPages = pageMatches.filter(
      (pageMatch) => pageMatch.docType === docType && pageMatch.match,
    );
    const fields = extraction.fields.map((field) => {
      if (field.source_box) return field;

      const matchedPage = field.source_page
        ? matchedPages.find((pageMatch) => pageMatch.pageNumber === field.source_page)
        : matchedPages.length === 1
          ? matchedPages[0]
          : null;
      const region = templateRegionsForStandardForm(
        matchedPage?.match?.key,
        field.field_key,
        matchedPage?.templatePageNumber,
      )[0];

      if (!matchedPage || !region?.boxes[0]) return field;
      fallbackCount += 1;
      return {
        ...field,
        source_page: field.source_page ?? matchedPage.pageNumber,
        source_box: region.boxes[0],
        source_box_origin: "template" as const,
      };
    });

    return { docType, extraction: { fields } };
  });

  return { extractions, fallbackCount };
}
