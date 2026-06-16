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
  type FieldSourceCandidate,
  type SourceBox,
} from "@/lib/types";
import type { ChecklistResult } from "@/lib/checklist";
import { PagePanel } from "./page-panel";

type DealRow = {
  id: string;
  file_name: string;
  status: string;
  transaction_type: string;
  scenario_key: string | null;
  scenario_label: string | null;
  property_address: string | null;
  page_count: number | null;
  error_message: string | null;
};

type PageRow = {
  page_number: number;
  doc_type: string | null;
  doc_confidence: string | null;
  standard_form_key?: string | null;
  standard_form_number?: string | null;
  standard_form_title?: string | null;
  standard_form_confidence?: string | null;
};

type FieldRow = {
  field_key: string;
  value: string | null;
  confidence: Confidence;
  source_doc_type: string | null;
  source_page: number | null;
  source_box: SourceBox | null;
  conflict_sources: FieldSourceCandidate[] | null;
  needs_review: boolean;
  notes: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "completed" | "dismissed";
  document_type: string | null;
  requirement_id: string | null;
  auto_created: boolean;
  created_at: string;
  completed_at: string | null;
};

type ReminderRow = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: "draft" | "sent";
  drafted_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type AgentRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  brokerage: string | null;
};

type AuditLogRow = {
  id: number;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
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
  checklistResult,
  tasks,
  reminders,
  agents,
  auditLogs,
}: {
  deal: DealRow;
  pages: PageRow[];
  fields: FieldRow[];
  checklistResult: ChecklistResult;
  tasks: TaskRow[];
  reminders: ReminderRow[];
  agents: AgentRow[];
  auditLogs: AuditLogRow[];
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null);
  const [draftingReminder, setDraftingReminder] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(
    pages.length > 0 ? pages[0].page_number : null,
  );

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const checklist = checklistResult.items;
  const missingRequired = checklistResult.missingRequired;
  const openTasks = tasks.filter((task) => task.status === "open");
  const documentGroups = useMemo(() => groupDocuments(pages), [pages]);
  const latestReminder = reminders.find((reminder) => reminder.sent_at) ?? reminders[0];
  const selectedField = selectedFieldKey ? fieldMap.get(selectedFieldKey) : null;
  const selectedConflictSource =
    selectedField && selectedSourceIndex != null
      ? validConflictSources(selectedField.conflict_sources)[selectedSourceIndex]
      : null;
  const activeSource = selectedConflictSource ?? fieldToSourceCandidate(selectedField);
  const activeSourceBox =
    activeSource?.sourcePage === selectedPage && isSourceBox(activeSource.sourceBox)
      ? activeSource.sourceBox
      : null;

  const currentValue = (key: string) =>
    edited[key] !== undefined ? edited[key] : (fieldMap.get(key)?.value ?? "");

  const dirty = Object.keys(edited).length > 0;

  function jumpToFieldSource(row: FieldRow | undefined, fieldKey?: string) {
    if (row?.source_page == null) return;
    setSelectedFieldKey(fieldKey ?? row.field_key);
    setSelectedSourceIndex(null);
    setSelectedPage(row.source_page);
  }

  function jumpToConflictSource(fieldKey: string, source: FieldSourceCandidate, index: number) {
    if (source.sourcePage == null) return;
    setSelectedFieldKey(fieldKey);
    setSelectedSourceIndex(index);
    setSelectedPage(source.sourcePage);
  }

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
              conflict_sources: null,
              edited_by: user?.id,
              edited_at: new Date().toISOString(),
              notes: null,
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

  async function syncTasks() {
    const res = await fetch(`/api/deals/${deal.id}/tasks/sync`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Could not sync tasks");
      return;
    }
    toast.success("Tasks synced from missing documents.");
    router.refresh();
  }

  async function updateTask(taskId: string, status: "completed" | "dismissed" | "open") {
    setWorkingTaskId(taskId);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    try {
      const { error } = await supabase
        .from("deal_tasks")
        .update({
          status,
          completed_at: status === "completed" ? new Date().toISOString() : null,
        })
        .eq("id", taskId);
      if (error) throw new Error(error.message);

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        deal_id: deal.id,
        action: `task_${status}`,
        details: { task_id: taskId },
      });
      toast.success(status === "completed" ? "Task completed." : "Task updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update task");
    } finally {
      setWorkingTaskId(null);
    }
  }

  async function generateReminderDraft() {
    setDraftingReminder(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/reminders/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentId || null,
          recipient: recipient || null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not create reminder draft");
      toast.success("Reminder draft created.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create reminder draft");
    } finally {
      setDraftingReminder(false);
    }
  }

  async function markSent(reminderId: string) {
    setSendingReminderId(reminderId);
    try {
      const res = await fetch(`/api/deals/${deal.id}/reminders/${reminderId}/send`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not mark reminder sent");
      toast.success("Reminder marked sent.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark reminder sent");
    } finally {
      setSendingReminderId(null);
    }
  }

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
            <Badge variant="secondary">{checklistResult.scenario.shortLabel}</Badge>
            <Badge variant="outline">{deal.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Scenario: {deal.scenario_label ?? checklistResult.scenario.label} | Completion{" "}
            {checklistResult.completionPct}%
            {latestReminder ? ` | Last reminder: ${relativeTime(latestReminder.sent_at ?? latestReminder.drafted_at ?? latestReminder.created_at)}` : ""}
          </p>
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.9fr_0.9fr]">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">
              Required Documents{" "}
              {missingRequired.length > 0 ? (
                <span className="text-sm font-normal text-destructive">
                  ({missingRequired.length} missing)
                </span>
              ) : (
                <span className="text-sm font-normal text-green-700">(ready)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-1 overflow-y-auto">
            {checklist.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setSelectedFieldKey(null);
                  setSelectedSourceIndex(null);
                  if (item.pages[0]) setSelectedPage(item.pages[0]);
                }}
              >
                <span
                  className={
                    item.found
                      ? "text-green-700"
                      : item.required
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {item.found ? "Found" : "Missing"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={!item.found && item.required ? "font-medium" : ""}>
                    {item.label}
                  </span>
                  {item.condition && (
                    <span className="block text-xs text-muted-foreground">{item.condition}</span>
                  )}
                  {item.standardForms?.length ? (
                    <span className="block text-xs text-muted-foreground">
                      Standard: {item.standardForms.join("; ")}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.pages.length > 0
                    ? `p.${item.pages.join(", ")}`
                    : item.conditional
                      ? "conditional"
                      : item.required
                        ? "required"
                        : "optional"}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-base">Tasks</CardTitle>
            <Button size="sm" variant="outline" onClick={syncTasks}>
              Sync
            </Button>
          </CardHeader>
          <CardContent className="max-h-80 space-y-2 overflow-y-auto">
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <div key={task.id} className="rounded border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{task.title}</p>
                      {task.description && (
                        <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                      )}
                    </div>
                    <Badge variant={task.status === "open" ? "destructive" : "secondary"}>
                      {task.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task.status !== "completed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateTask(task.id, "completed")}
                        disabled={workingTaskId === task.id}
                      >
                        Complete
                      </Button>
                    )}
                    {task.status === "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateTask(task.id, "dismissed")}
                        disabled={workingTaskId === task.id}
                      >
                        Dismiss
                      </Button>
                    )}
                    {task.status !== "open" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateTask(task.id, "open")}
                        disabled={workingTaskId === task.id}
                      >
                        Reopen
                      </Button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No tasks yet. Sync after processing to create missing-document tasks.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Reminder Email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedAgentId}
                onChange={(event) => setSelectedAgentId(event.target.value)}
              >
                <option value="">Choose agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} - {agent.email}
                  </option>
                ))}
              </select>
              <Input
                placeholder="or enter recipient email"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
              <Button onClick={generateReminderDraft} disabled={draftingReminder || openTasks.length === 0}>
                Generate Draft
              </Button>
            </div>
            <Separator />
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {reminders.length > 0 ? (
                reminders.map((reminder) => (
                  <div key={reminder.id} className="rounded border p-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{reminder.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {reminder.recipient} | {relativeTime(reminder.sent_at ?? reminder.drafted_at ?? reminder.created_at)}
                        </p>
                      </div>
                      <Badge variant={reminder.status === "sent" ? "secondary" : "outline"}>
                        {reminder.status}
                      </Badge>
                    </div>
                    {reminder.status === "draft" && (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        onClick={() => markSent(reminder.id)}
                        disabled={sendingReminderId === reminder.id}
                      >
                        Send
                      </Button>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No reminder drafts yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Documents</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {documentGroups.length > 0 ? (
              documentGroups.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className="rounded border p-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    setSelectedFieldKey(null);
                    setSelectedSourceIndex(null);
                    setSelectedPage(group.pages[0]);
                  }}
                >
                  <p className="font-medium">{group.label}</p>
                  <p className="text-xs text-muted-foreground">Pages {group.pages.join(", ")}</p>
                  {group.standardForms.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Standard: {group.standardForms.join("; ")}
                    </p>
                  )}
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No uploaded pages yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Update Package Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <UploadDropzone dealId={deal.id} compact />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(560px,0.95fr)_1fr]">
        {/* Left: page preview */}
        <div className="space-y-3 self-start lg:sticky lg:top-4">
          <PagePanel
            dealId={deal.id}
            pages={pages}
            selectedPage={selectedPage}
            highlight={activeSourceBox}
            onSelect={(page) => {
              setSelectedFieldKey(null);
              setSelectedSourceIndex(null);
              setSelectedPage(page);
            }}
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
                  const inputId = `field-${f.key}`;
                  const sourceLabel = row?.source_doc_type
                    ? DOCUMENT_TYPES[row.source_doc_type as DocumentType] ?? row.source_doc_type
                    : null;
                  const conflictSources = validConflictSources(row?.conflict_sources);
                  const tone =
                    fieldTone(row) + (edited[f.key] !== undefined ? " ring-2 ring-blue-300" : "");
                  return (
                    <div key={f.key} className={`space-y-1 ${f.wide ? "md:col-span-2" : ""}`}>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor={inputId}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {f.label}
                        </label>
                        {row?.source_page != null && (
                          <button
                            type="button"
                            className="text-xs text-blue-600 hover:underline"
                            onClick={() => jumpToFieldSource(row, f.key)}
                            title={sourceLabel ?? undefined}
                          >
                            p.{row.source_page}
                          </button>
                        )}
                      </div>
                      {f.multiline ? (
                        <Textarea
                          id={inputId}
                          className={`min-h-20 ${tone}`}
                          title={
                            row?.source_page != null
                              ? `Source: ${sourceLabel ?? "uploaded document"}, page ${row.source_page}`
                              : undefined
                          }
                          value={currentValue(f.key)}
                          onFocus={() => jumpToFieldSource(row, f.key)}
                          onChange={(e) =>
                            setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          id={inputId}
                          className={tone}
                          title={
                            row?.source_page != null
                              ? `Source: ${sourceLabel ?? "uploaded document"}, page ${row.source_page}`
                              : undefined
                          }
                          value={currentValue(f.key)}
                          onFocus={() => jumpToFieldSource(row, f.key)}
                          onChange={(e) =>
                            setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))
                          }
                        />
                      )}
                      {row?.notes && (
                        <p className="text-xs text-amber-700">{row.notes}</p>
                      )}
                      {conflictSources.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                          {conflictSources.map((source, index) => {
                            const active =
                              selectedFieldKey === f.key && selectedSourceIndex === index;
                            const label = source.sourceDocumentType
                              ? DOCUMENT_TYPES[source.sourceDocumentType] ?? source.sourceDocumentType
                              : "Source";
                            return (
                              <button
                                key={`${source.sourceDocumentType ?? "source"}-${source.sourcePage ?? "?"}-${index}`}
                                type="button"
                                className={`max-w-full rounded border px-2 py-1 text-left text-[11px] leading-tight ${
                                  active
                                    ? "border-amber-500 bg-amber-100 text-amber-950"
                                    : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                                }`}
                                onClick={() => jumpToConflictSource(f.key, source, index)}
                                title={`${label}${source.sourcePage ? ` p.${source.sourcePage}` : ""}: ${source.value}`}
                              >
                                <span className="font-medium">
                                  Source {index + 1}
                                  {source.sourcePage ? ` p.${source.sourcePage}` : ""}
                                </span>
                                <span className="ml-1 text-amber-800">
                                  {truncateSourceValue(source.value)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
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

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Activity Log</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {auditLogs.length > 0 ? (
            auditLogs.map((log) => (
              <div key={log.id} className="rounded border p-2 text-sm">
                <p className="font-medium">{formatAction(log.action)}</p>
                <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString()}</p>
                {log.details && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {summarizeDetails(log.details)}
                  </p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No activity available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function fieldToSourceCandidate(row: FieldRow | null | undefined): FieldSourceCandidate | null {
  if (!row || row.source_page == null) return null;
  return {
    value: row.value ?? "",
    confidence: row.confidence,
    sourceDocumentType: row.source_doc_type ? (row.source_doc_type as DocumentType) : undefined,
    sourcePage: row.source_page,
    sourceBox: row.source_box,
  };
}

function validConflictSources(
  sources: FieldSourceCandidate[] | null | undefined,
): FieldSourceCandidate[] {
  if (!Array.isArray(sources)) return [];
  return sources.filter((source) => source && source.value && source.sourcePage != null);
}

function isSourceBox(value: SourceBox | null | undefined): value is SourceBox {
  if (!value) return false;
  const { x, y, width, height } = value;
  return (
    [x, y, width, height].every((n) => Number.isFinite(n)) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1 &&
    y + height <= 1
  );
}

function truncateSourceValue(value: string) {
  return value.length > 34 ? `${value.slice(0, 31)}...` : value;
}

function groupDocuments(pages: PageRow[]) {
  const groups = new Map<
    string,
    { key: string; label: string; pages: number[]; standardForms: string[] }
  >();
  for (const page of pages) {
    const key = page.doc_type ?? "unclassified";
    const label = page.doc_type
      ? (DOCUMENT_TYPES[page.doc_type as DocumentType] ?? page.doc_type)
      : "Unclassified";
    const existing = groups.get(key) ?? { key, label, pages: [], standardForms: [] };
    existing.pages.push(page.page_number);
    const standardFormLabel = formatStandardFormLabel(page);
    if (standardFormLabel && !existing.standardForms.includes(standardFormLabel)) {
      existing.standardForms.push(standardFormLabel);
    }
    groups.set(key, existing);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    pages: group.pages.sort((a, b) => a - b),
  }));
}

function relativeTime(value: string | null) {
  if (!value) return "not sent";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatAction(action: string) {
  return action
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeDetails(details: Record<string, unknown>) {
  const entries = Object.entries(details).slice(0, 3);
  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
      if (value && typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${String(value)}`;
    })
    .join(" | ");
}

function formatStandardFormLabel(page: PageRow) {
  if (!page.standard_form_title && !page.standard_form_number) return "";
  const number = page.standard_form_number ? `Form ${page.standard_form_number}` : "";
  const title = page.standard_form_title ?? "";
  if (number && title) return `${number} ${title}`;
  return number || title;
}
