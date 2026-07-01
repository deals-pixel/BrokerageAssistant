"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FilePlus2,
  Inbox,
  Link2,
  Mail,
  RotateCcw,
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

  function dialogStateForEmail(mode: DialogMode, email: IntakeEmailRow): DialogState {
    const suggestedLink = bestLink(email);
    const suggestedDeal = linkedDealFromRelation(suggestedLink?.deals);
    return {
      mode,
      email,
      selectedDealId: suggestedDeal?.id ?? deal.id ?? dealOptions[0]?.id ?? "",
      propertyAddress: routingAddress(email.routing_json) || deal.property_address || "",
      transactionType: routingTransactionType(email.routing_json),
      reason: "",
      previewAttachmentId: firstPreviewAttachmentId(email),
    };
  }

  function openDialog(mode: DialogMode, email: IntakeEmailRow) {
    setDialog(dialogStateForEmail(mode, email));
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
        const result = await postAction(`/api/inbound-emails/${dialog.email.id}/create-draft`, {
          propertyAddress: dialog.propertyAddress,
          transactionType: dialog.transactionType,
        });
        rememberDashboardScrollTarget(result.deal as IntakeLinkedDeal | undefined);
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

  async function approveAndProcess(
    dialog: DialogState,
    action: "link" | "create",
    options: { successMessage?: string; undo?: { emailId: string; dealId: string } } = {},
  ) {
    const hasProcessableAttachments = hasProcessableEmailAttachments(dialog.email);
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

      if (!hasProcessableAttachments) {
        toast.success(action === "link" ? "Email linked for review." : "Draft transaction created for review.");
        rememberDashboardScrollTarget(approvedDeal);
        setDialog(null);
        router.refresh();
        return;
      }

      await updateInboundEmailStatus(dialog.email.id, "processing_from_routing");
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

      await updateInboundEmailStatus(dialog.email.id, action === "link" ? "matched" : "draft_transaction_created");
      rememberDashboardScrollTarget(approvedDeal);
      if (options.successMessage) {
        toast.success(options.successMessage, {
          duration: 5000,
          action: options.undo
            ? {
                label: "Undo",
                onClick: () => undoAutoMatch(options.undo!.emailId, options.undo!.dealId),
              }
            : undefined,
        });
      } else {
        toast.success("Email package approved and processed.");
      }
      setDialog(null);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Approval failed";
      await updateInboundEmailStatus(dialog.email.id, "error", message).catch((statusErr) => {
        console.error("Could not mark intake approval as failed", statusErr);
      });
      toast.error(message);
    } finally {
      setWorkingId(null);
      setWorkflowProgress("");
    }
  }

  async function updateInboundEmailStatus(emailId: string, status: string, errorMessage: string | null = null) {
    const { error } = await supabase
      .from("inbound_emails")
      .update({ status, error_message: errorMessage })
      .eq("id", emailId);
    if (error) throw new Error(error.message);
  }

  async function processIntakeForRouting(dialog: DialogState) {
    setWorkingId(dialog.email.id);
    setWorkflowProgress("Analyzing email content and attachments...");
    try {
      const result = await postAction(`/api/inbound-emails/${dialog.email.id}/analyze`, {});
      const status = typeof result.status === "string" ? result.status : "";
      const match = result.match as { deal?: IntakeLinkedDeal | null; score?: number | null; reason?: string | null } | undefined;
      const suggestedDeal = match?.deal ?? null;
      const matchScore = typeof match?.score === "number" ? match.score : 0;
      if (status === "needs_match_review" && suggestedDeal && isHighConfidenceMatch(matchScore)) {
        await approveAndProcess(
          {
            ...dialog,
            selectedDealId: suggestedDeal.id,
            email: emailWithAnalyzedRouting(dialog.email, result, suggestedDeal),
          },
          "link",
          {
            successMessage: `Matched to ${shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)}.`,
            undo: { emailId: dialog.email.id, dealId: suggestedDeal.id },
          },
        );
        return;
      }
      if (status === "needs_match_review") {
        toast.success("Possible match found. Confirm it on the intake card.");
      } else if (status === "new_deal_suggested") {
        toast.success("No existing match found. Create a new deal from the intake card.");
      } else if (status === "not_deal_suggested") {
        toast.success("Analysis complete. AI suggests this is not a deal package.");
      } else {
        toast.success("Analysis complete.");
      }
      setDialog(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process intake");
    } finally {
      setWorkingId(null);
      setWorkflowProgress("");
    }
  }

  async function rejectRoutingSuggestion(email: IntakeEmailRow) {
    setWorkingId(email.id);
    try {
      const primaryLink = bestLink(email);
      if (primaryLink?.deal_id) {
        await supabase
          .from("deal_email_links")
          .update({ match_status: "rejected" })
          .eq("inbound_email_id", email.id)
          .eq("deal_id", primaryLink.deal_id);
      }
      await updateInboundEmailStatus(email.id, "new_deal_suggested");
      toast.success("Match rejected. Create a new deal if this package should advance.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reject match");
    } finally {
      setWorkingId(null);
    }
  }

  async function undoAutoMatch(emailId: string, dealId: string) {
    try {
      await supabase
        .from("deal_email_links")
        .update({ match_status: "needs_review" })
        .eq("inbound_email_id", emailId)
        .eq("deal_id", dealId);
      await updateInboundEmailStatus(emailId, "needs_match_review");
      toast.success("Auto-match moved back to intake review.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo match");
    }
  }

  async function proceedWithRoutingSuggestion(
    email: IntakeEmailRow,
    _primaryLink: IntakeEmailRow["deal_email_links"][number] | null,
    suggestedDeal: IntakeLinkedDeal | null,
  ) {
    const nextDialog = dialogStateForEmail("review", email);
    if (email.status === "not_deal_suggested") {
      if (suggestedDeal) {
        await approveAndProcess(
          { ...nextDialog, selectedDealId: suggestedDeal.id },
          "link",
          { successMessage: "Communication saved to the transaction." },
        );
      } else {
        openDialog("link", email);
      }
      return;
    }
    if (email.status === "new_deal_suggested" || !suggestedDeal) {
      await approveAndProcess(nextDialog, "create");
      return;
    }
    await approveAndProcess({ ...nextDialog, selectedDealId: suggestedDeal.id }, "link");
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
        const isWorking = workingId === email.id;
        const routingReady = isRoutingReviewEmail(email, primaryLink);
        const suggestion = routingSuggestion(email, primaryLink, suggestedDeal);

        return (
          <div
            key={email.id}
            className="min-w-0 space-y-2 rounded-md border bg-background/80 p-2.5 text-left transition hover:border-foreground/25 hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="button"
            tabIndex={0}
            onClick={() => openDialog("review", email)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openDialog("review", email);
              }
            }}
          >
            {routingReady ? (
              <div className="flex min-w-0 items-start justify-between gap-3 rounded-md border bg-muted/25 p-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {email.status === "new_deal_suggested" ? "No match found" : "Inline confirmation"}
                  </div>
                  <div className="break-words text-[12px] font-semibold leading-4" title={suggestion.title}>
                    {suggestion.primary}
                  </div>
                  <div className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">
                    {suggestion.meta}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10px] leading-4">
                  <div className="uppercase tracking-wide text-muted-foreground">Confidence</div>
                  <div className="font-semibold text-foreground">{routingConfidence(email.routing_json, primaryLink)}</div>
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 pt-1 text-xs leading-4">
                <CompactIntakeInfo label="From" value={email.from_name || email.from_email || "Unknown sender"} />
                <CompactIntakeInfo label="Received" value={formatCompactReceived(email.received_at)} />
                <div className="col-span-2">
                  <CompactIntakeInfo label="Files" value={compactAttachmentSummary(email.email_attachments ?? [])} />
                </div>
                {email.error_message && (
                  <div className="col-span-2 flex min-w-0 items-center gap-1 text-destructive">
                    <AlertCircle className="size-3 shrink-0" />
                    <span className="break-words">{email.error_message}</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {routingReady && (
                  <>
                    <Button
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        proceedWithRoutingSuggestion(email, primaryLink, suggestedDeal);
                      }}
                      disabled={isWorking}
                    >
                      {email.status === "new_deal_suggested"
                        ? "Create Deal"
                        : email.status === "not_deal_suggested"
                          ? "Attach"
                          : "Confirm"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (email.status === "new_deal_suggested") {
                          openDialog("review", email);
                        } else if (email.status === "not_deal_suggested") {
                          submitDialogWithMode({
                            ...dialogStateForEmail("ignore", email),
                            reason: "AI suggested this intake is not a deal package.",
                          });
                        } else {
                          rejectRoutingSuggestion(email);
                        }
                      }}
                      disabled={isWorking}
                    >
                      {email.status === "new_deal_suggested"
                        ? "Review"
                        : email.status === "not_deal_suggested"
                          ? "Ignore"
                          : "Reject"}
                    </Button>
                  </>
                )}
                {!routingReady && !isConfirmed && (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-9 px-4 text-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      processIntakeForRouting(dialogStateForEmail("review", email));
                    }}
                    disabled={isWorking}
                  >
                    <Search className="size-3.5" />
                    {isWorking ? "Processing..." : "Process"}
                  </Button>
                )}
                {isConfirmed && linkedDeal && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      nativeButton={false}
                      onClick={(event) => event.stopPropagation()}
                      render={<Link href={`/deals/${linkedDeal.id}`} />}
                    >
                      Review
                    </Button>
                    {hasProcessableEmailAttachments(email) ? (
                      <>
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
                    ) : (
                      <span className="text-[11px] leading-4 text-muted-foreground">Body-only intake</span>
                    )}
                  </>
                )}
                {!routingReady && email.status !== "ignored" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 px-4 text-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      openDialog("ignore", email);
                    }}
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
        <DialogContent className={dialog?.mode === "review" ? "max-h-[90vh] overflow-y-auto sm:max-w-6xl" : "sm:max-w-lg"}>
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{dialogTitle(dialog.mode)}</DialogTitle>
                <DialogDescription>
                  {dialog.mode === "review"
                    ? "Inspect the email and attachments, then process intake or confirm the AI destination."
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
                  onProcessRouting={() => processIntakeForRouting(dialog)}
                  onConfirmExisting={() => approveAndProcess(dialog, "link")}
                  onCreateNew={() => approveAndProcess(dialog, "create")}
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
    <div className="grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] gap-2 rounded-md bg-muted/35 px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium leading-4 text-foreground" title={value}>
          {value}
        </div>
        {meta && <div className="truncate text-[10px] leading-3 text-muted-foreground">{meta}</div>}
      </div>
    </div>
  );
}

function CompactIntakeInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase leading-4 text-muted-foreground">{label}</div>
      <div className="min-w-0 truncate text-xs font-medium leading-4 text-foreground" title={value}>
        {value}
      </div>
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
  onProcessRouting,
  onConfirmExisting,
  onCreateNew,
  onIgnore,
}: {
  dialog: DialogState;
  selectedDeal: IntakeDealOption | null;
  dealOptions: IntakeDealOption[];
  working: boolean;
  progress: string;
  onChange: (dialog: DialogState) => void;
  onProcessRouting: () => void;
  onConfirmExisting: () => void;
  onCreateNew: () => void;
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
  const emailBodyFields = routingEmailBodyFields(routing);
  const hasCommunicationFields = emailBodyFields.length > 0;
  const hasProcessableAttachments = hasProcessableEmailAttachments(dialog.email);
  const primaryLink = bestLink(dialog.email);
  const suggestedDeal = linkedDealFromRelation(primaryLink?.deals);
  const routingReady = isRoutingReviewEmail(dialog.email, primaryLink);
  const notDealSuggested = dialog.email.status === "not_deal_suggested";
  const newDealSuggested = dialog.email.status === "new_deal_suggested";
  const [overrideOpen, setOverrideOpen] = useState(false);

  const suggestionTitle = notDealSuggested
    ? suggestedDeal
      ? "Communication for existing transaction"
      : hasCommunicationFields
        ? "Deal communication details found"
        : "Not a deal package"
    : newDealSuggested
      ? "Create a new transaction"
      : suggestedDeal
        ? "Match to existing transaction"
        : "Review intake";
  const suggestionPrimary = notDealSuggested
    ? suggestedDeal
      ? shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)
      : hasCommunicationFields
        ? routingAddress(routing) || "Attach these email details to the right transaction."
        : "AI suggests this intake should be ignored."
    : newDealSuggested
      ? routingAddress(routing) || "AI did not find a confident existing transaction."
      : suggestedDeal
        ? shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)
        : routingAddress(routing) || "No confident route is available.";
  const suggestionMeta = notDealSuggested
    ? suggestedDeal
      ? primaryLink?.match_reason || "Save this email to the deal portal without processing it as a document package."
      : hasCommunicationFields
        ? "This is not a document package, but it contains deal fields that can update the selected transaction."
        : dialog.email.error_message || "No confident deal-document signal was found."
    : newDealSuggested
      ? "No existing deal match reached the routing threshold."
      : primaryLink?.match_reason || routingSummary(routing) || "Review the suggested destination.";
  function proceedWithSuggestion() {
    if (notDealSuggested) {
      if (suggestedDeal) {
        onConfirmExisting();
      } else {
        setOverrideOpen(true);
      }
      return;
    }
    if (newDealSuggested || !suggestedDeal) {
      onCreateNew();
      return;
    }
    onConfirmExisting();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.85fr)]">
      <div className="space-y-3">
        {!routingReady && (
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
        )}

        <div className="rounded-lg border">
          {previewableAttachments.length === 0 ? (
            <>
              <div className="border-b p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email body</div>
                <div className="mt-1 text-sm font-medium">{dialog.email.subject || "No subject"}</div>
                <div className="text-xs text-muted-foreground">
                  {dialog.email.from_name || dialog.email.from_email || "Unknown sender"}
                  {dialog.email.received_at ? ` | ${new Date(dialog.email.received_at).toLocaleString()}` : ""}
                </div>
              </div>
              <div className="h-[34rem] overflow-y-auto bg-background p-4 text-sm leading-6">
                <pre className="whitespace-pre-wrap break-words font-sans">
                  {emailBody || "No readable email body was included with this forwarded package."}
                </pre>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b p-2">
                {previewableAttachments.map((attachment) => (
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
                ))}
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
            </>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {routingReady ? (
          <div className="rounded-lg border p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Suggestion</div>
            <div className="mt-2 rounded-lg border bg-muted/25 p-4">
              <div className="text-lg font-semibold leading-6">{suggestionTitle}</div>
              <div className="mt-2 break-words text-base leading-6">{suggestionPrimary}</div>
              <div className="mt-2 text-xs leading-5 text-muted-foreground">{suggestionMeta}</div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <SuggestionMeta label="Type" value={routingTransactionType(routing)} />
                <SuggestionMeta label="Confidence" value={routingConfidence(routing)} />
                <SuggestionMeta
                  label="Match"
                  value={primaryLink?.match_score != null ? `${primaryLink.match_score}%` : newDealSuggested ? "New" : "None"}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button onClick={proceedWithSuggestion} disabled={working}>
                {working ? "Working..." : notDealSuggested ? "Attach communication" : "Proceed"}
              </Button>
              <Button variant="outline" onClick={() => setOverrideOpen((current) => !current)} disabled={working}>
                Override
              </Button>
            </div>
            {!hasProcessableAttachments && !notDealSuggested && (
              <div className="mt-3 rounded-md bg-muted/35 px-2 py-1.5 text-xs text-muted-foreground">
                No processable document attachment is available. Proceeding will save the email context for review; full
                document parsing starts after PDF/image documents are added.
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-lg border p-3">
              <div className="mb-2 text-sm font-medium">AI Signals</div>
              <div className="grid gap-2 text-xs">
                <SignalRow label="Property" value={routingAddress(routing) || "Unknown"} />
                <SignalRow label="Type" value={routingTransactionType(routing)} />
                <SignalRow label="Confidence" value={routingConfidence(routing)} />
                <SignalRow label="Status" value={formatIntakeStatus(dialog.email.status)} />
              </div>
              {!hasProcessableAttachments && (
                <div className="mt-3 rounded-md bg-muted/35 px-2 py-1.5 text-xs text-muted-foreground">
                  No processable document attachment is available. Approving this intake will save the email context for
                  review; full document parsing starts after PDF/image documents are added.
                </div>
              )}
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

            {emailBodyFields.length > 0 && (
              <div className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-medium">Email Body Fields</div>
                <div className="space-y-1.5">
                  {emailBodyFields.map((field) => (
                    <div key={field.field_key} className="rounded-md bg-muted/35 px-2 py-1.5 text-xs">
                      <div className="font-medium">{field.label}</div>
                      <div className="break-words text-muted-foreground">{field.value}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Needs admin review {typeof field.confidence === "number" ? `| ${Math.round(field.confidence * 100)}% signal` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(!routingReady || overrideOpen) && (
          <div className="rounded-lg border p-3">
            <div className="mb-3 text-sm font-medium">{routingReady ? "Override Match" : "Process Intake"}</div>
            <div className="space-y-3">
              {!routingReady ? (
                <>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Run intake analysis first. The system will classify intake signals, suggest an existing transaction
                    when there is a match, or suggest a new transaction when no confident match is found.
                  </p>
                  <Button className="w-full" onClick={onProcessRouting} disabled={working}>
                    {working ? "Processing..." : "Process intake"}
                  </Button>
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
                </>
              ) : (
                <>
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
                      onClick={onConfirmExisting}
                      disabled={working || !dialog.selectedDealId || dealOptions.length === 0}
                    >
                      {hasProcessableAttachments ? "Confirm destination & process" : "Confirm destination"}
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
                      <Button variant="outline" className="w-full" onClick={onCreateNew} disabled={working}>
                        {hasProcessableAttachments ? "Create new & process" : "Create draft for review"}
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
                </>
              )}
            </div>
          </div>
        )}

        {working && (
          <div className="rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
            {progress || "Working..."}
          </div>
        )}
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

function SuggestionMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background/70 px-2 py-1.5">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
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

function compactAttachmentSummary(attachments: EmailAttachmentForQueue[]) {
  const activeAttachments = attachments.filter(
    (attachment) => attachment.status !== "ignored" && attachment.status !== "duplicate",
  );
  if (activeAttachments.length === 0) return "No files attached";
  if (activeAttachments.length === 1) return activeAttachments[0].original_filename || "1 file attached";
  return `${activeAttachments.length} files attached`;
}

function formatCompactReceived(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} - ${time}`;
}

function activityAttachmentSummary(email: IntakeEmailRow) {
  const attachments = email.email_attachments ?? [];
  if (attachments.length === 0 && email.status !== "ignored") return "Email body only";
  if (attachments.length === 0) return "No valid stored attachments";
  return attachmentStatusSummary(attachments);
}

function activityAttachmentReason(email: IntakeEmailRow) {
  const reasons = Array.from(
    new Set(
      (email.email_attachments ?? [])
        .map((attachment) => attachment.ignore_reason)
        .filter((reason): reason is string => Boolean(reason)),
    ),
  );
  if (reasons.length === 0) return "";
  return reasons.map((reason) => reason.replaceAll("_", " ")).join(" | ");
}

function activityResult(email: IntakeEmailRow) {
  if (email.status === "ignored") return "Hidden from active workspace";
  if (email.status === "error" || email.status === "routing_error") return "Needs admin attention";
  if (email.status === "attachments_queued") return "Stored email, preparing attachments";
  if (email.status === "intake_review") return "Visible in Intake Review";
  if (email.status === "needs_match_review") return "Needs inline match confirmation";
  if (email.status === "new_deal_suggested") return "Suggested as a new deal";
  if (email.status === "not_deal_suggested") return "Suggested as not a deal package";
  return "Stored by the platform";
}

function hasProcessableEmailAttachments(email: IntakeEmailRow) {
  return (email.email_attachments ?? []).some((attachment) =>
    attachment.status === "stored" ||
    attachment.status === "light_classified" ||
    attachment.status === "linked_to_transaction",
  );
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
                <TableHead>AI Match</TableHead>
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

export function InboundEmailActivityPanel({ emails }: { emails: IntakeEmailRow[] }) {
  const router = useRouter();
  const [selectedEmail, setSelectedEmail] = useState<IntakeEmailRow | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function markUseful(email: IntakeEmailRow) {
    setWorkingId(email.id);
    try {
      await postAction(`/api/inbound-emails/${email.id}/restore`, {});
      toast.success("Email moved to intake review.");
      setSelectedEmail(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not restore email");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Recent Email Intake Activity</h2>
          <p className="text-sm text-muted-foreground">
            Delivery receipts from Postmark, including emails hidden from the active workspace.
          </p>
        </div>
        <Badge variant="outline">{emails.length} recent</Badge>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attachments</TableHead>
              <TableHead>Platform result</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.map((email) => {
              const linkedDeal = linkedDealFromRelation(bestLink(email)?.deals);
              return (
                <TableRow key={email.id}>
                  <TableCell className="min-w-72 align-top">
                    <div className="font-medium">{email.subject || "No subject"}</div>
                    <div className="text-xs text-muted-foreground">
                      {email.from_name || email.from_email || "Unknown sender"}
                      {email.received_at ? ` | ${new Date(email.received_at).toLocaleString()}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant={intakeStatusVariant(email.status)}>
                      {formatIntakeStatus(email.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-80 align-top text-sm">
                    <div>{activityAttachmentSummary(email)}</div>
                    {activityAttachmentReason(email) && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {activityAttachmentReason(email)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-96 align-top text-sm">
                    {linkedDeal ? (
                      <Link href={`/deals/${linkedDeal.id}`} className="font-medium hover:underline">
                        Attached to {shortDealTitle(linkedDeal.property_address, linkedDeal.file_name)}
                      </Link>
                    ) : (
                      <span>{activityResult(email)}</span>
                    )}
                    {email.error_message && (
                      <div className="mt-1 text-xs text-muted-foreground">{email.error_message}</div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => setSelectedEmail(email)}>
                        <Eye className="size-4" />
                        Open
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={Boolean(selectedEmail)} onOpenChange={(open) => !open && setSelectedEmail(null)}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
          {selectedEmail && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEmail.subject || "No subject"}</DialogTitle>
                <DialogDescription>
                  {selectedEmail.from_name || selectedEmail.from_email || "Unknown sender"}
                  {selectedEmail.received_at ? ` | ${new Date(selectedEmail.received_at).toLocaleString()}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.25fr)_minmax(18rem,0.75fr)]">
                <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                  <div className="rounded-lg border">
                    <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email body
                    </div>
                    <div className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap p-3 text-xs leading-5 text-foreground/80">
                      {plainEmailBody(selectedEmail) || "No readable email body was included."}
                    </div>
                  </div>
                </div>

                <div className="min-h-0 space-y-3 overflow-y-auto">
                  <div className="rounded-lg border p-3">
                    <div className="mb-2 text-sm font-medium">AI Signals</div>
                    <div className="grid gap-2 text-xs">
                      <SignalRow label="Property" value={routingAddress(selectedEmail.routing_json) || "Unknown"} />
                      <SignalRow label="Type" value={routingTransactionType(selectedEmail.routing_json)} />
                      <SignalRow label="Confidence" value={routingConfidence(selectedEmail.routing_json)} />
                      <SignalRow label="Status" value={formatIntakeStatus(selectedEmail.status)} />
                    </div>
                  </div>

                  {routingEmailBodyFields(selectedEmail.routing_json).length > 0 && (
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 text-sm font-medium">Email Body Fields</div>
                      <div className="space-y-1.5">
                        {routingEmailBodyFields(selectedEmail.routing_json).map((field) => (
                          <div key={field.field_key} className="rounded-md bg-muted/35 px-2 py-1.5 text-xs">
                            <div className="font-medium">{field.label}</div>
                            <div className="break-words text-muted-foreground">{field.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border p-3">
                    <div className="mb-2 text-sm font-medium">Attachments</div>
                    <div className="space-y-2">
                      {selectedEmail.email_attachments.length === 0 ? (
                        <div className="rounded-md bg-muted/35 px-2 py-1.5 text-xs text-muted-foreground">
                          No attachment records. This may still be useful if the email body contains deal information.
                        </div>
                      ) : (
                        selectedEmail.email_attachments.map((attachment) => (
                          <div key={attachment.id} className="rounded-md bg-muted/35 px-2 py-1.5 text-xs">
                            <div className="truncate font-medium">{attachment.original_filename || "Attachment"}</div>
                            <div className="text-muted-foreground">
                              {formatEmailAttachmentStatus(attachment.status)}
                              {attachment.ignore_reason ? ` | ${attachment.ignore_reason.replaceAll("_", " ")}` : ""}
                              {attachment.file_size ? ` | ${formatBytes(attachment.file_size)}` : ""}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {selectedEmail.status === "ignored" && (
                    <div className="rounded-lg border p-3">
                      <div className="mb-2 text-sm font-medium">Override</div>
                      <p className="mb-3 text-xs text-muted-foreground">
                        Mark this email as useful to parse the subject/body and move it back into the active intake
                        workspace.
                      </p>
                      <Button
                        className="w-full"
                        onClick={() => markUseful(selectedEmail)}
                        disabled={workingId === selectedEmail.id}
                      >
                        <RotateCcw className="size-4" />
                        {workingId === selectedEmail.id ? "Moving..." : "Mark useful"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
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

function rememberDashboardScrollTarget(deal: IntakeLinkedDeal | undefined) {
  if (!deal?.id || typeof window === "undefined") return;
  window.sessionStorage.setItem("dashboard-scroll-deal-id", deal.id);
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

function isHighConfidenceMatch(score: number) {
  return score >= 80;
}

function emailWithAnalyzedRouting(
  email: IntakeEmailRow,
  result: Record<string, unknown>,
  suggestedDeal: IntakeLinkedDeal,
): IntakeEmailRow {
  const analysis = result.analysis && typeof result.analysis === "object"
    ? (result.analysis as Record<string, unknown>)
    : email.routing_json;
  const match = result.match && typeof result.match === "object"
    ? (result.match as { score?: unknown; reason?: unknown })
    : null;

  return {
    ...email,
    status: typeof result.status === "string" ? result.status : email.status,
    routing_json: analysis,
    deal_email_links: [
      {
        deal_id: suggestedDeal.id,
        match_score: typeof match?.score === "number" ? match.score : null,
        match_reason: typeof match?.reason === "string" ? match.reason : null,
        match_status: "needs_review",
        deals: suggestedDeal,
      },
      ...(email.deal_email_links ?? []),
    ],
  };
}

function isRoutingReviewEmail(
  email: IntakeEmailRow,
  link: IntakeEmailRow["deal_email_links"][number] | null,
) {
  return (
    email.status === "processing_from_routing" ||
    email.status === "needs_match_review" ||
    email.status === "new_deal_suggested" ||
    email.status === "not_deal_suggested" ||
    link?.match_status === "needs_review"
  );
}

function routingSuggestion(
  email: IntakeEmailRow,
  primaryLink: IntakeEmailRow["deal_email_links"][number] | null,
  suggestedDeal: IntakeLinkedDeal | null,
) {
  const routing = email.routing_json;
  if (email.status === "not_deal_suggested") {
    if (suggestedDeal) {
      const score = primaryLink?.match_score != null ? `${primaryLink.match_score}%` : routingConfidence(routing, primaryLink);
      return {
        title: "Attach communication",
        primary: `Communication for ${shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)}, ${score}`,
        meta: primaryLink?.match_reason || "Save this email to the deal portal without processing it as a document package.",
      };
    }
    const communicationFields = routingEmailBodyFields(email.routing_json);
    if (communicationFields.length > 0) {
      return {
        title: "Attach communication",
        primary: routingAddress(routing) || "Deal communication details found.",
        meta: `${communicationFields.length} email field${communicationFields.length === 1 ? "" : "s"} found. Attach to the deal to update fields with Email body as the source.`,
      };
    }
    return {
      title: "Not a deal package",
      primary: "AI suggests this intake should be ignored.",
      meta: email.error_message || "No confident deal-document signal was found.",
    };
  }
  if (email.status === "new_deal_suggested") {
    return {
      title: "Create a new transaction",
      primary: routingAddress(routing) || "AI did not find a confident existing transaction.",
      meta: "No existing deal match reached the routing threshold.",
    };
  }
  if (suggestedDeal) {
    const score = primaryLink?.match_score != null ? `${primaryLink.match_score}%` : routingConfidence(routing, primaryLink);
    const reason = primaryLink?.match_reason || routingSummary(routing) || "Review the suggested destination.";
    return {
      title: "Possible match",
      primary: `Possible match: ${shortDealTitle(suggestedDeal.property_address, suggestedDeal.file_name)}, ${score}`,
      meta: reason,
    };
  }
  return {
    title: "Review intake",
    primary: routingAddress(routing) || "No confident route is available.",
    meta: routingSummary(routing) || "Open the modal to choose a destination.",
  };
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
    status === "processing_from_routing" ||
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
  if (status === "processing_from_routing") return "Processing";
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
  if (typeof value === "string" && value) return value;
  return routingEmailBodyFields(routing).find((field) => field.field_key === "property_address")?.value ?? "";
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

function routingConfidence(
  routing: Record<string, unknown> | null,
  primaryLink?: IntakeEmailRow["deal_email_links"][number] | null,
) {
  if (primaryLink?.match_score != null) return `${primaryLink.match_score}%`;
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

function routingEmailBodyFields(routing: Record<string, unknown> | null) {
  const value = routing?.email_body_fields;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const fieldKey = typeof candidate.field_key === "string" ? candidate.field_key : "";
      const label = typeof candidate.label === "string" ? candidate.label : fieldKey.replaceAll("_", " ");
      const fieldValue = typeof candidate.value === "string" ? candidate.value : "";
      if (!fieldKey || !fieldValue) return null;
      return {
        field_key: fieldKey,
        label,
        value: fieldValue,
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : null,
      };
    })
    .filter((item): item is { field_key: string; label: string; value: string; confidence: number | null } => Boolean(item));
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
