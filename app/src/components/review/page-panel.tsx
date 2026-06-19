"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { shortDocumentLabel } from "@/lib/display";
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
  const selectedSection =
    selectedPage != null
      ? documentSections.find((section) => section.pages.includes(selectedPage))
      : documentSections[0];
  const selectedPageRow =
    selectedPage != null ? pages.find((p) => p.page_number === selectedPage) : null;
  const selectedDocLabel = selectedSection?.label ?? "Unclassified document";
  const selectedFormLabel = formatStandardFormLabel(selectedPageRow);
  const selectedSectionPages = selectedSection?.pages ?? [];
  const selectedPageIndex = selectedPage != null ? selectedSectionPages.indexOf(selectedPage) : -1;
  const canGoPrevious = selectedPageIndex > 0;
  const canGoNext = selectedPageIndex >= 0 && selectedPageIndex < selectedSectionPages.length - 1;

  return (
    <Card className="self-start lg:sticky lg:top-4">
      <CardContent className="space-y-3 p-3">
        {documentSections.length > 0 && (
          <div className="flex gap-1 overflow-x-auto border-b pb-2" role="tablist" aria-label="Document preview tabs">
            {documentSections.map((section) => {
              const selected = selectedPage != null && section.pages.includes(selectedPage);
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={section.formLabel ? `${section.label} - ${section.formLabel}` : section.label}
                  onClick={() => onSelect(section.startPage)}
                  className={`shrink-0 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <span className="block max-w-36 truncate font-medium">
                    {shortDocumentLabel(section.label)}
                  </span>
                  <span className="block text-[10px] leading-tight opacity-80">
                    {formatPageRange(section.pages)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selectedPage != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {shortDocumentLabel(selectedDocLabel)}
                {selectedFormLabel ? ` - ${selectedFormLabel}` : ""}
              </p>
              <div className="flex items-center gap-1">
                {selectedSectionPages.length > 1 && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Previous page in document"
                      onClick={() => {
                        if (canGoPrevious) onSelect(selectedSectionPages[selectedPageIndex - 1]);
                      }}
                      disabled={!canGoPrevious}
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      title="Current page in document"
                      disabled
                      className="w-auto px-2 text-xs disabled:opacity-100"
                    >
                      {selectedPageIndex + 1}/{selectedSectionPages.length}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Next page in document"
                      onClick={() => {
                        if (canGoNext) onSelect(selectedSectionPages[selectedPageIndex + 1]);
                      }}
                      disabled={!canGoNext}
                    >
                      <ChevronRight />
                    </Button>
                  </>
                )}
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
        {selectedPage == null && (
          <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground">
            No rendered document pages are available yet.
          </div>
        )}
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

function formatPageRange(pages: number[]) {
  if (pages.length === 0) return "";
  if (pages.length === 1) return `p.${pages[0]}`;
  return `p.${pages[0]}-${pages[pages.length - 1]}`;
}
