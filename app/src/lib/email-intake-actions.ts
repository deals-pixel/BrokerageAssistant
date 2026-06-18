import { transactionTypeForDeal, type LightRoutingResult } from "@/lib/email-intake";

type SupabaseClient = {
  from: (table: string) => unknown;
};

type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder;
  insert: (...args: unknown[]) => QueryBuilder;
  update: (...args: unknown[]) => QueryBuilder;
  upsert: (...args: unknown[]) => QueryBuilder;
  delete: (...args: unknown[]) => QueryBuilder;
  eq: (...args: unknown[]) => QueryBuilder;
  neq: (...args: unknown[]) => QueryBuilder;
  in: (...args: unknown[]) => QueryBuilder;
  gte: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  single: () => Promise<{ data: unknown; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
  then: Promise<{ data: unknown; error: { message: string } | null; count?: number | null }>["then"];
};

type InboundEmailForDraft = {
  id: string;
  subject: string | null;
  routing_json: Partial<LightRoutingResult> | null;
  email_attachments: { id: string; file_size: number | null; status: string }[];
};

type DealForLink = {
  id: string;
  property_address: string | null;
  file_name: string;
};

const LINKABLE_ATTACHMENT_STATUSES = ["stored", "light_classified", "linked_to_transaction"];

export async function confirmInboundEmailMatch({
  supabase,
  inboundEmailId,
  dealId,
  userId,
  matchScore,
  matchReason,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  dealId: string;
  userId: string;
  matchScore?: number;
  matchReason?: string;
}) {
  const deal = await fetchDeal(supabase, dealId);

  await table(supabase, "deal_email_links")
    .update({ match_status: "rejected" })
    .eq("inbound_email_id", inboundEmailId)
    .neq("deal_id", dealId);

  await table(supabase, "deal_email_links").upsert(
    {
      deal_id: dealId,
      inbound_email_id: inboundEmailId,
      match_score: matchScore ?? 100,
      match_reason: matchReason ?? "Admin linked email to this transaction",
      match_status: "manually_confirmed",
      confirmed_by: userId,
    },
    { onConflict: "deal_id,inbound_email_id" },
  );

  await linkAttachmentsToDeal(supabase, inboundEmailId, dealId);
  await table(supabase, "deals")
    .update({ status: "awaiting_admin_process", error_message: null })
    .eq("id", dealId);
  await table(supabase, "inbound_emails")
    .update({ status: "matched", error_message: null })
    .eq("id", inboundEmailId);

  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: dealId,
    action: "email_match_confirmed",
    details: { inbound_email_id: inboundEmailId, match_score: matchScore ?? 100 },
  });

  return { deal };
}

export async function createDraftDealFromInboundEmail({
  supabase,
  inboundEmailId,
  userId,
  propertyAddress,
  transactionType,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  userId: string;
  propertyAddress?: string | null;
  transactionType?: string | null;
}) {
  const inbound = await fetchInboundEmailForDraft(supabase, inboundEmailId);
  const routing = inbound.routing_json ?? {};
  const resolvedAddress = propertyAddress?.trim() || routing.property_address || null;
  const resolvedType = normalizeRoutingTransactionType(transactionType || routing.transaction_type_guess);
  const totalSize = inbound.email_attachments.reduce((sum, item) => sum + (item.file_size ?? 0), 0);

  const { data, error } = await table(supabase, "deals")
    .insert({
      created_by: userId,
      file_name: inbound.subject || "Email intake package",
      file_size: totalSize,
      page_count: 0,
      status: "draft_from_email",
      transaction_type: transactionTypeForDeal(resolvedType),
      property_address: resolvedAddress,
      source: "email",
      transaction_code: await nextTransactionCode(supabase),
    })
    .select("id, property_address, file_name")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create draft transaction");

  const deal = data as DealForLink;
  await table(supabase, "deal_email_links")
    .update({ match_status: "rejected" })
    .eq("inbound_email_id", inboundEmailId);
  await table(supabase, "deal_email_links").insert({
    deal_id: deal.id,
    inbound_email_id: inboundEmailId,
    match_score: 0,
    match_reason: "Admin created a new draft transaction from this email",
    match_status: "manually_confirmed",
    confirmed_by: userId,
  });

  await linkAttachmentsToDeal(supabase, inboundEmailId, deal.id);
  await table(supabase, "inbound_emails")
    .update({ status: "draft_transaction_created", error_message: null })
    .eq("id", inboundEmailId);
  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: deal.id,
    action: "draft_deal_created_from_email",
    details: { inbound_email_id: inboundEmailId, routing },
  });

  return { deal };
}

