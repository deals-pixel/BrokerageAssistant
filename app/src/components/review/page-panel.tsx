"use client";

import { useMemo, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { DOCUMENT_TYPES, type DocumentType, type SourceBox } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PageRow = {
  page_number: number;
  doc_type: string | null;
  doc_confidence: string | null;
  standard_form_key?: string | null;
  standard_form_number?: string | null;
  standard_form_title?: string | null;
  standard_form_confidence?: string | null;
};

export function PagePanel({
  dealId,
  pages,
  selectedPage,
  highlight,
  onSelect,
}: {
  dealId: string;
  pages: PageRow[];
  selectedPage: number | null;
  highlight?: SourceBox | null;
  onSelect: (page: number) => void;
}) {
  const [zoom, setZoom] = useState(100);
  const imageUrl = (page: number) => `/api/deals/${dealId}/pages/${page}/image`;
  const documentSections = useMemo(() => groupPagesByDocument(pages), [pages]);
  const selectedDocType =
    selectedPage != null ? pages.find((p) => p.page_number === selectedPage)?.doc_type : null;
  const selectedPageRow =
    selectedPage != null ? pages.find((p) => p.page_number === selectedPage) : null;
  const selectedDocLabel = selectedDocType
    ? (DOCUMENT_TYPES[selectedDocType as DocumentType] ?? selectedDocType)
    : "Unclassified document";
  const selectedFormLabel = formatStandardFormLabel(selectedPageRow);

  return (
    <Card className="self-start lg:sticky lg:top-4">
      <CardContent className="space-y-3 p-3">
        {selectedPage != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {selectedDocLabel}
                {selectedFormLabel ? ` - ${selectedFormLabel}` : ""}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title="Zoom out"
                  onClick={() => setZoom((value) => Math.max(75, value - 25))}
                  disabled={zoom <= 75}
                >
                  <ZoomOut />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  title="Reset zoom"
                  onClick={() => setZoom(100)}
                >
                  {zoom}%
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  title="Zoom in"
                  onClick={() => setZoom((value) => Math.min(200, value + 25))}
                  disabled={zoom >= 200}
                >
                  <ZoomIn />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Fit to panel"
                  onClick={() => setZoom(100)}
                  disabled={zoom === 100}
                >
                  <RotateCcw />
                </Button>
              </div>
            </div>
            <div className="max-h-[76vh] overflow-auto rounded border bg-muted/30 p-2">
              <div className="relative mx-auto" style={{ width: `${zoom}%` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; bypass image optimizer */}
                <img
                  src={imageUrl(selectedPage)}
                  alt={`${selectedDocLabel} preview`}
                  className="block w-full rounded bg-background"
                />
                {highlight && (
                  <div
                    className="pointer-events-none absolute rounded-[2px] bg-yellow-300/35 mix-blend-multiply"
                    style={{
                      left: `${highlight.x * 100}%`,
                      top: `${highlight.y * 100}%`,
                      width: `${highlight.width * 100}%`,
                      height: `${highlight.height * 100}%`,
                    }}
                  />
                )}
              </div>
            </div>
            {!highlight && (
              <p className="text-center text-xs text-muted-foreground">
                Click a sourced field to jump to its document
              </p>
            )}
          </div>
        )}
        <div className="grid max-h-[360px] grid-cols-5 gap-2 overflow-y-auto">
          {documentSections.map((section) => (
            <button
              key={section.key}
              type="button"
              onClick={() => onSelect(section.startPage)}
              className={`rounded border p-1 text-left ${
                selectedPage != null && section.pages.includes(selectedPage)
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-muted"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(section.startPage)}
                alt={`${section.label} preview`}
                loading="lazy"
                className="aspect-[8.5/11] w-full rounded-sm object-cover"
              />
              <p className="mt-1 truncate text-[10px] leading-tight text-muted-foreground">
                {section.label}
              </p>
              {section.formLabel && (
                <p className="truncate text-[10px] leading-tight text-muted-foreground">
                  {section.formLabel}
                </p>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function groupPagesByDocument(pages: PageRow[]) {
  const sections: {
    key: string;
    startPage: number;
    pages: number[];
    docType: string | null;
    label: string;
    formLabel: string;
  }[] = [];

  for (const page of pages) {
    const label = page.doc_type
      ? (DOCUMENT_TYPES[page.doc_type as DocumentType] ?? page.doc_type)
      : "Unclassified document";
    const formLabel = formatStandardFormLabel(page);
    const previous = sections[sections.length - 1];
    if (previous && previous.docType === page.doc_type && previous.formLabel === formLabel) {
      previous.pages.push(page.page_number);
      continue;
    }
    sections.push({
      key: `${page.doc_type ?? "unclassified"}-${page.page_number}`,
      startPage: page.page_number,
      pages: [page.page_number],
      docType: page.doc_type,
      label,
      formLabel,
    });
  }

  return sections;
}

function formatStandardFormLabel(page: PageRow | null | undefined) {
  if (!page?.standard_form_title && !page?.standard_form_number) return "";
  const number = page.standard_form_number ? `Form ${page.standard_form_number}` : "";
  const title = page.standard_form_title ?? "";
  if (number && title) return `${number} ${title}`;
  return number || title;
}
