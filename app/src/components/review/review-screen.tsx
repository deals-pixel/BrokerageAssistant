"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ProcessDealButton } from "@/components/process-deal-button";
import { toast } from "sonner";
import {
  FIELD_SECTIONS,
  DOCUMENT_TYPES,
  type Confidence,
  type DocumentType,
} from "@/lib/types";
import type { ChecklistItem } from "@/lib/checklist";
import { PagePanel } from "./page-panel";

type DealRow = {
  id: string;
  file_name: string;
  status: string;
  transaction_type: string;
  property_address: string | null;
  page_count: number | null;
  error_message: string | null;
};

type PageRow = { page_number: number; doc_type: string | null; doc_confidence: string | null };

type FieldRow = {
  field_key: string;
  value: string | null;
  confidence: Confidence;
  source_doc_type: string | null;
  source_page: number | null;
  needs_review: boolean;
  notes: string | null;
};

// Green = high confidence, yellow = needs review, red = missing (per plan).
function fieldTone(f: FieldRow | undefined): string {
  if (!f || f.value == null || f.value === "") return "border-red-300 bg-red-50";
  if (f.needs_review || f.confidence !== "high") return "border-yellow-300 bg-yellow-50";
  return "border-green-300 bg-green-50";
}

export function ReviewScreen({
  deal,
  pages,
  fields,
  checklist,
}: {
  deal: DealRow;
  pages: PageRow[];
  fields: FieldRow[];
  checklist: ChecklistItem[];
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [selectedPage, setSelectedPage] = useState<number | null>(
    pages.length > 0 ? pages[0].page_number : null,
  );

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);

  const currentValue = (key: string) =>
    edited[key] !== undefined ? edited[key] : (fieldMap.get(key)?.value ?? "");

  const dirty = Object.keys(edited).length > 0;

  async function saveEdits(markReviewed: boolean) {
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    try {
      for (const [key, value] of Object.entries(edited)) {
        const existing = fieldMap.get(key);
        if (existing) {
          const { error } = await supabase
            .from("deal_fields")
            .update({
              value: value || null,
              needs_review: false,
              confidence: "high",
              edited_by: user?.id,
              edited_at: new Date().toISOString(),
            })
            .eq("deal_id", deal.id)
            .eq("field_key", key);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("deal_fields").insert({
            deal_id: deal.id,
            field_key: key,
            value: value || null,
            confidence: "high",
            needs_review: false,
            edited_by: user?.id,
            edited_at: new Date().toISOString(),
          });
          if (error) throw new Error(error.message);
        }
      }

      const newStatus = markReviewed ? "reviewed" : "in_review";
      await supabase.from("deals").update({ status: newStatus }).eq("id", deal.id);
      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        deal_id: deal.id,
        action: markReviewed ? "deal_reviewed" : "fields_edited",
        details: { edited_fields: Object.keys(edited) },
      });

      toast.success(markReviewed ? "Deal marked as reviewed." : "Edits saved.");
      setEdited({});
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function copySummary() {
    const res = await fetch(`/api/deals/${deal.id}/export?format=summary`);
    if (!res.ok) {
      toast.error("Could not build summary");
      return;
    }
    await navigator.clipboard.writeText(await res.text());
    toast.success("Summary copied to clipboard.");
  }

  const missingRequired = checklist.filter((c) => c.required && !c.found);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              &lt;- Dashboard
            </Link>
            <h1 className="text-xl font-semibold">
              {deal.property_address ?? deal.file_name}
            </h1>
            <Badge className="capitalize">{deal.transaction_type}</Badge>
            <Badge variant="outline">{deal.status}</Badge>
          </div>
          {deal.error_message && (
            <p className="mt-1 text-sm text-destructive">Error: {deal.error_message}</p>
          )}
        </div>
        <div className="flex gap-2">
          <ProcessDealButton
            dealId={deal.id}
            status={deal.status}
            pageCount={deal.page_count}
            variant={deal.status === "uploaded" ? "default" : "outline"}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveEdits(false)}
            disabled={!dirty || saving}
          >
            Save edits
          </Button>
          <Button size="sm" onClick={() => saveEdits(true)} disabled={saving}>
            Mark reviewed
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              Document checklist{" "}
              {missingRequired.length > 0 ? (
                <span className="text-sm font-normal text-destructive">
                  ({missingRequired.length} required missing)
                </span>
              ) : (
                <span className="text-sm font-normal text-green-600">(complete)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {checklist.map((item) => (
              <button
                key={item.docType}
                type="button"
                className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-muted"
                onClick={() => item.pages[0] && setSelectedPage(item.pages[0])}
              >
                <span
                  className={
                    item.found
                      ? "text-green-600"
                      : item.required
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {item.found ? "Yes" : "No"}
                </span>
                <span className={!item.found && item.required ? "font-medium" : ""}>
                  {item.label}
                </span>
                {item.pages.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    p.{item.pages.join(", ")}
                  </span>
                )}
                {!item.required && (
                  <span className="text-xs text-muted-foreground">(optional)</span>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Update package documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <UploadDropzone dealId={deal.id} compact />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[440px_1fr]">
        {/* Left: page preview */}
        <div className="space-y-3 self-start lg:sticky lg:top-4">
          <PagePanel
            dealId={deal.id}
            pages={pages}
            selectedPage={selectedPage}
            onSelect={setSelectedPage}
          />
        </div>

        {/* Right: fields form */}
        <div className="space-y-4">
          {FIELD_SECTIONS.map((section) => (
            <Card key={section.title}>
              <CardHeader className="py-3">
                <CardTitle className="text-base">{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {section.fields.map((f) => {
                  const row = fieldMap.get(f.key);
                  const tone =
                    fieldTone(row) + (edited[f.key] !== undefined ? " ring-2 ring-blue-300" : "");
                  return (
                    <div key={f.key} className={`space-y-1 ${f.wide ? "md:col-span-2" : ""}`}>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">
                          {f.label}
                        </label>
                        {row?.source_page != null && (
                          <button
                            type="button"
                            className="text-xs text-blue-600 hover:underline"
                            onClick={() => setSelectedPage(row.source_page)}
                            title={
                              row.source_doc_type
                                ? DOCUMENT_TYPES[row.source_doc_type as DocumentType]
                                : undefined
                            }
                          >
                            p.{row.source_page}
                          </button>
                        )}
                      </div>
                      {f.multiline ? (
                        <Textarea
                          className={`min-h-20 ${tone}`}
                          value={currentValue(f.key)}
                          onChange={(e) =>
                            setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          className={tone}
                          value={currentValue(f.key)}
                          onChange={(e) =>
                            setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      )}
                      {row?.notes && (
                        <p className="text-xs text-amber-700">{row.notes}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      {/* Bottom: export */}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Export</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/deals/${deal.id}/export?format=csv`} />}
            >
              Download CSV
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/deals/${deal.id}/export?format=pdf`} />}
            >
              Deal Sheet PDF
            </Button>
            <Button variant="outline" onClick={copySummary}>
              Copy summary
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              CSV column order matches the Deal Information Sheet for Lone Wolf entry.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
