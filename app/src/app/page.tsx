import Link from "next/link";
import { buildChecklistResult, type ChecklistItem } from "@/lib/checklist";
import { createClient } from "@/lib/supabase/server";
import { ProcessDealButton } from "@/components/process-deal-button";
import { SignOutButton } from "@/components/sign-out-button";
import { UploadDropzone } from "@/components/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TransactionType } from "@/lib/types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Incomplete: "destructive",
  Ready: "default",
  Submitted: "secondary",
  uploaded: "outline",
  draft_from_email: "outline",
  awaiting_match_review: "secondary",
  awaiting_admin_process: "default",
  processing: "secondary",
  error: "destructive",
};

type FilterKey = "all" | "incomplete" | "ready" | "submitted" | "closing_week";

type DealRow = {
  id: string;
  file_name: string;
  status: string;
  transaction_type: TransactionType;
  property_address: string | null;
  transaction_code: string | null;
  source: string | null;
  page_count: number | null;
  scenario_key: string | null;
  scenario_label: string | null;
  submitted_at: string | null;
  created_at: string;
  deal_pages: { page_number: number; doc_type: string | null }[];
  deal_fields: { field_key: string; value: string | null }[];
};

type IntakeEmailRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  status: string;
  received_at: string | null;
  routing_json: Record<string, unknown> | null;
  email_attachments: { id: string; status: string; original_filename: string | null }[];
  deal_email_links: {
    deal_id: string;
    match_score: number | null;
    match_status: string;
    deals: IntakeLinkedDeal | IntakeLinkedDeal[] | null;
  }[];
};

type IntakeLinkedDeal = {
  id: string;
  property_address: string | null;
  file_name: string;
  status: string;
  page_count: number | null;
};

