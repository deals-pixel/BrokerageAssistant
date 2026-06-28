"use client";

import { useMemo, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowUpRightIcon, BellIcon, CalendarIcon, CheckCircle2Icon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, Clock3Icon, DownloadIcon, FileTextIcon, MailIcon, MapPinIcon, PauseIcon, PencilIcon, RefreshCwIcon, SendIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";
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
import { UploadDropzone } from "@/components/upload-dropzone";
import { ProcessDealButton } from "@/components/process-deal-button";
import { EmailAttachmentIngestButton } from "@/components/email-attachment-ingest-button";
import { SubmitArchiveButton } from "@/components/submit-archive-button";
import { toast } from "sonner";
import { INTAKE_ADDRESS } from "@/lib/intake-address";
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
  transaction_code: string | null;
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
  page_role?: string | null;
  page_role_confidence?: string | null;
  extraction_skip_reason?: string | null;
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
  requested_documents?: ReminderDocument[] | null;
  followup_enabled?: boolean | null;
  next_followup_at?: string | null;
  max_followups?: number | null;
  followup_count?: number | null;
  followup_delay_business_days?: number | null;
  escalate_after_days?: number | null;
  paused_at?: string | null;
};

type ReminderDocument = {
  id?: string;
  title?: string;
  documentType?: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  brokerage: string | null;
};

type InboundEmailContact = {
  email: string;
  name: string | null;
};

type ReminderTaskOption = {
  id: string;
  title: string;
  documentLabel: string;
  note: string | null;
};

