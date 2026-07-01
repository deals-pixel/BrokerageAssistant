import Link from "next/link";
import type { ReactNode } from "react";
import { Archive, BarChart3, Bell, CalendarClock, CheckCircle2, CircleAlert, Columns3, FileText, LoaderCircle, Search, Settings2, Table2, Users } from "lucide-react";
import { buildChecklistResult, type ChecklistItem } from "@/lib/checklist";
import { DashboardAutoRefresh } from "@/components/dashboard-auto-refresh";
import { createClient } from "@/lib/supabase/server";
import { shortDealTitle, shortDocumentLabel } from "@/lib/display";
import { IntakeDealLink } from "@/components/intake-deal-link";
import {
  DealIntakeWorkflow,
  InboundEmailActivityPanel,
  type IntakeDealOption,
  type IntakeEmailRow,
} from "@/components/email-intake-queue";
import { ProcessDealButton } from "@/components/process-deal-button";
import { SignOutButton } from "@/components/sign-out-button";
import { SubmitArchiveButton } from "@/components/submit-archive-button";
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

type ComplianceStatus = "Intake Review" | "Incomplete" | "Ready" | "Submitted";
type FilterKey = "all" | "intake" | "incomplete" | "ready" | "closing_week";
type ViewKey = "status" | "time" | "table" | "archive";

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
  attention_reason: string | null;
  attention_at: string | null;
  attention_cleared_at: string | null;
  attention_cleared_by: string | null;
  created_at: string;
  deal_pages: { page_number: number; doc_type: string | null }[];
  deal_fields: { field_key: string; value: string | null }[];
  reminder_emails: { status: string; sent_at: string | null; drafted_at: string | null; created_at: string }[];
};

type DashboardDeal = DealRow & {
  scenarioLabel: string;
  scenarioShortLabel: string;
  complianceStatus: ComplianceStatus;
  completionPct: number;
  missingRequired: ChecklistItem[];
  closingDate: Date | null;
  canAuditChecklist: boolean;
  intakeEmails: IntakeEmailRow[];
  renderedAttachmentIds: string[];
};

