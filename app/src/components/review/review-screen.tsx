"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, CheckIcon, Clock3Icon, DownloadIcon, FileTextIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDropzone } from "@/components/upload-dropzone";
import { ProcessDealButton } from "@/components/process-deal-button";
import { EmailAttachmentIngestButton } from "@/components/email-attachment-ingest-button";
import { SubmitArchiveButton } from "@/components/submit-archive-button";
import { toast } from "sonner";
import {
  FIELD_SECTIONS,
  DOCUMENT_TYPES,
  type Confidence,
  type DocumentType,
  type FieldSourceCandidate,
  type SourceBox,
} from "@/lib/types";
import type { ChecklistItem, ChecklistResult } from "@/lib/checklist";
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
  email_attachment_id?: string | null;
  standard_form_key?: string | null;
  standard_form_number?: string | null;
  standard_form_title?: string | null;
  standard_form_confidence?: string | null;
  classification_reviewed_at?: string | null;
  classification_reviewed_by?: string | null;
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
  edited_at?: string | null;
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

type RequirementStatusRow = {
  requirement_id: string;
  lonewolf_status: "not_required" | "pending_upload" | "uploaded" | "unknown";
  lonewolf_uploaded_at: string | null;
  lonewolf_uploaded_by: string | null;
};

type EmailAttachmentRow = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  status: string;
  ignore_reason: string | null;
  light_classification_type: string | null;
  light_classification_confidence: number | null;
  received_at: string | null;
  created_at: string;
};

type PackageFilter =
  | "all"
  | "uploaded_matched"
  | "outstanding"
  | "not_required"
  | "needs_review"
  | "pending_lonewolf";

type PackageBucket = "uploaded_matched" | "needs_review" | "outstanding" | "not_required";

type PackageDocumentRow = {
  id: string;
  requirementId: string;
  label: string;
  documentLabel: string;
  docTypes: DocumentType[];
  requirementLevel: ChecklistItem["level"];
  condition?: string;
  loneWolfLabel: string;
  pages: number[];
  found: boolean;
  missing: boolean;
  needsReview: boolean;
  pendingLoneWolf: boolean;
  unprocessed: boolean;
  reminderNeeded: boolean;
  canMarkLoneWolfUploaded: boolean;
  classificationReviewed: boolean;
};

type FieldStatusTone = "confirmed" | "review" | "missing" | "neutral";

type FieldStatus = {
  tone: FieldStatusTone;
  label: string;
  detail: string;
  className: string;
};

