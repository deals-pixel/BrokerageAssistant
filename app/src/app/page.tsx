import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleAlert, Columns3, LayoutList, Table2 } from "lucide-react";
import { buildChecklistResult, type ChecklistItem } from "@/lib/checklist";
import { DashboardAutoRefresh } from "@/components/dashboard-auto-refresh";
import { createClient } from "@/lib/supabase/server";
import {
  EmailIntakeQueue,
  type IntakeDealOption,
  type IntakeEmailRow,
} from "@/components/email-intake-queue";
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
type ViewKey = "status" | "time" | "table";

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
  searchParams?: Promise<{ filter?: string; view?: string }>;
}) {
  const params = await searchParams;
  const activeFilter = parseFilter(params?.filter);
  const activeView = parseView(params?.view);
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
      "id, from_email, from_name, subject, status, received_at, routing_json, error_message, email_attachments(id, status, original_filename, mime_type, file_size, light_classification_type, light_classification_confidence, received_at), deal_email_links(deal_id, match_score, match_reason, match_status, deals(id, property_address, file_name, status, page_count))",
    )
    .in("status", [
      "routing_queued",
      "attachments_queued",
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
  const linkedDealIds = Array.from(
    new Set(
      intakeEmails
        .flatMap((email) => email.deal_email_links ?? [])
        .map((link) => link.deal_id)
        .filter(Boolean),
    ),
  );
  const { data: renderedPages } =
    linkedDealIds.length > 0
      ? await supabase
          .from("deal_pages")
          .select("deal_id, email_attachment_id")
          .in("deal_id", linkedDealIds)
          .not("email_attachment_id", "is", null)
      : { data: [] };
  const renderedAttachmentIdsByDeal = ((renderedPages ?? []) as {
    deal_id: string;
    email_attachment_id: string | null;
  }[]).reduce<Record<string, string[]>>((acc, page) => {
    if (!page.email_attachment_id) return acc;
    acc[page.deal_id] = acc[page.deal_id] ?? [];
    acc[page.deal_id].push(page.email_attachment_id);
    return acc;
  }, {});
  const dealOptions = deals.map<IntakeDealOption>((deal) => ({
    id: deal.id,
    label: deal.property_address ?? deal.file_name,
    status: deal.status,
    transactionType: deal.transaction_type,
    transactionCode: deal.transaction_code,
    createdAt: deal.created_at,
  }));
  const filteredDeals = deals.filter((deal) => matchesFilter(deal, activeFilter));
  const metrics = buildMetrics(deals);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <DashboardAutoRefresh />

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

      <EmailIntakeQueue
        emails={intakeEmails}
        dealOptions={dealOptions}
        renderedAttachmentIdsByDeal={renderedAttachmentIdsByDeal}
      />

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">Transactions Database</h2>
              <Badge variant="outline">{filteredDeals.length} shown</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Switch between operational views without leaving the broker dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ViewButton
              active={activeView === "status"}
              href={dashboardHref({ view: "status", filter: activeFilter })}
              label="By Status"
              icon={<Columns3 className="size-3.5" />}
            />
            <ViewButton
              active={activeView === "time"}
              href={dashboardHref({ view: "time", filter: activeFilter })}
              label="By Time"
              icon={<CalendarClock className="size-3.5" />}
            />
            <ViewButton
              active={activeView === "table"}
              href={dashboardHref({ view: "table", filter: activeFilter })}
              label="All Records"
              icon={<Table2 className="size-3.5" />}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-y py-3">
          <FilterButton
            active={activeFilter === "all"}
            href={dashboardHref({ view: activeView, filter: "all" })}
            label={`All ${deals.length}`}
          />
          <FilterButton
            active={activeFilter === "incomplete"}
            href={dashboardHref({ view: activeView, filter: "incomplete" })}
            label={`Incomplete ${metrics.incompleteTransactions}`}
          />
          <FilterButton
            active={activeFilter === "ready"}
            href={dashboardHref({ view: activeView, filter: "ready" })}
            label={`Ready ${metrics.readyForSubmission}`}
          />
          <FilterButton
            active={activeFilter === "submitted"}
            href={dashboardHref({ view: activeView, filter: "submitted" })}
            label={`Submitted ${metrics.submittedTransactions}`}
          />
          <FilterButton
            active={activeFilter === "closing_week"}
            href={dashboardHref({ view: activeView, filter: "closing_week" })}
            label={`Closing This Week ${metrics.closingThisWeek}`}
          />
        </div>

        {activeView === "status" && <StatusBoard deals={filteredDeals} />}
        {activeView === "time" && <TimeList deals={filteredDeals} />}
        {activeView === "table" && <RecordsTable deals={filteredDeals} />}
      </section>
    </div>
  );
}

