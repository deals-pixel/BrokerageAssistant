"use client";

import { useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { DOCUMENT_TYPES, type DocumentType, type SourceBox } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PageRow = { page_number: number; doc_type: string | null; doc_confidence: string | null };

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
  const selectedDocType =
    selectedPage != null ? pages.find((p) => p.page_number === selectedPage)?.doc_type : null;

  return (
    <Card className="self-start lg:sticky lg:top-4">
      <CardContent className="space-y-3 p-3">
        {selectedPage != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                Page {selectedPage}
                {selectedDocType
                  ? ` - ${DOCUMENT_TYPES[selectedDocType as DocumentType] ?? selectedDocType}`
                  : ""}
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
                  alt={`Page ${selectedPage}`}
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
            <p className="text-center text-xs text-muted-foreground">
              {highlight ? "Highlighted source area" : "Click a sourced field to jump to its page"}
            </p>
          </div>
        )}
        <div className="grid max-h-[360px] grid-cols-5 gap-2 overflow-y-auto">
          {pages.map((p) => (
            <button
              key={p.page_number}
              type="button"
              onClick={() => onSelect(p.page_number)}
              className={`rounded border p-1 text-left ${
                selectedPage === p.page_number
                  ? "border-primary ring-2 ring-primary/40"
                  : "border-muted"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl(p.page_number)}
                alt={`Page ${p.page_number}`}
                loading="lazy"
                className="aspect-[8.5/11] w-full rounded-sm object-cover"
              />
              <p className="mt-1 truncate text-[10px] leading-tight text-muted-foreground">
                {p.page_number}.{" "}
                {p.doc_type
                  ? (DOCUMENT_TYPES[p.doc_type as DocumentType] ?? p.doc_type)
                  : "unclassified"}
              </p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