export async function ignoreInboundEmail({
  supabase,
  inboundEmailId,
  userId,
  reason,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  userId: string;
  reason?: string | null;
}) {
  await table(supabase, "deal_email_links")
    .update({ match_status: "rejected", confirmed_by: userId })
    .eq("inbound_email_id", inboundEmailId);
  await table(supabase, "email_attachments")
    .update({ status: "ignored", ignore_reason: reason || "Ignored by admin" })
    .eq("inbound_email_id", inboundEmailId)
    .in("status", ["stored", "light_classified"]);
  await table(supabase, "inbound_emails")
    .update({ status: "ignored", error_message: reason || "Ignored by admin" })
    .eq("id", inboundEmailId);
  await table(supabase, "audit_logs").insert({
    user_id: userId,
    action: "inbound_email_ignored",
    details: { inbound_email_id: inboundEmailId, reason: reason || "Ignored by admin" },
  });
}

export async function queueInboundEmailForRouting({
  supabase,
  inboundEmailId,
  userId,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  userId: string;
}) {
  await table(supabase, "inbound_emails")
    .update({
      status: "routing_queued",
      routing_attempts: 0,
      routing_started_at: null,
      error_message: null,
    })
    .eq("id", inboundEmailId);
  await table(supabase, "audit_logs").insert({
    user_id: userId,
    action: "inbound_email_routing_requeued",
    details: { inbound_email_id: inboundEmailId },
  });
}

async function fetchDeal(supabase: SupabaseClient, dealId: string) {
  const { data, error } = await table(supabase, "deals")
    .select("id, property_address, file_name")
    .eq("id", dealId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Transaction not found");
  return data as DealForLink;
}

async function fetchInboundEmailForDraft(supabase: SupabaseClient, inboundEmailId: string) {
  const { data, error } = await table(supabase, "inbound_emails")
    .select("id, subject, routing_json, email_attachments(id, file_size, status)")
    .eq("id", inboundEmailId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Inbound email not found");
  return data as InboundEmailForDraft;
}

async function linkAttachmentsToDeal(supabase: SupabaseClient, inboundEmailId: string, dealId: string) {
  await table(supabase, "email_attachments")
    .update({ deal_id: dealId, status: "linked_to_transaction", linked_at: new Date().toISOString() })
    .eq("inbound_email_id", inboundEmailId)
    .in("status", LINKABLE_ATTACHMENT_STATUSES);
}

async function nextTransactionCode(supabase: SupabaseClient) {
  const year = new Date().getFullYear();
  const { count } = (await table(supabase, "deals")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${year}-01-01T00:00:00.000Z`)) as { count: number | null };
  return `TX-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

function table(supabase: SupabaseClient, name: string) {
  return supabase.from(name) as QueryBuilder;
}

function normalizeRoutingTransactionType(value: unknown): LightRoutingResult["transaction_type_guess"] {
  if (
    value === "sale" ||
    value === "lease" ||
    value === "referral" ||
    value === "co_brokerage" ||
    value === "preconstruction" ||
    value === "unknown"
  ) {
    return value;
  }
  if (value === "purchase") return "sale";
  return "unknown";
}
