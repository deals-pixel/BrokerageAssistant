"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FilePlus2, Link2, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmailAttachmentIngestButton } from "@/components/email-attachment-ingest-button";
import { ProcessDealButton } from "@/components/process-deal-button";
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

  if (emails.length === 0) return null;

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

  async function retryRouting(email: IntakeEmailRow) {
    setWorkingId(email.id);
    try {
      await postAction(`/api/inbound-emails/${email.id}/reroute`, {});
      toast.success("Routing refreshed.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reroute email");
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
            Review forwarded packages, confirm matches, create drafts, then prepare documents for processing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <QueueStat label="Needs review" value={emails.filter((email) => email.status === "needs_match_review").length} />
          <QueueStat label="Drafts" value={emails.filter((email) => email.status === "draft_transaction_created").length} />
          <QueueStat label="Errors" value={emails.filter((email) => email.status === "routing_error" || email.status === "error").length} />
        </div>
      </div>

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
                      {(email.status === "routing_error" || email.status === "error") && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryRouting(email)}
                          disabled={workingId === email.id}
                        >
                          <RotateCcw className="size-4" />
                          Retry
                        </Button>
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
  if (status === "needs_match_review" || status === "routing" || status === "routing_queued") return "secondary";
  if (status === "error" || status === "routing_error") return "destructive";
  return "outline";
}

function formatIntakeStatus(status: string) {
  if (status === "needs_match_review") return "Needs match review";
  if (status === "draft_transaction_created") return "Draft created";
  if (status === "routing_queued") return "Routing queued";
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
  const classified = attachments.filter((item) => item.status === "light_classified").length;
  const parts = [];
  if (linked) parts.push(`${linked} linked`);
  if (classified) parts.push(`${classified} classified`);
  if (duplicate) parts.push(`${duplicate} duplicate`);
  if (ignored) parts.push(`${ignored} ignored`);
  return parts.length ? parts.join(" | ") : "Stored for review";
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