type DealOperationalStatus =
  | { label: "New"; tone: "new" }
  | { label: "Update"; tone: "updated" }
  | { label: "Reminded"; tone: "reminded" }
  | { label: "Ready"; tone: "ready" }
  | { label: "Review"; tone: "review" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; view?: string; q?: string }>;
}) {
  const params = await searchParams;
  const activeFilter = parseFilter(params?.filter);
  const activeView = parseView(params?.view);
  const activeSearch = normalizeSearchInput(params?.q);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from("deals")
    .select(
      "id, file_name, status, transaction_type, property_address, transaction_code, source, page_count, scenario_key, scenario_label, submitted_at, attention_reason, attention_at, attention_cleared_at, attention_cleared_by, created_at, deal_pages(page_number, doc_type), deal_fields(field_key, value), reminder_emails(status, sent_at, drafted_at, created_at)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: intakeData } = await supabase
    .from("inbound_emails")
    .select(
      "id, from_email, from_name, subject, body_text, body_html, status, received_at, routing_json, error_message, email_attachments(id, status, original_filename, mime_type, file_size, ignore_reason, light_classification_type, light_classification_confidence, received_at), deal_email_links(deal_id, match_score, match_reason, match_status, deals(id, property_address, file_name, status, page_count))",
    )
    .in("status", [
      "routing_queued",
      "attachments_queued",
      "routing",
      "routing_error",
      "intake_review",
      "needs_match_review",
      "new_deal_suggested",
      "not_deal_suggested",
      "processing_from_routing",
      "matched",
      "draft_transaction_created",
      "ignored",
      "error",
    ])
    .order("received_at", { ascending: false })
    .limit(50);

  const baseDeals = ((data ?? []) as DealRow[]).map(toDashboardDeal);
  const intakeEmails = (intakeData ?? []) as IntakeEmailRow[];
  const unconfirmedIntakeEmails = intakeEmails.filter((email) => !isConfirmedIntakeEmail(email) && email.status !== "ignored");
  const recentIntakeActivity = intakeEmails.slice(0, 8);
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
  const intakeEmailsByDealId = intakeEmails.filter(isConfirmedIntakeEmail).reduce<Record<string, IntakeEmailRow[]>>((acc, email) => {
    for (const link of email.deal_email_links ?? []) {
      if (!link.deal_id) continue;
      acc[link.deal_id] = acc[link.deal_id] ?? [];
      acc[link.deal_id].push(email);
    }
    return acc;
  }, {});
  const realDeals = baseDeals.map((deal) =>
    applyLinkedIntakeState({
      ...deal,
      intakeEmails: intakeEmailsByDealId[deal.id] ?? [],
      renderedAttachmentIds: renderedAttachmentIdsByDeal[deal.id] ?? [],
    }),
  );
  const dealOptions = realDeals.map<IntakeDealOption>((deal) => ({
    id: deal.id,
    label: shortDealTitle(deal.property_address, deal.file_name),
    status: deal.status,
    transactionType: deal.transaction_type,
    transactionCode: deal.transaction_code,
    createdAt: deal.created_at,
  }));
  const deals = [...unconfirmedIntakeEmails.map(toIntakeDashboardDeal), ...realDeals];
  const workspaceDeals = deals.filter((deal) => deal.complianceStatus !== "Submitted");
  const archivedDeals = deals.filter((deal) => deal.complianceStatus === "Submitted");
  const viewDeals = activeView === "archive" ? archivedDeals : workspaceDeals;
  const filteredDeals = viewDeals
    .filter((deal) => matchesFilter(deal, activeView === "archive" ? "all" : activeFilter))
    .filter((deal) => matchesDealSearch(deal, activeSearch));
  const metrics = buildMetrics(deals);
  const closingSoonDeals = upcomingClosingDeals(workspaceDeals, 3);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6">
      <DashboardAutoRefresh />

      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">Broker dashboard</h1>
          <Badge variant="outline" className="mt-1 max-w-full truncate rounded-full px-2 font-normal">
            {user?.email}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/templates" />}>
            <Settings2 className="size-3.5" />
            Templates
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/ai-usage" />}>
            <BarChart3 className="size-3.5" />
            AI usage
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/agents" />}>
            <Users className="size-3.5" />
            Agents
          </Button>
          <SignOutButton />
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={<Columns3 className="size-3.5" />} label="Active transactions" value={metrics.activeTransactions} helper="across all stages" />
        <MetricCard icon={<FileText className="size-3.5" />} label="Missing FINTRAC" value={metrics.missingFintrac} helper="compliance risk" tone="destructive" />
        <MetricCard icon={<CircleAlert className="size-3.5" />} label="Missing deposits" value={metrics.missingDeposits} helper="awaiting proof" tone="warning" />
        <MetricCard icon={<Users className="size-3.5" />} label="Missing PEP" value={metrics.missingPep} helper="declarations needed" tone="destructive" />
        <MetricCard icon={<CheckCircle2 className="size-3.5" />} label="Ready for submission" value={metrics.readyForSubmission} helper="deals complete" tone="success" />
      </section>

      <section className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.75fr)]">
        <Card className="h-full">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b py-3">
            <CardTitle className="text-base">Submit a package</CardTitle>
            <p className="text-xs text-muted-foreground">PDF, JPG, JPEG - max 50 MB per file</p>
          </CardHeader>
          <CardContent className="p-4">
            <UploadDropzone compact />
          </CardContent>
        </Card>

        <ClosingSummaryCard
          title="Closing soon"
          deals={closingSoonDeals}
          empty="No upcoming closings"
          href={dashboardHref({ view: "time", filter: activeFilter, q: activeSearch })}
          className="h-full"
        />
      </section>

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
              href={dashboardHref({ view: "status", filter: activeFilter, q: activeSearch })}
              label="By Status"
              icon={<Columns3 className="size-3.5" />}
            />
            <ViewButton
              active={activeView === "time"}
              href={dashboardHref({ view: "time", filter: activeFilter, q: activeSearch })}
              label="By Time"
              icon={<CalendarClock className="size-3.5" />}
            />
            <ViewButton
              active={activeView === "table"}
              href={dashboardHref({ view: "table", filter: activeFilter, q: activeSearch })}
              label="All Records"
              icon={<Table2 className="size-3.5" />}
            />
            <ViewButton
              active={activeView === "archive"}
              href={dashboardHref({ view: "archive", filter: "all", q: activeSearch })}
              label={`Submitted & Archived ${metrics.submittedTransactions}`}
              icon={<Archive className="size-3.5" />}
            />
          </div>
        </div>

        {activeView === "archive" ? (
          <div className="flex flex-wrap items-center gap-2 border-y py-3 text-sm text-muted-foreground">
            <Archive className="size-4" />
            Submitted and archived transactions are separated from the active workspace.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-y py-3">
            <FilterButton
              active={activeFilter === "all"}
              href={dashboardHref({ view: activeView, filter: "all", q: activeSearch })}
              label={`All ${workspaceDeals.length}`}
            />
            <FilterButton
              active={activeFilter === "intake"}
              href={dashboardHref({ view: activeView, filter: "intake", q: activeSearch })}
              label={`Intake ${metrics.intakeTransactions}`}
            />
            <FilterButton
              active={activeFilter === "incomplete"}
              href={dashboardHref({ view: activeView, filter: "incomplete", q: activeSearch })}
              label={`Active Deals ${metrics.incompleteTransactions}`}
            />
            <FilterButton
              active={activeFilter === "ready"}
              href={dashboardHref({ view: activeView, filter: "ready", q: activeSearch })}
              label={`Ready ${metrics.readyForSubmission}`}
            />
            <FilterButton
              active={activeFilter === "closing_week"}
              href={dashboardHref({ view: activeView, filter: "closing_week", q: activeSearch })}
              label={`Closing This Week ${metrics.closingThisWeek}`}
            />
            <form action="/" className="ml-auto flex min-w-[240px] max-w-sm flex-1 items-center gap-2 sm:flex-none">
              <input type="hidden" name="view" value={activeView} />
              <input type="hidden" name="filter" value={activeFilter} />
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  name="q"
                  defaultValue={activeSearch}
                  placeholder="Search address"
                  className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </label>
              <Button type="submit" size="sm" variant="outline">Search</Button>
              {activeSearch && (
                <Button
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href={dashboardHref({ view: activeView, filter: activeFilter })} />}
                >
                  Clear
                </Button>
              )}
            </form>
          </div>
        )}

        {activeView !== "archive" && <TransitionFeed deals={workspaceDeals} emails={unconfirmedIntakeEmails} />}

        {activeView === "status" && <StatusBoard deals={filteredDeals} dealOptions={dealOptions} />}
        {activeView === "time" && <TimeList deals={filteredDeals} dealOptions={dealOptions} />}
        {activeView === "table" && <RecordsTable deals={filteredDeals} />}
        {activeView === "archive" && <RecordsTable deals={filteredDeals} archive />}
      </section>

      {recentIntakeActivity.length > 0 && <InboundEmailActivityPanel emails={recentIntakeActivity} />}
    </div>
  );
}