type DashboardDeal = DealRow & {
  scenarioLabel: string;
  scenarioShortLabel: string;
  complianceStatus: "Incomplete" | "Ready" | "Submitted";
  completionPct: number;
  missingRequired: ChecklistItem[];
  closingDate: Date | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const activeFilter = parseFilter(params?.filter);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("deals")
    .select(
      "id, file_name, status, transaction_type, property_address, transaction_code, source, page_count, scenario_key, scenario_label, submitted_at, created_at, deal_pages(page_number, doc_type), deal_fields(field_key, value)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: intakeData } = await supabase
    .from("inbound_emails")
    .select(
      "id, from_email, from_name, subject, status, received_at, routing_json, email_attachments(id, status, original_filename), deal_email_links(deal_id, match_score, match_status, deals(id, property_address, file_name, status, page_count))",
    )
    .in("status", [
      "routing_queued",
      "routing",
      "routing_error",
      "needs_match_review",
      "matched",
      "draft_transaction_created",
      "ignored",
      "error",
    ])
    .order("received_at", { ascending: false })
    .limit(25);

  const deals = ((data ?? []) as DealRow[]).map(toDashboardDeal);
  const intakeEmails = (intakeData ?? []) as IntakeEmailRow[];
  const filteredDeals = deals.filter((deal) => matchesFilter(deal, activeFilter));
  const metrics = buildMetrics(deals);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Broker Dashboard</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/agents" />}>
            Agents
          </Button>
          <SignOutButton />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Active Transactions" value={metrics.activeTransactions} />
        <MetricCard label="Missing FINTRAC" value={metrics.missingFintrac} tone="destructive" />
        <MetricCard label="Missing Deposits" value={metrics.missingDeposits} tone="warning" />
        <MetricCard label="Missing PEP" value={metrics.missingPep} tone="destructive" />
        <MetricCard label="Ready For Submission" value={metrics.readyForSubmission} tone="success" />
      </section>

      <UploadDropzone />

      <EmailIntakeQueue emails={intakeEmails} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Transactions</h2>
          <div className="flex flex-wrap gap-2">
            <FilterButton active={activeFilter === "all"} href="/" label="All" />
            <FilterButton active={activeFilter === "incomplete"} href="/?filter=incomplete" label="Incomplete" />
            <FilterButton active={activeFilter === "ready"} href="/?filter=ready" label="Ready" />
            <FilterButton active={activeFilter === "submitted"} href="/?filter=submitted" label="Submitted" />
            <FilterButton
              active={activeFilter === "closing_week"}
              href="/?filter=closing_week"
              label="Closing This Week"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Missing</TableHead>
                <TableHead>Completion</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="min-w-56">
                    <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">
                      {deal.property_address ?? deal.file_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {deal.page_count ?? 0} pages
                      {deal.closingDate ? ` | Closing ${deal.closingDate.toLocaleDateString()}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="capitalize">{deal.transaction_type}</TableCell>
                  <TableCell>{deal.scenarioShortLabel}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[deal.complianceStatus] ?? "outline"}>
                      {deal.complianceStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-72">
                    {deal.missingRequired.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {deal.missingRequired.slice(0, 3).map((item) => (
                          <Badge key={item.id} variant="outline" className="text-xs">
                            {item.label}
                          </Badge>
                        ))}
                        {deal.missingRequired.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{deal.missingRequired.length - 3}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-28 items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${deal.completionPct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-sm tabular-nums">{deal.completionPct}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <ProcessDealButton
                      dealId={deal.id}
                      status={deal.status}
                      pageCount={deal.page_count}
                      variant={deal.status === "uploaded" ? "default" : "outline"}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {filteredDeals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No transactions match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function toDashboardDeal(deal: DealRow): DashboardDeal {
  const checklist = buildChecklistResult(
    deal.transaction_type,
    deal.deal_pages ?? [],
    deal.scenario_key,
    deal.deal_fields ?? [],
  );
  const submitted = Boolean(deal.submitted_at) || deal.status === "exported";
  const complianceStatus = submitted
    ? "Submitted"
    : checklist.missingRequired.length === 0 && deal.status !== "uploaded" && deal.status !== "processing"
      ? "Ready"
      : "Incomplete";

  return {
    ...deal,
    scenarioLabel: deal.scenario_label ?? checklist.scenario.label,
    scenarioShortLabel: checklist.scenario.shortLabel,
    complianceStatus,
    completionPct: checklist.completionPct,
    missingRequired: checklist.missingRequired,
    closingDate: parseDate(fieldValue(deal.deal_fields, "closing_date")),
  };
}

function buildMetrics(deals: DashboardDeal[]) {
  return {
    activeTransactions: deals.filter((deal) => deal.complianceStatus !== "Submitted").length,
    missingFintrac: countDealsMissing(deals, "form_630_individual_identification"),
    missingDeposits: countDealsMissing(deals, "deposit_proof"),
    missingPep: countDealsMissing(deals, "form_631_pep_checklist"),
    readyForSubmission: deals.filter((deal) => deal.complianceStatus === "Ready").length,
  };
}

function countDealsMissing(deals: DashboardDeal[], docType: string) {
  return deals.filter((deal) =>
    deal.missingRequired.some((item) => item.docTypes.some((candidate) => candidate === docType)),
  ).length;
}

function fieldValue(fields: { field_key: string; value: string | null }[], key: string) {
  return fields.find((field) => field.field_key === key)?.value ?? null;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFilter(value: string | undefined): FilterKey {
  if (value === "incomplete" || value === "ready" || value === "submitted" || value === "closing_week") {
    return value;
  }
  return "all";
}

function matchesFilter(deal: DashboardDeal, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "incomplete") return deal.complianceStatus === "Incomplete";
  if (filter === "ready") return deal.complianceStatus === "Ready";
  if (filter === "submitted") return deal.complianceStatus === "Submitted";
  if (filter === "closing_week") return isClosingThisWeek(deal.closingDate);
  return true;
}

function isClosingThisWeek(date: Date | null) {
  if (!date) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return date >= start && date <= end;
}

function EmailIntakeQueue({ emails }: { emails: IntakeEmailRow[] }) {
  if (emails.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Email Intake Queue</h2>
          <p className="text-sm text-muted-foreground">Forwarded packages from deals@teamadmiral.com.</p>
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
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.map((email) => {
              const primaryLink = email.deal_email_links?.[0];
              const linkedDeal = linkedDealFromRelation(primaryLink?.deals);
              return (
                <TableRow key={email.id}>
                  <TableCell className="min-w-72">
                    <div className="font-medium">{email.subject || "No subject"}</div>
                    <div className="text-xs text-muted-foreground">
                      {email.from_name || email.from_email || "Unknown sender"}
                      {email.received_at ? ` | ${new Date(email.received_at).toLocaleString()}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72">
                    {linkedDeal ? (
                      <div>
                        <Link href={`/deals/${linkedDeal.id}`} className="font-medium hover:underline">
                          {linkedDeal.property_address ?? linkedDeal.file_name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          Match {primaryLink.match_score ?? 0}% - {primaryLink.match_status}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {routingAddress(email.routing_json) || "No confident match"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{email.email_attachments?.length ?? 0} attachments</div>
                    <div className="text-xs text-muted-foreground">
                      {attachmentStatusSummary(email.email_attachments ?? [])}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={intakeStatusVariant(email.status)}>{formatIntakeStatus(email.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {linkedDeal ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          nativeButton={false}
                          render={<Link href={`/deals/${linkedDeal.id}`} />}
                        >
                          Review
                        </Button>
                        <ProcessDealButton
                          dealId={linkedDeal.id}
                          status={linkedDeal.status}
                          pageCount={linkedDeal.page_count}
                          variant="default"
                        />
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        Review match
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function linkedDealFromRelation(value: IntakeLinkedDeal | IntakeLinkedDeal[] | null | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function FilterButton({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Button variant={active ? "default" : "outline"} size="sm" nativeButton={false} render={<Link href={href} />}>
      {label}
    </Button>
  );
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

function attachmentStatusSummary(attachments: IntakeEmailRow["email_attachments"]) {
  if (attachments.length === 0) return "No stored attachments";
  const linked = attachments.filter((item) => item.status === "linked_to_transaction").length;
  const duplicate = attachments.filter((item) => item.status === "duplicate").length;
  const ignored = attachments.filter((item) => item.status === "ignored").length;
  const parts = [];
  if (linked) parts.push(`${linked} linked`);
  if (duplicate) parts.push(`${duplicate} duplicate`);
  if (ignored) parts.push(`${ignored} ignored`);
  return parts.length ? parts.join(" | ") : "Stored for review";
}

function routingAddress(routing: Record<string, unknown> | null) {
  const value = routing?.property_address;
  return typeof value === "string" ? value : "";
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "destructive" | "warning" | "success";
}) {
  const toneClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "success"
          ? "text-green-700"
          : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
