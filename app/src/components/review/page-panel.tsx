"use client";

import { DOCUMENT_TYPES, type DocumentType } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";

type PageRow = { page_number: number; doc_type: string | null; doc_confidence: string | null };

export function PagePanel({
  dealId,
  pages,
  selectedPage,
  onSelect,
}: {
  dealId: string;
  pages: PageRow[];
  selectedPage: number | null;
  onSelect: (page: number) => void;
}) {
  const imageUrl = (page: number) => `/api/deals/${dealId}/pages/${page}/image`;

  return (
    <Card className="self-start lg:sticky lg:top-4">
      <CardContent className="space-y-3 p-3">
        {selectedPage != null && (
          <div className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs expire; bypass image optimizer */}
            <img
              src={imageUrl(selectedPage)}
              alt={`Page ${selectedPage}`}
              className="w-full rounded border"
            />
            <p className="text-center text-xs text-muted-foreground">
              Page {selectedPage}
              {(() => {
                const dt = pages.find((p) => p.page_number === selectedPage)?.doc_type;
                return dt ? ` — ${DOCUMENT_TYPES[dt as DocumentType] ?? dt}` : "";
              })()}
            </p>
          </div>
        )}
        <div className="grid max-h-[420px] grid-cols-4 gap-2 overflow-y-auto">
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