const BOARD_COLUMNS: {
  status: ComplianceStatus;
  label: string;
  helper: string;
  icon: ReactNode;
  className: string;
  dotClassName: string;
  textClassName: string;
  headerPillClassName: string;
  cardClassName: string;
}[] = [
  {
    status: "Intake Review",
    label: "Intake Review",
    helper: "Admin decision needed",
    icon: <FileText className="size-3.5" />,
    className: "bg-gray-50",
    dotClassName: "bg-gray-500",
    textClassName: "text-gray-700",
    headerPillClassName: "bg-gray-50 text-gray-800",
    cardClassName: "border-gray-200 shadow-[0_1px_2px_rgba(52,48,41,0.05)]",
  },
  {
    status: "Incomplete",
    label: "Active Deals",
    helper: "Open files and ready-to-close files",
    icon: <CircleAlert className="size-3.5" />,
    className: "bg-amber-50",
    dotClassName: "bg-amber-500",
    textClassName: "text-amber-700",
    headerPillClassName: "bg-amber-50 text-amber-800",
    cardClassName: "border-amber-200 shadow-[0_1px_2px_rgba(90,51,25,0.05)]",
  },
];

function StatusBoard({
  deals,
  dealOptions,
}: {
  deals: DashboardDeal[];
  dealOptions: IntakeDealOption[];
}) {
  return (
    <div className="min-w-0">
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.45fr)]">
        {BOARD_COLUMNS.map((column) => {
          const columnDeals = sortBoardDeals(deals.filter((deal) => boardColumnMatches(deal, column.status)));
          const averageCompletion = columnDeals.length
            ? Math.round(columnDeals.reduce((sum, deal) => sum + deal.completionPct, 0) / columnDeals.length)
            : 0;
          return (
            <div key={column.status} className={`min-h-64 min-w-0 rounded-lg p-2 ${column.className}`}>
              <div className="mb-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-1 text-xs">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${column.dotClassName}`} />
                  <span className={`truncate rounded-md px-1.5 py-0.5 font-medium ${column.headerPillClassName}`}>
                    {column.label}
                  </span>
                </div>
                <div className={`flex shrink-0 items-center gap-1 tabular-nums ${column.textClassName}`}>
                  <span>{columnDeals.length}</span>
                  <span>deals</span>
                  <span>{averageCompletion}%</span>
                </div>
              </div>
              <div className="min-w-0 space-y-2">
                {columnDeals.map((deal) => (
                  <TransactionCard key={deal.id} deal={deal} column={column} dealOptions={dealOptions} />
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
    </div>
  );
}

function TransactionCard({
  deal,
  column,
  dealOptions,
}: {
  deal: DashboardDeal;
  column: (typeof BOARD_COLUMNS)[number];
  dealOptions: IntakeDealOption[];
}) {
  const isVirtualIntake = isVirtualIntakeDeal(deal);
  const isProcessing = deal.status === "processing" || hasProcessingRoutedIntake(deal);
  const hasIntakeWorkflow = shouldShowIntakeWorkflow(deal) && !hasProcessingRoutedIntake(deal);
  const ready = deal.complianceStatus === "Ready";
  const statusBadge = dealOperationalStatus(deal);
  const updateSummary = dealAttentionSummary(deal);
  const hasUpdate = shouldShowDealAttention(deal);

  return (
    <div
      data-deal-id={deal.id}
      className={`min-w-0 overflow-hidden rounded-lg border bg-background p-2 ${
        hasUpdate
          ? "border-blue-400 bg-background shadow-[0_0_0_1px_rgba(55,138,221,0.22),0_1px_4px_rgba(12,68,124,0.08)]"
          : ready
          ? "border-l-4 border-l-emerald-500 shadow-[0_1px_2px_rgba(28,90,62,0.08)]"
          : column.cardClassName
      }`}
    >
      <div className="min-w-0 space-y-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-start gap-1.5">
              <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              {isVirtualIntake ? (
                <span className="min-w-0 break-words text-sm font-semibold leading-snug">
                  {shortDealTitle(deal.property_address, deal.file_name)}
                </span>
              ) : (
                <IntakeDealLink
                  href={`/deals/${deal.id}`}
                  dealId={deal.id}
                  className="min-w-0 break-words text-sm font-semibold leading-snug hover:underline"
                >
                  {shortDealTitle(deal.property_address, deal.file_name)}
                </IntakeDealLink>
              )}
            </div>
            <div className="mt-1.5 truncate text-[11px] leading-4 text-muted-foreground">
              {deal.transaction_type} | {deal.scenarioShortLabel}
            </div>
          </div>
          <DealOperationalStatusBadge status={statusBadge} />
        </div>
        {updateSummary && (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] leading-4 text-blue-800">
            {updateSummary}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap gap-1">
          {deal.source === "email" && (
            <Badge variant="outline" className="h-4 px-1.5 text-[11px] leading-4">
              Email
            </Badge>
          )}
          {deal.transaction_code && (
            <Badge variant="outline" className="h-4 max-w-full truncate px-1.5 text-[11px] leading-4">
              {deal.transaction_code}
            </Badge>
          )}
        </div>
        {isProcessing && <ProcessingStepProgress />}
        {hasIntakeWorkflow ? (
          <DealIntakeWorkflow
            deal={deal}
            emails={deal.intakeEmails}
            dealOptions={dealOptions}
            renderedAttachmentIds={deal.renderedAttachmentIds}
          />
        ) : !isProcessing ? (
          <>
            <MissingBadges deal={deal} />
            <CompletionMeter deal={deal} />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pt-0.5">
              <div className="min-w-0 text-[11px] leading-4 text-foreground/80">
                {deal.closingDate ? `Closing ${deal.closingDate.toLocaleDateString()}` : "No closing date"}
              </div>
              <DashboardDealAction deal={deal} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function DashboardDealAction({ deal }: { deal: DashboardDeal }) {
  if (deal.status === "processing" || deal.complianceStatus === "Submitted") {
    return null;
  }

  if (deal.complianceStatus === "Incomplete") {
    return (
      <Button
        size="sm"
        variant="outline"
        nativeButton={false}
        render={<IntakeDealLink href={`/deals/${deal.id}?reminder=1`} dealId={deal.id} />}
      >
        Remind
      </Button>
    );
  }

  if (deal.complianceStatus === "Ready") {
    return <SubmitArchiveButton dealId={deal.id} variant="default" label="Close Deal" />;
  }

  return (
    <ProcessDealButton
      dealId={deal.id}
      status={deal.status}
      pageCount={deal.page_count}
      variant={deal.complianceStatus === "Intake Review" ? "default" : "outline"}
    />
  );
}

function DealOperationalStatusBadge({ status }: { status: DealOperationalStatus }) {
  const toneClassName: Record<DealOperationalStatus["tone"], string> = {
    new: "border-blue-200 bg-blue-50 text-blue-800",
    updated: "border-blue-200 bg-blue-50 text-blue-800",
    reminded: "border-violet-200 bg-violet-50 text-violet-800",
    ready: "border-emerald-200 bg-emerald-50 text-emerald-800",
    review: "border-slate-200 bg-slate-50 text-slate-700",
  };

  return (
    <Badge
      variant="secondary"
      className={`h-5 shrink-0 border px-2 text-[11px] font-medium leading-4 ${toneClassName[status.tone]}`}
    >
      {status.label}
    </Badge>
  );
}

function ProcessingStepProgress() {
  const steps = [
    { label: "Pages ready", state: "done" },
    { label: "Reading forms", state: "active" },
    { label: "Extracting fields", state: "pending" },
    { label: "Checking requirements", state: "pending" },
  ];

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/70 p-2 text-[11px] text-blue-950">
      <div className="mb-2 flex items-center gap-1.5 font-medium">
        <LoaderCircle className="size-3.5 animate-spin" />
        Processing package
      </div>
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.label} className="flex items-center gap-1.5">
            <span
              className={
                step.state === "done"
                  ? "size-2 rounded-full bg-blue-700"
                  : step.state === "active"
                    ? "size-2 rounded-full bg-blue-500 animate-pulse"
                    : "size-2 rounded-full border border-blue-300 bg-background"
              }
            />
            <span className={step.state === "pending" ? "text-blue-800/60" : ""}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeList({
  deals,
  dealOptions,
}: {
  deals: DashboardDeal[];
  dealOptions: IntakeDealOption[];
}) {
  const intakeDeals = sortBoardDeals(deals.filter((deal) => deal.complianceStatus === "Intake Review"));
  const dateTrackedDeals = deals.filter((deal) => deal.complianceStatus !== "Intake Review");
  const groups = [
    {
      label: "Intake Review",
      icon: <FileText className="size-4" />,
      deals: intakeDeals,
      kind: "intake" as const,
    },
    {
      label: "Closing This Week",
      icon: <CalendarClock className="size-4" />,
      deals: sortByClosingDateWithUpdates(dateTrackedDeals.filter((deal) => isClosingThisWeek(deal.closingDate))),
      kind: "date" as const,
    },
    {
      label: "Upcoming",
      icon: <CalendarClock className="size-4" />,
      deals: sortByClosingDateWithUpdates(
        dateTrackedDeals.filter((deal) => deal.closingDate && !isClosingThisWeek(deal.closingDate)),
      ),
      kind: "date" as const,
    },
    {
      label: "No Closing Date",
      icon: <CalendarClock className="size-4" />,
      deals: sortBoardDeals(dateTrackedDeals.filter((deal) => !deal.closingDate)),
      kind: "date" as const,
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
            {group.icon}
            {group.label}
            <Badge variant="outline">{group.deals.length}</Badge>
          </div>
          <div className="overflow-hidden rounded-lg border">
            {group.deals.map((deal) => (
              <TimeListDealRow
                key={deal.id}
                deal={deal}
                dealOptions={dealOptions}
                kind={group.kind}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimeListDealRow({
  deal,
  dealOptions,
  kind,
}: {
  deal: DashboardDeal;
  dealOptions: IntakeDealOption[];
  kind: "intake" | "date";
}) {
  const isProcessing = deal.status === "processing" || hasProcessingRoutedIntake(deal);
  const hasIntakeWorkflow = shouldShowIntakeWorkflow(deal) && !hasProcessingRoutedIntake(deal);
  const statusBadge = dealOperationalStatus(deal);
  const updateSummary = dealAttentionSummary(deal);

  return (
    <div
      className={`${kind === "intake"
        ? "grid gap-3 border-b p-3 last:border-b-0 md:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)]"
        : "grid gap-3 border-b p-3 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_8rem_9rem_minmax(12rem,1fr)_9rem]"
      } ${updateSummary ? "border-l-4 border-l-amber-400 bg-amber-50/25" : ""}`}
    >
      <div className="min-w-0">
        {isVirtualIntakeDeal(deal) ? (
          <div className="font-medium">{shortDealTitle(deal.property_address, deal.file_name)}</div>
        ) : (
          <IntakeDealLink href={`/deals/${deal.id}`} dealId={deal.id} className="font-medium hover:underline">
            {shortDealTitle(deal.property_address, deal.file_name)}
          </IntakeDealLink>
        )}
        <div className="text-xs text-muted-foreground">
          {deal.transaction_type} | {deal.scenarioShortLabel}
        </div>
        {kind === "intake" && (
          <div className="mt-2">
            <DealOperationalStatusBadge status={statusBadge} />
          </div>
        )}
        {updateSummary && (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] leading-4 text-amber-900">
            {updateSummary}
          </div>
        )}
      </div>
      {kind === "intake" ? (
        hasIntakeWorkflow ? (
          <DealIntakeWorkflow
            deal={deal}
            emails={deal.intakeEmails}
            dealOptions={dealOptions}
            renderedAttachmentIds={deal.renderedAttachmentIds}
          />
        ) : (
          <div className="min-w-0 space-y-2 rounded-lg border bg-background/65 p-3">
            {isProcessing ? (
              <ProcessingStepProgress />
            ) : (
              <>
                <MissingBadges deal={deal} />
                <CompletionMeter deal={deal} />
                <div className="flex items-center justify-end">
                  <DashboardDealAction deal={deal} />
                </div>
              </>
            )}
          </div>
        )
      ) : (
        <>
          <div>
            <div className="text-xs text-muted-foreground">Closing</div>
            <div className="text-sm">{deal.closingDate ? deal.closingDate.toLocaleDateString() : "None"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <DealOperationalStatusBadge status={statusBadge} />
          </div>
          <MissingBadges deal={deal} />
          <div className="flex items-center justify-end">
            <DashboardDealAction deal={deal} />
          </div>
        </>
      )}
    </div>
  );
}

function RecordsTable({ deals, archive = false }: { deals: DashboardDeal[]; archive?: boolean }) {
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
            {!archive && <TableHead className="text-right">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((deal) => (
            <TableRow key={deal.id}>
              <TableCell className="min-w-56">
                {isVirtualIntakeDeal(deal) ? (
                  <div className="font-medium">{shortDealTitle(deal.property_address, deal.file_name)}</div>
                ) : (
                  <IntakeDealLink href={`/deals/${deal.id}`} dealId={deal.id} className="font-medium hover:underline">
                    {shortDealTitle(deal.property_address, deal.file_name)}
                  </IntakeDealLink>
                )}
                <div className="text-xs text-muted-foreground">
                  {deal.page_count ?? 0} pages
                  {deal.closingDate ? ` | Closing ${deal.closingDate.toLocaleDateString()}` : ""}
                </div>
              </TableCell>
              <TableCell className="capitalize">{deal.transaction_type}</TableCell>
              <TableCell>{deal.scenarioShortLabel}</TableCell>
              <TableCell>
                <DealOperationalStatusBadge status={dealOperationalStatus(deal)} />
              </TableCell>
              <TableCell className="max-w-72">
                <MissingBadges deal={deal} />
              </TableCell>
              <TableCell>
                <CompletionMeter deal={deal} />
              </TableCell>
              {!archive && <TableCell className="text-right">
                <DashboardDealAction deal={deal} />
              </TableCell>}
            </TableRow>
          ))}
          {deals.length === 0 && (
            <TableRow>
              <TableCell colSpan={archive ? 6 : 7} className="text-center text-muted-foreground">
                No transactions match this view.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MissingBadges({ deal }: { deal: DashboardDeal }) {
  if (!deal.canAuditChecklist) {
    return <span className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground">Not processed yet</span>;
  }

  if (deal.missingRequired.length === 0) {
    return <span className="min-w-0 truncate text-[11px] leading-4 text-muted-foreground">No missing requirements</span>;
  }

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-start gap-1 overflow-hidden">
      {deal.missingRequired.map((item) => (
        <span
          key={item.id}
          title={item.label}
          className="inline-flex max-w-full truncate rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-medium leading-4 text-red-800"
        >
          {shortDocumentLabel(item.label)}
        </span>
      ))}
    </div>
  );
}

function CompletionMeter({ deal }: { deal: DashboardDeal }) {
  if (!deal.canAuditChecklist) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <div className="h-2 min-w-0 flex-1 rounded-full bg-muted" />
        <span className="w-14 text-right text-[11px] leading-4 text-muted-foreground">Pending</span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${deal.completionPct}%` }} />
      </div>
      <span className="w-9 text-right text-[11px] leading-4 tabular-nums">{deal.completionPct}%</span>
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

function TransitionFeed({
  deals,
  emails,
}: {
  deals: DashboardDeal[];
  emails: IntakeEmailRow[];
}) {
  const items = [
    ...emails
      .filter((email) => email.status === "needs_match_review" || email.status === "new_deal_suggested")
      .map((email) => ({
        id: `email-${email.id}`,
        tone: "review" as const,
        label: email.status === "new_deal_suggested" ? "Create new deal" : "Confirm match",
        title: email.subject || routingAddress(email.routing_json) || "Inbound package",
        detail: routingFeedDetail(email),
        date: parseDate(email.received_at),
      })),
    ...emails
      .filter((email) => email.status === "processing_from_routing")
      .map((email) => ({
        id: `processing-${email.id}`,
        tone: "processing" as const,
        label: "Processing",
        title: email.subject || routingAddress(email.routing_json) || "Inbound package",
        detail: "AI extraction is running.",
        date: parseDate(email.received_at),
      })),
    ...deals
      .filter((deal) => deal.complianceStatus === "Ready")
      .map((deal) => ({
        id: `ready-${deal.id}`,
        tone: "ready" as const,
        label: "Ready",
        title: shortDealTitle(deal.property_address, deal.file_name),
        detail: "Ready to close.",
        date: parseDate(deal.created_at),
      })),
    ...deals
      .filter((deal) => isIntakeArrivedDeal(deal))
      .map((deal) => ({
        id: `new-${deal.id}`,
        tone: "new" as const,
        label: "New",
        title: shortDealTitle(deal.property_address, deal.file_name),
        detail: "Arrived from intake.",
        date: parseDate(deal.created_at),
      })),
  ]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, 5);

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Bell className="size-4" />
        State Changes
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <div key={item.id} className="min-w-0 rounded-md border bg-background px-2.5 py-2">
            <div className="mb-1 flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${transitionToneClass(item.tone)}`} />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.label}
              </span>
            </div>
            <div className="truncate text-xs font-medium" title={item.title}>
              {item.title}
            </div>
            <div className="truncate text-[11px] text-muted-foreground" title={item.detail}>
              {item.detail}
            </div>
          </div>
        ))}
      </div>
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
  const pageCount = deal.page_count ?? 0;
  const isEmailDraft = deal.status === "draft_from_email" || (deal.source === "email" && pageCount === 0);
  const needsProcessing =
    !isEmailDraft &&
    (deal.status === "uploaded" || deal.status === "awaiting_admin_process" || deal.status === "processing");
  const canAuditChecklist = !isEmailDraft && !needsProcessing;
  const complianceStatus: ComplianceStatus = submitted
    ? "Submitted"
    : isEmailDraft
      ? "Intake Review"
      : needsProcessing
        ? "Intake Review"
        : checklist.missingRequired.length === 0
          ? "Ready"
          : "Incomplete";
  const scenarioLabel = isEmailDraft
    ? "Intake review"
    : needsProcessing
      ? deal.status === "processing" ? "Processing package" : "Ready to process"
      : deal.scenario_label ?? checklist.scenario.label;
  const scenarioShortLabel = isEmailDraft
    ? "Intake review"
    : needsProcessing
      ? deal.status === "processing" ? "Processing" : "Ready to process"
      : checklist.scenario.shortLabel;

  return {
    ...deal,
    reminder_emails: deal.reminder_emails ?? [],
    scenarioLabel,
    scenarioShortLabel,
    complianceStatus,
    completionPct: canAuditChecklist ? checklist.completionPct : 0,
    missingRequired: canAuditChecklist ? checklist.missingRequired : [],
    closingDate: parseDate(fieldValue(deal.deal_fields, "closing_date")),
    canAuditChecklist,
    intakeEmails: [],
    renderedAttachmentIds: [],
  };
}