type RecipientOption = {
  id: string;
  label: string;
  email: string;
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

type DepositVerificationRow = {
  id: string;
  status: "confirmed";
  proof_amount: string | null;
  confirmed_amount: string | null;
  note: string | null;
  source_inbound_email_id: string | null;
  source_email: string | null;
  source_name: string | null;
  source_received_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string;
  profiles?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
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

type PackageBucket = "awaiting_sync" | "uploaded_matched" | "needs_review" | "outstanding" | "not_required";

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
  reminderStatus: "none" | "draft" | "sent";
  reminderFollowupCount: number;
  reminderNextFollowupAt: string | null;
  reminderOverdue: boolean;
  canMarkLoneWolfUploaded: boolean;
  classificationReviewed: boolean;
};

type FieldStatusTone = "confirmed" | "review" | "missing" | "neutral";
type FieldReviewFilter = "all" | "needs_review" | "confirmed" | "unverified";

type FieldStatus = {
  tone: FieldStatusTone;
  label: string;
  detail: string;
  className: string;
};

const CHECKBOX_FIELD_KEYS = new Set(["additional_payees", "marketing_fee", "rebate_to_clients", "referral"]);
const CONDITIONAL_FIELD_GATES: Record<string, string> = {
  additional_payee_1_name: "additional_payees",
  additional_payee_1_commission_pct: "additional_payees",
  additional_payee_2_name: "additional_payees",
  additional_payee_2_commission_pct: "additional_payees",
  marketing_fee_amount: "marketing_fee",
  rebate_amount: "rebate_to_clients",
  referral_to: "referral",
};

export function ReviewScreen({
  deal,
  pages,
  fields,
  checklistResult,
  tasks,
  reminders,
  inboundEmailContacts = [],
  agents,
  requirementStatuses,
  depositVerification,
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
  inboundEmailContacts?: InboundEmailContact[];
  agents: AgentRow[];
  requirementStatuses: RequirementStatusRow[];
  depositVerification: DepositVerificationRow | null;
  emailAttachments: EmailAttachmentRow[];
  auditLogs: AuditLogRow[];
  initialReminderOpen?: boolean;
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [renderedAt] = useState(() => new Date().toISOString());
  const [savingFieldKey, setSavingFieldKey] = useState<string | null>(null);
  const [draftingReminder, setDraftingReminder] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [recipientMode, setRecipientMode] = useState("other");
  const [selectedReminderTaskIds, setSelectedReminderTaskIds] = useState<string[]>([]);
  const [followupDelayBusinessDays, setFollowupDelayBusinessDays] = useState(2);
  const [maxFollowups, setMaxFollowups] = useState(2);
  const [escalateAfterDays, setEscalateAfterDays] = useState(7);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [fieldReviewFilter, setFieldReviewFilter] = useState<FieldReviewFilter>("all");
  const [packageFilter, setPackageFilter] = useState<PackageFilter>("all");
  const [workingRequirementId, setWorkingRequirementId] = useState<string | null>(null);
  const [confirmingDeposit, setConfirmingDeposit] = useState(false);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(initialReminderOpen);
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
        currentIso: renderedAt,
        requirementStatuses: requirementStatusMap,
      }),
    [checklist, deal.status, pages, reminders, renderedAt, requirementStatusMap, tasks],
  );
  const outstandingRows = packageRows.filter((row) => row.missing);
  const openTasksByRequirementId = useMemo(
    () => new Map(openTasks.filter((task) => task.requirement_id).map((task) => [task.requirement_id as string, task])),
    [openTasks],
  );
  const reminderTasks = outstandingRows
    .map((row) => {
      const task = openTasksByRequirementId.get(row.requirementId);
      return task
        ? {
            id: task.id,
            title: row.label,
            documentLabel: row.documentLabel,
            note: task.description,
          }
        : null;
    })
    .filter((task): task is ReminderTaskOption => Boolean(task));
  const recipientOptions = useMemo(
    () => buildRecipientOptions({ agents, inboundEmailContacts, fields }),
    [agents, inboundEmailContacts, fields],
  );
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
  const currentValue = (key: string) => {
    if (edited[key] !== undefined) return edited[key];
    const saved = fieldMap.get(key)?.value;
    if (saved != null) return saved;
    if (CHECKBOX_FIELD_KEYS.has(key) && dependentFieldsForGate(key).some((dependentKey) => fieldMap.get(dependentKey)?.value?.trim())) {
      return "yes";
    }
    if (CHECKBOX_FIELD_KEYS.has(key)) return "no";
    return "";
  };

  const dirty = Object.keys(edited).length > 0;
  const packageCounts = packageFilterCounts(packageRows);
  const receivedRequiredCount = checklistResult.requiredItems.length - checklistResult.missingRequired.length;
  const receivedPct =
    checklistResult.requiredItems.length === 0
      ? 100
      : Math.round((receivedRequiredCount / checklistResult.requiredItems.length) * 100);
  const sentReminderCount = reminders.filter((reminder) => reminder.status === "sent").length;
  const closingDate = currentValue("closing_date");
  const depositAmount = currentValue("deposit_amount");
  const depositHolder = currentValue("deposit_holder");
  const depositMethod = currentValue("deposit_method");
  const depositProofRows = packageRows.filter((row) =>
    row.docTypes.some((docType) => docType === "deposit_proof" || docType === "copy_deposit_receipt_other_brokerage"),
  );
  const depositProofFound = depositProofRows.some((row) => row.found);
  const fieldReviewStats = buildFieldReviewStats({
    fieldMap,
    currentValue,
    isHidden: (fieldKey) => isConditionalFieldHidden(fieldKey, currentValue),
  });
  const fieldReviewPct =
    fieldReviewStats.all === 0 ? 100 : Math.round((fieldReviewStats.confirmed / fieldReviewStats.all) * 100);

  function setCheckboxFieldEdit(fieldKey: string, checked: boolean) {
    setEdited((prev) => {
      const next = { ...prev, [fieldKey]: checked ? "yes" : "no" };
      for (const dependentKey of dependentFieldsForGate(fieldKey)) {
        if (checked) {
          if (next[dependentKey] === "") delete next[dependentKey];
        } else {
          next[dependentKey] = "";
        }
      }
      return next;
    });
  }

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

  function selectConflictSource(fieldKey: string, source: FieldSourceCandidate, index: number) {
    setEdited((prev) => ({ ...prev, [fieldKey]: source.value }));
    jumpToConflictSource(fieldKey, source, index);
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
      await persistFieldEdits(fieldEditEntriesForSave(fieldKey, edited));
      toast.success("Field override saved.");
      setEdited((prev) => {
        const next = { ...prev };
        for (const [key] of fieldEditEntriesForSave(fieldKey, prev)) delete next[key];
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

  async function generateReminderDraft(options: { followupEnabled?: boolean } = {}) {
    setDraftingReminder(true);
    try {
      const requestedDocumentIds =
        selectedReminderTaskIds.length > 0 ? selectedReminderTaskIds : reminderTasks.map((task) => task.id);
      const res = await fetch(`/api/deals/${deal.id}/reminders/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: selectedAgentId || null,
          recipient: recipient || null,
          requestedDocumentIds,
          followupEnabled: options.followupEnabled ?? true,
          followupDelayBusinessDays,
          maxFollowups,
          escalateAfterDays,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not create reminder draft");
      toast.success("Reminder draft created.");
      router.refresh();
      return body?.reminder as ReminderRow;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create reminder draft");
      return null;
    } finally {
      setDraftingReminder(false);
    }
  }

  function openReminderDialog(targetRows?: PackageDocumentRow | PackageDocumentRow[]) {
    const targetList = Array.isArray(targetRows) ? targetRows : targetRows ? [targetRows] : outstandingRows;
    const targetIds = targetList
      .map((row) => openTasksByRequirementId.get(row.requirementId)?.id)
      .filter((id): id is string => Boolean(id));
    setSelectedReminderTaskIds(targetIds.length > 0 ? targetIds : reminderTasks.map((task) => task.id));
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
          page_role: "data_entry_page",
          page_role_confidence: "medium",
          extraction_skip_reason: null,
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

  async function markAllLoneWolfUploaded(rows: PackageDocumentRow[]) {
    for (const row of rows.filter((candidate) => candidate.canMarkLoneWolfUploaded)) {
      await markLoneWolfUploaded(row.requirementId);
    }
  }

  async function confirmDeposit() {
    setConfirmingDeposit(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/deposit-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not confirm deposit");
      toast.success("Deposit verification recorded.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not confirm deposit");
    } finally {
      setConfirmingDeposit(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-6">
      <header className="sticky top-0 z-20 -mx-6 border-b bg-background/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground hover:underline">
                Dashboard
              </Link>
              <span>/</span>
              <span className="truncate">{shortDealAddress(deal)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="max-w-[900px] text-2xl font-semibold leading-tight">
                {deal.property_address ?? deal.file_name}
              </h1>
              <Badge className="capitalize">{deal.transaction_type}</Badge>
              <Badge variant="outline">{deal.status}</Badge>
            </div>
            {deal.error_message && (
              <p className="text-sm text-destructive">Error: {deal.error_message}</p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <ProcessDealButton
              dealId={deal.id}
              status={deal.status}
              pageCount={deal.page_count}
              variant="outline"
            />
            <Button
              variant="outline"
              onClick={() => saveEdits()}
              disabled={!dirty || saving}
            >
              Save edits
            </Button>
            <Button onClick={() => openReminderDialog()} disabled={draftingReminder || reminderTasks.length === 0}>
              <BellIcon className="size-4" />
              Send reminder
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DealMetaItem icon={UsersIcon} label="Representation" value={checklistResult.scenario.shortLabel} />
          <DealMetaItem icon={FileTextIcon} label="Scenario" value={deal.scenario_label ?? checklistResult.scenario.label} />
          <DealMetaItem icon={CalendarIcon} label="Closing" value={closingDate ? formatDateOnly(closingDate) : "Not captured"} />
          <DealMetaItem
            icon={Clock3Icon}
            label="Last reminder"
            value={latestReminder ? relativeTime(latestReminder.sent_at ?? latestReminder.drafted_at ?? latestReminder.created_at) : "None sent"}
          />
        </div>
      </header>

      <div className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4 xl:divide-x">
        <DealStatCard
          icon={Clock3Icon}
          label="Received"
          value={`${receivedPct}%`}
          detail={`${receivedRequiredCount} of ${checklistResult.requiredItems.length} required docs received`}
        />
        <DealStatCard
          icon={Clock3Icon}
          label="Outstanding"
          value={String(packageCounts.outstanding)}
          detail="documents missing"
          tone="red"
        />
        <DealStatCard
          icon={RefreshCwIcon}
          label="Awaiting sync"
          value={String(packageCounts.pendingLoneWolf)}
          detail="pending Lone Wolf upload"
          tone="amber"
        />
        <DealStatCard
          icon={MailIcon}
          label="Reminders sent"
          value={String(sentReminderCount)}
          detail={`${reminderTasks.length} open document${reminderTasks.length === 1 ? "" : "s"} available`}
        />
      </div>

      <DepositVerificationCard
        verification={depositVerification}
        depositAmount={depositAmount}
        depositHolder={depositHolder}
        depositMethod={depositMethod}
        proofFound={depositProofFound}
        confirming={confirmingDeposit}
        onConfirm={confirmDeposit}
      />

      <PackageDocumentsPanel
        rows={packageRows}
        activeFilter={packageFilter}
        onFilterChange={setPackageFilter}
        onMarkLoneWolfUploaded={markLoneWolfUploaded}
        onMarkAllLoneWolfUploaded={markAllLoneWolfUploaded}
        onGenerateReminder={openReminderDialog}
        onReviewMatch={openClassificationReview}
        workingRequirementId={workingRequirementId}
        draftingReminder={draftingReminder}
      />

      <ReminderDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        deal={deal}
        recipientOptions={recipientOptions}
        reminders={reminders}
        reminderTasks={reminderTasks}
        selectedReminderTaskIds={selectedReminderTaskIds}
        onSelectedReminderTaskIdsChange={setSelectedReminderTaskIds}
        onSelectedAgentChange={setSelectedAgentId}
        recipientMode={recipientMode}
        onRecipientModeChange={setRecipientMode}
        recipient={recipient}
        onRecipientChange={setRecipient}
        followupDelayBusinessDays={followupDelayBusinessDays}
        onFollowupDelayBusinessDaysChange={setFollowupDelayBusinessDays}
        maxFollowups={maxFollowups}
        onMaxFollowupsChange={setMaxFollowups}
        escalateAfterDays={escalateAfterDays}
        onEscalateAfterDaysChange={setEscalateAfterDays}
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

      <div className="space-y-4">
        <EmailAttachmentsPanel
          dealId={deal.id}
          attachments={emailAttachments}
          renderedAttachmentIds={renderedEmailAttachmentIds}
        />
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
          <Card className="overflow-hidden py-0">
            <CardHeader className="border-b px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-[220px] flex-1">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Review progress</span>
                    <span>{fieldReviewStats.confirmed} of {fieldReviewStats.all} confirmed</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-green-600" style={{ width: `${fieldReviewPct}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "all" as const, label: "All", count: fieldReviewStats.all },
                    { id: "needs_review" as const, label: "Needs review", count: fieldReviewStats.needsReview },
                    { id: "confirmed" as const, label: "Confirmed", count: fieldReviewStats.confirmed },
                    { id: "unverified" as const, label: "Unverified", count: fieldReviewStats.unverified },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={`h-8 rounded-md border px-2.5 text-sm transition ${
                        fieldReviewFilter === filter.id
                          ? "border-foreground bg-background shadow-sm"
                          : "border-border bg-muted/20 hover:bg-muted"
                      }`}
                      onClick={() => setFieldReviewFilter(filter.id)}
                    >
                      {filter.label} <span className="font-semibold">{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4">
              {FIELD_SECTIONS.map((section) => {
                const visibleFields = section.fields.filter((f) => {
                  if (isConditionalFieldHidden(f.key, currentValue)) return false;
                  const row = fieldMap.get(f.key);
                  const value = currentValue(f.key);
                  const conflictSources = validConflictSources(row?.conflict_sources);
                  const fieldStatus = getFieldStatus(f.key, row, conflictSources.length, fieldMap, value);
                  return fieldMatchesReviewFilter(fieldStatus, fieldReviewFilter);
                });
                if (visibleFields.length === 0) return null;

                return (
                  <section key={section.title} className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-border" />
                      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {friendlyFieldSectionTitle(section.title)}
                      </h2>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {visibleFields.map((f) => {
                        const row = fieldMap.get(f.key);
                        const inputId = `field-${f.key}`;
                        const value = currentValue(f.key);
                        const conflictSources = validConflictSources(row?.conflict_sources);
                        const fieldStatus = getFieldStatus(f.key, row, conflictSources.length, fieldMap, value);
                        const fieldDirty = edited[f.key] !== undefined;
                        const fieldSaving = savingFieldKey === f.key;
                        const isCheckboxField = CHECKBOX_FIELD_KEYS.has(f.key);
                        const sourceLabel = fieldSourceLabel(row, pageLabelByNumber);
                        const inputClassName = reviewInputClass(fieldStatus.tone, fieldDirty);
                        const wideClass = f.wide || f.multiline || conflictSources.length > 1 ? "md:col-span-2" : "";

                        return (
                          <div key={f.key} className={`rounded-md border p-2.5 ${reviewFieldShellClass(fieldStatus.tone)} ${wideClass}`}>
                            <label htmlFor={inputId} className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {f.label}
                            </label>
                            <div className={f.multiline ? "mt-1.5 flex items-start gap-2" : "mt-1.5 flex items-center gap-2"}>
                              {isCheckboxField ? (
                                <div className={`flex min-h-8 flex-1 items-center gap-3 rounded-md border px-3 text-sm ${inputClassName}`}>
                                  <input
                                    id={inputId}
                                    type="checkbox"
                                    className="size-4 rounded border-input accent-primary"
                                    checked={isCheckedValue(value)}
                                    onFocus={() => jumpToFieldSource(row, f.key)}
                                    onChange={(event) => setCheckboxFieldEdit(f.key, event.target.checked)}
                                  />
                                  <span>{isCheckedValue(value) ? "Yes" : "No"}</span>
                                </div>
                              ) : f.multiline ? (
                                <Textarea
                                  id={inputId}
                                  className={`min-h-16 flex-1 ${inputClassName}`}
                                  value={value}
                                  onFocus={() => jumpToFieldSource(row, f.key)}
                                  onChange={(e) => setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                />
                              ) : (
                                <Input
                                  id={inputId}
                                  className={`h-8 flex-1 ${inputClassName}`}
                                  value={value}
                                  onFocus={() => jumpToFieldSource(row, f.key)}
                                  onChange={(e) => setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                />
                              )}
                              {fieldDirty && conflictSources.length <= 1 && (
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

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                              <FieldStatusDot tone={fieldStatus.tone} />
                              <span className={`font-medium ${fieldStatusTextClass(fieldStatus.tone)}`}>{reviewStatusLabel(fieldStatus)}</span>
                              {sourceLabel && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                                  onClick={() => jumpToFieldSource(row, f.key)}
                                >
                                  <ArrowUpRightIcon className="size-3" />
                                  {sourceLabel}
                                </button>
                              )}
                              {templateFallbackNote(row) && (
                                <span className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 text-[11px] text-muted-foreground">
                                  <AlertTriangleIcon className="size-3" />
                                  Template fallback
                                </span>
                              )}
                            </div>

                            {conflictSources.length > 1 && (
                              <div className="mt-2 overflow-hidden rounded-md border border-amber-300 bg-background">
                                <div className="border-b border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">
                                  Which value is correct?
                                </div>
                                <div className="divide-y">
                                  {conflictSources.map((source, index) => {
                                    const active = selectedFieldKey === f.key && selectedSourceIndex === index;
                                    const label = conflictSourceLabel(source, pageLabelByNumber);
                                    return (
                                      <button
                                        key={`${source.sourceDocumentType ?? "source"}-${source.sourcePage ?? "?"}-${index}`}
                                        type="button"
                                        className={`grid w-full grid-cols-[auto_1fr] gap-x-2 px-2.5 py-2 text-left text-xs ${
                                          active ? "bg-amber-50" : "hover:bg-muted/40"
                                        }`}
                                        onClick={() => selectConflictSource(f.key, source, index)}
                                      >
                                        <span className={`mt-0.5 size-3 rounded-full border ${active ? "border-amber-700 bg-amber-700" : "border-amber-400"}`} />
                                        <span>
                                          <span className="block font-semibold text-foreground">{source.value}</span>
                                          <span className="block text-[11px] text-muted-foreground">{label}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50/40 px-2.5 py-2">
                                  <span className="text-xs text-amber-900">Select the correct value, then confirm</span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => saveFieldEdit(f.key)}
                                    disabled={edited[f.key] === undefined || saving || fieldSaving}
                                  >
                                    {fieldSaving ? "Saving..." : "Confirm selection"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Bottom: export */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
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

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Update Package Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <UploadDropzone dealId={deal.id} compact />
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
  activeFilter,
  onFilterChange,
  onMarkLoneWolfUploaded,
  onMarkAllLoneWolfUploaded,
  onGenerateReminder,
  onReviewMatch,
  workingRequirementId,
  draftingReminder,
}: {
  rows: PackageDocumentRow[];
  activeFilter: PackageFilter;
  onFilterChange: (filter: PackageFilter) => void;
  onMarkLoneWolfUploaded: (requirementId: string) => void | Promise<void>;
  onMarkAllLoneWolfUploaded: (rows: PackageDocumentRow[]) => void | Promise<void>;
  onGenerateReminder: (row?: PackageDocumentRow | PackageDocumentRow[]) => void;
  onReviewMatch: (row: PackageDocumentRow) => void;
  workingRequirementId: string | null;
  draftingReminder: boolean;
}) {
  const [notRequiredExpanded, setNotRequiredExpanded] = useState(false);
  const filteredRows = filterPackageRows(rows, activeFilter);
  const groups = buildPackageGroups(filteredRows);
  const counts = packageFilterCounts(rows);
  const filters: { id: PackageFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "uploaded_matched", label: "Processed", count: counts.uploadedMatched },
    { id: "outstanding", label: "Outstanding", count: counts.outstanding },
    { id: "pending_lonewolf", label: "Awaiting sync", count: counts.pendingLoneWolf },
    { id: "not_required", label: "Not required", count: counts.notRequired },
    ...(counts.needsReview > 0
      ? [{ id: "needs_review" as const, label: "Needs review", count: counts.needsReview }]
      : []),
  ];

  return (
    <Card>
      <CardHeader className="border-b px-4 py-3">
        <div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
            {filters.map((filter) => {
              const active = activeFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={`flex h-9 items-center justify-center gap-2 rounded-md border px-2 text-center transition ${
                    active
                      ? "border-foreground bg-background shadow-sm"
                      : "border-border bg-muted/20 hover:bg-muted"
                  }`}
                  onClick={() => onFilterChange(filter.id)}
                >
                  <span className="min-w-0 truncate text-sm font-medium leading-tight">{filter.label}</span>
                  <span className="text-sm font-semibold leading-tight">{filter.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filteredRows.length > 0 ? (
          <div className="divide-y">
            {groups.map((group) => {
              const isCollapsed = group.id === "not_required" && !notRequiredExpanded;
              return (
                <section key={group.id}>
                  <PackageGroupHeader
                    group={group}
                    isCollapsed={isCollapsed}
                    onToggle={
                      group.id === "not_required"
                        ? () => setNotRequiredExpanded((expanded) => !expanded)
                        : undefined
                    }
                    onMarkAllUploaded={
                      group.id === "awaiting_sync" ? () => onMarkAllLoneWolfUploaded(group.rows) : undefined
                    }
                    onRemindAll={
                      group.id === "outstanding" ? () => onGenerateReminder(group.rows) : undefined
                    }
                    draftingReminder={draftingReminder}
                  />
                  {!isCollapsed && (
                    <div className="divide-y">
                      {group.rows.map((row) => (
                        <PackageDocumentListRow
                          key={row.id}
                          row={row}
                          workingRequirementId={workingRequirementId}
                          draftingReminder={draftingReminder}
                          onMarkLoneWolfUploaded={onMarkLoneWolfUploaded}
                          onGenerateReminder={onGenerateReminder}
                          onReviewMatch={onReviewMatch}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No documents match this filter.
          </p>
        )}
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

function PackageGroupHeader({
  group,
  isCollapsed = false,
  onToggle,
  onMarkAllUploaded,
  onRemindAll,
  draftingReminder = false,
}: {
  group: PackageGroup;
  isCollapsed?: boolean;
  onToggle?: () => void;
  onMarkAllUploaded?: () => void;
  onRemindAll?: () => void;
  draftingReminder?: boolean;
}) {
  const dotClass =
    group.tone === "green"
      ? "bg-green-600"
      : group.tone === "amber"
        ? "bg-amber-600"
        : group.tone === "red"
          ? "bg-red-600"
          : "bg-muted-foreground";
  const headerClass =
    group.tone === "green"
      ? "bg-green-50/45"
      : group.tone === "amber"
        ? "bg-amber-50/55"
        : group.tone === "red"
          ? "bg-red-50/45"
          : "bg-muted/25";

  return (
    <div className={`flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 ${headerClass}`}>
      <div>
        {onToggle ? (
          <button
            type="button"
            className="flex items-center gap-2 text-left text-sm font-medium text-foreground hover:text-primary"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
          >
            <ChevronDownIcon
              className={`size-4 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
            />
            <span className={`size-2 rounded-full ${dotClass}`} />
            <span>{group.label}</span>
            <span className="text-xs font-normal text-muted-foreground">{group.rows.length}</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className={`size-2 rounded-full ${dotClass}`} />
            <span>{group.label} - {group.rows.length}</span>
          </div>
        )}
      </div>
      {onMarkAllUploaded && (
        <Button variant="outline" onClick={onMarkAllUploaded}>
          Mark all uploaded
        </Button>
      )}
      {onRemindAll && (
        <Button variant="outline" onClick={onRemindAll} disabled={draftingReminder}>
          <BellIcon className="size-4" />
          Remind all
        </Button>
      )}
    </div>
  );
}

function getFieldStatus(
  fieldKey: string,
  row: FieldRow | undefined,
  conflictCount: number,
  fieldMap: Map<string, FieldRow>,
  currentFieldValue?: string,
): FieldStatus {
  const value = (currentFieldValue ?? row?.value ?? "").trim();
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
      tone: "missing",
      label: "Missing",
      detail: "No value found in the source documents",
      className: "border-red-200 bg-red-50/60 focus-visible:ring-red-200",
    };
  }

  if (CHECKBOX_FIELD_KEYS.has(fieldKey)) {
    const checked = isCheckedValue(value);
    return {
      tone: row?.needs_review ? "review" : "confirmed",
      label: checked ? "Checked" : "Unchecked",
      detail: checked ? "Related detail fields are enabled" : "Related detail fields are hidden",
      className: row?.needs_review
        ? "border-amber-200 bg-amber-50/70 focus-visible:ring-amber-200"
        : "border-green-200 bg-green-50/60 focus-visible:ring-green-200",
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

function buildFieldReviewStats({
  fieldMap,
  currentValue,
  isHidden,
}: {
  fieldMap: Map<string, FieldRow>;
  currentValue: (key: string) => string;
  isHidden: (key: string) => boolean;
}) {
  const stats = { all: 0, needsReview: 0, confirmed: 0, unverified: 0 };

  for (const section of FIELD_SECTIONS) {
    for (const field of section.fields) {
      if (isHidden(field.key)) continue;
      const row = fieldMap.get(field.key);
      const value = currentValue(field.key);
      const conflictSources = validConflictSources(row?.conflict_sources);
      const status = getFieldStatus(field.key, row, conflictSources.length, fieldMap, value);
      stats.all += 1;
      if (status.tone === "review") stats.needsReview += 1;
      else if (status.tone === "confirmed") stats.confirmed += 1;
      else stats.unverified += 1;
    }
  }

  return stats;
}

function fieldMatchesReviewFilter(status: FieldStatus, filter: FieldReviewFilter) {
  if (filter === "all") return true;
  if (filter === "needs_review") return status.tone === "review";
  if (filter === "confirmed") return status.tone === "confirmed";
  return status.tone !== "confirmed" && status.tone !== "review";
}

function friendlyFieldSectionTitle(title: string) {
  if (title === "Deal Summary") return "Transaction Details";
  if (title === "Seller / Landlord" || title === "Buyer / Tenant") return "Parties";
  return title;
}

function reviewStatusLabel(status: FieldStatus) {
  if (status.tone === "confirmed") return "Confirmed";
  if (status.tone === "review") return status.label.startsWith("Conflict") ? status.label : "Needs review";
  if (status.tone === "missing") return "Unverified - click to confirm";
  return "Unverified";
}

function fieldSourceLabel(row: FieldRow | undefined, pageLabelByNumber: Map<number, string>) {
  if (!row) return null;
  if (row.source_doc_type) return documentTypeLabel(row.source_doc_type);
  if (row.source_page != null) return pageLabelByNumber.get(row.source_page) ?? `Page ${row.source_page}`;
  return null;
}

function conflictSourceLabel(source: FieldSourceCandidate, pageLabelByNumber: Map<number, string>) {
  const sourceLabel = source.sourceDocumentType
    ? documentTypeLabel(source.sourceDocumentType)
    : source.sourcePage != null
      ? pageLabelByNumber.get(source.sourcePage) ?? "Source document"
      : "Source document";
  return source.sourcePage != null ? `${sourceLabel} - p.${source.sourcePage}` : sourceLabel;
}

function templateFallbackNote(row: FieldRow | undefined) {
  return row?.notes?.toLowerCase().includes("template fallback") ?? false;
}

function reviewFieldShellClass(tone: FieldStatusTone) {
  if (tone === "confirmed") return "border-green-200 bg-green-50/35";
  if (tone === "review") return "border-amber-300 bg-amber-50/40";
  if (tone === "missing") return "border-border bg-muted/10";
  return "border-border bg-background";
}

function reviewInputClass(tone: FieldStatusTone, dirty: boolean) {
  const base =
    tone === "confirmed"
      ? "border-green-300 bg-green-50/70 focus-visible:ring-green-200"
      : tone === "review"
        ? "border-amber-300 bg-amber-50/70 focus-visible:ring-amber-200"
        : "border-border bg-background focus-visible:ring-muted";
  return `${base}${dirty ? " ring-2 ring-blue-300" : ""}`;
}

function isConditionalFieldHidden(fieldKey: string, currentValue: (key: string) => string) {
  const gateKey = CONDITIONAL_FIELD_GATES[fieldKey];
  if (!gateKey) return false;
  return !isCheckedValue(currentValue(gateKey));
}

function isCheckedValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "checked" || normalized === "1";
}

function dependentFieldsForGate(fieldKey: string) {
  return Object.entries(CONDITIONAL_FIELD_GATES)
    .filter(([, gateKey]) => gateKey === fieldKey)
    .map(([dependentKey]) => dependentKey);
}

function fieldEditEntriesForSave(fieldKey: string, edited: Record<string, string>) {
  const entries: [string, string][] = [[fieldKey, edited[fieldKey] ?? ""]];
  if (CHECKBOX_FIELD_KEYS.has(fieldKey) && !isCheckedValue(edited[fieldKey])) {
    for (const dependentKey of dependentFieldsForGate(fieldKey)) {
      entries.push([dependentKey, edited[dependentKey] ?? ""]);
    }
  }
  return entries;
}

function fieldGridSpanClass(wide: boolean | undefined, isCheckboxField: boolean) {
  if (wide) return "md:col-span-2 xl:col-span-4";
  if (isCheckboxField) return "";
  return "xl:col-span-2";
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
  if (tone === "missing") return "text-muted-foreground";
  return "text-muted-foreground";
}

function PackageDocumentListRow({
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
  onMarkLoneWolfUploaded: (requirementId: string) => void | Promise<void>;
  onGenerateReminder: (row?: PackageDocumentRow | PackageDocumentRow[]) => void;
  onReviewMatch: (row: PackageDocumentRow) => void;
}) {
  const primaryAction = packagePrimaryAction(row);

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(260px,1fr)_220px_170px] md:items-center">
      <div className="min-w-0">
        <div className="font-medium leading-tight">{row.label}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {row.pages.length > 0 ? (
            <button
              type="button"
              className="truncate text-left text-blue-600 hover:underline"
              onClick={() => onReviewMatch(row)}
            >
              {row.documentLabel}
            </button>
          ) : (
            <span className="truncate">{row.documentLabel}</span>
          )}
          {row.condition && <span>{row.condition}</span>}
        </div>
      </div>

      <PackageStatusLabel row={row} />

      <div className="flex items-center justify-start gap-2 md:justify-end">
        {primaryAction === "review" && (
          <Button variant="outline" onClick={() => onReviewMatch(row)}>
            Review match
          </Button>
        )}
        {primaryAction === "mark_uploaded" && (
          <Button
            variant="outline"
            onClick={() => onMarkLoneWolfUploaded(row.requirementId)}
            disabled={workingRequirementId === row.requirementId}
          >
            Mark uploaded
          </Button>
        )}
        {primaryAction === "remind" && (
          <Button variant="outline" onClick={() => onGenerateReminder(row)} disabled={draftingReminder}>
            <BellIcon className="size-4" />
            Remind
          </Button>
        )}
        {primaryAction === "send_now" && (
          <Button variant="outline" onClick={() => onGenerateReminder(row)} disabled={draftingReminder}>
            <SendIcon className="size-4" />
            Send now
          </Button>
        )}
        {primaryAction === "none" && <span className="text-sm text-muted-foreground">-</span>}
        <PackageOverflowActions
          row={row}
          draftingReminder={draftingReminder}
          onGenerateReminder={onGenerateReminder}
        />
      </div>
    </div>
  );
}

function PackageStatusLabel({ row }: { row: PackageDocumentRow }) {
  const status = packagePlainStatus(row);
  return (
    <div className={`flex items-center gap-2 text-sm ${status.className}`}>
      <span className={`size-1.5 rounded-full ${status.dotClass}`} />
      <span>{status.label}</span>
      {row.reminderNextFollowupAt && packageBucket(row) === "outstanding" && !row.reminderOverdue && (
        <span className="text-xs text-muted-foreground">Next {formatShortDateTime(row.reminderNextFollowupAt)}</span>
      )}
    </div>
  );
}

function PackageOverflowActions({
  row,
  draftingReminder,
  onGenerateReminder,
}: {
  row: PackageDocumentRow;
  draftingReminder: boolean;
  onGenerateReminder: (row?: PackageDocumentRow | PackageDocumentRow[]) => void;
}) {
  const bucket = packageBucket(row);
  if (bucket === "uploaded_matched" || bucket === "not_required") return null;

  return (
    <details className="relative">
      <summary className="flex h-9 w-11 cursor-pointer list-none items-center justify-center rounded-lg border bg-background text-sm font-semibold hover:bg-muted">
        ...
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border bg-background p-1 shadow-lg">
        {row.missing && (
          <button
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
            onClick={() => onGenerateReminder(row)}
            disabled={draftingReminder}
          >
            Edit schedule
          </button>
        )}
        {row.needsReview && row.pages.length > 0 && (
          <button
            type="button"
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => onGenerateReminder(row)}
          >
            Draft reminder
          </button>
        )}
        <button
          type="button"
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground"
          disabled
          title="Manual not-required workflow is coming next."
        >
          Mark not required
        </button>
      </div>
    </details>
  );
}

function packagePrimaryAction(row: PackageDocumentRow): "review" | "mark_uploaded" | "remind" | "send_now" | "none" {
  if (row.needsReview && row.pages.length > 0) return "review";
  if (row.canMarkLoneWolfUploaded) return "mark_uploaded";
  if (row.missing && row.reminderStatus === "none") return "remind";
  if (row.missing) return "send_now";
  return "none";
}

function packagePlainStatus(row: PackageDocumentRow) {
  if (packageBucket(row) === "awaiting_sync") {
    return {
      label: "Pending Lone Wolf",
      className: "text-amber-700",
      dotClass: "bg-amber-500",
    };
  }
  if (row.needsReview) {
    return {
      label: "Needs review",
      className: "text-amber-700",
      dotClass: "bg-amber-500",
    };
  }
  if (row.missing && row.reminderStatus === "sent") {
    return {
      label: "Reminder sent",
      className: "text-green-700",
      dotClass: "bg-green-600",
    };
  }
  if (row.missing && row.reminderStatus === "draft") {
    return {
      label: "Reminder drafted",
      className: "text-blue-700",
      dotClass: "bg-blue-600",
    };
  }
  if (row.missing) {
    return {
      label: "Not requested",
      className: "text-foreground",
      dotClass: "bg-muted-foreground",
    };
  }
  if (packageBucket(row) === "not_required") {
    return {
      label: "Not required",
      className: "text-muted-foreground",
      dotClass: "bg-muted-foreground",
    };
  }
  return {
    label: "Matched",
    className: "text-green-700",
    dotClass: "bg-green-600",
  };
}

function DealMetaItem({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 border-border/70 text-foreground lg:border-l lg:pl-4 first:lg:border-l-0 first:lg:pl-0">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium leading-tight">{value}</p>
      </div>
    </div>
  );
}

function DealStatCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "red" | "amber";
}) {
  const valueClass = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  const iconClass =
    tone === "red"
      ? "bg-red-50 text-red-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : "bg-muted text-muted-foreground";
  return (
    <div className="min-h-[58px] border-b p-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0">
      <div className="flex items-center gap-3">
        <span className={`flex size-8 items-center justify-center rounded-md ${iconClass}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <p className={`text-lg font-semibold leading-none ${valueClass}`}>{value}</p>
            <p className="truncate text-sm font-medium leading-tight">{label.toLowerCase()}</p>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function DepositVerificationCard({
  verification,
  depositAmount,
  depositHolder,
  depositMethod,
  proofFound,
  confirming,
  onConfirm,
}: {
  verification: DepositVerificationRow | null;
  depositAmount: string;
  depositHolder: string;
  depositMethod: string;
  proofFound: boolean;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const confirmed = verification?.status === "confirmed";
  const confirmer = verification ? verificationSourceLabel(verification) : null;
  const amountValue = formatDepositAmount(depositAmount);

  return (
    <Card className="gap-0 overflow-hidden border border-orange-300 py-0 shadow-none ring-1 ring-orange-300">
      <div className="flex flex-row items-center justify-between gap-4 border-b border-orange-300 bg-orange-50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheckIcon className="size-4 shrink-0 text-orange-700" />
          <CardTitle className="shrink-0 text-sm font-semibold">Deposit verification</CardTitle>
          <p className="truncate text-xs text-orange-900/85">
            Confirm the bank deposit matches the proof of deposit received.
          </p>
        </div>
        <Badge
          className={
            confirmed
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }
          variant="outline"
        >
          {confirmed ? "Verified" : "Not verified"}
        </Badge>
      </div>
      <CardContent className="grid gap-4 p-2.5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid gap-0 sm:grid-cols-2 xl:grid-cols-4">
          <DepositMeta label="Proof status" value={proofFound ? "Proof received" : "Proof not found"} tone={proofFound ? "default" : "red"} />
          <DepositMeta label="Amount" value={amountValue} />
          <DepositMeta label="Held by Sutton Admiral" value={depositHolder || "Not extracted"} />
          <DepositMeta label="Method" value={depositMethod || "Not extracted"} />
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          {confirmed ? (
            <p className="text-sm text-muted-foreground">
              Confirmed {formatShortDateTime(verification.confirmed_at)} by {confirmer}
            </p>
          ) : null}
          <Button
            variant="outline"
            onClick={onConfirm}
            disabled={confirming}
            className="border-border bg-background px-3"
          >
            <CheckCircle2Icon className="size-4" />
            {confirmed ? "Confirm again" : "Confirm received"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DepositMeta({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "red" }) {
  return (
    <div className="border-b px-3 py-2.5 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:border-r sm:even:border-r-0 xl:border-b-0 xl:even:border-r xl:last:border-r-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${tone === "red" ? "text-red-700" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

function formatDepositAmount(value: string) {
  if (!value) return "Not extracted";
  const numeric = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(numeric)) return value;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

function verificationSourceLabel(verification: DepositVerificationRow) {
  if (verification.source_email) return verification.source_email;
  const profile = Array.isArray(verification.profiles) ? verification.profiles[0] : verification.profiles;
  return profile?.full_name || profile?.email || "staff member";
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
  deal,
  recipientOptions,
  reminders,
  reminderTasks,
  selectedReminderTaskIds,
  onSelectedReminderTaskIdsChange,
  onSelectedAgentChange,
  recipientMode,
  onRecipientModeChange,
  recipient,
  onRecipientChange,
  followupDelayBusinessDays,
  onFollowupDelayBusinessDaysChange,
  maxFollowups,
  onMaxFollowupsChange,
  escalateAfterDays,
  onEscalateAfterDaysChange,
  onGenerateDraft,
  draftingReminder,
  onMarkSent,
  sendingReminderId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: DealRow;
  recipientOptions: RecipientOption[];
  reminders: ReminderRow[];
  reminderTasks: ReminderTaskOption[];
  selectedReminderTaskIds: string[];
  onSelectedReminderTaskIdsChange: (ids: string[]) => void;
  onSelectedAgentChange: (agentId: string) => void;
  recipientMode: string;
  onRecipientModeChange: (mode: string) => void;
  recipient: string;
  onRecipientChange: (recipient: string) => void;
  followupDelayBusinessDays: number;
  onFollowupDelayBusinessDaysChange: (value: number) => void;
  maxFollowups: number;
  onMaxFollowupsChange: (value: number) => void;
  escalateAfterDays: number;
  onEscalateAfterDaysChange: (value: number) => void;
  onGenerateDraft: (options?: { followupEnabled?: boolean }) => Promise<ReminderRow | null>;
  draftingReminder: boolean;
  onMarkSent: (reminderId: string) => Promise<void>;
  sendingReminderId: string | null;
}) {
  const sortedReminders = [...reminders].sort((a, b) => {
    const bTime = new Date(b.sent_at ?? b.drafted_at ?? b.created_at).getTime();
    const aTime = new Date(a.sent_at ?? a.drafted_at ?? a.created_at).getTime();
    return bTime - aTime;
  });
  const previewReminder =
    sortedReminders.find((reminder) => reminder.status === "draft") ?? sortedReminders[0];
  const selectedTasks = reminderTasks.filter((task) => selectedReminderTaskIds.includes(task.id));
  const selectedCount = selectedTasks.length;
  const recipientOption = recipientOptions.find((option) => option.id === recipientMode);
  const recipientLabel = recipientOption?.label.split(" - ")[0] ?? (recipient || "Other recipient");
  const recipientInitials = initialsFor(recipientLabel);
  const subject = previewReminder?.subject ?? `Action required: Missing documents for ${formatDealTitle(deal)}`;
  const body = previewReminder?.body ?? buildReminderPreviewBody({
    deal,
    recipientLabel,
    tasks: selectedTasks,
  });
  async function sendSelectedReminder(followupEnabled: boolean) {
    const reminder =
      previewReminder?.status === "draft" && draftMatchesSelectedSchedule(previewReminder, followupEnabled, {
        followupDelayBusinessDays,
        maxFollowups,
        escalateAfterDays,
      })
        ? previewReminder
        : await onGenerateDraft({ followupEnabled });
    if (reminder?.id) await onMarkSent(reminder.id);
  }
  const applyStandardSchedule = () => {
    onFollowupDelayBusinessDaysChange(2);
    onMaxFollowupsChange(3);
    onEscalateAfterDaysChange(7);
  };
  const applyUrgentSchedule = () => {
    onFollowupDelayBusinessDaysChange(1);
    onMaxFollowupsChange(2);
    onEscalateAfterDaysChange(3);
  };
  const isUrgentSchedule = followupDelayBusinessDays === 1 && maxFollowups === 2 && escalateAfterDays === 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl bg-muted p-0 sm:max-w-[1040px]">
        <DialogHeader className="border-b bg-background px-5 py-4 pr-14">
          <DialogTitle>Send reminder</DialogTitle>
          <DialogDescription className="flex min-w-0 items-start gap-1 text-xs text-foreground">
            <MapPinIcon className="mt-0.5 size-3 shrink-0" />
            <span className="break-words">{shortDealAddress(deal)} - {deal.transaction_type || "deal"} - {deal.scenario_label || "scenario pending"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="flex min-w-0 flex-col gap-3 bg-background p-5 pb-6">
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sending to</p>
              <div className="flex flex-col gap-3 rounded-lg border bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-800">
                    {recipientInitials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{recipientLabel}</p>
                    <p className="truncate text-xs text-muted-foreground">{recipient || "No email selected"}</p>
                  </div>
                </div>
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm sm:w-[220px] sm:shrink-0"
                  value={recipientMode}
                  onChange={(event) => {
                    const value = event.target.value;
                    onRecipientModeChange(value);
                    if (value === "other") {
                      onSelectedAgentChange("");
                      return;
                    }
                    const option = recipientOptions.find((item) => item.id === value);
                    if (option) {
                      onRecipientChange(option.email);
                      onSelectedAgentChange(value.startsWith("agent:") ? value.replace("agent:", "") : "");
                    }
                  }}
                >
                  {recipientOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                  <option value="other">Other email...</option>
                </select>
              </div>
              {recipientMode === "other" && (
                <Input
                  className="mt-2"
                  placeholder="Recipient email"
                  value={recipient}
                  onChange={(event) => onRecipientChange(event.target.value)}
                />
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Documents included <span className="normal-case tracking-normal">{selectedCount} of {reminderTasks.length} selected</span>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSelectedReminderTaskIdsChange(reminderTasks.map((task) => task.id))}
                >
                  Select all
                </Button>
              </div>
              <div className="space-y-2">
                {reminderTasks.map((task) => {
                  const checked = selectedReminderTaskIds.includes(task.id);
                  return (
                    <label key={task.id} className="flex items-start gap-3 rounded-lg border bg-muted p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={checked}
                        onChange={(event) => {
                          if (event.target.checked) {
                            onSelectedReminderTaskIdsChange([...new Set([...selectedReminderTaskIds, task.id])]);
                          } else {
                            onSelectedReminderTaskIdsChange(selectedReminderTaskIds.filter((id) => id !== task.id));
                          }
                        }}
                      />
                      <span>
                        <span className="font-medium leading-tight">{task.title}</span>
                        <span className="block text-xs text-muted-foreground">{task.documentLabel}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {reminderTasks.length === 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No open missing-document tasks are available. Sync tasks before drafting a reminder.
              </div>
            )}

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Follow-up schedule</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" className={`rounded-lg border bg-background p-3 text-left ${!isUrgentSchedule ? "ring-1 ring-foreground/20" : ""}`} onClick={applyStandardSchedule}>
                  <p className="text-sm font-medium">Standard</p>
                  <p className="text-xs text-muted-foreground">Every 2 days - 3 follow-ups - escalate after 7</p>
                </button>
                <button type="button" className={`rounded-lg border bg-background p-3 text-left ${isUrgentSchedule ? "ring-1 ring-blue-500" : ""}`} onClick={applyUrgentSchedule}>
                  <p className="text-sm font-medium text-blue-700">Urgent</p>
                  <p className="text-xs text-blue-700">Every 1 day - 2 follow-ups - escalate after 3</p>
                </button>
                <div className="rounded-lg border bg-background p-3 text-left">
                  <p className="text-sm font-medium">Custom</p>
                  <p className="text-xs text-muted-foreground">Edit your own schedule</p>
                </div>
              </div>
              <div className="mt-2 rounded-lg border bg-muted p-3 text-sm">
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Next follow-up</span>
                    <span className="font-medium">{followupDelayBusinessDays} business day{followupDelayBusinessDays === 1 ? "" : "s"} after send</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Max follow-ups</span>
                    <Input className="h-7 w-16 text-right" type="number" min={0} max={5} value={maxFollowups} onChange={(event) => onMaxFollowupsChange(Number(event.target.value))} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Escalate after</span>
                    <span className="font-medium">{escalateAfterDays} days with no response</span>
                  </div>
                </div>
                <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                  Follow-ups stop automatically once all documents are received, manually marked, or the deal is closed.
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border bg-background">
              <div className="flex items-center justify-between border-b bg-muted p-3">
                <div className="flex items-center gap-2 text-sm">
                  <MailIcon className="size-4" />
                  <span>Draft preview</span>
                  <Badge className="border-green-200 bg-green-50 text-green-700" variant="outline">Sent once</Badge>
                </div>
                <Button size="sm" variant="outline">
                  <PencilIcon />
                  Edit body
                </Button>
              </div>
              <div className="grid gap-2 p-3 text-sm">
                <div className="grid grid-cols-[64px_1fr] border-b pb-2">
                  <span className="text-muted-foreground">Subject</span>
                  <span className="font-medium">{subject}</span>
                </div>
                <div className="grid grid-cols-[64px_1fr] border-b pb-2">
                  <span className="text-muted-foreground">To</span>
                  <span>{recipient || "No recipient selected"}</span>
                </div>
                <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-6">{body}</pre>
              </div>
            </div>
          </section>

          <aside className="border-t bg-muted p-4 pb-6 lg:border-l lg:border-t-0">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Reminder History</p>
              <Badge variant="outline">{sortedReminders.length}</Badge>
            </div>
            <div className="space-y-2">
              {sortedReminders.length > 0 ? (
                sortedReminders.map((reminder, index) => (
                  <div key={reminder.id} className="rounded-lg border bg-background p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium leading-5">Reminder #{sortedReminders.length - index}</p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">To: {reminder.recipient}</p>
                        <p className="text-xs text-muted-foreground">{relativeTime(reminder.sent_at ?? reminder.drafted_at ?? reminder.created_at)}</p>
                        <p className="break-words text-xs text-muted-foreground">Subject: {reminder.subject}</p>
                      </div>
                      <Badge className={reminder.status === "sent" ? "border-green-200 bg-green-50 text-green-700" : ""} variant="outline">{reminder.status}</Badge>
                    </div>
                    <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                      <p>Docs received <span className="font-medium text-amber-700">0 of {reminder.requested_documents?.length ?? selectedCount}</span></p>
                      {reminder.next_followup_at && <p>Next follow-up: {formatShortDateTime(reminder.next_followup_at)}</p>}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed bg-background p-4 text-sm text-muted-foreground">
                  Generate a draft to preview it here.
                </div>
              )}
            </div>
            <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next follow-up</p>
              <p className="mt-1 font-medium">{previewReminder?.next_followup_at ? formatShortDateTime(previewReminder.next_followup_at) : `${followupDelayBusinessDays} business day${followupDelayBusinessDays === 1 ? "" : "s"} after send`}</p>
              <Button className="mt-3 w-full" size="sm" variant="outline" disabled>
                <PauseIcon />
                Pause schedule
              </Button>
            </div>
            <p className="mt-4 text-xs leading-5 text-foreground">
              Escalates to broker if no response within {escalateAfterDays} days.
            </p>
          </aside>
        </div>

        <DialogFooter className="mx-0 mb-0 mt-0 shrink-0 flex-wrap gap-2 rounded-none border-t bg-background px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" onClick={() => onGenerateDraft({ followupEnabled: true })} disabled={draftingReminder || selectedReminderTaskIds.length === 0}>
            Save draft
          </Button>
          <Button variant="outline" onClick={() => sendSelectedReminder(false)} disabled={draftingReminder || selectedReminderTaskIds.length === 0 || sendingReminderId === previewReminder?.id}>
            Send only
          </Button>
          <Button onClick={() => sendSelectedReminder(true)} disabled={draftingReminder || selectedReminderTaskIds.length === 0 || sendingReminderId === previewReminder?.id}>
            <SendIcon />
            Send & schedule follow-up
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
                  <Image
                    src={`/api/deals/${dealId}/pages/${activePage.page_number}/image`}
                    alt={`Page ${activePage.page_number}`}
                    width={900}
                    height={1200}
                    unoptimized
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
  currentIso,
  requirementStatuses,
}: {
  checklist: ChecklistItem[];
  dealStatus: string;
  pages: PageRow[];
  tasks: TaskRow[];
  reminders: ReminderRow[];
  currentIso: string;
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
  const reminderStatus = hasSentReminder ? "sent" : hasDraftReminder ? "draft" : "none";
  const activeReminder = reminders.find((reminder) => reminder.status === "sent") ?? reminders.find((reminder) => reminder.status === "draft");

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
      reminderStatus,
      reminderFollowupCount: activeReminder?.followup_count ?? 0,
      reminderNextFollowupAt: activeReminder?.next_followup_at ?? null,
      reminderOverdue: Boolean(activeReminder?.next_followup_at && activeReminder.next_followup_at < currentIso),
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
  if (row.pendingLoneWolf) return "awaiting_sync";
  if (row.found) return "uploaded_matched";
  if (row.requirementLevel === "required") return "outstanding";
  return "not_required";
}

function buildPackageGroups(rows: PackageDocumentRow[]): PackageGroup[] {
  const definitions: Omit<PackageGroup, "rows">[] = [
    { id: "awaiting_sync", label: "Awaiting sync", tone: "amber" },
    { id: "needs_review", label: "Needs review", tone: "amber" },
    { id: "outstanding", label: "Outstanding", tone: "red" },
    { id: "uploaded_matched", label: "Uploaded & matched", tone: "green" },
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
    pendingLoneWolf: rows.filter((row) => packageBucket(row) === "awaiting_sync").length,
  };
}

function filterPackageRows(rows: PackageDocumentRow[], filter: PackageFilter) {
  if (filter === "uploaded_matched") {
    return rows.filter((row) => packageBucket(row) === "uploaded_matched");
  }
  if (filter === "outstanding") return rows.filter((row) => packageBucket(row) === "outstanding");
  if (filter === "not_required") return rows.filter((row) => packageBucket(row) === "not_required");
  if (filter === "needs_review") return rows.filter((row) => packageBucket(row) === "needs_review");
  if (filter === "pending_lonewolf") return rows.filter((row) => packageBucket(row) === "awaiting_sync");
  return rows;
}

function buildRecipientOptions({
  agents,
  inboundEmailContacts,
  fields,
}: {
  agents: AgentRow[];
  inboundEmailContacts: InboundEmailContact[];
  fields: FieldRow[];
}): RecipientOption[] {
  const options = new Map<string, RecipientOption>();
  for (const agent of agents) {
    options.set(agent.email.toLowerCase(), {
      id: `agent:${agent.id}`,
      label: `${agent.name} - ${agent.brokerage || "Agent"}`,
      email: agent.email,
    });
  }
  for (const contact of inboundEmailContacts) {
    options.set(contact.email.toLowerCase(), {
      id: `sender:${contact.email}`,
      label: `${contact.name || contact.email} - Package sender`,
      email: contact.email,
    });
  }
  for (const field of fields) {
    if (!field.field_key.includes("email") || !field.value?.includes("@")) continue;
    for (const email of field.value.split(/[;,]/).map((item) => item.trim()).filter(Boolean)) {
      options.set(email.toLowerCase(), {
        id: `field:${field.field_key}:${email}`,
        label: `${email} - Deal information`,
        email,
      });
    }
  }
  return [...options.values()];
}

function shortDealAddress(deal: DealRow) {
  return deal.property_address || deal.file_name || "this transaction";
}

function initialsFor(value: string) {
  const parts = value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "??";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function buildReminderPreviewBody({
  deal,
  recipientLabel,
  tasks,
}: {
  deal: DealRow;
  recipientLabel: string;
  tasks: ReminderTaskOption[];
}) {
  const agentName = recipientLabel || "there";
  const taskLines = tasks.map((task, index) => `${index + 1}. ${cleanReminderDocumentTitle(task.title)}`).join("\n");
  return [
    `Hello ${agentName},`,
    "",
    "We are completing the deal package for:",
    "",
    formatDealTitle(deal),
    deal.scenario_label ? `Scenario: ${deal.scenario_label}` : null,
    "",
    "The following documents are still required:",
    "",
    taskLines || "1. Missing transaction documents",
    "",
    "Please reply to this email with the documents attached, or upload them using the transaction intake link below:",
    "",
    reminderUploadLink(deal),
    "",
    "If these have already been sent, please disregard this reminder or reply and let us know.",
    "",
    "Thank you,",
    "Team Admiral",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function draftMatchesSelectedSchedule(
  reminder: ReminderRow,
  followupEnabled: boolean,
  schedule: { followupDelayBusinessDays: number; maxFollowups: number; escalateAfterDays: number },
) {
  return (
    Boolean(reminder.followup_enabled) === followupEnabled &&
    (reminder.followup_delay_business_days ?? 2) === schedule.followupDelayBusinessDays &&
    (reminder.max_followups ?? 0) === (followupEnabled ? schedule.maxFollowups : 0) &&
    (reminder.escalate_after_days ?? 7) === schedule.escalateAfterDays
  );
}

function cleanReminderDocumentTitle(title: string) {
  return title.replace(/^Request\s+/i, "").trim();
}

function formatDealTitle(deal: DealRow) {
  const dealNumber = formatDealNumber(deal.transaction_code);
  const address = shortDealAddress(deal);
  if (dealNumber && address) return `${dealNumber} - ${address}`;
  return dealNumber ?? address ?? "this transaction";
}

function formatDealNumber(transactionCode: string | null) {
  const value = transactionCode?.trim();
  if (!value) return null;
  return value.startsWith("#") ? value : `#${value}`;
}

function reminderUploadLink(deal: DealRow) {
  const subject = encodeURIComponent(`Missing documents for ${formatDealTitle(deal)}`);
  return `mailto:${INTAKE_ADDRESS}?subject=${subject}`;
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

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return "not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
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
  if (details.source_email || details.from_email || details.source_name || details.from_name) {
    return [
      details.source_name || details.from_name ? `sender_name: ${String(details.source_name ?? details.from_name)}` : null,
      details.source_email || details.from_email ? `sender_email: ${String(details.source_email ?? details.from_email)}` : null,
      details.confirmed_amount || details.proof_amount ? `amount: ${String(details.confirmed_amount ?? details.proof_amount)}` : null,
      details.source_received_at || details.received_at ? `received_at: ${String(details.source_received_at ?? details.received_at)}` : null,
      details.confirmed_at ? `confirmed_at: ${String(details.confirmed_at)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  if (details.confirmed_by_email || details.confirmed_amount || details.proof_amount) {
    return [
      details.confirmed_by_email ? `confirmed_by: ${String(details.confirmed_by_email)}` : null,
      details.confirmed_amount ? `amount: ${String(details.confirmed_amount)}` : null,
      details.confirmed_at ? `confirmed_at: ${String(details.confirmed_at)}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  const entries = Object.entries(details).slice(0, 3);
  return entries
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
      if (value && typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
      return `${key}: ${String(value)}`;
    })
    .join(" | ");
}
