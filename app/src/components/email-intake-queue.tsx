"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  FilePlus2,
  Inbox,
  Link2,
  Mail,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { EmailAttachmentIngestButton } from "@/components/email-attachment-ingest-button";
import { ProcessDealButton } from "@/components/process-deal-button";
import { shortDealTitle, shortDocumentLabel } from "@/lib/display";
import { INTAKE_ADDRESS } from "@/lib/intake-address";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { TransactionType } from "@/lib/types";

export type IntakeEmailRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  status: string;
  received_at: string | null;
  routing_json: Record<string, unknown> | null;
  error_message: string | null;
  email_attachments: EmailAttachmentForQueue[];
  deal_email_links: {
    deal_id: string;
    match_score: number | null;
    match_reason: string | null;
    match_status: string;
    deals: IntakeLinkedDeal | IntakeLinkedDeal[] | null;
  }[];
};

export type EmailAttachmentForQueue = {
  id: string;
  status: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  light_classification_type: string | null;
  light_classification_confidence: number | null;
  received_at: string | null;
};

export type IntakeLinkedDeal = {
  id: string;
  property_address: string | null;
  file_name: string;
  status: string;
  page_count: number | null;
};

export type IntakeDealOption = {
  id: string;
  label: string;
  status: string;
  transactionType: TransactionType;
  transactionCode: string | null;
  createdAt: string;
};

type DialogMode = "link" | "create" | "ignore";

type DialogState = {
  mode: DialogMode;
  email: IntakeEmailRow;
  selectedDealId: string;
  propertyAddress: string;
  transactionType: string;
  reason: string;
};

type IntakeWorkflowDeal = {
  id: string;
  property_address: string | null;
  file_name: string;
  status: string;
  page_count: number | null;
};

