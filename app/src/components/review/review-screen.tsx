"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ArrowUpRightIcon, BellIcon, CalendarIcon, CheckCircle2Icon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, Clock3Icon, CopyIcon, DownloadIcon, FileTextIcon, MailIcon, MapPinIcon, PauseIcon, PencilIcon, PlusIcon, RefreshCwIcon, SendIcon, ShieldCheckIcon, Trash2Icon, UsersIcon } from "lucide-react";
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
  type FieldDef,
  type FieldSection,
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

type LinkedInboundEmailRow = {
  id: string;
  subject: string | null;
  from_email: string | null;
  from_name: string | null;
  received_at: string | null;
  routing_json: Record<string, unknown> | null;
};

type EmailBodySuggestion = {
  inboundEmailId: string;
  emailLabel: string;
  emailMeta: string;
  fieldKey: string;
  label: string;
  value: string;
  confidence: number | null;
  currentValue: string;
  sourceIsEmailBody: boolean;
  hasConflict: boolean;
  isManual: boolean;
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
  user_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  profiles?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
};

type RequirementStatusRow = {
  requirement_id: string;
  lonewolf_status: "not_required" | "pending_upload" | "uploaded" | "unknown";
  lonewolf_uploaded_at: string | null;
  lonewolf_uploaded_by: string | null;
};
type LoneWolfRequirementStatus = RequirementStatusRow["lonewolf_status"];

type ConditionRow = {
  id: string;
  condition_type: string | null;
  due_date: string | null;
  met_date: string | null;
  completed: boolean;
  sort_order: number;
};

type LoneWolfWorkflowStatus = "not_started" | "open" | "complete" | "blocked";
type LoneWolfStepStatus = "not_started" | "in_progress" | "completed" | "blocked" | "skipped";

type LoneWolfWorkspaceRow = {
  deal_id: string;
  trade_number: string | null;
  sub_trade: string | null;
  status: LoneWolfWorkflowStatus;
  key_info_status: LoneWolfStepStatus;
  people_status: LoneWolfStepStatus;
  outside_brokers_status: LoneWolfStepStatus;
  commissions_status: LoneWolfStepStatus;
  initial_documents_status: LoneWolfStepStatus;
  trade_record_sheet_status: LoneWolfStepStatus;
  signed_trade_record_sheet_status: LoneWolfStepStatus;
  notes: string | null;
  updated_at: string;
};