const BOARD_COLUMNS: {
  status: DashboardDeal["complianceStatus"];
  label: string;
  helper: string;
  icon: ReactNode;
  className: string;
  dotClassName: string;
}[] = [
  {
    status: "Incomplete",
    label: "Incomplete",
    helper: "Missing documents",
    icon: <CircleAlert className="size-3.5" />,
    className: "border-red-100 bg-red-50/45",
    dotClassName: "bg-red-700",
  },
  {
    status: "Ready",
    label: "Ready",
    helper: "Ready for submission",
    icon: <CheckCircle2 className="size-3.5" />,
    className: "border-emerald-100 bg-emerald-50/55",
    dotClassName: "bg-emerald-700",
  },
  {
    status: "Submitted",
    label: "Submitted",
    helper: "Filed or closed",
    icon: <LayoutList className="size-3.5" />,
    className: "border-slate-200 bg-slate-50/70",
    dotClassName: "bg-slate-600",
  },
];

function StatusBoard({ deals }: { deals: DashboardDeal[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {BOARD_COLUMNS.map((column) => {
        const columnDeals = deals.filter((deal) => deal.complianceStatus === column.status);
        return (
          <div key={column.status} className={`min-h-64 rounded-xl border p-3 ${column.className}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`size-2 rounded-full ${column.dotClassName}`} />
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    {column.icon}
                    {column.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{column.helper}</div>
                </div>
              </div>
              <Badge variant="outline">{columnDeals.length}</Badge>
            </div>
            <div className="space-y-2">
              {columnDeals.map((deal) => (
                <TransactionCard key={deal.id} deal={deal} />
              ))}
              {columnDeals.length === 0 && (
                <div className="rounded-lg border border-dashed bg-background/65 p-4 text-sm text-muted-foreground">
                  No transactions in this status.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TransactionCard({ deal }: { deal: DashboardDeal }) {
  return (
    <div className="rounded-lg border bg-background p-3 shadow-xs">
      <div className="space-y-2">
        <div>
          <Link href={`/deals/${deal.id}`} className="font-semibold leading-snug hover:underline">
            {deal.property_address ?? deal.file_name}
          </Link>
          <div className="mt-1 text-xs text-muted-foreground">
            {deal.transaction_type} · {deal.scenarioShortLabel}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant={STATUS_VARIANT[deal.complianceStatus] ?? "outline"}>{deal.complianceStatus}</Badge>
          {deal.source === "email" && <Badge variant="outline">Email</Badge>}
          {deal.transaction_code && <Badge variant="outline">{deal.transaction_code}</Badge>}
        </div>
        <MissingBadges deal={deal} limit={2} />
        <CompletionMeter deal={deal} />
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs text-muted-foreground">
            {deal.closingDate ? `Closing ${deal.closingDate.toLocaleDateString()}` : "No closing date"}
          </div>
          <ProcessDealButton
            dealId={deal.id}
            status={deal.status}
            pageCount={deal.page_count}
            variant={deal.status === "uploaded" ? "default" : "outline"}
          />
        </div>
      </div>
    </div>
  );
}

function TimeList({ deals }: { deals: DashboardDeal[] }) {
  const groups = [
    {
      label: "Closing This Week",
      deals: sortByClosingDate(deals.filter((deal) => isClosingThisWeek(deal.closingDate))),
    },
    {
      label: "Upcoming",
      deals: sortByClosingDate(
        deals.filter((deal) => deal.closingDate && !isClosingThisWeek(deal.closingDate)),
      ),
    },
    {
      label: "No Closing Date",
      deals: deals.filter((deal) => !deal.closingDate),
    },
  ].filter((group) => group.deals.length > 0);

  if (groups.length === 0) {
    return <EmptyDatabaseState />;
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label} className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4" />
            {group.label}
            <Badge variant="outline">{group.deals.length}</Badge>
          </div>
          <div className="overflow-hidden rounded-lg border">
            {group.deals.map((deal) => (
              <div
                key={deal.id}
                className="grid gap-3 border-b p-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_8rem_9rem_minmax(12rem,1fr)_9rem]"
              >
                <div className="min-w-0">
                  <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">
                    {deal.property_address ?? deal.file_name}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {deal.transaction_type} · {deal.scenarioShortLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Closing</div>
                  <div className="text-sm">{deal.closingDate ? deal.closingDate.toLocaleDateString() : "None"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Status</div>
                  <Badge variant={STATUS_VARIANT[deal.complianceStatus] ?? "outline"}>
                    {deal.complianceStatus}
                  </Badge>
                </div>
                <MissingBadges deal={deal} limit={3} />
                <div className="flex items-center justify-end">
                  <ProcessDealButton
                    dealId={deal.id}
                    status={deal.status}
                    pageCount={deal.page_count}
                    variant={deal.status === "uploaded" ? "default" : "outline"}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecordsTable({ deals }: { deals: DashboardDeal[] }) {
  return (
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
          {deals.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="min-w-56">
                <Link href={`/deals/${deal.id}`} className="font-medium hover:underline">
                  {deal.property_address ?? deal.file_name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {deal.page_count ?? 0} pages
                  {deal.closingDate ? ` · Closing ${deal.closingDate.toLocaleDateString()}` : ""}
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
                <MissingBadges deal={deal} limit={3} />
              </TableCell>
              <TableCell>
                <CompletionMeter deal={deal} />
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
          {deals.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No transactions match this view.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MissingBadges({ deal, limit }: { deal: DashboardDeal; limit: number }) {
  if (deal.missingRequired.length === 0) {
    return <span className="text-sm text-muted-foreground">No missing requirements</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {deal.missingRequired.slice(0, limit).map((item) => (
        <Badge key={item.id} variant="outline" className="bg-background text-xs">
          {item.label}
        </Badge>
      ))}
      {deal.missingRequired.length > limit && (
        <Badge variant="outline" className="bg-background text-xs">
          +{deal.missingRequired.length - limit}
        </Badge>
      )}
    </div>
  );
}

function CompletionMeter({ deal }: { deal: DashboardDeal }) {
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${deal.completionPct}%` }} />
      </div>
      <span className="w-10 text-right text-sm tabular-nums">{deal.completionPct}%</span>
    </div>
  );
}

function EmptyDatabaseState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      No transactions match this view.
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
    incompleteTransactions: deals.filter((deal) => deal.complianceStatus === "Incomplete").length,
    missingFintrac: countDealsMissing(deals, "form_630_individual_identification"),
    missingDeposits: countDealsMissing(deals, "deposit_proof"),
    missingPep: countDealsMissing(deals, "form_631_pep_checklist"),
    readyForSubmission: deals.filter((deal) => deal.complianceStatus === "Ready").length,
    submittedTransactions: deals.filter((deal) => deal.complianceStatus === "Submitted").length,
    closingThisWeek: deals.filter((deal) => isClosingThisWeek(deal.closingDate)).length,
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

function parseView(value: string | undefined): ViewKey {
  if (value === "time" || value === "table") return value;
  return "status";
}

function dashboardHref({ view, filter }: { view: ViewKey; filter: FilterKey }) {
  const params = new URLSearchParams();
  if (view !== "status") params.set("view", view);
  if (filter !== "all") params.set("filter", filter);
  const query = params.toString();
  return query ? `/?${query}` : "/";
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

function sortByClosingDate(deals: DashboardDeal[]) {
  return [...deals].sort((a, b) => {
    const aTime = a.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function FilterButton({ active, href, label }: { active: boolean; href: string; label: string }) {
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" nativeButton={false} render={<Link href={href} />}>
      {label}
    </Button>
  );
}

function ViewButton({
  active,
  href,
  label,
  icon,
}: {
  active: boolean;
  href: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="sm"
      className={active ? "border border-border" : ""}
      nativeButton={false}
      render={<Link href={href} />}
    >
      {icon}
      {label}
    </Button>
  );
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