function toIntakeDashboardDeal(email: IntakeEmailRow): DashboardDeal {
  const routing = email.routing_json ?? {};
  const receivedAt = email.received_at ?? new Date().toISOString();
  const address = stringRoutingValue(routing, "property_address");
  const typeGuess = stringRoutingValue(routing, "transaction_type_guess");
  const transactionCode = stringRoutingValue(routing, "transaction_code");
  const attentionReason = intakeAttentionReason(email.status);

  return {
    id: `intake:${email.id}`,
    file_name: email.subject || "Inbound email package",
    status: "draft_from_email",
    transaction_type: transactionTypeFromRouting(typeGuess),
    property_address: address || null,
    transaction_code: transactionCode || null,
    source: "email",
    page_count: 0,
    scenario_key: null,
    scenario_label: null,
    submitted_at: null,
    attention_reason: attentionReason,
    attention_at: attentionReason ? receivedAt : null,
    attention_cleared_at: null,
    attention_cleared_by: null,
    created_at: receivedAt,
    deal_pages: [],
    deal_fields: [],
    reminder_emails: [],
    scenarioLabel: intakeScenarioLabel(email.status),
    scenarioShortLabel: intakeScenarioLabel(email.status),
    complianceStatus: intakeComplianceStatus(email.status),
    completionPct: 0,
    missingRequired: [],
    closingDate: null,
    canAuditChecklist: false,
    intakeEmails: [email],
    renderedAttachmentIds: [],
  };
}