export function DealIntakeWorkflow({
  deal,
  emails,
  dealOptions,
  renderedAttachmentIds,
}: {
  deal: IntakeWorkflowDeal;
  emails: IntakeEmailRow[];
  dealOptions: IntakeDealOption[];
  renderedAttachmentIds: string[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const selectedDeal = useMemo(
    () => dealOptions.find((item) => item.id === dialog?.selectedDealId) ?? null,
    [dealOptions, dialog?.selectedDealId],
  );

  function openDialog(mode: DialogMode, email: IntakeEmailRow) {
    const suggestedLink = bestLink(email);
    const suggestedDeal = linkedDealFromRelation(suggestedLink?.deals);
    setDialog({
      mode,
      email,
      selectedDealId: suggestedDeal?.id ?? deal.id ?? dealOptions[0]?.id ?? "",
      propertyAddress: routingAddress(email.routing_json) || deal.property_address || "",
      transactionType: routingTransactionType(email.routing_json),
      reason: "",
    });
  }

  async function submitDialog() {
    if (!dialog) return;
    setWorkingId(dialog.email.id);
    try {
      if (dialog.mode === "link") {
        if (!dialog.selectedDealId) throw new Error("Choose a transaction to link.");
        await postAction(`/api/inbound-emails/${dialog.email.id}/link`, {
          dealId: dialog.selectedDealId,
          matchReason: "Admin linked email from transaction card",
        });
        toast.success("Email linked to transaction.");
      }
      if (dialog.mode === "create") {
        await postAction(`/api/inbound-emails/${dialog.email.id}/create-draft`, {
          propertyAddress: dialog.propertyAddress,
          transactionType: dialog.transactionType,
        });
        toast.success("Draft transaction created.");
      }
      if (dialog.mode === "ignore") {
        await postAction(`/api/inbound-emails/${dialog.email.id}/ignore`, {
          reason: dialog.reason,
        });
        toast.success("Email ignored.");
      }
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setWorkingId(null);
    }
  }

  async function analyzeEmail(email: IntakeEmailRow) {
    setWorkingId(email.id);
    try {
      await postAction(`/api/inbound-emails/${email.id}/analyze`, {});
      toast.success("Intake analyzed.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setWorkingId(null);
    }
  }

  if (emails.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-2 text-[11px] leading-4 text-muted-foreground">
        No linked intake email. Review the draft deal or link a stored email from intake history.
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2">
      {emails.map((email) => {
        const primaryLink = bestLink(email);
        const suggestedDeal = linkedDealFromRelation(primaryLink?.deals);
        const linkedDeal = suggestedDeal ?? deal;
        const isConfirmed = Boolean(
          suggestedDeal &&
            (email.status === "matched" ||
              email.status === "draft_transaction_created" ||
              primaryLink?.match_status === "auto_matched" ||
              primaryLink?.match_status === "manually_confirmed"),
        );
        const needsReview = email.status === "needs_match_review" || primaryLink?.match_status === "needs_review";
        const isWorking = workingId === email.id;
        const dealTitle = suggestedDeal
          ? shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)
          : routingAddress(email.routing_json) || "Needs admin review";
        const routeMeta = primaryLink
          ? `${primaryLink.match_score ?? 0}% | ${formatMatchStatus(primaryLink.match_status)}`
          : routingSummary(email.routing_json) || "No match signal";
        const signal = primaryLink?.match_reason || routingSummary(email.routing_json);
        const nextStep = intakeNextStep(email, isConfirmed, needsReview, renderedAttachmentIds);

        return (
          <div key={email.id} className="min-w-0 space-y-2 rounded-md border bg-background/80 p-2.5">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Email</div>
                <div className="truncate text-[12px] font-semibold leading-4">{email.subject || "No subject"}</div>
                <div className="truncate text-[11px] leading-4 text-muted-foreground" title={email.from_email ?? undefined}>
                  {email.from_name || email.from_email || "Unknown sender"}
                </div>
              </div>
              <Badge variant={intakeStatusVariant(email.status)} className="h-5 shrink-0 px-1.5 text-[11px]">
                {formatIntakeStatus(email.status)}
              </Badge>
            </div>

            <div className="grid min-w-0 gap-1.5 text-[11px] leading-4 sm:grid-cols-3">
              <IntakeInfo label="Match" value={dealTitle || routingAddress(email.routing_json) || "Needs admin review"} meta={routeMeta} />
              <IntakeInfo label="Files" value={attachmentWorkflowSummary(email.email_attachments ?? [])} />
              <IntakeInfo
                label="Received"
                value={email.received_at ? new Date(email.received_at).toLocaleDateString() : "Unknown"}
                meta={email.received_at ? new Date(email.received_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
              />
              {signal && (
                <div className="min-w-0 rounded-md bg-muted/35 px-2 py-1 sm:col-span-3">
                  <span className="font-medium text-foreground/80">Signal: </span>
                  <span className="text-muted-foreground">{signal}</span>
                </div>
              )}
              {email.error_message && (
                <div className="flex min-w-0 items-center gap-1 text-destructive sm:col-span-3">
                  <AlertCircle className="size-3 shrink-0" />
                  <span className="break-words">{email.error_message}</span>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2">
              <div className="min-w-0 text-[11px] leading-4">
                <span className="font-medium text-foreground/80">Next: </span>
                <span className="text-muted-foreground">{nextStep}</span>
              </div>
              <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
                {needsReview && linkedDeal && (
                  <>
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => openDialog("link", email)} disabled={isWorking}>
                      <CheckCircle2 className="size-3.5" />
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => openDialog("link", email)}
                      disabled={isWorking}
                    >
                      <Search className="size-3.5" />
                      Change
                    </Button>
                  </>
                )}
                {!isConfirmed && (
                  <>
                    {canAnalyzeIntake(email) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        onClick={() => analyzeEmail(email)}
                        disabled={isWorking}
                      >
                        <Sparkles className="size-3.5" />
                        Analyze
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={needsReview ? "outline" : "default"}
                      className="h-7 px-2 text-xs"
                      onClick={() => openDialog("link", email)}
                      disabled={isWorking || dealOptions.length === 0}
                    >
                      <Link2 className="size-3.5" />
                      Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => openDialog("create", email)}
                      disabled={isWorking}
                    >
                      <FilePlus2 className="size-3.5" />
                      Create draft
                    </Button>
                  </>
                )}
                {isConfirmed && linkedDeal && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      nativeButton={false}
                      render={<Link href={`/deals/${linkedDeal.id}`} />}
                    >
                      Review
                    </Button>
                    <EmailAttachmentIngestButton
                      dealId={linkedDeal.id}
                      attachments={email.email_attachments}
                      renderedAttachmentIds={renderedAttachmentIds}
                    />
                    <ProcessDealButton
                      dealId={linkedDeal.id}
                      status={linkedDeal.status}
                      pageCount={linkedDeal.page_count}
                      variant="default"
                    />
                  </>
                )}
                {email.status !== "ignored" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => openDialog("ignore", email)}
                    disabled={isWorking}
                  >
                    <Trash2 className="size-3.5" />
                    Ignore
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialogTitle(dialog.mode)}</DialogTitle>
                <DialogDescription>{dialog.email.subject || "No subject"}</DialogDescription>
              </DialogHeader>

              {dialog.mode === "link" && (
                <div className="space-y-3">
                  <Label htmlFor={`intake-deal-search-${dialog.email.id}`}>Transaction</Label>
                  <select
                    id={`intake-deal-search-${dialog.email.id}`}
                    value={dialog.selectedDealId}
                    onChange={(event) => setDialog({ ...dialog, selectedDealId: event.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    {dealOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {selectedDeal && (
                    <p className="text-xs text-muted-foreground">
                      {selectedDeal.transactionCode ? `${selectedDeal.transactionCode} | ` : ""}
                      {selectedDeal.transactionType} | {selectedDeal.status}
                    </p>
                  )}
                </div>
              )}

              {dialog.mode === "create" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`draft-address-${dialog.email.id}`}>Property address</Label>
                    <Input
                      id={`draft-address-${dialog.email.id}`}
                      value={dialog.propertyAddress}
                      onChange={(event) => setDialog({ ...dialog, propertyAddress: event.target.value })}
                      placeholder="Unknown"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`draft-type-${dialog.email.id}`}>Transaction type</Label>
                    <select
                      id={`draft-type-${dialog.email.id}`}
                      value={dialog.transactionType}
                      onChange={(event) => setDialog({ ...dialog, transactionType: event.target.value })}
                      className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="sale">Sale</option>
                      <option value="purchase">Purchase</option>
                      <option value="lease">Lease</option>
                      <option value="referral">Referral</option>
                      <option value="co_brokerage">Co-brokerage</option>
                      <option value="preconstruction">Pre-construction</option>
                    </select>
                  </div>
                </div>
              )}

              {dialog.mode === "ignore" && (
                <div className="space-y-2">
                  <Label htmlFor={`ignore-reason-${dialog.email.id}`}>Reason</Label>
                  <Textarea
                    id={`ignore-reason-${dialog.email.id}`}
                    value={dialog.reason}
                    onChange={(event) => setDialog({ ...dialog, reason: event.target.value })}
                    placeholder="Duplicate, spam, wrong brokerage, or not a transaction package"
                  />
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button onClick={submitDialog} disabled={workingId === dialog.email.id}>
                  {workingId === dialog.email.id ? "Saving..." : dialogSubmitLabel(dialog.mode)}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IntakeInfo({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-muted/35 px-2 py-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[11px] font-medium leading-4 text-foreground" title={value}>
        {value}
      </div>
      {meta && <div className="truncate text-[10px] leading-3 text-muted-foreground">{meta}</div>}
    </div>
  );
}

function attachmentWorkflowSummary(attachments: EmailAttachmentForQueue[]) {
  if (attachments.length === 0) return "No files";
  const labels = Array.from(
    new Set(
      attachments
        .map((attachment) => shortDocumentLabel(attachment.light_classification_type))
        .filter((label) => label && label !== "Unknown"),
    ),
  );
  const fileText = `${attachments.length} file${attachments.length === 1 ? "" : "s"}`;
  if (labels.length === 0) return `${fileText} | ${attachmentStatusSummary(attachments)}`;
  const visible = labels.slice(0, 2).join(", ");
  return labels.length > 2 ? `${fileText} | ${visible} +${labels.length - 2}` : `${fileText} | ${visible}`;
}

function intakeNextStep(
  email: IntakeEmailRow,
  isConfirmed: boolean,
  needsReview: boolean,
  renderedAttachmentIds: string[],
) {
  if (email.status === "routing_error" || email.status === "error") return "Review the intake error, then link, create, or ignore.";
  if (email.status === "not_deal_suggested") return "AI suggests this is not a deal package. Ignore it or choose another action.";
  if (email.status === "new_deal_suggested") return "AI suggests this is a new deal. Create a draft or link it to an existing one.";
  if (email.status === "intake_review" || email.status === "routing_queued") return "Analyze intake, link it, create a draft, or ignore it.";
  if (needsReview) return "Confirm the suggested match or change it.";
  if (!isConfirmed) return "Link this email or create a draft deal.";

  const pendingAttachments = (email.email_attachments ?? []).filter(
    (attachment) =>
      attachment.status !== "ignored" &&
      attachment.status !== "duplicate" &&
      !renderedAttachmentIds.includes(attachment.id),
  );
  if (pendingAttachments.length > 0) return "Prepare email files for processing.";
  return "Run full processing when ready.";
}

export function EmailIntakeQueue({
  emails,
  dealOptions,
  renderedAttachmentIdsByDeal,
}: {
  emails: IntakeEmailRow[];
  dealOptions: IntakeDealOption[];
  renderedAttachmentIdsByDeal: Record<string, string[]>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const selectedDeal = useMemo(
    () => dealOptions.find((deal) => deal.id === dialog?.selectedDealId) ?? null,
    [dealOptions, dialog?.selectedDealId],
  );

  function openDialog(mode: DialogMode, email: IntakeEmailRow) {
    const suggestedLink = bestLink(email);
    const suggestedDeal = linkedDealFromRelation(suggestedLink?.deals);
    setDialog({
      mode,
      email,
      selectedDealId: suggestedDeal?.id ?? dealOptions[0]?.id ?? "",
      propertyAddress: routingAddress(email.routing_json),
      transactionType: routingTransactionType(email.routing_json),
      reason: "",
    });
  }

  async function submitDialog() {
    if (!dialog) return;
    setWorkingId(dialog.email.id);
    try {
      if (dialog.mode === "link") {
        if (!dialog.selectedDealId) throw new Error("Choose a transaction to link.");
        await postAction(`/api/inbound-emails/${dialog.email.id}/link`, {
          dealId: dialog.selectedDealId,
          matchReason: "Admin linked email from intake queue",
        });
        toast.success("Email linked to transaction.");
      }
      if (dialog.mode === "create") {
        await postAction(`/api/inbound-emails/${dialog.email.id}/create-draft`, {
          propertyAddress: dialog.propertyAddress,
          transactionType: dialog.transactionType,
        });
        toast.success("Draft transaction created.");
      }
      if (dialog.mode === "ignore") {
        await postAction(`/api/inbound-emails/${dialog.email.id}/ignore`, {
          reason: dialog.reason,
        });
        toast.success("Email ignored.");
      }
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setWorkingId(null);
    }
  }

  async function analyzeEmail(email: IntakeEmailRow) {
    setWorkingId(email.id);
    try {
      await postAction(`/api/inbound-emails/${email.id}/analyze`, {});
      toast.success("Intake analyzed.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Email Intake Queue</h2>
          <p className="text-sm text-muted-foreground">
            Review stored packages, link or create a draft, then prepare approved documents for processing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <QueueStat label="Waiting" value={emails.length} />
          <QueueStat label="Needs review" value={emails.filter((email) => email.status === "needs_match_review").length} />
          <QueueStat label="Drafts" value={emails.filter((email) => email.status === "draft_transaction_created").length} />
          <QueueStat label="Errors" value={emails.filter((email) => email.status === "routing_error" || email.status === "error").length} />
        </div>
      </div>

      {emails.length === 0 ? (
        <EmailIntakeEmptyState />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Routing</TableHead>
                <TableHead>Attachments</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="min-w-72 text-right">Workflow</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((email) => {
                const primaryLink = bestLink(email);
                const linkedDeal = linkedDealFromRelation(primaryLink?.deals);
                const isConfirmed = Boolean(
                  linkedDeal &&
                    (email.status === "matched" ||
                      email.status === "draft_transaction_created" ||
                      primaryLink?.match_status === "auto_matched" ||
                      primaryLink?.match_status === "manually_confirmed"),
                );
                const needsReview = email.status === "needs_match_review" || primaryLink?.match_status === "needs_review";
                const renderedAttachmentIds = linkedDeal ? renderedAttachmentIdsByDeal[linkedDeal.id] ?? [] : [];

                return (
                  <TableRow key={email.id}>
                    <TableCell className="min-w-72 align-top">
                      <div className="font-medium">{email.subject || "No subject"}</div>
                      <div className="text-xs text-muted-foreground">
                        {email.from_name || email.from_email || "Unknown sender"}
                        {email.received_at ? ` | ${new Date(email.received_at).toLocaleString()}` : ""}
                      </div>
                      {email.error_message && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-destructive">
                          <AlertCircle className="size-3" />
                          <span>{email.error_message}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-80 align-top">
                      {linkedDeal ? (
                        <div className="space-y-1">
                          <Link href={`/deals/${linkedDeal.id}`} className="font-medium hover:underline">
                            {linkedDeal.property_address ?? linkedDeal.file_name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            Match {primaryLink?.match_score ?? 0}% - {formatMatchStatus(primaryLink?.match_status)}
                          </div>
                          {primaryLink?.match_reason && (
                            <div className="text-xs text-muted-foreground">{primaryLink.match_reason}</div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <span className="text-sm text-muted-foreground">
                            {routingAddress(email.routing_json) || "No confident match"}
                          </span>
                          {routingSummary(email.routing_json) && (
                            <div className="text-xs text-muted-foreground">{routingSummary(email.routing_json)}</div>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="text-sm">{email.email_attachments?.length ?? 0} attachments</div>
                      <div className="text-xs text-muted-foreground">
                        {attachmentStatusSummary(email.email_attachments ?? [])}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant={intakeStatusVariant(email.status)}>{formatIntakeStatus(email.status)}</Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap justify-end gap-2">
                        {needsReview && linkedDeal && (
                          <>
                            <Button size="sm" onClick={() => openDialog("link", email)} disabled={workingId === email.id}>
                              <CheckCircle2 className="size-4" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDialog("link", email)}
                              disabled={workingId === email.id}
                            >
                              <Search className="size-4" />
                              Change
                            </Button>
                          </>
                        )}
                        {!isConfirmed && (
                          <>
                            {canAnalyzeIntake(email) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => analyzeEmail(email)}
                                disabled={workingId === email.id}
                              >
                                <Sparkles className="size-4" />
                                Analyze
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant={needsReview ? "outline" : "default"}
                              onClick={() => openDialog("link", email)}
                              disabled={workingId === email.id || dealOptions.length === 0}
                            >
                              <Link2 className="size-4" />
                              Link
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDialog("create", email)}
                              disabled={workingId === email.id}
                            >
                              <FilePlus2 className="size-4" />
                              Create draft
                            </Button>
                          </>
                        )}
                        {isConfirmed && linkedDeal && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              nativeButton={false}
                              render={<Link href={`/deals/${linkedDeal.id}`} />}
                            >
                              Review
                            </Button>
                            <EmailAttachmentIngestButton
                              dealId={linkedDeal.id}
                              attachments={email.email_attachments}
                              renderedAttachmentIds={renderedAttachmentIds}
                            />
                            <ProcessDealButton
                              dealId={linkedDeal.id}
                              status={linkedDeal.status}
                              pageCount={linkedDeal.page_count}
                              variant="default"
                            />
                          </>
                        )}
                        {email.status !== "ignored" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openDialog("ignore", email)}
                            disabled={workingId === email.id}
                          >
                            <Trash2 className="size-4" />
                            Ignore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialogTitle(dialog.mode)}</DialogTitle>
                <DialogDescription>{dialog.email.subject || "No subject"}</DialogDescription>
              </DialogHeader>

              {dialog.mode === "link" && (
                <div className="space-y-3">
                  <Label htmlFor="intake-deal-search">Transaction</Label>
                  <select
                    id="intake-deal-search"
                    value={dialog.selectedDealId}
                    onChange={(event) => setDialog({ ...dialog, selectedDealId: event.target.value })}
                    className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    {dealOptions.map((deal) => (
                      <option key={deal.id} value={deal.id}>
                        {deal.label}
                      </option>
                    ))}
                  </select>
                  {selectedDeal && (
                    <p className="text-xs text-muted-foreground">
                      {selectedDeal.transactionCode ? `${selectedDeal.transactionCode} | ` : ""}
                      {selectedDeal.transactionType} | {selectedDeal.status}
                    </p>
                  )}
                </div>
              )}

              {dialog.mode === "create" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="draft-address">Property address</Label>
                    <Input
                      id="draft-address"
                      value={dialog.propertyAddress}
                      onChange={(event) => setDialog({ ...dialog, propertyAddress: event.target.value })}
                      placeholder="Unknown"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="draft-type">Transaction type</Label>
                    <select
                      id="draft-type"
                      value={dialog.transactionType}
                      onChange={(event) => setDialog({ ...dialog, transactionType: event.target.value })}
                      className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="sale">Sale</option>
                      <option value="purchase">Purchase</option>
                      <option value="lease">Lease</option>
                      <option value="referral">Referral</option>
                      <option value="co_brokerage">Co-brokerage</option>
                      <option value="preconstruction">Pre-construction</option>
                    </select>
                  </div>
                </div>
              )}

              {dialog.mode === "ignore" && (
                <div className="space-y-2">
                  <Label htmlFor="ignore-reason">Reason</Label>
                  <Textarea
                    id="ignore-reason"
                    value={dialog.reason}
                    onChange={(event) => setDialog({ ...dialog, reason: event.target.value })}
                    placeholder="Duplicate, spam, wrong brokerage, or not a transaction package"
                  />
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>
                  Cancel
                </Button>
                <Button onClick={submitDialog} disabled={workingId === dialog.email.id}>
                  {workingId === dialog.email.id ? "Saving..." : dialogSubmitLabel(dialog.mode)}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

async function postAction(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error ?? "Request failed");
  }
  return res.json();
}

function bestLink(email: IntakeEmailRow) {
  const links = email.deal_email_links ?? [];
  return (
    links.find((link) => link.match_status === "manually_confirmed") ??
    links.find((link) => link.match_status === "auto_matched") ??
    links.find((link) => link.match_status === "needs_review") ??
    links[0] ??
    null
  );
}

function linkedDealFromRelation(value: IntakeLinkedDeal | IntakeLinkedDeal[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function QueueStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full border px-2 py-1">
      {label}: <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}

function EmailIntakeEmptyState() {
  return (
    <div className="rounded-lg border bg-muted/20 p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
        <div className="flex gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
            <Inbox className="size-5" />
          </div>
          <div className="space-y-2">
            <div>
              <h3 className="font-medium">No forwarded packages waiting</h3>
              <p className="text-sm text-muted-foreground">
                New emails forwarded into the intake address will appear here for match review before full processing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Email received</Badge>
              <Badge variant="outline">Admin reviewed</Badge>
              <Badge variant="outline">Admin approved</Badge>
              <Badge variant="outline">Ready to process</Badge>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Mail className="size-4" />
            Intake address
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm">
            {INTAKE_ADDRESS}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Forward transaction emails here. The system stores attachments and waits for admin approval before full AI
            processing.
          </p>
        </div>
      </div>
    </div>
  );
}

function dialogTitle(mode: DialogMode) {
  if (mode === "link") return "Link Email to Transaction";
  if (mode === "create") return "Create Draft Transaction";
  return "Ignore Email";
}

function dialogSubmitLabel(mode: DialogMode) {
  if (mode === "link") return "Link Email";
  if (mode === "create") return "Create Draft";
  return "Ignore Email";
}

function intakeStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "matched" || status === "draft_transaction_created") return "default";
  if (
    status === "needs_match_review" ||
    status === "new_deal_suggested" ||
    status === "attachments_queued" ||
    status === "routing" ||
    status === "routing_queued"
  ) {
    return "secondary";
  }
  if (status === "error" || status === "routing_error") return "destructive";
  return "outline";
}

function formatIntakeStatus(status: string) {
  if (status === "intake_review") return "Intake review";
  if (status === "needs_match_review") return "Needs match review";
  if (status === "new_deal_suggested") return "New deal suggested";
  if (status === "not_deal_suggested") return "Not a deal?";
  if (status === "draft_transaction_created") return "Draft created";
  if (status === "attachments_queued") return "Storing attachments";
  if (status === "routing_queued") return "Needs review";
  if (status === "routing_error") return "Routing error";
  if (status === "ignored") return "Ignored";
  return status.replaceAll("_", " ");
}

function formatMatchStatus(status: string | undefined) {
  if (status === "auto_matched") return "Auto matched";
  if (status === "manually_confirmed") return "Confirmed";
  if (status === "needs_review") return "Needs review";
  if (status === "rejected") return "Rejected";
  return status ?? "Suggested";
}

function attachmentStatusSummary(attachments: EmailAttachmentForQueue[]) {
  if (attachments.length === 0) return "No stored attachments";
  const linked = attachments.filter((item) => item.status === "linked_to_transaction").length;
  const duplicate = attachments.filter((item) => item.status === "duplicate").length;
  const ignored = attachments.filter((item) => item.status === "ignored").length;
  const parts = [];
  if (linked) parts.push(`${linked} linked`);
  if (duplicate) parts.push(`${duplicate} duplicate`);
  if (ignored) parts.push(`${ignored} ignored`);
  return parts.length ? parts.join(" | ") : "Stored";
}

function routingAddress(routing: Record<string, unknown> | null) {
  const value = routing?.property_address;
  return typeof value === "string" ? value : "";
}

function routingTransactionType(routing: Record<string, unknown> | null) {
  const value = routing?.transaction_type_guess;
  return typeof value === "string" && value ? value : "unknown";
}

function routingSummary(routing: Record<string, unknown> | null) {
  if (!routing) return "";
  const type = routingTransactionType(routing);
  const confidence = routing.routing_confidence;
  const confidenceText = typeof confidence === "number" ? `${Math.round(confidence * 100)}% confidence` : "";
  if (type === "unknown") return confidenceText;
  return [type, confidenceText].filter(Boolean).join(" | ");
}

function canAnalyzeIntake(email: IntakeEmailRow) {
  return (
    email.status === "intake_review" ||
    email.status === "new_deal_suggested" ||
    email.status === "not_deal_suggested" ||
    email.status === "routing_queued" ||
    email.status === "routing_error" ||
    email.status === "error"
  );
}