export function ReviewScreen({
  deal,
  pages,
  fields,
  checklistResult,
  tasks,
  reminders,
  agents,
  requirementStatuses,
  emailAttachments,
  auditLogs,
  initialReminderOpen = false,
}: {
  deal: DealRow;
  pages: PageRow[];
  fields: FieldRow[];
  checklistResult: ChecklistResult;
  tasks: TaskRow[];
  reminders: ReminderRow[];
  agents: AgentRow[];
  requirementStatuses: RequirementStatusRow[];
  emailAttachments: EmailAttachmentRow[];
  auditLogs: AuditLogRow[];
  initialReminderOpen?: boolean;
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savingFieldKey, setSavingFieldKey] = useState<string | null>(null);
  const [workingTaskId, setWorkingTaskId] = useState<string | null>(null);
  const [draftingReminder, setDraftingReminder] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [packageFilter, setPackageFilter] = useState<PackageFilter>("all");
  const [workingRequirementId, setWorkingRequirementId] = useState<string | null>(null);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(initialReminderOpen);
  const [reminderContext, setReminderContext] = useState<PackageDocumentRow | null>(null);
  const [classificationReviewRow, setClassificationReviewRow] = useState<PackageDocumentRow | null>(null);
  const [classificationReviewPage, setClassificationReviewPage] = useState<number | null>(null);
  const [overrideDocType, setOverrideDocType] = useState<DocumentType>("other");
  const [savingClassification, setSavingClassification] = useState(false);
  const [selectedPage, setSelectedPage] = useState<number | null>(
    pages.length > 0 ? pages[0].page_number : null,
  );

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const requirementStatusMap = useMemo(
    () => new Map(requirementStatuses.map((status) => [status.requirement_id, status])),
    [requirementStatuses],
  );
  const checklist = checklistResult.items;
  const openTasks = tasks.filter((task) => task.status === "open");
  const packageRows = useMemo(
    () =>
      buildPackageDocumentRows({
        checklist,
        dealStatus: deal.status,
        pages,
        tasks,
        reminders,
        requirementStatuses: requirementStatusMap,
      }),
    [checklist, deal.status, pages, reminders, requirementStatusMap, tasks],
  );
  const packageSummary = useMemo(() => summarizePackageRows(packageRows), [packageRows]);
  const sortedAuditLogs = useMemo(() => sortAuditLogs(auditLogs), [auditLogs]);
  const latestReminder = reminders.find((reminder) => reminder.sent_at) ?? reminders[0];
  const pageLabelByNumber = useMemo(() => buildPageLabelMap(pages), [pages]);
  const renderedEmailAttachmentIds = useMemo(
    () =>
      pages
        .map((page) => page.email_attachment_id)
        .filter((id): id is string => Boolean(id)),
    [pages],
  );
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

  async function persistFieldEdits(entries: [string, string][]) {
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    for (const [key, value] of entries) {
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

    await supabase.from("audit_logs").insert({
      user_id: user?.id,
      deal_id: deal.id,
      action: "fields_edited",
      details: { edited_fields: entries.map(([key]) => key) },
    });
  }

  async function saveEdits() {
    const entries = Object.entries(edited);
    if (entries.length === 0) return;

    try {
      await persistFieldEdits(entries);
      toast.success("Edits saved.");
      setEdited({});
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveFieldEdit(fieldKey: string) {
    if (edited[fieldKey] === undefined) return;
    setSavingFieldKey(fieldKey);
    try {
      await persistFieldEdits([[fieldKey, edited[fieldKey]]]);
      toast.success("Field override saved.");
      setEdited((prev) => {
        const next = { ...prev };
        delete next[fieldKey];
        return next;
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingFieldKey(null);
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

  function openReminderDialog(row: PackageDocumentRow) {
    setReminderContext(row);
    setReminderDialogOpen(true);
  }

  function openClassificationReview(row: PackageDocumentRow) {
    const firstPage = row.pages[0] ?? null;
    const currentPage = firstPage != null ? pages.find((page) => page.page_number === firstPage) : null;
    setClassificationReviewRow(row);
    setClassificationReviewPage(firstPage);
    setOverrideDocType((currentPage?.doc_type as DocumentType | null) ?? row.docTypes[0] ?? "other");
    if (firstPage != null) {
      setSelectedFieldKey(null);
      setSelectedSourceIndex(null);
      setSelectedPage(firstPage);
    }
  }

  async function saveClassificationOverride() {
    if (!classificationReviewRow || classificationReviewRow.pages.length === 0) return;
    setSavingClassification(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("deal_pages")
        .update({
          doc_type: overrideDocType,
          doc_confidence: "high",
          standard_form_key: null,
          standard_form_number: null,
          standard_form_title: null,
          standard_form_confidence: null,
          classification_reviewed_at: new Date().toISOString(),
          classification_reviewed_by: user?.id ?? null,
        })
        .eq("deal_id", deal.id)
        .in("page_number", classificationReviewRow.pages);
      if (error) throw new Error(error.message);

      await supabase.from("audit_logs").insert({
        user_id: user?.id,
        deal_id: deal.id,
        action: "document_classification_overridden",
        details: {
          requirement_id: classificationReviewRow.requirementId,
          pages: classificationReviewRow.pages,
          override_doc_type: overrideDocType,
        },
      });

      const syncRes = await fetch(`/api/deals/${deal.id}/tasks/sync`, { method: "POST" });
      if (!syncRes.ok) {
        const body = await syncRes.json().catch(() => null);
        throw new Error(body?.error ?? "Classification saved, but tasks could not be synced");
      }
      toast.success("Document classification updated.");
      setClassificationReviewRow(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update classification");
    } finally {
      setSavingClassification(false);
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

  async function markLoneWolfUploaded(requirementId: string) {
    setWorkingRequirementId(requirementId);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/requirements/${encodeURIComponent(requirementId)}/lonewolf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "uploaded" }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not mark uploaded");
      toast.success("Marked uploaded to Lone Wolf.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not mark uploaded");
    } finally {
      setWorkingRequirementId(null);
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
            onClick={() => saveEdits()}
            disabled={!dirty || saving}
          >
            Save edits
          </Button>
        </div>
      </header>

      <PackageDocumentsPanel
        rows={packageRows}
        summary={packageSummary}
        activeFilter={packageFilter}
        onFilterChange={setPackageFilter}
        onMarkLoneWolfUploaded={markLoneWolfUploaded}
        onGenerateReminder={openReminderDialog}
        onReviewMatch={openClassificationReview}
        workingRequirementId={workingRequirementId}
        draftingReminder={draftingReminder}
      />

      <ReminderDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        context={reminderContext}
        agents={agents}
        reminders={reminders}
        openTasks={openTasks}
        selectedAgentId={selectedAgentId}
        onSelectedAgentChange={setSelectedAgentId}
        recipient={recipient}
        onRecipientChange={setRecipient}
        onGenerateDraft={generateReminderDraft}
        draftingReminder={draftingReminder}
        onMarkSent={markSent}
        sendingReminderId={sendingReminderId}
      />

      <ClassificationReviewDialog
        dealId={deal.id}
        row={classificationReviewRow}
        pages={pages}
        selectedPage={classificationReviewPage}
        selectedDocType={overrideDocType}
        saving={savingClassification}
        onOpenChange={(open) => {
          if (!open) setClassificationReviewRow(null);
        }}
        onSelectedPageChange={(page) => {
          setClassificationReviewPage(page);
          setSelectedFieldKey(null);
          setSelectedSourceIndex(null);
          setSelectedPage(page);
        }}
        onSelectedDocTypeChange={setOverrideDocType}
        onSave={saveClassificationOverride}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
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

        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Update Package Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <UploadDropzone dealId={deal.id} compact />
            </CardContent>
          </Card>

          <EmailAttachmentsPanel
            dealId={deal.id}
            attachments={emailAttachments}
            renderedAttachmentIds={renderedEmailAttachmentIds}
          />
        </div>
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
          <Card>
            <CardContent className="flex flex-wrap gap-x-5 gap-y-2 p-3">
              <FieldStatusLegendItem tone="confirmed" label="Confirmed" />
              <FieldStatusLegendItem tone="review" label="Needs review" />
              <FieldStatusLegendItem tone="missing" label="Missing - required" />
              <FieldStatusLegendItem tone="neutral" label="Not applicable" />
            </CardContent>
          </Card>

          {FIELD_SECTIONS.map((section) => (
            <Card key={section.title}>
              <CardHeader className="py-4">
                <CardTitle className="text-base">{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {section.fields.map((f) => {
                  const row = fieldMap.get(f.key);
                  const inputId = `field-${f.key}`;
                  const sourceLabel = row?.source_doc_type
                    ? documentTypeLabel(row.source_doc_type)
                    : row?.source_page != null
                      ? pageLabelByNumber.get(row.source_page)
                      : null;
                  const conflictSources = validConflictSources(row?.conflict_sources);
                  const fieldStatus = getFieldStatus(f.key, row, conflictSources.length, fieldMap);
                  const fieldDirty = edited[f.key] !== undefined;
                  const fieldSaving = savingFieldKey === f.key;
                  const inputClassName =
                    fieldStatus.className +
                    (fieldDirty ? " ring-2 ring-blue-300" : "");
                  return (
                    <div
                      key={f.key}
                      className={`rounded-md border p-3 ${fieldShellClass(fieldStatus.tone)} ${
                        f.wide ? "md:col-span-2" : ""
                      }`}
                    >
                      <div className="mb-2">
                        <label
                          htmlFor={inputId}
                          className="text-sm font-medium leading-tight text-foreground"
                        >
                          {f.label}
                        </label>
                      </div>
                      <div className={f.multiline ? "flex items-start gap-2" : "flex items-center gap-2"}>
                        {f.multiline ? (
                          <Textarea
                            id={inputId}
                            className={`min-h-20 flex-1 ${inputClassName}`}
                            title={
                              row?.source_page != null
                                ? `Source: ${sourceLabel ?? "uploaded document"}`
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
                            className={`flex-1 ${inputClassName}`}
                            title={
                              row?.source_page != null
                                ? `Source: ${sourceLabel ?? "uploaded document"}`
                                : undefined
                            }
                            value={currentValue(f.key)}
                            onFocus={() => jumpToFieldSource(row, f.key)}
                            onChange={(e) =>
                              setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))
                            }
                          />
                        )}
                        {fieldDirty && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => saveFieldEdit(f.key)}
                            disabled={saving || fieldSaving}
                          >
                            {fieldSaving ? "Saving..." : "Save"}
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex items-start gap-2 text-xs">
                        <FieldStatusDot tone={fieldStatus.tone} className="mt-1" />
                        <div>
                          <p className={fieldStatusTextClass(fieldStatus.tone)}>
                            {fieldStatus.label}
                          </p>
                          <p className="text-muted-foreground">{fieldStatus.detail}</p>
                        </div>
                      </div>
                      {row?.notes && (
                        <p className="mt-2 text-xs text-amber-800">{row.notes}</p>
                      )}
                      {conflictSources.length > 1 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs text-amber-800">
                            {conflictSources.length} sources disagree
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                          {conflictSources.map((source, index) => {
                            const active =
                              selectedFieldKey === f.key && selectedSourceIndex === index;
                            const label = source.sourceDocumentType
                              ? documentTypeLabel(source.sourceDocumentType)
                              : source.sourcePage != null
                                ? pageLabelByNumber.get(source.sourcePage) ?? "Source document"
                                : "Source document";
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
                                title={`${label}: ${source.value}`}
                              >
                                <span className="font-medium">
                                  {label}
                                </span>
                                <span className="ml-1 text-amber-800">
                                  {truncateSourceValue(source.value)}
                                </span>
                              </button>
                            );
                          })}
                          </div>
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
            <CardTitle className="text-base">Export & Submission</CardTitle>
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
            <SubmitArchiveButton
              dealId={deal.id}
              disabled={deal.status === "exported"}
              warningItems={checklistResult.missingRequired.map((item) => item.label)}
            />
            <p className="w-full text-xs text-muted-foreground">
              Downloads are read-only. Use Submit & archive when the transaction is complete and ready to leave the
              active workspace.
            </p>
            {checklistResult.missingRequired.length > 0 && (
              <p className="w-full text-xs text-muted-foreground">
                This transaction has missing required documents. Submit & archive is still available, but requires
                confirmation.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Activity Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedAuditLogs.length > 0 ? (
            <ol className="divide-y">
              {sortedAuditLogs.map((log) => (
                <li
                  key={log.id}
                  className="grid gap-1 px-4 py-3 text-sm md:grid-cols-[190px_1fr] md:gap-4"
                >
                  <time className="text-xs text-muted-foreground" dateTime={log.created_at}>
                    {formatTimestamp(log.created_at)}
                  </time>
                  <div className="min-w-0">
                    <p className="font-medium">{formatAction(log.action)}</p>
                    {log.details && (
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {summarizeDetails(log.details)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No activity available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PackageDocumentsPanel({
  rows,
  summary,
  activeFilter,
  onFilterChange,
  onMarkLoneWolfUploaded,
  onGenerateReminder,
  onReviewMatch,
  workingRequirementId,
  draftingReminder,
}: {
  rows: PackageDocumentRow[];
  summary: string;
  activeFilter: PackageFilter;
  onFilterChange: (filter: PackageFilter) => void;
  onMarkLoneWolfUploaded: (requirementId: string) => void;
  onGenerateReminder: (row: PackageDocumentRow) => void;
  onReviewMatch: (row: PackageDocumentRow) => void;
  workingRequirementId: string | null;
  draftingReminder: boolean;
}) {
  const filteredRows = filterPackageRows(rows, activeFilter);
  const groups = buildPackageGroups(filteredRows);
  const counts = packageFilterCounts(rows);
  const filters: { id: PackageFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "uploaded_matched", label: "Uploaded & matched", count: counts.uploadedMatched },
    { id: "outstanding", label: "Outstanding", count: counts.outstanding },
    { id: "not_required", label: "Not required", count: counts.notRequired },
    ...(counts.needsReview > 0
      ? [{ id: "needs_review" as const, label: "Needs review", count: counts.needsReview }]
      : []),
    ...(counts.pendingLoneWolf > 0
      ? [
          {
            id: "pending_lonewolf" as const,
            label: "Pending Lone Wolf",
            count: counts.pendingLoneWolf,
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Package Documents</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                size="sm"
                variant={activeFilter === filter.id ? "default" : "outline"}
                onClick={() => onFilterChange(filter.id)}
              >
                {filter.label} <span className="text-xs opacity-70">{filter.count}</span>
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[320px] px-4">Document / requirement</TableHead>
              <TableHead className="min-w-[260px]">Pipeline</TableHead>
              <TableHead className="px-4 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.length > 0 ? (
              groups.flatMap((group) => [
                <PackageGroupHeader key={`${group.id}-header`} group={group} />,
                ...group.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-4 whitespace-normal">
                      <div className="font-medium leading-tight">{row.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {row.pages.length > 0 ? (
                          <button
                            type="button"
                            className="text-blue-600 hover:underline"
                            onClick={() => onReviewMatch(row)}
                          >
                            {row.documentLabel}
                          </button>
                        ) : (
                          <span>{row.documentLabel}</span>
                        )}
                        {row.condition && <span>{row.condition}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <PipelineIndicator row={row} />
                    </TableCell>
                    <TableCell className="px-4">
                      <PackageRowActions
                        row={row}
                        workingRequirementId={workingRequirementId}
                        draftingReminder={draftingReminder}
                        onMarkLoneWolfUploaded={onMarkLoneWolfUploaded}
                        onGenerateReminder={onGenerateReminder}
                        onReviewMatch={onReviewMatch}
                      />
                    </TableCell>
                  </TableRow>
                )),
              ])
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  No documents match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EmailAttachmentsPanel({
  dealId,
  attachments,
  renderedAttachmentIds,
}: {
  dealId: string;
  attachments: EmailAttachmentRow[];
  renderedAttachmentIds: string[];
}) {
  if (attachments.length === 0) return null;
  const renderedSet = new Set(renderedAttachmentIds);
  const hasUnpreparedAttachment = attachments.some((attachment) => !renderedSet.has(attachment.id));

  if (!hasUnpreparedAttachment) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 py-3">
        <div>
          <CardTitle className="text-base">Email Attachments</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Convert received email documents into review pages before running full processing.
          </p>
        </div>
        <EmailAttachmentIngestButton
          dealId={dealId}
          attachments={attachments}
          renderedAttachmentIds={renderedAttachmentIds}
        />
      </CardHeader>
      <CardContent className="space-y-2">
        {attachments.map((attachment) => {
          const rendered = renderedSet.has(attachment.id);
          return (
            <div key={attachment.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                    <p className="truncate text-sm font-medium">
                      {attachment.original_filename ?? "Email attachment"}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {emailAttachmentTypeLabel(attachment.light_classification_type)}
                    {attachment.light_classification_confidence != null
                      ? ` | ${Math.round(attachment.light_classification_confidence * 100)}% confidence`
                      : ""}
                  </p>
                </div>
                <Badge variant={rendered ? "default" : emailAttachmentStatusVariant(attachment.status)}>
                  {rendered ? "Ready for process" : formatEmailAttachmentStatus(attachment.status)}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {attachment.received_at
                    ? `Received ${relativeTime(attachment.received_at)}`
                    : `Stored ${relativeTime(attachment.created_at)}`}
                  {attachment.file_size != null ? ` | ${formatBytes(attachment.file_size)}` : ""}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<a href={`/api/email-attachments/${attachment.id}/download`} />}
                >
                  <DownloadIcon className="size-3.5" />
                  Download
                </Button>
              </div>
              {attachment.ignore_reason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Reason: {attachment.ignore_reason.replaceAll("_", " ")}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

type PackageGroup = {
  id: PackageBucket;
  label: string;
  tone: "green" | "amber" | "red" | "neutral";
  rows: PackageDocumentRow[];
};

function PackageGroupHeader({ group }: { group: PackageGroup }) {
  const dotClass =
    group.tone === "green"
      ? "bg-green-700"
      : group.tone === "amber"
        ? "bg-amber-600"
        : group.tone === "red"
          ? "bg-red-800"
          : "bg-muted-foreground";

  return (
    <TableRow className="bg-background hover:bg-background">
      <TableCell colSpan={3} className="px-4 pt-5 pb-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className={`size-2 rounded-full ${dotClass}`} />
          <span>{group.label}</span>
          <span className="text-xs font-normal text-muted-foreground">{group.rows.length}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function PipelineIndicator({ row }: { row: PackageDocumentRow }) {
  if (packageBucket(row) === "not_required") {
    return <span className="text-sm text-muted-foreground">Not required for this scenario</span>;
  }

  const steps = [
    { id: "received", complete: row.found, current: false },
    { id: "processed", complete: row.found && !row.unprocessed, current: row.found && row.unprocessed },
    {
      id: "matched",
      complete: row.found && !row.unprocessed && !row.needsReview,
      current: row.found && !row.unprocessed && row.needsReview,
    },
    {
      id: "lonewolf",
      complete:
        row.found &&
        !row.needsReview &&
        (row.loneWolfLabel === "Uploaded" || row.loneWolfLabel === "Not Required"),
      current: row.pendingLoneWolf && !row.needsReview,
    },
  ];

  return (
    <div className="space-y-1">
      <div className="flex items-center">
        {steps.map((step, index) => (
          <PipelineStep
            key={step.id}
            complete={step.complete}
            current={step.current}
            showConnector={index < steps.length - 1}
          />
        ))}
      </div>
      <p className="text-sm text-foreground">{pipelineLabel(row)}</p>
    </div>
  );
}

function PipelineStep({
  complete,
  current,
  showConnector,
}: {
  complete: boolean;
  current: boolean;
  showConnector: boolean;
}) {
  const dotClass = complete
    ? "border-green-200 bg-green-100 text-green-800"
    : current
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-border bg-background text-transparent";
  const connectorClass = complete ? "bg-green-200" : "bg-border";

  return (
    <>
      <span className={`grid size-4 place-items-center rounded-full border ${dotClass}`}>
        {complete ? <CheckIcon className="size-3" /> : current ? <Clock3Icon className="size-3" /> : null}
      </span>
      {showConnector && <span className={`h-px w-5 ${connectorClass}`} />}
    </>
  );
}

function getFieldStatus(
  fieldKey: string,
  row: FieldRow | undefined,
  conflictCount: number,
  fieldMap: Map<string, FieldRow>,
): FieldStatus {
  const value = row?.value?.trim();
  const hasValue = Boolean(value);
  const note = row?.notes?.toLowerCase() ?? "";
  const requiredMissing =
    !hasValue &&
    (isRequiredReviewField(fieldKey, fieldMap) ||
      row?.needs_review ||
      note.includes("required") ||
      note.includes("not found") ||
      note.includes("missing"));

  if (requiredMissing) {
    return {
      tone: "missing",
      label: "Missing - required",
      detail: "Required - not found in any source",
      className: "border-red-200 bg-red-50/60 focus-visible:ring-red-200",
    };
  }

  if (!hasValue) {
    return {
      tone: "neutral",
      label: "Not applicable",
      detail: "Not required for this transaction type",
      className: "border-border bg-muted/30 text-muted-foreground",
    };
  }

  if (row?.needs_review || row?.confidence !== "high" || conflictCount > 1) {
    return {
      tone: "review",
      label: conflictCount > 1 ? `Conflict - ${conflictCount} sources disagree` : "Needs review",
      detail: row?.source_doc_type
        ? `Review source: ${documentTypeLabel(row.source_doc_type)}`
        : "Review extracted value",
      className: "border-amber-200 bg-amber-50/70 focus-visible:ring-amber-200",
    };
  }

  return {
    tone: "confirmed",
    label: "Confirmed",
    detail: row?.edited_at
      ? "Admin Override"
      : row?.source_doc_type
      ? `Confirmed from ${documentTypeLabel(row.source_doc_type)}`
      : "Confirmed from source",
    className: "border-green-200 bg-green-50/60 focus-visible:ring-green-200",
  };
}

const ALWAYS_REQUIRED_REVIEW_FIELDS = new Set([
  "agent_name",
  "property_address",
  "closing_date",
  "price_or_rent",
  "transaction_type",
  "representation_side",
  "seller_representation",
  "buyer_representation",
  "seller_landlord_names",
  "buyer_tenant_names",
]);

function isRequiredReviewField(fieldKey: string, fieldMap: Map<string, FieldRow>) {
  if (ALWAYS_REQUIRED_REVIEW_FIELDS.has(fieldKey)) return true;

  if (fieldKey === "deposit_holder" || fieldKey === "deposit_held_by_sutton" || fieldKey === "deposit_method" || fieldKey === "deposit_amount") {
    return hasFieldValue(fieldMap, "deposit_holder") ||
      hasFieldValue(fieldMap, "deposit_held_by") ||
      hasFieldValue(fieldMap, "deposit_method") ||
      hasFieldValue(fieldMap, "deposit_amount");
  }

  if (fieldKey === "lease_start_date") {
    return fieldMap.get("transaction_type")?.value?.toLowerCase() === "lease";
  }

  return false;
}

function hasFieldValue(fieldMap: Map<string, FieldRow>, fieldKey: string) {
  return Boolean(fieldMap.get(fieldKey)?.value?.trim());
}

function fieldShellClass(tone: FieldStatusTone) {
  if (tone === "confirmed") return "border-green-100 bg-green-50/25";
  if (tone === "review") return "border-amber-100 bg-amber-50/30";
  if (tone === "missing") return "border-red-100 bg-red-50/30";
  return "border-border bg-muted/10";
}

function fieldStatusTextClass(tone: FieldStatusTone) {
  if (tone === "confirmed") return "text-green-800";
  if (tone === "review") return "text-amber-800";
  if (tone === "missing") return "text-red-800";
  return "text-muted-foreground";
}

function PackageRowActions({
  row,
  workingRequirementId,
  draftingReminder,
  onMarkLoneWolfUploaded,
  onGenerateReminder,
  onReviewMatch,
}: {
  row: PackageDocumentRow;
  workingRequirementId: string | null;
  draftingReminder: boolean;
  onMarkLoneWolfUploaded: (requirementId: string) => void;
  onGenerateReminder: (row: PackageDocumentRow) => void;
  onReviewMatch: (row: PackageDocumentRow) => void;
}) {
  if (row.needsReview && row.pages.length > 0) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => onReviewMatch(row)}>
          Review match
        </Button>
      </div>
    );
  }

  if (row.canMarkLoneWolfUploaded) {
    return (
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onMarkLoneWolfUploaded(row.requirementId)}
          disabled={workingRequirementId === row.requirementId}
        >
          Mark uploaded
        </Button>
      </div>
    );
  }

  if (row.reminderNeeded) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onGenerateReminder(row)}
          disabled={draftingReminder}
        >
          Generate reminder
        </Button>
        <span className="text-xs text-muted-foreground">Waiting on agent</span>
      </div>
    );
  }

  return <div className="text-right text-muted-foreground">-</div>;
}

function FieldStatusLegendItem({ tone, label }: { tone: FieldStatusTone; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-foreground">
      <FieldStatusDot tone={tone} />
      <span>{label}</span>
    </div>
  );
}

function FieldStatusDot({
  tone,
  className = "",
}: {
  tone: FieldStatusTone;
  className?: string;
}) {
  const color =
    tone === "confirmed"
      ? "bg-green-700"
      : tone === "review"
        ? "bg-amber-700"
        : tone === "missing"
          ? "bg-red-800"
          : "bg-muted-foreground";

  return <span className={`inline-block size-2 rounded-full ${color} ${className}`} />;
}

function ReminderDialog({
  open,
  onOpenChange,
  context,
  agents,
  reminders,
  openTasks,
  selectedAgentId,
  onSelectedAgentChange,
  recipient,
  onRecipientChange,
  onGenerateDraft,
  draftingReminder,
  onMarkSent,
  sendingReminderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: PackageDocumentRow | null;
  agents: AgentRow[];
  reminders: ReminderRow[];
  openTasks: TaskRow[];
  selectedAgentId: string;
  onSelectedAgentChange: (agentId: string) => void;
  recipient: string;
  onRecipientChange: (recipient: string) => void;
  onGenerateDraft: () => void;
  draftingReminder: boolean;
  onMarkSent: (reminderId: string) => void;
  sendingReminderId: string | null;
}) {
  const sortedReminders = [...reminders].sort((a, b) => {
    const bTime = new Date(b.sent_at ?? b.drafted_at ?? b.created_at).getTime();
    const aTime = new Date(a.sent_at ?? a.drafted_at ?? a.created_at).getTime();
    return bTime - aTime;
  });
  const previewReminder =
    sortedReminders.find((reminder) => reminder.status === "draft") ?? sortedReminders[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate Reminder</DialogTitle>
          <DialogDescription>
            {context
              ? `Missing document: ${context.label}`
              : "Create and review a reminder draft for missing documents."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={selectedAgentId}
              onChange={(event) => onSelectedAgentChange(event.target.value)}
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
              onChange={(event) => onRecipientChange(event.target.value)}
            />
            <Button onClick={onGenerateDraft} disabled={draftingReminder || openTasks.length === 0}>
              {draftingReminder ? "Drafting..." : "Generate Draft"}
            </Button>
          </div>

          {openTasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No open missing-document tasks are available. Sync tasks before drafting a reminder.
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
            <div className="space-y-2">
              <p className="text-sm font-medium">Reminder History</p>
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
                {sortedReminders.length > 0 ? (
                  sortedReminders.map((reminder) => (
                    <div key={reminder.id} className="rounded border bg-background p-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{reminder.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            {reminder.recipient} |{" "}
                            {relativeTime(
                              reminder.sent_at ?? reminder.drafted_at ?? reminder.created_at,
                            )}
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
                          onClick={() => onMarkSent(reminder.id)}
                          disabled={sendingReminderId === reminder.id}
                        >
                          {sendingReminderId === reminder.id ? "Sending..." : "Send"}
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="p-2 text-sm text-muted-foreground">
                    No reminder drafts yet. Generate a draft to preview it here.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Draft Preview</p>
              {previewReminder ? (
                <div className="space-y-2">
                  <Input value={previewReminder.subject} readOnly />
                  <Textarea className="min-h-52" value={previewReminder.body} readOnly />
                </div>
              ) : (
                <div className="flex min-h-52 items-center rounded-md border p-4 text-sm text-muted-foreground">
                  No draft selected.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClassificationReviewDialog({
  dealId,
  row,
  pages,
  selectedPage,
  selectedDocType,
  saving,
  onOpenChange,
  onSelectedPageChange,
  onSelectedDocTypeChange,
  onSave,
}: {
  dealId: string;
  row: PackageDocumentRow | null;
  pages: PageRow[];
  selectedPage: number | null;
  selectedDocType: DocumentType;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectedPageChange: (page: number) => void;
  onSelectedDocTypeChange: (docType: DocumentType) => void;
  onSave: () => void;
}) {
  const rowPages = row
    ? row.pages
        .map((pageNumber) => pages.find((page) => page.page_number === pageNumber))
        .filter((page): page is PageRow => Boolean(page))
    : [];
  const activePage = selectedPage != null
    ? rowPages.find((page) => page.page_number === selectedPage) ?? rowPages[0]
    : rowPages[0];
  const activePageIndex = activePage
    ? rowPages.findIndex((page) => page.page_number === activePage.page_number)
    : -1;
  const canGoPrevious = activePageIndex > 0;
  const canGoNext = activePageIndex >= 0 && activePageIndex < rowPages.length - 1;
  const docOptions = Object.entries(DOCUMENT_TYPES).sort((a, b) => a[1].localeCompare(b[1]));
  const pageRangeLabel = formatPageRange(row?.pages ?? []);

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Review Document Match</DialogTitle>
          <DialogDescription>
            {row
              ? `Audit the matched pages for ${row.label}, then confirm or override the classification.`
              : "Audit the matched document classification."}
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-h-0 rounded-md border bg-muted/20">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {activePage ? `Page ${activePage.page_number}` : "No page selected"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Current: {documentTypeLabel(activePage?.doc_type)}
                    {activePage?.doc_confidence ? ` | ${activePage.doc_confidence} confidence` : ""}
                  </p>
                </div>
                {rowPages.length > 1 && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      title="Previous page"
                      onClick={() => {
                        if (canGoPrevious) onSelectedPageChange(rowPages[activePageIndex - 1].page_number);
                      }}
                      disabled={!canGoPrevious}
                    >
                      <ChevronLeftIcon />
                    </Button>
                    <span className="min-w-24 text-center text-xs text-muted-foreground">
                      {pageRangeLabel}
                      {activePageIndex >= 0 ? ` | ${activePageIndex + 1}/${rowPages.length}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      title="Next page"
                      onClick={() => {
                        if (canGoNext) onSelectedPageChange(rowPages[activePageIndex + 1].page_number);
                      }}
                      disabled={!canGoNext}
                    >
                      <ChevronRightIcon />
                    </Button>
                  </div>
                )}
              </div>
              <div className="max-h-[62vh] overflow-auto p-3">
                {activePage ? (
                  <img
                    src={`/api/deals/${dealId}/pages/${activePage.page_number}/image`}
                    alt={`Page ${activePage.page_number}`}
                    className="mx-auto max-h-none w-full max-w-3xl rounded border bg-white"
                  />
                ) : (
                  <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
                    No rendered page is available for this match.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current document label: {row.documentLabel}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  This override updates all matched pages in this row: {pageRangeLabel}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="classification-override" className="text-sm font-medium">
                  Classification override
                </label>
                <select
                  id="classification-override"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={selectedDocType}
                  onChange={(event) => onSelectedDocTypeChange(event.target.value as DocumentType)}
                >
                  {docOptions.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Saving marks this match as high confidence and clears stale standard-form metadata.
                </p>
              </div>

              {activePage?.standard_form_title || activePage?.standard_form_number ? (
                <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Current form signal</p>
                  <p>{[activePage.standard_form_number, activePage.standard_form_title].filter(Boolean).join(" | ")}</p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving || !row || row.pages.length === 0}>
            {saving ? "Saving..." : "Save override"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function formatPageRange(pages: number[]) {
  if (pages.length === 0) return "No pages";
  if (pages.length === 1) return `p.${pages[0]}`;
  return `p.${pages[0]}-${pages[pages.length - 1]}`;
}

function documentTypeLabel(docType: string | DocumentType | null | undefined) {
  if (!docType) return "Source document";
  if (docType === "email_body") return "Email body";
  return DOCUMENT_TYPES[docType as DocumentType] ?? docType;
}

function documentTypesLabel(docTypes: DocumentType[]) {
  if (docTypes.length === 0) return "Source document";
  return docTypes.map((docType) => documentTypeLabel(docType)).join(" / ");
}

function buildPageLabelMap(pages: PageRow[]) {
  return new Map(
    pages.map((page) => [
      page.page_number,
      page.doc_type ? documentTypeLabel(page.doc_type) : "Unclassified document",
    ]),
  );
}

function buildPackageDocumentRows({
  checklist,
  dealStatus,
  pages,
  tasks,
  reminders,
  requirementStatuses,
}: {
  checklist: ChecklistItem[];
  dealStatus: string;
  pages: PageRow[];
  tasks: TaskRow[];
  reminders: ReminderRow[];
  requirementStatuses: Map<string, RequirementStatusRow>;
}): PackageDocumentRow[] {
  const pageConfidenceByType = new Map<string, string | null>();
  const reviewedPages = new Set<number>();
  for (const page of pages) {
    if (page.classification_reviewed_at) reviewedPages.add(page.page_number);
    if (!page.doc_type) continue;
    if (!pageConfidenceByType.has(page.doc_type)) {
      pageConfidenceByType.set(page.doc_type, page.doc_confidence);
    }
  }

  const hasDraftReminder = reminders.some((reminder) => reminder.status === "draft");
  const hasSentReminder = reminders.some((reminder) => reminder.status === "sent");

  return checklist.map((item) => {
    const found = item.found;
    const missing = item.required && !found;
    const foundExtra = item.id.startsWith("found_");
    const task = tasks.find((candidate) => candidate.requirement_id === item.id);
    const requirementStatus = requirementStatuses.get(item.id);
    const loneWolfStatus = requirementStatus?.lonewolf_status ?? defaultLoneWolfStatus(item);
    const confidence = item.docTypes
      .map((docType) => pageConfidenceByType.get(docType))
      .find(Boolean);
    const classificationReviewed = item.pages.some((pageNumber) => reviewedPages.has(pageNumber));
    const unprocessed = found && (!confidence || dealStatus === "uploaded" || dealStatus === "processing");
    const needsReview = (!classificationReviewed && (foundExtra || confidence === "low")) || task?.status === "open";
    const reminderNeeded = missing && (!hasDraftReminder && !hasSentReminder);
    return {
      id: item.id,
      requirementId: item.id,
      label: item.label,
      documentLabel: documentTypesLabel(item.docTypes),
      docTypes: item.docTypes,
      requirementLevel: item.level,
      condition: item.condition,
      loneWolfLabel: found ? formatLoneWolfStatus(loneWolfStatus) : "-",
      pages: item.pages,
      found,
      missing,
      needsReview,
      pendingLoneWolf: found && loneWolfStatus === "pending_upload",
      unprocessed,
      reminderNeeded,
      canMarkLoneWolfUploaded: found && loneWolfStatus === "pending_upload",
      classificationReviewed,
    };
  });
}

function defaultLoneWolfStatus(item: ChecklistItem): RequirementStatusRow["lonewolf_status"] {
  if (!item.found) return "unknown";
  return "pending_upload";
}

function formatLoneWolfStatus(status: RequirementStatusRow["lonewolf_status"]) {
  if (status === "pending_upload") return "Pending Upload";
  if (status === "not_required") return "Not Required";
  if (status === "uploaded") return "Uploaded";
  return "Unknown";
}

function emailAttachmentTypeLabel(docType: string | null) {
  if (!docType || docType === "unknown") return "Light classification pending";
  return documentTypeLabel(docType);
}

function formatEmailAttachmentStatus(status: string) {
  if (status === "linked_to_transaction") return "Awaiting process";
  if (status === "light_classified") return "Light classified";
  return status.replaceAll("_", " ");
}

function emailAttachmentStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "linked_to_transaction" || status === "light_classified") return "default";
  if (status === "duplicate" || status === "ignored") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

function packageBucket(row: PackageDocumentRow): PackageBucket {
  if (row.found && row.needsReview) return "needs_review";
  if (row.found) return "uploaded_matched";
  if (row.requirementLevel === "required") return "outstanding";
  return "not_required";
}

function buildPackageGroups(rows: PackageDocumentRow[]): PackageGroup[] {
  const definitions: Omit<PackageGroup, "rows">[] = [
    { id: "uploaded_matched", label: "Uploaded & matched", tone: "green" },
    { id: "needs_review", label: "Needs review", tone: "amber" },
    { id: "outstanding", label: "Outstanding requirements", tone: "red" },
    { id: "not_required", label: "Not required for this deal", tone: "neutral" },
  ];

  return definitions
    .map((definition) => ({
      ...definition,
      rows: rows.filter((row) => packageBucket(row) === definition.id),
    }))
    .filter((group) => group.rows.length > 0);
}

function packageFilterCounts(rows: PackageDocumentRow[]) {
  return {
    all: rows.length,
    uploadedMatched: rows.filter((row) => packageBucket(row) === "uploaded_matched").length,
    outstanding: rows.filter((row) => packageBucket(row) === "outstanding").length,
    notRequired: rows.filter((row) => packageBucket(row) === "not_required").length,
    needsReview: rows.filter((row) => packageBucket(row) === "needs_review").length,
    pendingLoneWolf: rows.filter((row) => row.pendingLoneWolf).length,
  };
}

function pipelineLabel(row: PackageDocumentRow) {
  if (packageBucket(row) === "not_required") return "Not required for this scenario";
  if (!row.found) return "Not started";
  if (row.unprocessed) return "Pending processing";
  if (row.needsReview) return "Needs review";
  if (row.pendingLoneWolf) return "Pending Lone Wolf upload";
  if (row.loneWolfLabel === "Uploaded") return "Uploaded to Lone Wolf";
  return "Matched";
}

function filterPackageRows(rows: PackageDocumentRow[], filter: PackageFilter) {
  if (filter === "uploaded_matched") {
    return rows.filter((row) => packageBucket(row) === "uploaded_matched");
  }
  if (filter === "outstanding") return rows.filter((row) => packageBucket(row) === "outstanding");
  if (filter === "not_required") return rows.filter((row) => packageBucket(row) === "not_required");
  if (filter === "needs_review") return rows.filter((row) => packageBucket(row) === "needs_review");
  if (filter === "pending_lonewolf") return rows.filter((row) => row.pendingLoneWolf);
  return rows;
}

function summarizePackageRows(rows: PackageDocumentRow[]) {
  const received = rows.filter((row) => row.found).length;
  const processed = rows.filter((row) => row.found && !row.unprocessed).length;
  const missing = rows.filter((row) => row.missing).length;
  const pendingLoneWolf = rows.filter((row) => row.pendingLoneWolf).length;
  return `${received} received - ${processed} processed - ${missing} missing - ${pendingLoneWolf} pending Lone Wolf upload`;
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

function sortAuditLogs(logs: AuditLogRow[]) {
  return [...logs].sort((a, b) => {
    const bTime = new Date(b.created_at).getTime();
    const aTime = new Date(a.created_at).getTime();
    return bTime - aTime;
  });
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "unknown size";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
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