function buildMetrics(deals: DashboardDeal[]) {
  return {
    activeTransactions: deals.filter((deal) => deal.complianceStatus !== "Submitted").length,
    intakeTransactions: deals.filter((deal) => deal.complianceStatus === "Intake Review").length,
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

function isConfirmedIntakeEmail(email: IntakeEmailRow) {
  return (email.deal_email_links ?? []).some((link) => link.match_status === "manually_confirmed" || link.match_status === "auto_matched");
}

function isVirtualIntakeDeal(deal: DashboardDeal) {
  return deal.id.startsWith("intake:");
}

function boardColumnMatches(deal: DashboardDeal, columnStatus: ComplianceStatus) {
  if (columnStatus === "Incomplete") return deal.complianceStatus === "Incomplete" || deal.complianceStatus === "Ready";
  return deal.complianceStatus === columnStatus;
}

function sortBoardDeals(deals: DashboardDeal[]) {
  return [...deals].sort((a, b) => {
    const aNew = shouldShowDealAttention(a) ? 1 : 0;
    const bNew = shouldShowDealAttention(b) ? 1 : 0;
    if (aNew !== bNew) return bNew - aNew;

    if (aNew && bNew) {
      const aAttentionTime = parseDate(a.attention_at)?.getTime() ?? 0;
      const bAttentionTime = parseDate(b.attention_at)?.getTime() ?? 0;
      if (aAttentionTime !== bAttentionTime) return bAttentionTime - aAttentionTime;
    }

    const aReady = a.complianceStatus === "Ready" ? 1 : 0;
    const bReady = b.complianceStatus === "Ready" ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function isIntakeArrivedDeal(deal: DashboardDeal) {
  return !isVirtualIntakeDeal(deal) && deal.source === "email" && deal.intakeEmails.length > 0;
}

function shouldShowDealAttention(deal: DashboardDeal) {
  if (isVirtualIntakeDeal(deal)) return Boolean(deal.attention_at && deal.attention_reason);
  if (!deal.attention_at) return false;
  if (!deal.attention_cleared_at) return true;
  return new Date(deal.attention_cleared_at).getTime() < new Date(deal.attention_at).getTime();
}

function dealAttentionSummary(deal: DashboardDeal) {
  if (!shouldShowDealAttention(deal)) return "";
  const label =
    deal.attention_reason === "updated_from_intake"
      ? "Updated from intake"
      : deal.attention_reason === "created_from_intake"
        ? "Draft created from intake"
        : deal.attention_reason === "new_deal_suggested"
          ? "New deal suggested"
        : "New intake activity";
  const when = deal.attention_at ? ` ${formatRelativeDashboardTime(deal.attention_at)}` : "";
  return `${label}${when}.`;
}

function dealOperationalStatus(deal: DashboardDeal): DealOperationalStatus {
  if (shouldShowDealAttention(deal)) {
    return deal.attention_reason === "updated_from_intake" ||
      deal.attention_reason === "created_from_intake" ||
      deal.attention_reason === "new_deal_suggested"
      ? { label: "Update", tone: "updated" }
      : { label: "New", tone: "new" };
  }
  if (deal.complianceStatus === "Ready") return { label: "Ready", tone: "ready" };
  if (hasSentReminder(deal)) return { label: "Reminded", tone: "reminded" };
  return { label: "Review", tone: "review" };
}

function hasSentReminder(deal: DashboardDeal) {
  return deal.reminder_emails.some((reminder) => reminder.status === "sent" || Boolean(reminder.sent_at));
}

function intakeAttentionReason(status: string) {
  if (status === "new_deal_suggested") return "new_deal_suggested";
  if (status === "draft_transaction_created") return "created_from_intake";
  return null;
}

function shouldShowIntakeWorkflow(deal: DashboardDeal) {
  const hasIntakeSource = deal.intakeEmails.length > 0 || isVirtualIntakeDeal(deal);
  return hasIntakeSource && deal.complianceStatus === "Intake Review";
}

function hasProcessingRoutedIntake(deal: DashboardDeal) {
  return deal.intakeEmails.some((email) => email.status === "processing_from_routing");
}

function applyLinkedIntakeState(deal: DashboardDeal): DashboardDeal {
  if (!hasProcessingRoutedIntake(deal)) return deal;
  return {
    ...deal,
    complianceStatus: "Intake Review",
    scenarioLabel: "Processing routed intake",
    scenarioShortLabel: "Processing",
  };
}

function stringRoutingValue(routing: Record<string, unknown>, key: string) {
  const value = routing[key];
  return typeof value === "string" ? value : "";
}

function routingAddress(routing: Record<string, unknown> | null) {
  const value = routing?.property_address;
  if (typeof value === "string" && value) return value;
  return "";
}

function transactionTypeFromRouting(value: string): TransactionType {
  if (value === "lease") return "lease";
  if (value === "sale") return "purchase";
  return "unknown";
}

function intakeScenarioLabel(status: string) {
  if (status === "processing_from_routing") return "Processing routed intake";
  if (status === "needs_match_review") return "Likely existing deal";
  if (status === "new_deal_suggested") return "New deal suggested";
  if (status === "not_deal_suggested") return "Not a deal?";
  if (status === "error" || status === "routing_error") return "Needs attention";
  return "Intake review";
}

function intakeComplianceStatus(status: string): ComplianceStatus {
  if (
    status === "processing_from_routing" ||
    status === "needs_match_review" ||
    status === "new_deal_suggested" ||
    status === "not_deal_suggested"
  ) {
    return "Intake Review";
  }
  return "Intake Review";
}

function parseFilter(value: string | undefined): FilterKey {
  if (
    value === "intake" ||
    value === "incomplete" ||
    value === "ready" ||
    value === "closing_week"
  ) {
    return value;
  }
  return "all";
}

function parseView(value: string | undefined): ViewKey {
  if (value === "time" || value === "table" || value === "archive") return value;
  return "status";
}

function dashboardHref({ view, filter, q }: { view: ViewKey; filter: FilterKey; q?: string }) {
  const params = new URLSearchParams();
  if (view !== "status") params.set("view", view);
  if (filter !== "all") params.set("filter", filter);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function matchesFilter(deal: DashboardDeal, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "intake") return deal.complianceStatus === "Intake Review";
  if (filter === "incomplete") return deal.complianceStatus === "Incomplete";
  if (filter === "ready") return deal.complianceStatus === "Ready";
  if (filter === "closing_week") return isClosingThisWeek(deal.closingDate);
  return true;
}

function normalizeSearchInput(value: string | undefined) {
  return (value ?? "").trim().slice(0, 80);
}

function matchesDealSearch(deal: DashboardDeal, query: string) {
  if (!query) return true;
  const haystacks = [
    deal.property_address,
    deal.file_name,
    deal.transaction_code,
    shortDealTitle(deal.property_address, deal.file_name),
  ].filter((value): value is string => Boolean(value));

  return haystacks.some((value) => fuzzyAddressMatch(value, query));
}

function fuzzyAddressMatch(value: string, query: string) {
  const normalizedValue = normalizeAddressSearchText(value);
  const normalizedQuery = normalizeAddressSearchText(query);
  if (!normalizedQuery) return true;
  if (normalizedValue.includes(normalizedQuery)) return true;

  const valueTokens = normalizedValue.split(" ").filter(Boolean);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return true;

  const tokenPrefixMatch = queryTokens.every((queryToken) =>
    valueTokens.some((valueToken) => valueToken.startsWith(queryToken) || queryToken.startsWith(valueToken)),
  );
  if (tokenPrefixMatch) return true;

  return isSubsequence(normalizedQuery.replace(/\s/g, ""), normalizedValue.replace(/\s/g, ""));
}

function normalizeAddressSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(street|st)\b/g, "st")
    .replace(/\b(avenue|ave)\b/g, "ave")
    .replace(/\b(road|rd)\b/g, "rd")
    .replace(/\b(drive|dr)\b/g, "dr")
    .replace(/\b(circle|cir)\b/g, "cir")
    .replace(/\b(court|ct)\b/g, "ct")
    .replace(/\b(boulevard|blvd)\b/g, "blvd")
    .replace(/\b(unit|suite|apt|apartment)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isSubsequence(query: string, value: string) {
  if (query.length < 3) return false;
  let queryIndex = 0;
  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (query[queryIndex] === value[valueIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function routingFeedDetail(email: IntakeEmailRow) {
  const primaryLink = bestIntakeLink(email);
  const score = primaryLink?.match_score != null ? `${primaryLink.match_score}%` : routingConfidenceText(email.routing_json);
  if (email.status === "new_deal_suggested") return "No confident existing transaction match.";
  return [score, primaryLink?.match_reason || routingSummaryText(email.routing_json)].filter(Boolean).join(" - ");
}

function bestIntakeLink(email: IntakeEmailRow) {
  const links = email.deal_email_links ?? [];
  return (
    links.find((link) => link.match_status === "manually_confirmed") ??
    links.find((link) => link.match_status === "auto_matched") ??
    links.find((link) => link.match_status === "needs_review") ??
    links[0] ??
    null
  );
}

function routingConfidenceText(routing: Record<string, unknown> | null) {
  const confidence = routing?.routing_confidence;
  return typeof confidence === "number" ? `${Math.round(confidence * 100)}%` : "";
}

function routingSummaryText(routing: Record<string, unknown> | null) {
  if (!routing) return "";
  const type = typeof routing.transaction_type_guess === "string" ? routing.transaction_type_guess : "";
  const confidence = routingConfidenceText(routing);
  return [type && type !== "unknown" ? type : "", confidence].filter(Boolean).join(" - ");
}

function transitionToneClass(tone: "new" | "review" | "processing" | "ready") {
  if (tone === "ready") return "bg-emerald-500";
  if (tone === "processing") return "bg-blue-500";
  if (tone === "review") return "bg-amber-500";
  return "bg-sky-500";
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

function upcomingClosingDeals(deals: DashboardDeal[], limit: number) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return sortByClosingDate(
    deals.filter((deal) => deal.closingDate && deal.closingDate >= now && !isVirtualIntakeDeal(deal)),
  ).slice(0, limit);
}

function sortByClosingDate(deals: DashboardDeal[]) {
  return [...deals].sort((a, b) => {
    const aTime = a.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function sortByClosingDateWithUpdates(deals: DashboardDeal[]) {
  return [...deals].sort((a, b) => {
    const aAttention = shouldShowDealAttention(a) ? 1 : 0;
    const bAttention = shouldShowDealAttention(b) ? 1 : 0;
    if (aAttention !== bAttention) return bAttention - aAttention;
    if (aAttention && bAttention) {
      const aAttentionTime = parseDate(a.attention_at)?.getTime() ?? 0;
      const bAttentionTime = parseDate(b.attention_at)?.getTime() ?? 0;
      if (aAttentionTime !== bAttentionTime) return bAttentionTime - aAttentionTime;
    }
    const aTime = a.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.closingDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function ClosingSummaryCard({
  title,
  deals,
  empty,
  href,
  className = "",
}: {
  title: string;
  deals: DashboardDeal[];
  empty: string;
  href: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between border-b py-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={href} />}>
          View all
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {deals.length > 0 ? (
          <div className="divide-y">
            {deals.map((deal) => (
              <div key={deal.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3">
                <div className="min-w-0">
                  {isVirtualIntakeDeal(deal) ? (
                    <p className="truncate text-sm font-semibold">{shortDealTitle(deal.property_address, deal.file_name)}</p>
                  ) : (
                    <IntakeDealLink href={`/deals/${deal.id}`} dealId={deal.id} className="block truncate text-sm font-semibold hover:underline">
                      {shortDealTitle(deal.property_address, deal.file_name)}
                    </IntakeDealLink>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {deal.transaction_type} - {deal.scenarioShortLabel}
                  </p>
                </div>
                {deal.closingDate && (
                  <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 text-amber-800">
                    {formatShortDate(deal.closingDate)}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-28 place-items-center px-4 py-6 text-center text-sm text-muted-foreground">
            <div>
              <CalendarClock className="mx-auto mb-2 size-5" />
              {empty}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date);
}

function formatRelativeDashboardTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const absMinutes = Math.abs(diffMinutes);
  if (absMinutes < 1) return "just now";
  if (absMinutes < 60) return `${absMinutes}m ago`;
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) return `${absHours}h ago`;
  return `on ${new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(date)}`;
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
  icon,
  label,
  value,
  helper,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  helper: string;
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
    <Card className="rounded-lg">
      <CardContent className="p-4">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <span className="mt-0.5">{icon}</span>
          <span className="leading-tight">{label}</span>
        </div>
        <div className={`mt-2 text-3xl font-semibold leading-none tabular-nums ${toneClass}`}>{value}</div>
        <p className="mt-2 text-xs text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}