type LoneWolfWorkspaceDraft = {
  tradeNumber: string;
  subTrade: string;
  status: LoneWolfWorkflowStatus;
  keyInfoStatus: LoneWolfStepStatus;
  peopleStatus: LoneWolfStepStatus;
  outsideBrokersStatus: LoneWolfStepStatus;
  commissionsStatus: LoneWolfStepStatus;
  initialDocumentsStatus: LoneWolfStepStatus;
  tradeRecordSheetStatus: LoneWolfStepStatus;
  signedTradeRecordSheetStatus: LoneWolfStepStatus;
  notes: string;
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

type TradeRecordSheetAttachment = {
  id: string;
  name: string;
  receivedAt: string | null;
  status: string;
  confidence: number | null;
};

type LoneWolfAutomationPacket = {
  version: "lonewolf-entry-v0";
  generatedAt: string;
  safeMode: {
    reviewedFieldsOnly: boolean;
    stopOnUnexpectedScreen: boolean;
    requireOperatorConfirmation: boolean;
  };
  deal: {
    id: string;
    address: string;
    transactionType: string;
    scenario: string | null;
  };
  loneWolf: {
    tradeNumber: string;
    subTrade: string;
    status: LoneWolfWorkflowStatus;
  };
  readiness: {
    ready: boolean;
    blockers: string[];
    warnings: string[];
    nextAction: string;
  };
  entrySections: Array<{
    title: string;
    fields: Array<{ key: string; label: string; value: string }>;
  }>;
  keyboardPlans: {
    keyInfo: LoneWolfKeyboardPlan;
  };
  documents: {
    pendingUpload: Array<{ requirementId: string; label: string; documentLabel: string; pages: number[] }>;
    uploaded: Array<{ requirementId: string; label: string; uploadedAt: string | null }>;
    needsReview: Array<{ requirementId: string; label: string; reason: string }>;
  };
  tradeRecordSheet: {
    generatedAndSentStatus: LoneWolfStepStatus;
    signedUploadStatus: LoneWolfStepStatus;
    candidateAttachments: TradeRecordSheetAttachment[];
  };
};

type LoneWolfKeyboardPlanStep = {
  order: number;
  fieldKey: string;
  loneWolfLabel: string;
  value: string;
  action: "type" | "select" | "skip" | "verify";
  tabAfter: number;
  note?: string;
};

type LoneWolfKeyboardPlan = {
  id: "key_info";
  title: string;
  mode: "dry_run_no_store";
  startingFocus: string;
  stopBefore: string;
  expectedSeconds: { low: number; high: number };
  assumptions: string[];
  steps: LoneWolfKeyboardPlanStep[];
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
  loneWolfStatus: LoneWolfRequirementStatus;
  loneWolfUploadedAt: string | null;
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

const CHECKBOX_FIELD_KEYS = new Set([
  "additional_payees",
  "marketing_fee",
  "rebate_to_clients",
  "referral",
  "seller_landlord_main_contact",
  "seller_landlord_moving_out",
  "buyer_tenant_main_contact",
  "outside_brokerage_hst_exempt",
  "referral_hst_exempt",
]);
const CONDITIONAL_FIELD_GATES: Record<string, string> = {
  additional_payee_1_name: "additional_payees",
  additional_payee_1_commission_pct: "additional_payees",
  additional_payee_2_name: "additional_payees",
  additional_payee_2_commission_pct: "additional_payees",
  marketing_fee_amount: "marketing_fee",
  rebate_amount: "rebate_to_clients",
  referral_to: "referral",
  referral_network: "referral",
  referral_agent_name: "referral",
  referral_address: "referral",
  referral_email: "referral",
  referral_phone: "referral",
  referral_fax: "referral",
  referral_contact_name: "referral",
  referral_contact_number: "referral",
  referral_contact_email: "referral",
  referral_pay_broker: "referral",
  referral_end: "referral",
  referral_hst: "referral",
  referral_hst_exempt: "referral",
  referral_charged_hst: "referral",
  referral_franchise: "referral",
};

const LONE_WOLF_PARTY_TYPE_OPTIONS = [
  "Buyer",
  "Seller",
  "Escrow Company",
  "Landlord",
  "Mortgage Company",
  "Solicitor",
  "Tenant",
  "Title Company",
];

const LONE_WOLF_SELECT_OPTIONS: Record<string, string[]> = {
  seller_landlord_type: LONE_WOLF_PARTY_TYPE_OPTIONS,
  buyer_tenant_type: LONE_WOLF_PARTY_TYPE_OPTIONS,
  property_type: [
    "COMMERCIAL",
    "CONDO",
    "FARM",
    "FREEHOLD",
    "LAND",
    "MULTI FAMILY",
    "OFFICE",
    "RETAIL",
  ],
  we_manage: ["Yes", "No"],
  condition_type: [
    "Financing",
    "Inspection",
    "Status Certificate",
    "Lawyer Approval - Seller",
    "Lawyer Approval - Buyer",
    "Sale Of Purchaser's Property",
    "Due Diligence",
    "Builder Approval of Assignment",
  ],
  outside_brokerage_pay_broker: ["Yes", "No"],
  outside_brokerage_end: ["Listing", "Selling"],
  outside_brokerage_charged_hst: ["Yes", "No"],
  referral_pay_broker: ["Yes", "No"],
  referral_end: ["Listing", "Selling"],
  referral_charged_hst: ["Yes", "No"],
};

const LONE_WOLF_ENTRY_TABS: { id: string; label: string; loneWolfHint: string; sectionTitles: string[] }[] = [
  {
    id: "key_info",
    label: "Key Info",
    loneWolfHint: "Trade Records → Key Info tab",
    sectionTitles: ["Key Info - Trade Record", "Key Info - Dates", "Key Info - Trade Details"],
  },
  {
    id: "people",
    label: "People",
    loneWolfHint: "Trade Records → People tab",
    sectionTitles: ["People - Seller / Landlord", "People - Buyer / Tenant", "People - Solicitors"],
  },
  {
    id: "outside_brokers",
    label: "Outside Brokers",
    loneWolfHint: "Trade Records → Outside Brokers tab",
    sectionTitles: ["Outside Brokers", "Outside Brokers - Referral"],
  },
  {
    id: "commissions",
    label: "Commissions",
    loneWolfHint: "Trade Records → Commissions tab",
    sectionTitles: [
      "Commissions - Sale Closing",
      "Commissions - Income",
      "Commissions - Outside Brokers & Expenses",
    ],
  },
  {
    id: "agent_info",
    label: "Agent Info",
    loneWolfHint: "Trade Records → Agent Info tab",
    sectionTitles: ["Agent Info"],
  },
  {
    id: "sides_deposit",
    label: "Sides & Deposit",
    loneWolfHint: "Reference only — not entered as a Lone Wolf tab",
    sectionTitles: ["Brokerage Sides", "Deposit Reference - Not Trust Entry"],
  },
];

const SECTION_PANEL_PREFIXES = ["Key Info - ", "People - ", "Commissions - "];

function sectionPanelTitle(title: string) {
  for (const prefix of SECTION_PANEL_PREFIXES) {
    if (title.startsWith(prefix)) return title.slice(prefix.length);
  }
  return title;
}

function peopleSectionSummary(sectionTitle: string, currentValue: FieldValueGetter) {
  if (sectionTitle === "People - Seller / Landlord") {
    return partySummary(currentValue("seller_landlord_type"), currentValue("seller_landlord_names"));
  }
  if (sectionTitle === "People - Buyer / Tenant") {
    return partySummary(currentValue("buyer_tenant_type"), currentValue("buyer_tenant_names"));
  }
  if (sectionTitle === "People - Solicitors") {
    const sellerLawyer = currentValue("seller_lawyer_name");
    const buyerLawyer = currentValue("buyer_lawyer_name");
    const parts = [
      sellerLawyer ? `Seller/Landlord: ${sellerLawyer}` : null,
      buyerLawyer ? `Buyer/Tenant: ${buyerLawyer}` : null,
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" | ") : "Not set";
  }
  return "";
}

function partySummary(type: string, name: string) {
  const parts = [type || "Type not set", name].filter(Boolean);
  return parts.join(" - ");
}

type FieldValueGetter = (key: string) => string;

function loneWolfFieldSuggestion(fieldKey: string, currentValue: FieldValueGetter, deal: DealRow) {
  if (currentValue(fieldKey).trim()) return "";

  const parsedAddress = parseLoneWolfPropertyAddress(currentValue("property_address"));
  if (fieldKey === "street_number") return parsedAddress.streetNumber;
  if (fieldKey === "street_name") return parsedAddress.streetName;
  if (fieldKey === "city") return parsedAddress.city;
  if (fieldKey === "province") return parsedAddress.province;
  if (fieldKey === "postal_code") return parsedAddress.postalCode;
  if (fieldKey === "we_manage") return "No";
  if (fieldKey === "condition_type") return inferLoneWolfConditionType(currentValue("conditions_summary"));
  if (fieldKey === "outside_brokerage_pay_broker" && currentValue("outside_brokerage").trim()) return "Yes";
  if (fieldKey === "outside_brokerage_charged_hst" && currentValue("outside_brokerage").trim()) return "Yes";
  if (fieldKey === "outside_brokerage_commission_pct" && currentValue("outside_brokerage").trim()) {
    return outsideBrokerCommissionSuggestion(currentValue, deal);
  }
  return "";
}

function outsideBrokerCommissionSuggestion(currentValue: FieldValueGetter, deal: DealRow) {
  const outsideEnd = currentValue("outside_brokerage_end").trim().toLowerCase();
  if (outsideEnd === "listing") return currentValue("listing_commission_pct");
  if (outsideEnd === "selling") return currentValue("cooperating_commission_pct");

  const perspective = commissionPerspectiveForDeal(deal);
  if (perspective.listingSide && !perspective.cooperatingSide) return currentValue("cooperating_commission_pct");
  if (perspective.cooperatingSide && !perspective.listingSide) return currentValue("listing_commission_pct");
  return "";
}

function commissionPerspectiveForDeal(deal: DealRow) {
  const key = deal.scenario_key ?? "";
  const label = (deal.scenario_label ?? "").toLowerCase();
  const listingSide =
    key.startsWith("sale_seller") ||
    key.startsWith("lease_landlord") ||
    key === "sale_same_agent_both_sides" ||
    key === "lease_same_agent_both_sides" ||
    label.includes("seller rep") ||
    label.includes("landlord rep");
  const cooperatingSide =
    key.startsWith("sale_buyer") ||
    key.startsWith("lease_tenant") ||
    key === "sale_same_agent_both_sides" ||
    key === "lease_same_agent_both_sides" ||
    key === "sale_seller_rep_buyer_sga" ||
    key === "lease_landlord_rep_tenant_sga" ||
    key === "pre_construction" ||
    label.includes("buyer rep") ||
    label.includes("tenant rep");
  return { listingSide, cooperatingSide };
}

function parseLoneWolfPropertyAddress(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  const streetPart = parts[0] ?? "";
  const streetMatch = streetPart.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  const postalMatch = normalized.match(/[A-Z]\d[A-Z][ -]?\d[A-Z]\d/i);
  const provincePart = parts.find((part) => /^(ON|Ontario)$/i.test(part)) ?? "";
  const city = parts.find((part, index) => index > 0 && !/^(ON|Ontario)$/i.test(part) && !/[A-Z]\d[A-Z][ -]?\d[A-Z]\d/i.test(part)) ?? "";

  return {
    streetNumber: streetMatch?.[1] ?? "",
    streetName: streetMatch?.[2] ?? "",
    city,
    province: provincePart ? "Ontario" : "",
    postalCode: postalMatch ? formatLoneWolfPostalCode(postalMatch[0]) : "",
  };
}

function formatLoneWolfPostalCode(value: string) {
  const compact = value.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (compact.length !== 6) return value.toUpperCase();
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}

function inferLoneWolfConditionType(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("status certificate")) return "Status Certificate";
  if (normalized.includes("inspection")) return "Inspection";
  if (normalized.includes("financ")) return "Financing";
  if (normalized.includes("lawyer") && normalized.includes("seller")) return "Lawyer Approval - Seller";
  if (normalized.includes("lawyer") && normalized.includes("buyer")) return "Lawyer Approval - Buyer";
  if (normalized.includes("due diligence")) return "Due Diligence";
  if (normalized.includes("assignment")) return "Builder Approval of Assignment";
  if (normalized.includes("purchaser")) return "Sale Of Purchaser's Property";
  return "";
}

export function ReviewScreen({
  deal,
  pages,
  fields,
  checklistResult,
  tasks,
  reminders,
  inboundEmailContacts = [],
  linkedInboundEmails = [],
  agents,
  requirementStatuses,
  conditions,
  loneWolfWorkspace,
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
  linkedInboundEmails?: LinkedInboundEmailRow[];
  agents: AgentRow[];
  requirementStatuses: RequirementStatusRow[];
  conditions: ConditionRow[];
  loneWolfWorkspace: LoneWolfWorkspaceRow | null;
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
  const [activeEntryTab, setActiveEntryTab] = useState(LONE_WOLF_ENTRY_TABS[0].id);
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
  const [loneWolfDraft, setLoneWolfDraft] = useState<LoneWolfWorkspaceDraft>(() =>
    loneWolfWorkspaceDraftFromRow(loneWolfWorkspace),
  );
  const [savingLoneWolfWorkspace, setSavingLoneWolfWorkspace] = useState(false);
  const [emailBodySuggestionSelections, setEmailBodySuggestionSelections] = useState<Record<string, boolean>>({});
  const [applyingEmailBodyFields, setApplyingEmailBodyFields] = useState(false);

  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.field_key, f])), [fields]);
  const emailBodySuggestions = useMemo(
    () => buildEmailBodySuggestions(linkedInboundEmails, fieldMap),
    [linkedInboundEmails, fieldMap],
  );
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
  const tradeRecordSheetAttachments = useMemo(
    () => buildTradeRecordSheetAttachments(emailAttachments, pages),
    [emailAttachments, pages],
  );
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
  const entryTabs = useMemo(
    () =>
      LONE_WOLF_ENTRY_TABS.map((tab) => ({
        ...tab,
        sections: FIELD_SECTIONS.filter((section) => tab.sectionTitles.includes(section.title)),
      })),
    [],
  );
  const entryTabStats = entryTabs.map((tab) => ({
    id: tab.id,
    stats: buildFieldReviewStats({
      fieldMap,
      currentValue,
      isHidden: (fieldKey) => isConditionalFieldHidden(fieldKey, currentValue),
      sections: tab.sections,
    }),
  }));
  const activeTab = entryTabs.find((tab) => tab.id === activeEntryTab) ?? entryTabs[0];
  const activeTabStats =
    entryTabStats.find((entry) => entry.id === activeTab.id)?.stats ?? { all: 0, needsReview: 0, confirmed: 0, unverified: 0 };
  const activeTabConfirmedPct =
    activeTabStats.all === 0 ? 100 : Math.round((activeTabStats.confirmed / activeTabStats.all) * 100);
  const loneWolfAutomationPacket = buildLoneWolfAutomationPacket({
    deal,
    draft: loneWolfDraft,
    fieldReviewStats,
    packageRows,
    tradeRecordSheetAttachments,
    currentValue,
  });

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

  function emailBodySuggestionSelected(suggestion: EmailBodySuggestion) {
    const key = emailBodySuggestionId(suggestion);
    return emailBodySuggestionSelections[key] ?? (!suggestion.hasConflict && !suggestion.isManual);
  }

  function toggleEmailBodySuggestion(suggestion: EmailBodySuggestion, checked: boolean) {
    setEmailBodySuggestionSelections((prev) => ({
      ...prev,
      [emailBodySuggestionId(suggestion)]: checked,
    }));
  }

  async function applySelectedEmailBodySuggestions() {
    const selected = emailBodySuggestions.filter(emailBodySuggestionSelected);
    if (selected.length === 0) {
      toast.error("Choose at least one email field to apply.");
      return;
    }

    const byEmail = new Map<string, string[]>();
    for (const suggestion of selected) {
      byEmail.set(suggestion.inboundEmailId, [
        ...(byEmail.get(suggestion.inboundEmailId) ?? []),
        suggestion.fieldKey,
      ]);
    }

    setApplyingEmailBodyFields(true);
    try {
      let applied = 0;
      for (const [inboundEmailId, fieldKeys] of byEmail) {
        const res = await fetch(`/api/deals/${deal.id}/email-body-fields`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inboundEmailId, fieldKeys }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "Could not apply email body fields");
        applied += typeof body?.applied === "number" ? body.applied : 0;
      }
      toast.success(`${applied} email field${applied === 1 ? "" : "s"} applied.`);
      setEmailBodySuggestionSelections({});
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply email body fields");
    } finally {
      setApplyingEmailBodyFields(false);
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

  async function copyText(value: string, successMessage: string) {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  }

  async function copyLoneWolfAutomationPacket() {
    await copyText(JSON.stringify(loneWolfAutomationPacket, null, 2), "Lone Wolf automation packet copied.");
  }

  async function copyLoneWolfNextAction() {
    await copyText(loneWolfAutomationPacket.readiness.nextAction, "Lone Wolf next action copied.");
  }

  async function copyLoneWolfKeyInfoPlan() {
    await copyText(
      JSON.stringify(loneWolfAutomationPacket.keyboardPlans.keyInfo, null, 2),
      "Lone Wolf Key Info dry-run plan copied.",
    );
  }

  async function copyFieldSection(section: FieldSection, visibleFields: FieldDef[]) {
    const lines = [
      `${friendlyFieldSectionTitle(section.title)}:`,
      ...visibleFields.map((field) => `${field.label}: ${currentValue(field.key) || ""}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(`${friendlyFieldSectionTitle(section.title)} copied.`);
  }

  async function copyEntryTab(tab: (typeof entryTabs)[number]) {
    const lines: string[] = [tab.label];
    for (const section of tab.sections) {
      const visibleFields = section.fields.filter((field) => !isConditionalFieldHidden(field.key, currentValue));
      lines.push("", `${sectionPanelTitle(section.title)}:`);
      for (const field of visibleFields) {
        lines.push(`${field.label}: ${currentValue(field.key) || ""}`);
      }
    }
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success(`${tab.label} screen copied.`);
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

  async function updateLoneWolfRequirementStatus(requirementId: string, status: LoneWolfRequirementStatus) {
    setWorkingRequirementId(requirementId);
    try {
      const res = await fetch(
        `/api/deals/${deal.id}/requirements/${encodeURIComponent(requirementId)}/lonewolf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not update Lone Wolf status");
      toast.success(loneWolfRequirementStatusToast(status));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update Lone Wolf status");
    } finally {
      setWorkingRequirementId(null);
    }
  }

  async function markAllLoneWolfUploaded(rows: PackageDocumentRow[]) {
    for (const row of rows.filter((candidate) => candidate.canMarkLoneWolfUploaded)) {
      await updateLoneWolfRequirementStatus(row.requirementId, "uploaded");
    }
  }

  async function saveLoneWolfWorkspace(nextDraft = loneWolfDraft) {
    setSavingLoneWolfWorkspace(true);
    try {
      const res = await fetch(`/api/deals/${deal.id}/lonewolf`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextDraft),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not update Lone Wolf workspace");
      toast.success("Lone Wolf workspace updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update Lone Wolf workspace");
    } finally {
      setSavingLoneWolfWorkspace(false);
    }
  }

  async function updateLoneWolfStep(key: keyof LoneWolfWorkspaceDraft, status: LoneWolfStepStatus) {
    const nextDraft = { ...loneWolfDraft, [key]: status };
    setLoneWolfDraft(nextDraft);
    await saveLoneWolfWorkspace(nextDraft);
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

  function renderFieldGrid(visibleFields: FieldDef[]) {
    return (
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
          const selectOptions = LONE_WOLF_SELECT_OPTIONS[f.key];
          const sourceLabel = fieldSourceLabel(row, pageLabelByNumber);
          const inputClassName = reviewInputClass(fieldStatus.tone, fieldDirty);
          const wideClass = f.wide || f.multiline || conflictSources.length > 1 ? "md:col-span-2" : "";
          const suggestion = loneWolfFieldSuggestion(f.key, currentValue, deal);

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
                ) : selectOptions ? (
                  <select
                    id={inputId}
                    className={`h-8 flex-1 rounded-md border px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${inputClassName}`}
                    value={value}
                    onFocus={() => jumpToFieldSource(row, f.key)}
                    onChange={(e) => setEdited((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    {selectOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
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
                {suggestion && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                    onClick={() => setEdited((prev) => ({ ...prev, [f.key]: suggestion }))}
                  >
                    Use suggestion: {suggestion}
                  </button>
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
    );
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
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <DealMetaItem
            icon={FileTextIcon}
            label="Lone Wolf Trade #"
            value={loneWolfDraft.tradeNumber || "Not entered"}
            actionLabel={loneWolfDraft.tradeNumber ? "Copy" : undefined}
            onAction={loneWolfDraft.tradeNumber ? () => copyText(loneWolfDraft.tradeNumber, "Trade number copied.") : undefined}
          />
          <DealMetaItem
            icon={FileTextIcon}
            label="Sub-trade"
            value={loneWolfDraft.subTrade || (loneWolfDraft.tradeNumber ? `${loneWolfDraft.tradeNumber}-A` : "Not entered")}
            actionLabel={loneWolfDraft.subTrade || loneWolfDraft.tradeNumber ? "Copy" : undefined}
            onAction={
              loneWolfDraft.subTrade || loneWolfDraft.tradeNumber
                ? () => copyText(loneWolfDraft.subTrade || `${loneWolfDraft.tradeNumber}-A`, "Sub-trade copied.")
                : undefined
            }
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

      <EmailBodySuggestionsPanel
        suggestions={emailBodySuggestions}
        selected={emailBodySuggestionSelected}
        onToggle={toggleEmailBodySuggestion}
        onApply={applySelectedEmailBodySuggestions}
        applying={applyingEmailBodyFields}
      />

      <DepositVerificationCard
        verification={depositVerification}
        depositAmount={depositAmount}
        depositHolder={depositHolder}
        depositMethod={depositMethod}
        proofFound={depositProofFound}
        confirming={confirmingDeposit}
        onConfirm={confirmDeposit}
      />

      <LoneWolfWorkspacePanel
        workspace={loneWolfWorkspace}
        draft={loneWolfDraft}
        saving={savingLoneWolfWorkspace}
        pendingDocumentCount={packageCounts.pendingLoneWolf}
        tradeRecordSheetAttachments={tradeRecordSheetAttachments}
        automationPacket={loneWolfAutomationPacket}
        onDraftChange={setLoneWolfDraft}
        onSave={() => saveLoneWolfWorkspace()}
        onStepStatusChange={updateLoneWolfStep}
        onCopyAutomationPacket={copyLoneWolfAutomationPacket}
        onCopyNextAction={copyLoneWolfNextAction}
        onCopyKeyInfoPlan={copyLoneWolfKeyInfoPlan}
      />

      <PackageDocumentsPanel
        rows={packageRows}
        activeFilter={packageFilter}
        onFilterChange={setPackageFilter}
        onUpdateLoneWolfStatus={updateLoneWolfRequirementStatus}
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
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span>Lone Wolf entry packet</span>
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

                <div className="-mb-px flex flex-wrap items-end gap-1 border-b">
                  {entryTabs.map((tab) => {
                    const stats = entryTabStats.find((entry) => entry.id === tab.id)?.stats;
                    const active = tab.id === activeTab.id;
                    const needsReview = stats?.needsReview ?? 0;
                    const complete = (stats?.all ?? 0) > 0 && stats?.confirmed === stats?.all;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveEntryTab(tab.id)}
                        className={`flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm transition ${
                          active
                            ? "border-border bg-background font-semibold text-foreground shadow-[0_1px_0_0_var(--background)]"
                            : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        }`}
                      >
                        {tab.label}
                        {needsReview > 0 ? (
                          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">
                            {needsReview}
                          </span>
                        ) : complete ? (
                          <CheckCircle2Icon className="size-3.5 text-green-600" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold leading-tight">{activeTab.label}</h2>
                  <p className="text-xs text-muted-foreground">{activeTab.loneWolfHint}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden items-center gap-2 sm:flex">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-green-600" style={{ width: `${activeTabConfirmedPct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {activeTabStats.confirmed}/{activeTabStats.all}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => copyEntryTab(activeTab)}
                  >
                    <CopyIcon className="size-3.5" />
                    Copy screen
                  </Button>
                </div>
              </div>

              {(() => {
                const renderedSections = activeTab.sections
                  .map((section) => {
                    const visibleFields = section.fields.filter((f) => {
                      if (isConditionalFieldHidden(f.key, currentValue)) return false;
                      const row = fieldMap.get(f.key);
                      const value = currentValue(f.key);
                      const conflictSources = validConflictSources(row?.conflict_sources);
                      const fieldStatus = getFieldStatus(f.key, row, conflictSources.length, fieldMap, value);
                      return fieldMatchesReviewFilter(fieldStatus, fieldReviewFilter);
                    });
                    return { section, visibleFields };
                  })
                  .filter((entry) => entry.visibleFields.length > 0);

                if (renderedSections.length === 0) {
                  return (
                    <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                      No fields in this screen match the current filter.
                    </p>
                  );
                }

                return (
                  <>
                    {renderedSections.map(({ section, visibleFields }) =>
                      activeTab.id === "people" ? (
                        <CollapsiblePeopleCard
                          key={section.title}
                          title={sectionPanelTitle(section.title)}
                          summary={peopleSectionSummary(section.title, currentValue)}
                          onCopy={() => copyFieldSection(section, visibleFields)}
                        >
                          {renderFieldGrid(visibleFields)}
                        </CollapsiblePeopleCard>
                      ) : (
                        <section key={section.title} className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {sectionPanelTitle(section.title)}
                            </h3>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => copyFieldSection(section, visibleFields)}
                            >
                              <CopyIcon className="size-3" />
                              Copy section
                            </Button>
                          </div>
                          {renderFieldGrid(visibleFields)}
                        </section>
                      ),
                    )}
                    {activeTab.id === "key_info" && (
                      <ConditionsPanel
                        dealId={deal.id}
                        conditions={conditions}
                        firmOrConditional={currentValue("firm_or_conditional")}
                      />
                    )}
                    {activeTab.id === "commissions" && (
                      <CommissionFormulaPanel currentValue={currentValue} />
                    )}
                  </>
                );
              })()}
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
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="font-medium">{formatAction(log.action)}</p>
                      <p className="text-xs text-muted-foreground">By {formatAuditActor(log)}</p>
                    </div>
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

function CollapsiblePeopleCard({
  title,
  summary,
  onCopy,
  children,
}: {
  title: string;
  summary: string;
  onCopy: () => void;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="space-y-3 rounded-md border p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronDownIcon className={`size-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
          <span className="truncate text-sm text-foreground">{summary}</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
        >
          <CopyIcon className="size-3" />
          Copy section
        </Button>
      </button>
      {expanded && children}
    </section>
  );
}

function ConditionsPanel({
  dealId,
  conditions,
  firmOrConditional,
}: {
  dealId: string;
  conditions: ConditionRow[];
  firmOrConditional: string;
}) {
  const router = useRouter();
  const isFirm = firmOrConditional.trim().toLowerCase().startsWith("firm");
  const [expanded, setExpanded] = useState(!isFirm);
  const [addingCondition, setAddingCondition] = useState(false);
  const [savingConditionId, setSavingConditionId] = useState<string | null>(null);
  const [removingConditionId, setRemovingConditionId] = useState<string | null>(null);

  async function addCondition() {
    setAddingCondition(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/conditions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: conditions.length }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not add condition");
      setExpanded(true);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add condition");
    } finally {
      setAddingCondition(false);
    }
  }

  async function patchCondition(
    conditionId: string,
    patch: { conditionType?: string; dueDate?: string; metDate?: string; completed?: boolean },
  ) {
    setSavingConditionId(conditionId);
    try {
      const res = await fetch(`/api/deals/${dealId}/conditions/${conditionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not update condition");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update condition");
    } finally {
      setSavingConditionId(null);
    }
  }

  async function removeCondition(conditionId: string) {
    setRemovingConditionId(conditionId);
    try {
      const res = await fetch(`/api/deals/${dealId}/conditions/${conditionId}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not remove condition");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove condition");
    } finally {
      setRemovingConditionId(null);
    }
  }

  return (
    <section className="space-y-3 rounded-md border p-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ChevronDownIcon className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          Conditions {conditions.length > 0 && `(${conditions.length})`}
        </span>
        {isFirm && (
          <Badge variant="outline" className="border-green-200 bg-green-50 text-[11px] text-green-700">
            Firm - conditions collapsed
          </Badge>
        )}
      </button>
      {expanded && (
        <div className="space-y-2">
          {conditions.length === 0 && (
            <p className="text-sm text-muted-foreground">No conditions added yet.</p>
          )}
          {conditions.map((condition) => (
            <ConditionRowEditor
              key={`${condition.id}-${condition.due_date ?? ""}-${condition.met_date ?? ""}`}
              condition={condition}
              saving={savingConditionId === condition.id}
              removing={removingConditionId === condition.id}
              onPatch={(patch) => patchCondition(condition.id, patch)}
              onRemove={() => removeCondition(condition.id)}
            />
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addCondition} disabled={addingCondition}>
            <PlusIcon className="size-3.5" />
            Add condition
          </Button>
        </div>
      )}
    </section>
  );
}

function CommissionFormulaPanel({ currentValue }: { currentValue: FieldValueGetter }) {
  const summary = buildCommissionFormulaSummary(currentValue);
  const rows = [
    { label: "Total commission before HST", value: summary.totalCommissionBeforeHst, detail: "Sell Price / Rent x Commission %" },
    { label: "Listing commission", value: summary.listingCommission, detail: "TC x Listing %" },
    { label: "Selling commission", value: summary.sellingCommission, detail: "TC x Selling %" },
    { label: "Selling brokerage HST", value: summary.sellingBrokerageHst, detail: "Selling commission x 13%" },
    { label: "Selling brokerage total", value: summary.sellingBrokerageTotal, detail: "Selling commission + HST" },
  ];

  return (
    <section className="space-y-3 rounded-md border bg-muted/10 p-3">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Generated commission amounts</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Amounts below are generated from percentages for review only. Lone Wolf should calculate the editable amount fields.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-md border bg-background p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</div>
            <div className="mt-1 text-sm font-semibold">{formatNullableCurrency(row.value)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{row.detail}</div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        HST is fixed at 13%. Outside broker commission information uses the selling brokerage calculation above.
      </div>
    </section>
  );
}

function ConditionRowEditor({
  condition,
  saving,
  removing,
  onPatch,
  onRemove,
}: {
  condition: ConditionRow;
  saving: boolean;
  removing: boolean;
  onPatch: (patch: { conditionType?: string; dueDate?: string; metDate?: string; completed?: boolean }) => void;
  onRemove: () => void;
}) {
  const [dueDate, setDueDate] = useState(condition.due_date ?? "");
  const [metDate, setMetDate] = useState(condition.met_date ?? "");

  const disabled = saving || removing;

  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border bg-background p-2.5 sm:grid-cols-[1.3fr_1fr_1fr_auto_auto] sm:items-center">
      <select
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        value={condition.condition_type ?? ""}
        disabled={disabled}
        onChange={(event) => onPatch({ conditionType: event.target.value })}
      >
        <option value="">Select type...</option>
        {LONE_WOLF_SELECT_OPTIONS.condition_type.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <Input
        className="h-8"
        placeholder="Due date"
        value={dueDate}
        disabled={disabled}
        onChange={(event) => setDueDate(event.target.value)}
        onBlur={() => {
          if (dueDate !== (condition.due_date ?? "")) onPatch({ dueDate });
        }}
      />
      <Input
        className="h-8"
        placeholder="Met date"
        value={metDate}
        disabled={disabled}
        onChange={(event) => setMetDate(event.target.value)}
        onBlur={() => {
          if (metDate !== (condition.met_date ?? "")) onPatch({ metDate });
        }}
      />
      <label className="flex items-center gap-1.5 whitespace-nowrap text-sm">
        <input
          type="checkbox"
          className="size-4 rounded border-input accent-primary"
          checked={condition.completed}
          disabled={disabled}
          onChange={(event) => onPatch({ completed: event.target.checked })}
        />
        Met
      </label>
      <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={disabled} onClick={onRemove}>
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  );
}

function EmailBodySuggestionsPanel({
  suggestions,
  selected,
  onToggle,
  onApply,
  applying,
}: {
  suggestions: EmailBodySuggestion[];
  selected: (suggestion: EmailBodySuggestion) => boolean;
  onToggle: (suggestion: EmailBodySuggestion, checked: boolean) => void;
  onApply: () => void | Promise<void>;
  applying: boolean;
}) {
  if (suggestions.length === 0) return null;
  const selectedCount = suggestions.filter(selected).length;

  return (
    <Card className="overflow-hidden border-amber-200 bg-amber-50/20 py-0">
      <CardHeader className="border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailIcon className="size-4 text-amber-700" />
              Email Body Field Suggestions
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Linked emails include field details that can update this transaction. Review and approve before anything is written.
            </p>
          </div>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            {suggestions.length} pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="grid gap-2">
          {suggestions.map((suggestion) => {
            const checked = selected(suggestion);
            return (
              <label
                key={emailBodySuggestionId(suggestion)}
                className="grid cursor-pointer gap-3 rounded-md border bg-background p-3 text-sm md:grid-cols-[auto_minmax(10rem,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={checked}
                  onChange={(event) => onToggle(suggestion, event.target.checked)}
                />
                <div className="min-w-0">
                  <div className="font-medium">{suggestion.label}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={suggestion.emailLabel}>
                    {suggestion.emailLabel}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground" title={suggestion.emailMeta}>
                    {suggestion.emailMeta}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Current</div>
                  <div className="mt-1 break-words text-xs">{suggestion.currentValue || "Blank"}</div>
                  {(suggestion.hasConflict || suggestion.isManual) && (
                    <Badge variant="outline" className="mt-2 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                      {suggestion.isManual ? "Manual value" : "Existing value"}
                    </Badge>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">From email</div>
                  <div className="mt-1 break-words text-xs font-medium">{suggestion.value}</div>
                  {suggestion.confidence != null && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {Math.round(suggestion.confidence * 100)}% signal
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Conflicting values are left unchecked until you explicitly choose them.
          </p>
          <Button onClick={onApply} disabled={applying || selectedCount === 0}>
            <CheckCircle2Icon className="size-4" />
            {applying ? "Applying..." : `Apply ${selectedCount} selected`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PackageDocumentsPanel({
  rows,
  activeFilter,
  onFilterChange,
  onUpdateLoneWolfStatus,
  onMarkAllLoneWolfUploaded,
  onGenerateReminder,
  onReviewMatch,
  workingRequirementId,
  draftingReminder,
}: {
  rows: PackageDocumentRow[];
  activeFilter: PackageFilter;
  onFilterChange: (filter: PackageFilter) => void;
  onUpdateLoneWolfStatus: (requirementId: string, status: LoneWolfRequirementStatus) => void | Promise<void>;
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
  const uploadedToLoneWolfCount = rows.filter((row) => row.found && row.loneWolfStatus === "uploaded").length;
  const loneWolfReadyCount = rows.filter((row) => row.found).length;
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Lone Wolf Document Queue</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Track which extracted package documents still need to be uploaded through the Lone Wolf Docs window.
              </p>
            </div>
            <div className="grid min-w-[220px] grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border bg-muted/20 p-2">
                <div className="font-semibold">{uploadedToLoneWolfCount}</div>
                <div className="text-muted-foreground">Uploaded</div>
              </div>
              <div className="rounded-md border bg-muted/20 p-2">
                <div className="font-semibold">{loneWolfReadyCount - uploadedToLoneWolfCount}</div>
                <div className="text-muted-foreground">Remaining</div>
              </div>
            </div>
          </div>
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
                          onUpdateLoneWolfStatus={onUpdateLoneWolfStatus}
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

function LoneWolfAutomationHandoffPanel({
  packet,
  onCopyPacket,
  onCopyNextAction,
  onCopyKeyInfoPlan,
}: {
  packet: LoneWolfAutomationPacket;
  onCopyPacket: () => void | Promise<void>;
  onCopyNextAction: () => void | Promise<void>;
  onCopyKeyInfoPlan: () => void | Promise<void>;
}) {
  const packetJson = JSON.stringify(packet, null, 2);
  const packetDownloadUrl = `data:application/json;charset=utf-8,${encodeURIComponent(packetJson)}`;
  const keyInfoPlan = packet.keyboardPlans.keyInfo;
  const actionableStepCount = keyInfoPlan.steps.filter((step) => step.action !== "skip").length;

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Start Lone Wolf Entry</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy a structured packet for attended RDP automation. The assistant should stop if Lone Wolf shows an unexpected screen.
          </p>
        </div>
        <Badge
          variant="outline"
          className={packet.readiness.ready ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}
        >
          {packet.readiness.ready ? "Ready for assisted entry" : "Prep required"}
        </Badge>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="rounded-md border bg-background p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next action</p>
          <p className="mt-1 text-sm">{packet.readiness.nextAction}</p>
          {packet.readiness.warnings.length > 0 && (
            <p className="mt-2 text-xs text-amber-700">{packet.readiness.warnings[0]}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          <Button type="button" variant="outline" onClick={onCopyNextAction}>
            <CopyIcon className="size-4" />
            Copy next action
          </Button>
          <Button
            type="button"
            variant="outline"
            nativeButton={false}
            render={<a href={packetDownloadUrl} download={`lonewolf-${packet.deal.id}.json`} />}
          >
            <DownloadIcon className="size-4" />
            Download packet
          </Button>
          <Button type="button" onClick={onCopyPacket}>
            <CopyIcon className="size-4" />
            Copy automation packet
          </Button>
        </div>
      </div>
      <div className="mt-3 rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keyboard dry run</p>
            <p className="mt-1 text-sm font-medium">{keyInfoPlan.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {actionableStepCount} active steps | estimated {keyInfoPlan.expectedSeconds.low}-{keyInfoPlan.expectedSeconds.high}s after focus is set.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onCopyKeyInfoPlan}>
            <CopyIcon className="size-4" />
            Copy Key Info plan
          </Button>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {keyInfoPlan.steps.slice(0, 6).map((step) => (
            <div key={`${step.order}-${step.fieldKey}`} className="rounded-md border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold">{step.order}. {step.loneWolfLabel}</p>
                <Badge variant="outline" className="shrink-0 capitalize">{step.action}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{step.value || "blank / skip"}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Starts at {keyInfoPlan.startingFocus}. Stops before {keyInfoPlan.stopBefore}.
        </p>
      </div>
      <details className="mt-3 rounded-md border bg-background">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Packet preview</summary>
        <Textarea className="min-h-48 rounded-none border-x-0 border-b-0 font-mono text-xs" readOnly value={packetJson} />
      </details>
    </div>
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
  sections = FIELD_SECTIONS,
}: {
  fieldMap: Map<string, FieldRow>;
  currentValue: (key: string) => string;
  isHidden: (key: string) => boolean;
  sections?: FieldSection[];
}) {
  const stats = { all: 0, needsReview: 0, confirmed: 0, unverified: 0 };

  for (const section of sections) {
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
  onUpdateLoneWolfStatus,
  onGenerateReminder,
  onReviewMatch,
}: {
  row: PackageDocumentRow;
  workingRequirementId: string | null;
  draftingReminder: boolean;
  onUpdateLoneWolfStatus: (requirementId: string, status: LoneWolfRequirementStatus) => void | Promise<void>;
  onGenerateReminder: (row?: PackageDocumentRow | PackageDocumentRow[]) => void;
  onReviewMatch: (row: PackageDocumentRow) => void;
}) {
  const primaryAction = packagePrimaryAction(row);
  const working = workingRequirementId === row.requirementId;

  return (
    <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(260px,1fr)_220px_210px] md:items-center">
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
          {row.loneWolfUploadedAt && <span>Uploaded {formatShortDateTime(row.loneWolfUploadedAt)}</span>}
        </div>
      </div>

      <div className="space-y-1">
        <PackageStatusLabel row={row} />
        {row.found && (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            value={row.loneWolfStatus}
            disabled={working}
            onChange={(event) =>
              onUpdateLoneWolfStatus(row.requirementId, event.target.value as LoneWolfRequirementStatus)
            }
          >
            <option value="pending_upload">Pending upload</option>
            <option value="uploaded">Uploaded to Lone Wolf</option>
            <option value="unknown">Needs review</option>
            <option value="not_required">Not required</option>
          </select>
        )}
      </div>

      <div className="flex items-center justify-start gap-2 md:justify-end">
        {primaryAction === "review" && (
          <Button variant="outline" onClick={() => onReviewMatch(row)}>
            Review match
          </Button>
        )}
        {primaryAction === "mark_uploaded" && (
          <Button
            variant="outline"
            onClick={() => onUpdateLoneWolfStatus(row.requirementId, "uploaded")}
            disabled={working}
          >
            {working ? "Saving..." : "Mark uploaded"}
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
          working={working}
          onUpdateLoneWolfStatus={onUpdateLoneWolfStatus}
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
  working,
  onUpdateLoneWolfStatus,
  onGenerateReminder,
}: {
  row: PackageDocumentRow;
  draftingReminder: boolean;
  working: boolean;
  onUpdateLoneWolfStatus: (requirementId: string, status: LoneWolfRequirementStatus) => void | Promise<void>;
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
        {row.found && (
          <>
            <button
              type="button"
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              disabled={working}
              onClick={() => onUpdateLoneWolfStatus(row.requirementId, "pending_upload")}
            >
              Reset to pending
            </button>
            <button
              type="button"
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              disabled={working}
              onClick={() => onUpdateLoneWolfStatus(row.requirementId, "unknown")}
            >
              Needs review
            </button>
            <button
              type="button"
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
              disabled={working}
              onClick={() => onUpdateLoneWolfStatus(row.requirementId, "not_required")}
            >
              Mark not required
            </button>
          </>
        )}
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
  if (row.loneWolfStatus === "uploaded") {
    return {
      label: "Uploaded to Lone Wolf",
      className: "text-green-700",
      dotClass: "bg-green-600",
    };
  }
  if (row.loneWolfStatus === "not_required") {
    return {
      label: "Not required",
      className: "text-muted-foreground",
      dotClass: "bg-muted-foreground",
    };
  }
  if (row.loneWolfStatus === "unknown") {
    return {
      label: "Needs review",
      className: "text-amber-700",
      dotClass: "bg-amber-500",
    };
  }
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
  actionLabel,
  onAction,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-start gap-2 border-border/70 text-foreground lg:border-l lg:pl-4 first:lg:border-l-0 first:lg:pl-0">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-medium leading-tight">{value}</p>
          {onAction && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
              onClick={onAction}
            >
              <CopyIcon className="size-3" />
              {actionLabel ?? "Copy"}
            </button>
          )}
        </div>
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

const LONE_WOLF_DOCUMENT_STEP_FIELDS: Array<{
  key: keyof Pick<
    LoneWolfWorkspaceDraft,
    "initialDocumentsStatus" | "tradeRecordSheetStatus" | "signedTradeRecordSheetStatus"
  >;
  label: string;
  detail: string;
}> = [
  {
    key: "initialDocumentsStatus",
    label: "Initial PDFs",
    detail: "Transaction package PDFs uploaded through the Lone Wolf Docs window.",
  },
  {
    key: "tradeRecordSheetStatus",
    label: "Trade Record Sheet",
    detail: "Generated from Lone Wolf and sent to the agent for signature.",
  },
  {
    key: "signedTradeRecordSheetStatus",
    label: "Signed Sheet Upload",
    detail: "Signed Trade Record Sheet received by email and uploaded back to Lone Wolf.",
  },
];

const LONE_WOLF_ALL_STEP_FIELDS = LONE_WOLF_DOCUMENT_STEP_FIELDS;

const LONE_WOLF_STEP_STATUS_OPTIONS: Array<{ value: LoneWolfStepStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "Ready for entry" },
  { value: "completed", label: "Entered in Lone Wolf" },
  { value: "blocked", label: "Needs admin review" },
  { value: "skipped", label: "Skipped" },
];

function LoneWolfWorkspacePanel({
  workspace,
  draft,
  saving,
  pendingDocumentCount,
  tradeRecordSheetAttachments,
  automationPacket,
  onDraftChange,
  onSave,
  onStepStatusChange,
  onCopyAutomationPacket,
  onCopyNextAction,
  onCopyKeyInfoPlan,
}: {
  workspace: LoneWolfWorkspaceRow | null;
  draft: LoneWolfWorkspaceDraft;
  saving: boolean;
  pendingDocumentCount: number;
  tradeRecordSheetAttachments: TradeRecordSheetAttachment[];
  automationPacket: LoneWolfAutomationPacket;
  onDraftChange: (draft: LoneWolfWorkspaceDraft) => void;
  onSave: () => void | Promise<void>;
  onStepStatusChange: (key: keyof LoneWolfWorkspaceDraft, status: LoneWolfStepStatus) => void | Promise<void>;
  onCopyAutomationPacket: () => void | Promise<void>;
  onCopyNextAction: () => void | Promise<void>;
  onCopyKeyInfoPlan: () => void | Promise<void>;
}) {
  const completedCount = LONE_WOLF_ALL_STEP_FIELDS.filter((step) => draft[step.key] === "completed").length;
  const blockedCount = LONE_WOLF_ALL_STEP_FIELDS.filter((step) => draft[step.key] === "blocked").length;
  const progressPct = Math.round((completedCount / LONE_WOLF_ALL_STEP_FIELDS.length) * 100);
  const tradeNumberMissing = !draft.tradeNumber.trim();

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Lone Wolf Workspace</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Track the remote-desktop handoff, document uploads, and signed Trade Record Sheet loop.
            </p>
          </div>
          <Badge className={loneWolfOverallBadgeClass(draft.status)} variant="outline">
            {formatLoneWolfWorkflowStatus(draft.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Trade Number
              </label>
              <Input
                className="h-9"
                value={draft.tradeNumber}
                placeholder="999999"
                onChange={(event) => onDraftChange({ ...draft, tradeNumber: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sub-trade
              </label>
              <Input
                className="h-9"
                value={draft.subTrade}
                placeholder={draft.tradeNumber ? `${draft.tradeNumber}-A` : "999999-A"}
                onChange={(event) => onDraftChange({ ...draft, subTrade: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={draft.status}
                onChange={(event) =>
                  onDraftChange({ ...draft, status: event.target.value as LoneWolfWorkflowStatus })
                }
              >
                <option value="not_started">Not started</option>
                <option value="open">Open in Lone Wolf</option>
                <option value="complete" disabled={tradeNumberMissing}>Complete</option>
                <option value="blocked">Blocked</option>
              </select>
              {tradeNumberMissing && (
                <p className="text-xs text-amber-700">Trade Number is required before marking complete.</p>
              )}
            </div>
          </div>

          <div className="grid gap-2 rounded-md border bg-muted/15 p-3 text-sm sm:grid-cols-3">
            <LoneWolfMetric label="Progress" value={`${progressPct}%`} detail={`${completedCount} of ${LONE_WOLF_ALL_STEP_FIELDS.length}`} />
            <LoneWolfMetric label="Blocked" value={String(blockedCount)} detail="needs attention" tone={blockedCount > 0 ? "red" : "neutral"} />
            <LoneWolfMetric label="Docs pending" value={String(pendingDocumentCount)} detail="Lone Wolf upload" tone={pendingDocumentCount > 0 ? "amber" : "neutral"} />
          </div>
        </div>

        <div className="rounded-md border bg-muted/10 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Trade Record Sheet Lifecycle</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Use this for the Lone Wolf-generated sheet that goes out for agent signature and comes back by email.
              </p>
            </div>
            <Badge variant="outline" className={draft.signedTradeRecordSheetStatus === "completed" ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
              {draft.signedTradeRecordSheetStatus === "completed" ? "Signed sheet uploaded" : "Signature loop open"}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <LoneWolfLifecycleStep
              label="Initial PDFs uploaded"
              detail="Package documents are in Lone Wolf Docs."
              status={draft.initialDocumentsStatus}
              saving={saving}
              onComplete={() => onStepStatusChange("initialDocumentsStatus", "completed")}
              onReview={() => onStepStatusChange("initialDocumentsStatus", "blocked")}
            />
            <LoneWolfLifecycleStep
              label="Sheet generated & sent"
              detail="Trade Record Sheet printed/exported from Lone Wolf and sent to agent."
              status={draft.tradeRecordSheetStatus}
              saving={saving}
              onComplete={() => onStepStatusChange("tradeRecordSheetStatus", "completed")}
              onReview={() => onStepStatusChange("tradeRecordSheetStatus", "blocked")}
            />
            <LoneWolfLifecycleStep
              label="Signed sheet uploaded"
              detail="Signed version received by email and uploaded back to Lone Wolf."
              status={draft.signedTradeRecordSheetStatus}
              saving={saving}
              onComplete={() => onStepStatusChange("signedTradeRecordSheetStatus", "completed")}
              onReview={() => onStepStatusChange("signedTradeRecordSheetStatus", "blocked")}
            />
          </div>
          <TradeRecordSheetAttachmentList
            attachments={tradeRecordSheetAttachments}
            saving={saving}
            signedSheetUploaded={draft.signedTradeRecordSheetStatus === "completed"}
            onMarkSignedUploaded={() => onStepStatusChange("signedTradeRecordSheetStatus", "completed")}
          />
        </div>

        <LoneWolfAutomationHandoffPanel
          packet={automationPacket}
          onCopyPacket={onCopyAutomationPacket}
          onCopyNextAction={onCopyNextAction}
          onCopyKeyInfoPlan={onCopyKeyInfoPlan}
        />

        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              RDP / Lone Wolf Notes
            </label>
            <Textarea
              className="min-h-20"
              value={draft.notes}
              placeholder="File picker path, automation blocker, or admin handoff note"
              onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 lg:flex-col lg:items-end">
            <p className="text-xs text-muted-foreground">
              {workspace?.updated_at ? `Updated ${formatShortDateTime(workspace.updated_at)}` : "No Lone Wolf checkpoint saved yet"}
            </p>
            <Button onClick={onSave} disabled={saving}>
              <CheckCircle2Icon className="size-4" />
              Save workspace
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LoneWolfLifecycleStep({
  label,
  detail,
  status,
  saving,
  onComplete,
  onReview,
}: {
  label: string;
  detail: string;
  status: LoneWolfStepStatus;
  saving: boolean;
  onComplete: () => void | Promise<void>;
  onReview: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start gap-2">
        <span className={`mt-1 size-2 rounded-full ${loneWolfStepDotClass(status)}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{label}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">{formatLoneWolfStepStatus(status)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={saving || status === "completed"}
          onClick={onComplete}
        >
          Mark done
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          disabled={saving || status === "blocked"}
          onClick={onReview}
        >
          Review
        </Button>
      </div>
    </div>
  );
}

function TradeRecordSheetAttachmentList({
  attachments,
  saving,
  signedSheetUploaded,
  onMarkSignedUploaded,
}: {
  attachments: TradeRecordSheetAttachment[];
  saving: boolean;
  signedSheetUploaded: boolean;
  onMarkSignedUploaded: () => void | Promise<void>;
}) {
  return (
    <div className="mt-3 rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Received Trade Record Sheet candidates</p>
          <p className="mt-1 text-xs text-muted-foreground">
            These are email attachments that look like the signed sheet returning from the agent.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saving || signedSheetUploaded || attachments.length === 0}
          onClick={onMarkSignedUploaded}
        >
          {signedSheetUploaded ? "Uploaded" : "Mark signed uploaded"}
        </Button>
      </div>
      {attachments.length > 0 ? (
        <div className="mt-3 divide-y rounded-md border">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{attachment.name}</p>
                <p className="text-xs text-muted-foreground">
                  {attachment.receivedAt ? `Received ${formatShortDateTime(attachment.receivedAt)}` : "Received date unknown"}
                  {attachment.confidence != null ? ` | ${Math.round(attachment.confidence * 100)}% match` : ""}
                </p>
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
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          No Trade Record Sheet attachment has been detected from email yet.
        </p>
      )}
    </div>
  );
}

function LoneWolfMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "red" | "amber";
}) {
  const valueClass = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-foreground";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
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

function formatNullableCurrency(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "Needs inputs";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function buildCommissionFormulaSummary(currentValue: FieldValueGetter) {
  const salePrice = parseMoneyValue(currentValue("price_or_rent"));
  const totalPct = parsePercentValue(currentValue("total_commission_pct"));
  const listingPct = parsePercentValue(currentValue("listing_commission_pct"));
  const sellingPct = parsePercentValue(currentValue("cooperating_commission_pct"));

  const totalCommissionBeforeHst = salePrice != null && totalPct != null ? salePrice * (totalPct / 100) : null;
  const listingCommission = totalCommissionBeforeHst != null && listingPct != null
    ? totalCommissionBeforeHst * (listingPct / 100)
    : null;
  const sellingCommission = totalCommissionBeforeHst != null && sellingPct != null
    ? totalCommissionBeforeHst * (sellingPct / 100)
    : null;
  const sellingBrokerageHst = sellingCommission != null ? sellingCommission * 0.13 : null;
  const sellingBrokerageTotal = sellingCommission != null && sellingBrokerageHst != null
    ? sellingCommission + sellingBrokerageHst
    : null;

  return {
    totalCommissionBeforeHst,
    listingCommission,
    sellingCommission,
    sellingBrokerageHst,
    sellingBrokerageTotal,
  };
}

function parseMoneyValue(value: string) {
  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function parsePercentValue(value: string) {
  const normalized = value.replace(/[%\s]/g, "");
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
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
      loneWolfStatus,
      loneWolfUploadedAt: requirementStatus?.lonewolf_uploaded_at ?? null,
      requirementLevel: item.level,
      condition: item.condition,
      loneWolfLabel: found ? formatLoneWolfStatus(loneWolfStatus) : "-",
      pages: item.pages,
      found,
      missing,
      needsReview: needsReview || loneWolfStatus === "unknown",
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
  return "Needs Review";
}

function loneWolfRequirementStatusToast(status: LoneWolfRequirementStatus) {
  if (status === "uploaded") return "Marked uploaded to Lone Wolf.";
  if (status === "pending_upload") return "Reset to pending Lone Wolf upload.";
  if (status === "not_required") return "Marked not required for Lone Wolf.";
  return "Marked for Lone Wolf review.";
}

function buildLoneWolfAutomationPacket({
  deal,
  draft,
  fieldReviewStats,
  packageRows,
  tradeRecordSheetAttachments,
  currentValue,
}: {
  deal: DealRow;
  draft: LoneWolfWorkspaceDraft;
  fieldReviewStats: ReturnType<typeof buildFieldReviewStats>;
  packageRows: PackageDocumentRow[];
  tradeRecordSheetAttachments: TradeRecordSheetAttachment[];
  currentValue: FieldValueGetter;
}): LoneWolfAutomationPacket {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const tradeNumber = draft.tradeNumber.trim();
  const subTrade = draft.subTrade.trim() || (tradeNumber ? `${tradeNumber}-A` : "");
  const pendingUpload = packageRows.filter((row) => row.found && row.loneWolfStatus === "pending_upload");
  const uploaded = packageRows.filter((row) => row.found && row.loneWolfStatus === "uploaded");
  const needsReviewDocuments = packageRows.filter((row) => row.found && (row.needsReview || row.loneWolfStatus === "unknown"));

  if (!tradeNumber) blockers.push("Trade Number is missing. Create or open the Lone Wolf trade record first.");
  if (fieldReviewStats.needsReview > 0) blockers.push(`${fieldReviewStats.needsReview} field${fieldReviewStats.needsReview === 1 ? "" : "s"} still need review.`);
  if (fieldReviewStats.unverified > 0) warnings.push(`${fieldReviewStats.unverified} field${fieldReviewStats.unverified === 1 ? "" : "s"} are unverified; automation should skip blank or uncertain values.`);
  if (needsReviewDocuments.length > 0) warnings.push(`${needsReviewDocuments.length} document${needsReviewDocuments.length === 1 ? "" : "s"} need review before upload.`);
  if (pendingUpload.length > 0) warnings.push(`${pendingUpload.length} document${pendingUpload.length === 1 ? "" : "s"} still need Lone Wolf upload.`);

  const readiness = {
    ready: blockers.length === 0,
    blockers,
    warnings,
    nextAction: nextLoneWolfAutomationAction({
      tradeNumber,
      blockers,
      pendingUploadCount: pendingUpload.length,
      signedSheetCandidateCount: tradeRecordSheetAttachments.length,
      signedSheetStatus: draft.signedTradeRecordSheetStatus,
    }),
  };

  return {
    version: "lonewolf-entry-v0",
    generatedAt: new Date().toISOString(),
    safeMode: {
      reviewedFieldsOnly: true,
      stopOnUnexpectedScreen: true,
      requireOperatorConfirmation: true,
    },
    deal: {
      id: deal.id,
      address: shortDealAddress(deal),
      transactionType: deal.transaction_type,
      scenario: deal.scenario_label,
    },
    loneWolf: {
      tradeNumber,
      subTrade,
      status: draft.status,
    },
    readiness,
    entrySections: FIELD_SECTIONS.map((section) => ({
      title: friendlyFieldSectionTitle(section.title),
      fields: section.fields
        .filter((field) => !isConditionalFieldHidden(field.key, currentValue))
        .map((field) => ({
          key: field.key,
          label: field.label,
          value: currentValue(field.key),
        })),
    })).filter((section) => section.fields.some((field) => field.value.trim())),
    keyboardPlans: {
      keyInfo: buildLoneWolfKeyInfoKeyboardPlan(currentValue),
    },
    documents: {
      pendingUpload: pendingUpload.map((row) => ({
        requirementId: row.requirementId,
        label: row.label,
        documentLabel: row.documentLabel,
        pages: row.pages,
      })),
      uploaded: uploaded.map((row) => ({
        requirementId: row.requirementId,
        label: row.label,
        uploadedAt: row.loneWolfUploadedAt,
      })),
      needsReview: needsReviewDocuments.map((row) => ({
        requirementId: row.requirementId,
        label: row.label,
        reason: row.loneWolfStatus === "unknown" ? "Lone Wolf status needs review" : "Document match needs review",
      })),
    },
    tradeRecordSheet: {
      generatedAndSentStatus: draft.tradeRecordSheetStatus,
      signedUploadStatus: draft.signedTradeRecordSheetStatus,
      candidateAttachments: tradeRecordSheetAttachments,
    },
  };
}

function nextLoneWolfAutomationAction({
  tradeNumber,
  blockers,
  pendingUploadCount,
  signedSheetCandidateCount,
  signedSheetStatus,
}: {
  tradeNumber: string;
  blockers: string[];
  pendingUploadCount: number;
  signedSheetCandidateCount: number;
  signedSheetStatus: LoneWolfStepStatus;
}) {
  if (!tradeNumber) return "Create or open the trade in Lone Wolf, then enter the generated Trade Number in BrokerageAssistant.";
  if (blockers.length > 0) return blockers[0];
  if (pendingUploadCount > 0) return `Upload ${pendingUploadCount} pending document${pendingUploadCount === 1 ? "" : "s"} in the Lone Wolf Docs window.`;
  if (signedSheetCandidateCount > 0 && signedSheetStatus !== "completed") {
    return "Download the signed Trade Record Sheet candidate, upload it to Lone Wolf, then mark signed sheet uploaded.";
  }
  return "Start attended Lone Wolf entry using the copied automation packet. Stop before saving if the screen does not match the packet section.";
}

const LONE_WOLF_KEY_INFO_KEYBOARD_FIELDS: Array<{
  fieldKey: string;
  loneWolfLabel: string;
  action: LoneWolfKeyboardPlanStep["action"];
  tabAfter: number;
  note?: string;
}> = [
  { fieldKey: "street_number", loneWolfLabel: "Street Number", action: "type", tabAfter: 1 },
  { fieldKey: "street_direction", loneWolfLabel: "Direction", action: "type", tabAfter: 1 },
  { fieldKey: "street_name", loneWolfLabel: "Street Name", action: "type", tabAfter: 1 },
  { fieldKey: "unit", loneWolfLabel: "Unit", action: "type", tabAfter: 1 },
  { fieldKey: "city", loneWolfLabel: "City", action: "type", tabAfter: 1 },
  { fieldKey: "province", loneWolfLabel: "Province", action: "select", tabAfter: 1, note: "Usually defaults to Ontario; verify instead of changing if already correct." },
  { fieldKey: "postal_code", loneWolfLabel: "Postal Code", action: "type", tabAfter: 1 },
  { fieldKey: "lot_plan", loneWolfLabel: "Lot and Plan", action: "type", tabAfter: 1 },
  { fieldKey: "offer_date", loneWolfLabel: "Offer Date", action: "type", tabAfter: 1, note: "Date format MM/DD/YYYY." },
  { fieldKey: "acceptance_date", loneWolfLabel: "Firm Date", action: "type", tabAfter: 1, note: "Date format MM/DD/YYYY." },
  { fieldKey: "closing_date", loneWolfLabel: "Close Date", action: "type", tabAfter: 1, note: "Date format MM/DD/YYYY." },
  { fieldKey: "price_or_rent", loneWolfLabel: "Sell Price", action: "type", tabAfter: 1 },
  { fieldKey: "mls_number", loneWolfLabel: "MLS Number", action: "type", tabAfter: 1 },
  { fieldKey: "property_type", loneWolfLabel: "Type", action: "select", tabAfter: 1, note: "Use Lone Wolf dropdown value." },
  { fieldKey: "we_manage", loneWolfLabel: "We Manage", action: "select", tabAfter: 1 },
  { fieldKey: "conditions_summary", loneWolfLabel: "Classification", action: "verify", tabAfter: 1, note: "Classification is derived from transaction/side; operator verifies dropdown value." },
  { fieldKey: "ends", loneWolfLabel: "Ends", action: "type", tabAfter: 1 },
  { fieldKey: "tax_roll_number", loneWolfLabel: "Tax Roll Number", action: "type", tabAfter: 1 },
  { fieldKey: "tax_rate", loneWolfLabel: "Tax Rate", action: "type", tabAfter: 0 },
];

function buildLoneWolfKeyInfoKeyboardPlan(currentValue: FieldValueGetter): LoneWolfKeyboardPlan {
  const steps = LONE_WOLF_KEY_INFO_KEYBOARD_FIELDS.map((field, index) => {
    const value = currentValue(field.fieldKey).trim();
    const action: LoneWolfKeyboardPlanStep["action"] = value ? field.action : "skip";
    return {
      order: index + 1,
      fieldKey: field.fieldKey,
      loneWolfLabel: field.loneWolfLabel,
      value,
      action,
      tabAfter: field.tabAfter,
      note: field.note,
    };
  });
  const activeSteps = steps.filter((step) => step.action !== "skip").length;
  return {
    id: "key_info",
    title: "Key Info tab keyboard-only dry run",
    mode: "dry_run_no_store",
    startingFocus: "Key Info tab, Street Number field",
    stopBefore: "Store button",
    expectedSeconds: {
      low: Math.max(45, activeSteps * 4),
      high: Math.max(90, activeSteps * 8),
    },
    assumptions: [
      "Dummy trade is already open on the Lone Wolf Key Info tab.",
      "Focus starts in Street Number.",
      "Automation may use keyboard navigation and clipboard paste, but must not click Store.",
      "Dropdowns are verified visually before moving to the next field.",
      "Blank values are skipped; existing Lone Wolf defaults are not overwritten unless a value exists in BrokerageAssistant.",
    ],
    steps,
  };
}

function buildTradeRecordSheetAttachments(
  attachments: EmailAttachmentRow[],
  pages: PageRow[],
): TradeRecordSheetAttachment[] {
  const renderedTradeRecordAttachmentIds = new Set(
    pages
      .filter((page) => page.doc_type === "trade_record_sheet" && page.email_attachment_id)
      .map((page) => page.email_attachment_id as string),
  );

  return attachments
    .filter((attachment) => {
      const filename = attachment.original_filename?.toLowerCase() ?? "";
      return (
        attachment.light_classification_type === "trade_record_sheet" ||
        renderedTradeRecordAttachmentIds.has(attachment.id) ||
        (filename.includes("trade") && filename.includes("record"))
      );
    })
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.original_filename ?? "Trade Record Sheet",
      receivedAt: attachment.received_at ?? attachment.created_at,
      status: attachment.status,
      confidence: attachment.light_classification_type === "trade_record_sheet"
        ? attachment.light_classification_confidence
        : null,
    }));
}

function buildEmailBodySuggestions(
  emails: LinkedInboundEmailRow[],
  fieldMap: Map<string, FieldRow>,
): EmailBodySuggestion[] {
  return emails.flatMap((email) => {
    const emailFields = emailBodyFieldsFromRouting(email.routing_json);
    const emailLabel = email.subject || email.from_name || email.from_email || "Linked email";
    const emailMeta = [
      email.from_name || email.from_email,
      email.received_at ? formatShortDateTime(email.received_at) : null,
    ].filter(Boolean).join(" | ");

    return emailFields.flatMap((field) => {
      const existing = fieldMap.get(field.field_key);
      const currentValue = existing?.value?.trim() ?? "";
      const suggestedValue = field.value.trim();
      if (!suggestedValue) return [];
      if (currentValue && valuesEquivalent(currentValue, suggestedValue)) return [];

      return [{
        inboundEmailId: email.id,
        emailLabel,
        emailMeta,
        fieldKey: field.field_key,
        label: field.label || fieldLabelForKey(field.field_key),
        value: suggestedValue,
        confidence: field.confidence,
        currentValue,
        sourceIsEmailBody: existing?.source_doc_type === "email_body",
        hasConflict: Boolean(currentValue && !valuesEquivalent(currentValue, suggestedValue)),
        isManual: Boolean(existing?.edited_at),
      }];
    });
  });
}

function emailBodyFieldsFromRouting(routing: Record<string, unknown> | null) {
  const value = routing?.email_body_fields;
  if (!Array.isArray(value)) return [];
  return value
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") return null;
      const item = candidate as Record<string, unknown>;
      const fieldKey = typeof item.field_key === "string" ? item.field_key : "";
      const fieldValue = typeof item.value === "string" ? item.value.trim() : "";
      if (!fieldKey || !fieldValue) return null;
      return {
        field_key: fieldKey,
        label: typeof item.label === "string" && item.label ? item.label : fieldLabelForKey(fieldKey),
        value: fieldValue,
        confidence: typeof item.confidence === "number" ? item.confidence : null,
      };
    })
    .filter((item): item is { field_key: string; label: string; value: string; confidence: number | null } => Boolean(item));
}

function fieldLabelForKey(fieldKey: string) {
  return FIELD_SECTIONS.flatMap((section) => section.fields).find((field) => field.key === fieldKey)?.label ??
    fieldKey.replaceAll("_", " ");
}

function emailBodySuggestionId(suggestion: EmailBodySuggestion) {
  return `${suggestion.inboundEmailId}:${suggestion.fieldKey}`;
}

function valuesEquivalent(a: string, b: string) {
  return a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
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
  if (row.loneWolfStatus === "not_required") return "not_required";
  if (row.found && (row.needsReview || row.loneWolfStatus === "unknown")) return "needs_review";
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

function loneWolfWorkspaceDraftFromRow(row: LoneWolfWorkspaceRow | null): LoneWolfWorkspaceDraft {
  return {
    tradeNumber: row?.trade_number ?? "",
    subTrade: row?.sub_trade ?? "",
    status: row?.status ?? "not_started",
    keyInfoStatus: row?.key_info_status ?? "not_started",
    peopleStatus: row?.people_status ?? "not_started",
    outsideBrokersStatus: row?.outside_brokers_status ?? "not_started",
    commissionsStatus: row?.commissions_status ?? "not_started",
    initialDocumentsStatus: row?.initial_documents_status ?? "not_started",
    tradeRecordSheetStatus: row?.trade_record_sheet_status ?? "not_started",
    signedTradeRecordSheetStatus: row?.signed_trade_record_sheet_status ?? "not_started",
    notes: row?.notes ?? "",
  };
}

function formatLoneWolfWorkflowStatus(status: LoneWolfWorkflowStatus) {
  if (status === "open") return "Open in Lone Wolf";
  if (status === "complete") return "Complete";
  if (status === "blocked") return "Blocked";
  return "Not started";
}

function formatLoneWolfStepStatus(status: LoneWolfStepStatus) {
  if (status === "completed") return "Entered in Lone Wolf";
  if (status === "in_progress") return "Ready for entry";
  if (status === "blocked") return "Needs admin review";
  if (status === "skipped") return "Skipped";
  return "Not started";
}

function loneWolfOverallBadgeClass(status: LoneWolfWorkflowStatus) {
  if (status === "complete") return "border-green-200 bg-green-50 text-green-700";
  if (status === "blocked") return "border-red-200 bg-red-50 text-red-700";
  if (status === "open") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-border bg-background text-muted-foreground";
}

function loneWolfStepDotClass(status: LoneWolfStepStatus) {
  if (status === "completed") return "bg-green-600";
  if (status === "blocked") return "bg-red-600";
  if (status === "in_progress") return "bg-blue-600";
  if (status === "skipped") return "bg-muted-foreground";
  return "bg-amber-500";
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

function formatAuditActor(log: AuditLogRow) {
  const profile = profileFromRelation(log.profiles);
  if (profile?.full_name?.trim()) return profile.full_name.trim();
  if (profile?.email?.trim()) return profile.email.trim();
  if (log.user_id) return "Unknown user";
  return "System";
}

function profileFromRelation(
  profile: AuditLogRow["profiles"],
): { email: string | null; full_name: string | null } | null {
  if (Array.isArray(profile)) return profile[0] ?? null;
  return profile ?? null;
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
