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
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  EmailAttachmentIngestButton,
  prepareEmailAttachmentsForProcessing,
} from "@/components/email-attachment-ingest-button";
import { ProcessDealButton } from "@/components/process-deal-button";
import { createClient } from "@/lib/supabase/client";
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
  body_text: string | null;
  body_html: string | null;
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
  ignore_reason?: string | null;
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

type DialogMode = "review" | "link" | "create" | "ignore";

type DialogState = {
  mode: DialogMode;
  email: IntakeEmailRow;
  selectedDealId: string;
  propertyAddress: string;
  transactionType: string;
  reason: string;
  previewAttachmentId: string;
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
  const supabase = createClient();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [workflowProgress, setWorkflowProgress] = useState("");
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
      previewAttachmentId: firstPreviewAttachmentId(email),
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

  async function approveAndProcess(dialog: DialogState, action: "link" | "create") {
    setWorkingId(dialog.email.id);
    setWorkflowProgress(action === "link" ? "Linking email to transaction..." : "Creating draft transaction...");
    try {
      const result =
        action === "link"
          ? await postAction(`/api/inbound-emails/${dialog.email.id}/link`, {
              dealId: dialog.selectedDealId,
              matchReason: "Admin approved email intake for full processing",
            })
          : await postAction(`/api/inbound-emails/${dialog.email.id}/create-draft`, {
              propertyAddress: dialog.propertyAddress,
              transactionType: dialog.transactionType,
            });
      const approvedDeal = result.deal as IntakeLinkedDeal | undefined;
      if (!approvedDeal?.id) throw new Error("Approved transaction was not returned.");

      setWorkflowProgress("Preparing email attachments...");
      await prepareEmailAttachmentsForProcessing({
        supabase,
        dealId: approvedDeal.id,
        attachments: dialog.email.email_attachments,
        renderedAttachmentIds: approvedDeal.id === deal.id ? renderedAttachmentIds : [],
        onProgress: setWorkflowProgress,
      });

      setWorkflowProgress("Running full AI extraction and compliance check...");
      const processResponse = await fetch(`/api/deals/${approvedDeal.id}/process`, { method: "POST" });
      if (!processResponse.ok) {
        const body = await processResponse.json().catch(() => null);
        throw new Error(body?.error ?? "Full processing failed");
      }

      toast.success("Email package approved and processed.");
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setWorkingId(null);
      setWorkflowProgress("");
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
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={() => openDialog("review", email)} disabled={isWorking}>
                    <CheckCircle2 className="size-3.5" />
                    Review match
                  </Button>
                )}
                {!isConfirmed && (
                  <Button
                    size="sm"
                    variant={needsReview ? "outline" : "default"}
                    className="h-7 px-2 text-xs"
                    onClick={() => openDialog("review", email)}
                    disabled={isWorking}
                  >
                    <Search className="size-3.5" />
                    Review intake
                  </Button>
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
        <DialogContent className={dialog?.mode === "review" ? "max-h-[90vh] overflow-hidden sm:max-w-6xl" : "sm:max-w-lg"}>
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialogTitle(dialog.mode)}</DialogTitle>
                <DialogDescription>
                  {dialog.mode === "review"
                    ? "Inspect the email and attachments, then approve full processing or ignore this intake."
                    : dialog.email.subject || "No subject"}
                </DialogDescription>
              </DialogHeader>

              {dialog.mode === "review" && (
                <IntakeReviewModal
                  dialog={dialog}
                  selectedDeal={selectedDeal}
                  dealOptions={dealOptions}
                  working={workingId === dialog.email.id}
                  progress={workflowProgress}
                  onChange={setDialog}
                  onApproveExisting={() => approveAndProcess(dialog, "link")}
                  onApproveNew={() => approveAndProcess(dialog, "create")}
                  onIgnore={() => submitDialogWithMode({ ...dialog, mode: "ignore" })}
                />
              )}

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
                {dialog.mode !== "review" && (
                  <Button onClick={submitDialog} disabled={workingId === dialog.email.id}>
                    {workingId === dialog.email.id ? "Saving..." : dialogSubmitLabel(dialog.mode)}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  async function submitDialogWithMode(nextDialog: DialogState) {
    setDialog(nextDialog);
    setWorkingId(nextDialog.email.id);
    try {
      await postAction(`/api/inbound-emails/${nextDialog.email.id}/ignore`, {
        reason: nextDialog.reason || "Ignored during intake review",
      });
      toast.success("Email ignored.");
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setWorkingId(null);
      setWorkflowProgress("");
    }
  }
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

function IntakeReviewModal({
  dialog,
  selectedDeal,
  dealOptions,
  working,
  progress,
  onChange,
  onApproveExisting,
  onApproveNew,
  onIgnore,
}: {
  dialog: DialogState;
  selectedDeal: IntakeDealOption | null;
  dealOptions: IntakeDealOption[];
  working: boolean;
  progress: string;
  onChange: (dialog: DialogState) => void;
  onApproveExisting: () => void;
  onApproveNew: () => void;
  onIgnore: () => void;
}) {
  const attachments = dialog.email.email_attachments ?? [];
  const previewableAttachments = attachments.filter((attachment) => attachment.status !== "ignored" && attachment.status !== "duplicate");
  const selectedAttachment =
    previewableAttachments.find((attachment) => attachment.id === dialog.previewAttachmentId) ??
    previewableAttachments[0] ??
    null;
  const emailBody = plainEmailBody(dialog.email);
  const routing = dialog.email.routing_json;
  const documentGuesses = routingDocumentGuesses(routing);

  return (
    <div className="grid min-h-0 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]">
      <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
        <div className="rounded-lg border">
          <div className="border-b p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</div>
            <div className="mt-1 text-sm font-medium">{dialog.email.subject || "No subject"}</div>
            <div className="text-xs text-muted-foreground">
              {dialog.email.from_name || dialog.email.from_email || "Unknown sender"}
              {dialog.email.received_at ? ` | ${new Date(dialog.email.received_at).toLocaleString()}` : ""}
            </div>
          </div>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-5 text-foreground/80">
            {emailBody || "No readable email body was included with this forwarded package."}
          </div>
        </div>

        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            {previewableAttachments.length === 0 ? (
              <span className="px-1 text-xs text-muted-foreground">No stored document attachments to preview.</span>
            ) : (
              previewableAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  className={`max-w-48 truncate rounded-md border px-2 py-1 text-left text-xs ${
                    selectedAttachment?.id === attachment.id ? "border-primary bg-primary text-primary-foreground" : "bg-background"
                  }`}
                  onClick={() => onChange({ ...dialog, previewAttachmentId: attachment.id })}
                  title={attachment.original_filename ?? undefined}
                >
                  {attachment.original_filename || "Attachment"}
                </button>
              ))
            )}
          </div>
          <div className="h-[34rem] bg-muted/25">
            {selectedAttachment ? (
              attachmentCanPreview(selectedAttachment) ? (
                <iframe
                  title={selectedAttachment.original_filename ?? "Attachment preview"}
                  src={`/api/email-attachments/${selectedAttachment.id}/download`}
                  className="h-full w-full bg-background"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  Preview is not available for this file type. Use Download to inspect it.
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Select an attachment to preview.
              </div>
            )}
          </div>
          {selectedAttachment && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-2 text-xs text-muted-foreground">
              <span className="truncate">{attachmentMeta(selectedAttachment)}</span>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={`/api/email-attachments/${selectedAttachment.id}/download`} target="_blank" />}
              >
                Download
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 space-y-3 overflow-y-auto">
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-medium">Routing Signals</div>
          <div className="grid gap-2 text-xs">
            <SignalRow label="Property" value={routingAddress(routing) || "Unknown"} />
            <SignalRow label="Type" value={routingTransactionType(routing)} />
            <SignalRow label="Confidence" value={routingConfidence(routing)} />
            <SignalRow label="Status" value={formatIntakeStatus(dialog.email.status)} />
          </div>
          {documentGuesses.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Document guesses</div>
              {documentGuesses.slice(0, 5).map((guess) => (
                <div key={`${guess.filename}-${guess.document_type}`} className="rounded-md bg-muted/35 px-2 py-1 text-xs">
                  <div className="truncate font-medium">{shortDocumentLabel(guess.document_type)}</div>
                  <div className="truncate text-muted-foreground">
                    {guess.filename} {typeof guess.confidence === "number" ? `| ${Math.round(guess.confidence * 100)}%` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border p-3">
          <div className="mb-3 text-sm font-medium">Approve Destination</div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`review-existing-${dialog.email.id}`}>Existing transaction</Label>
              <select
                id={`review-existing-${dialog.email.id}`}
                value={dialog.selectedDealId}
                onChange={(event) => onChange({ ...dialog, selectedDealId: event.target.value })}
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
              <Button
                className="w-full"
                onClick={onApproveExisting}
                disabled={working || !dialog.selectedDealId || dealOptions.length === 0}
              >
                Approve existing & process
              </Button>
            </div>

            <div className="border-t pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Or create a new transaction</div>
              <div className="space-y-2">
                <Input
                  value={dialog.propertyAddress}
                  onChange={(event) => onChange({ ...dialog, propertyAddress: event.target.value })}
                  placeholder="Property address"
                />
                <select
                  value={dialog.transactionType}
                  onChange={(event) => onChange({ ...dialog, transactionType: event.target.value })}
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
                <Button variant="outline" className="w-full" onClick={onApproveNew} disabled={working}>
                  Create new & process
                </Button>
              </div>
            </div>

            <div className="border-t pt-3">
              <Textarea
                value={dialog.reason}
                onChange={(event) => onChange({ ...dialog, reason: event.target.value })}
                placeholder="Reason if ignored"
              />
              <Button variant="outline" className="mt-2 w-full" onClick={onIgnore} disabled={working}>
                Ignore intake
              </Button>
            </div>
          </div>
          {working && (
            <div className="mt-3 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              {progress || "Working..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
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
  if (email.status === "intake_review" || email.status === "routing_queued") return "Review intake, approve it for processing, or ignore it.";
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
      previewAttachmentId: firstPreviewAttachmentId(email),
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

function formatEmailAttachmentStatus(status: string) {
  if (status === "linked_to_transaction") return "Linked";
  if (status === "light_classified") return "Classified";
  if (status === "stored") return "Stored";
  if (status === "duplicate") return "Duplicate";
  if (status === "ignored") return "Ignored";
  if (status === "failed") return "Failed";
  return status.replaceAll("_", " ");
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

function routingConfidence(routing: Record<string, unknown> | null) {
  const confidence = routing?.routing_confidence;
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "Unknown";
}

function routingDocumentGuesses(routing: Record<string, unknown> | null) {
  const value = routing?.document_type_guesses;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      return {
        filename: typeof candidate.filename === "string" ? candidate.filename : "Attachment",
        document_type: typeof candidate.document_type === "string" ? candidate.document_type : "unknown",
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
      };
    })
    .filter((item): item is { filename: string; document_type: string; confidence: number | null } => Boolean(item));
}

function firstPreviewAttachmentId(email: IntakeEmailRow) {
  return (
    email.email_attachments.find((attachment) => attachment.status !== "ignored" && attachment.status !== "duplicate")?.id ??
    ""
  );
}

function plainEmailBody(email: IntakeEmailRow) {
  if (email.body_text?.trim()) return email.body_text.trim();
  if (!email.body_html) return "";
  return email.body_html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function attachmentCanPreview(attachment: EmailAttachmentForQueue) {
  const mime = attachment.mime_type ?? "";
  const name = attachment.original_filename?.toLowerCase() ?? "";
  return mime === "application/pdf" || mime.startsWith("image/") || name.endsWith(".pdf");
}

function attachmentMeta(attachment: EmailAttachmentForQueue) {
  return [
    attachment.original_filename || "Attachment",
    attachment.mime_type || "unknown type",
    formatBytes(attachment.file_size),
    formatEmailAttachmentStatus(attachment.status),
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatBytes(bytes: number | null) {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
