import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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

type UsageRow = {
  id: string;
  created_at: string;
  deal_id: string | null;
  inbound_email_id: string | null;
  layer: "light_routing" | "intake_analysis" | "classification" | "extraction";
  model: string | null;
  cached: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  input_pages: number | null;
  input_attachments: number | null;
  metadata: Record<string, unknown> | null;
  deals?: { property_address: string | null; file_name: string | null } | { property_address: string | null; file_name: string | null }[] | null;
  inbound_emails?: { subject: string | null; from_email: string | null } | { subject: string | null; from_email: string | null }[] | null;
};

type CacheSummary = {
  extractionRows: number;
  classificationRows: number;
};

export default async function AiUsagePage() {
  const supabase = await createClient();
  const [{ data: usageData }, extractionCache, classificationCache] = await Promise.all([
    supabase
      .from("ai_usage_events")
      .select(
        "id, created_at, deal_id, inbound_email_id, layer, model, cached, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, input_pages, input_attachments, metadata, deals(property_address, file_name), inbound_emails(subject, from_email)",
      )
      .order("created_at", { ascending: false })
      .limit(250),
    supabase.from("ai_extraction_cache").select("cache_key", { count: "exact", head: true }),
    supabase.from("ai_classification_cache").select("cache_key", { count: "exact", head: true }),
  ]);

  const rows = (usageData ?? []) as unknown as UsageRow[];
  const cacheSummary: CacheSummary = {
    extractionRows: extractionCache.count ?? 0,
    classificationRows: classificationCache.count ?? 0,
  };
  const totals = summarizeUsage(rows);
  const byLayer = summarizeByLayer(rows);
  const topDeals = summarizeTopDeals(rows);
  const extractionModes = summarizeExtractionModes(rows);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft className="size-4" />
            Dashboard
          </Button>
          <h1 className="mt-3 text-2xl font-semibold">AI Usage</h1>
          <p className="text-sm text-muted-foreground">
            Recent model calls, cache hits, and token-heavy transaction runs.
          </p>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Events" value={totals.events} />
        <MetricCard label="Input Tokens" value={formatNumber(totals.inputTokens)} />
        <MetricCard label="Output Tokens" value={formatNumber(totals.outputTokens)} />
        <MetricCard label="Cached Events" value={totals.cachedEvents} />
        <MetricCard label="Cache Rows" value={cacheSummary.extractionRows + cacheSummary.classificationRows} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By Layer</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageTable
              columns={["Layer", "Events", "Cached", "Input", "Output", "Pages", "Attachments"]}
              rows={byLayer.map((item) => [
                layerLabel(item.layer),
                item.events,
                item.cachedEvents,
                formatNumber(item.inputTokens),
                formatNumber(item.outputTokens),
                item.pages,
                item.attachments,
              ])}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Extraction Modes</CardTitle>
          </CardHeader>
          <CardContent>
            <UsageTable
              columns={["Mode", "Document", "Events", "Cached", "Input", "Regions"]}
              rows={extractionModes.map((item) => [
                item.mode || "full_page",
                item.docType || "unknown",
                item.events,
                item.cachedEvents,
                formatNumber(item.inputTokens),
                item.regions,
              ])}
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Top Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageTable
            columns={["Transaction", "Events", "Cached", "Input", "Output", "Pages"]}
            rows={topDeals.map((item) => [
              item.label,
              item.events,
              item.cachedEvents,
              formatNumber(item.inputTokens),
              formatNumber(item.outputTokens),
              item.pages,
            ])}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Layer</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Tokens</TableHead>
                <TableHead>Input</TableHead>
                <TableHead>Cache</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 80).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(row.created_at)}
                  </TableCell>
                  <TableCell>{layerLabel(row.layer)}</TableCell>
                  <TableCell>{String(row.metadata?.source ?? row.metadata?.extraction_mode ?? "manual")}</TableCell>
                  <TableCell className="max-w-72 truncate">{targetLabel(row)}</TableCell>
                  <TableCell>
                    {formatNumber((row.input_tokens ?? 0) + (row.output_tokens ?? 0))}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.input_pages ? `${row.input_pages} p` : ""}
                    {row.input_attachments ? `${row.input_attachments} att` : ""}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.cached ? "default" : "outline"}>{row.cached ? "cached" : "new"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function UsageTable({ columns, rows }: { columns: string[]; rows: Array<Array<string | number>> }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {row.map((cell, cellIndex) => (
              <TableCell key={cellIndex} className={cellIndex === 0 ? "max-w-80 truncate" : ""}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function summarizeUsage(rows: UsageRow[]) {
  return rows.reduce(
    (acc, row) => ({
      events: acc.events + 1,
      cachedEvents: acc.cachedEvents + (row.cached ? 1 : 0),
      inputTokens: acc.inputTokens + (row.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (row.output_tokens ?? 0),
    }),
    { events: 0, cachedEvents: 0, inputTokens: 0, outputTokens: 0 },
  );
}

function summarizeByLayer(rows: UsageRow[]) {
  const byLayer = new Map<string, ReturnType<typeof emptyGroup> & { layer: string }>();
  for (const row of rows) {
    const current = byLayer.get(row.layer) ?? { layer: row.layer, ...emptyGroup() };
    addToGroup(current, row);
    byLayer.set(row.layer, current);
  }
  return [...byLayer.values()].sort((a, b) => b.inputTokens - a.inputTokens);
}

function summarizeTopDeals(rows: UsageRow[]) {
  const byDeal = new Map<string, ReturnType<typeof emptyGroup> & { label: string }>();
  for (const row of rows) {
    if (!row.deal_id) continue;
    const deal = firstRelation(row.deals);
    const label = deal?.property_address ?? deal?.file_name ?? row.deal_id;
    const current = byDeal.get(row.deal_id) ?? { label, ...emptyGroup() };
    addToGroup(current, row);
    byDeal.set(row.deal_id, current);
  }
  return [...byDeal.values()].sort((a, b) => b.inputTokens - a.inputTokens).slice(0, 12);
}

function summarizeExtractionModes(rows: UsageRow[]) {
  const byMode = new Map<
    string,
    ReturnType<typeof emptyGroup> & { mode: string; docType: string; regions: number }
  >();
  for (const row of rows) {
    if (row.layer !== "extraction") continue;
    const mode = String(row.metadata?.extraction_mode ?? "");
    const docType = String(row.metadata?.doc_type ?? "");
    const key = `${mode}:${docType}`;
    const current = byMode.get(key) ?? { mode, docType, regions: 0, ...emptyGroup() };
    addToGroup(current, row);
    current.regions += numberFromUnknown(row.metadata?.regions);
    byMode.set(key, current);
  }
  return [...byMode.values()].sort((a, b) => b.inputTokens - a.inputTokens);
}

function emptyGroup() {
  return {
    events: 0,
    cachedEvents: 0,
    inputTokens: 0,
    outputTokens: 0,
    pages: 0,
    attachments: 0,
  };
}

function addToGroup(group: ReturnType<typeof emptyGroup>, row: UsageRow) {
  group.events += 1;
  group.cachedEvents += row.cached ? 1 : 0;
  group.inputTokens += row.input_tokens ?? 0;
  group.outputTokens += row.output_tokens ?? 0;
  group.pages += row.input_pages ?? 0;
  group.attachments += row.input_attachments ?? 0;
}

function layerLabel(layer: string) {
  return layer.replace(/_/g, " ");
}

function targetLabel(row: UsageRow) {
  const deal = firstRelation(row.deals);
  const inboundEmail = firstRelation(row.inbound_emails);
  return (
    deal?.property_address ??
    deal?.file_name ??
    inboundEmail?.subject ??
    inboundEmail?.from_email ??
    "No linked target"
  );
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return 0;
}
