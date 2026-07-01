import { EXISTING_DEAL_MATCH_THRESHOLD, heuristicRouteEmail, transactionTypeForDeal, type InboundEmailInput, type LightRoutingResult } from "@/lib/email-intake";
import { matchDeal } from "@/lib/email-routing-job";

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
  from_email: string | null;
  routing_json: Partial<LightRoutingResult> | null;
  email_attachments: { id: string; file_size: number | null; status: string }[];
};

type InboundEmailForRestore = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_email: string | null;
  original_recipient: string | null;
  forwarding_admin_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  message_id: string | null;
  thread_id: string | null;
  received_at: string | null;
};

type InboundEmailRouting = {
  id: string;
  routing_json: Partial<LightRoutingResult> | null;
};

type InboundEmailEvidence = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
};

type EmailBodyDealField = {
  field_key: string;
  value: string | null;
  source_doc_type: string | null;
  edited_at: string | null;
};

type DealForLink = {
  id: string;
  property_address: string | null;
  file_name: string;
};

type DealDepositField = {
  field_key: string;
  value: string | null;
};

const LINKABLE_ATTACHMENT_STATUSES = ["stored", "light_classified", "linked_to_transaction"];
const ATTENTION_REASONS = {
  createdFromIntake: "created_from_intake",
  updatedFromIntake: "updated_from_intake",
} as const;

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
  const emailBodyFieldsApplied = await applyEmailBodyFieldsToDeal(supabase, inboundEmailId, dealId);
  const depositConfirmedByEmail = await confirmDepositFromInboundEmail({
    supabase,
    inboundEmailId,
    dealId,
    userId,
  });
  await markDealNeedsAttention(supabase, dealId, ATTENTION_REASONS.updatedFromIntake);
  await table(supabase, "inbound_emails")
    .update({ status: "matched", error_message: null })
    .eq("id", inboundEmailId);

  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: dealId,
    action: "email_match_confirmed",
    details: {
      inbound_email_id: inboundEmailId,
      match_score: matchScore ?? 100,
      email_body_fields_applied: emailBodyFieldsApplied,
      deposit_confirmed_by_email: depositConfirmedByEmail,
    },
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
  const existingMatch = await matchDeal(
    supabase as Parameters<typeof matchDeal>[0],
    routingForExistingMatch(routing, resolvedAddress, resolvedType),
    inbound.from_email,
  );

  if (existingMatch.best && existingMatch.score >= EXISTING_DEAL_MATCH_THRESHOLD) {
    return confirmInboundEmailMatch({
      supabase,
      inboundEmailId,
      dealId: existingMatch.best.id,
      userId,
      matchScore: existingMatch.score,
      matchReason: `Matched existing transaction before draft creation: ${existingMatch.reason}`,
    });
  }

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
      attention_reason: ATTENTION_REASONS.createdFromIntake,
      attention_at: new Date().toISOString(),
      attention_cleared_at: null,
      attention_cleared_by: null,
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
  const emailBodyFieldsApplied = await applyEmailBodyFieldsToDeal(supabase, inboundEmailId, deal.id);
  await table(supabase, "inbound_emails")
    .update({ status: "draft_transaction_created", error_message: null })
    .eq("id", inboundEmailId);
  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: deal.id,
    action: "draft_deal_created_from_email",
    details: { inbound_email_id: inboundEmailId, routing, email_body_fields_applied: emailBodyFieldsApplied },
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

export async function restoreInboundEmailToReview({
  supabase,
  inboundEmailId,
  userId,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  userId: string;
}) {
  const inbound = await fetchInboundEmailForRestore(supabase, inboundEmailId);
  const input = inboundEmailToInput(inbound);
  const routing = heuristicRouteEmail(input);
  const match = await matchDeal(supabase as Parameters<typeof matchDeal>[0], routing, input.fromEmail);
  const strongMatch = match.best && match.score >= EXISTING_DEAL_MATCH_THRESHOLD ? match.best : null;

  await table(supabase, "deal_email_links")
    .update({ match_status: "rejected", confirmed_by: userId })
    .eq("inbound_email_id", inboundEmailId);

  if (strongMatch) {
    await table(supabase, "deal_email_links").upsert(
      {
        deal_id: strongMatch.id,
        inbound_email_id: inboundEmailId,
        match_score: match.score,
        match_reason: match.reason,
        match_status: "needs_review",
      },
      { onConflict: "deal_id,inbound_email_id" },
    );
  }

  await table(supabase, "inbound_emails")
    .update({
      status: strongMatch ? "needs_match_review" : "intake_review",
      routing_json: routing,
      routing_completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", inboundEmailId);

  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: strongMatch?.id ?? null,
    action: strongMatch ? "inbound_email_match_suggested" : "inbound_email_marked_useful",
    details: {
      inbound_email_id: inboundEmailId,
      restored_from_ignored: true,
      content_only: true,
      match_score: strongMatch ? match.score : 0,
      match_reason: strongMatch ? match.reason : null,
      routing,
    },
  });

  return {
    status: strongMatch ? "needs_match_review" : "intake_review",
    routing,
    deal: strongMatch
      ? {
          id: strongMatch.id,
          property_address: strongMatch.property_address,
          file_name: strongMatch.property_address ?? strongMatch.transaction_code ?? "Matched transaction",
        }
      : null,
  };
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
    .select("id, subject, from_email, routing_json, email_attachments(id, file_size, status)")
    .eq("id", inboundEmailId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Inbound email not found");
  return data as InboundEmailForDraft;
}

function routingForExistingMatch(
  routing: Partial<LightRoutingResult>,
  resolvedAddress: string | null,
  resolvedType: LightRoutingResult["transaction_type_guess"],
): LightRoutingResult {
  return {
    property_address: resolvedAddress ?? routing.property_address ?? "",
    mls_number: routing.mls_number ?? "",
    transaction_type_guess: resolvedType,
    party_names: Array.isArray(routing.party_names) ? routing.party_names : [],
    agent_names: Array.isArray(routing.agent_names) ? routing.agent_names : [],
    email_body_fields: routing.email_body_fields,
    document_type_guesses: Array.isArray(routing.document_type_guesses) ? routing.document_type_guesses : [],
    routing_confidence: typeof routing.routing_confidence === "number" ? routing.routing_confidence : 0,
    transaction_code: routing.transaction_code ?? "",
  };
}

async function fetchInboundEmailForRestore(supabase: SupabaseClient, inboundEmailId: string) {
  const { data, error } = await table(supabase, "inbound_emails")
    .select(
      "id, from_email, from_name, to_email, original_recipient, forwarding_admin_email, subject, body_text, body_html, message_id, thread_id, received_at",
    )
    .eq("id", inboundEmailId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Inbound email not found");
  return data as InboundEmailForRestore;
}

async function fetchInboundRouting(supabase: SupabaseClient, inboundEmailId: string) {
  const { data, error } = await table(supabase, "inbound_emails")
    .select("id, routing_json")
    .eq("id", inboundEmailId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Inbound email not found");
  return data as InboundEmailRouting;
}

async function fetchInboundEmailEvidence(supabase: SupabaseClient, inboundEmailId: string) {
  const { data, error } = await table(supabase, "inbound_emails")
    .select("id, from_email, from_name, subject, body_text, body_html, received_at")
    .eq("id", inboundEmailId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "Inbound email not found");
  return data as InboundEmailEvidence;
}

async function applyEmailBodyFieldsToDeal(supabase: SupabaseClient, inboundEmailId: string, dealId: string) {
  const inbound = await fetchInboundRouting(supabase, inboundEmailId);
  const evidence = await fetchInboundEmailEvidence(supabase, inboundEmailId);
  const fields = emailBodyFieldsFromRouting(inbound.routing_json);
  if (fields.length === 0) return 0;

  const keys = fields.map((field) => field.field_key);
  const { data: existingRows } = (await table(supabase, "deal_fields")
    .select("field_key, value, source_doc_type, edited_at")
    .eq("deal_id", dealId)
    .in("field_key", keys)) as { data: EmailBodyDealField[] | null };
  const existingByKey = new Map((existingRows ?? []).map((row) => [row.field_key, row]));
  let applied = 0;

  for (const field of fields) {
    const existing = existingByKey.get(field.field_key);
    if (existing?.edited_at) continue;
    if (existing?.value?.trim() && existing.source_doc_type !== "email_body") continue;

    const row = {
      deal_id: dealId,
      field_key: field.field_key,
      value: field.value,
      confidence: "medium",
      source_doc_type: "email_body",
      source_page: null,
      source_box: null,
      conflict_sources: null,
      needs_review: true,
      notes: emailBodyFieldSourceNote(evidence),
    };

    if (existing) {
      const { error } = await table(supabase, "deal_fields")
        .update(row)
        .eq("deal_id", dealId)
        .eq("field_key", field.field_key);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await table(supabase, "deal_fields").insert(row);
      if (error) throw new Error(error.message);
    }
    applied += 1;
  }

  return applied;
}

function emailBodyFieldSourceNote(email: InboundEmailEvidence) {
  const parts = [
    "Extracted from email body - admin review needed",
    email.subject ? `Subject: ${email.subject}` : null,
    email.from_email ? `Sender: ${email.from_email}` : null,
    email.received_at ? `Received: ${email.received_at}` : null,
  ];
  return parts.filter(Boolean).join("; ");
}

async function confirmDepositFromInboundEmail({
  supabase,
  inboundEmailId,
  dealId,
  userId,
}: {
  supabase: SupabaseClient;
  inboundEmailId: string;
  dealId: string;
  userId: string;
}) {
  const inbound = await fetchInboundEmailEvidence(supabase, inboundEmailId);
  const evidence = depositConfirmationEvidence(inbound);
  if (!evidence.confirmed) return false;

  const { data: fields } = (await table(supabase, "deal_fields")
    .select("field_key, value")
    .eq("deal_id", dealId)
    .in("field_key", ["deposit_amount", "deposit_holder", "deposit_method"])) as { data: DealDepositField[] | null };
  const fieldMap = new Map((fields ?? []).map((field) => [field.field_key, field.value ?? ""]));
  const proofAmount = fieldMap.get("deposit_amount")?.trim() || evidence.amount || null;
  const confirmedAt = new Date().toISOString();
  const note = [
    "Confirmed by inbound email.",
    inbound.subject ? `Subject: ${inbound.subject}` : null,
    inbound.from_email ? `Sender: ${inbound.from_email}` : null,
    inbound.received_at ? `Received: ${inbound.received_at}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const { error } = await table(supabase, "deal_deposit_verifications").upsert(
    {
      deal_id: dealId,
      status: "confirmed",
      proof_amount: proofAmount,
      confirmed_amount: proofAmount,
      note,
      source_inbound_email_id: inboundEmailId,
      source_email: inbound.from_email,
      source_name: inbound.from_name,
      source_received_at: inbound.received_at,
      confirmed_by: userId,
      confirmed_at: confirmedAt,
    },
    { onConflict: "deal_id" },
  );
  if (error) throw new Error(error.message);

  await table(supabase, "audit_logs").insert({
    user_id: userId,
    deal_id: dealId,
    action: "deposit_confirmed_by_email",
    details: {
      inbound_email_id: inboundEmailId,
      from_email: inbound.from_email,
      from_name: inbound.from_name,
      source_email: inbound.from_email,
      source_name: inbound.from_name,
      source_received_at: inbound.received_at,
      subject: inbound.subject,
      received_at: inbound.received_at,
      confirmed_at: confirmedAt,
      proof_amount: proofAmount,
      confirmed_amount: proofAmount,
      deposit_holder: fieldMap.get("deposit_holder") || null,
      deposit_method: fieldMap.get("deposit_method") || null,
      evidence_text: evidence.excerpt,
    },
  });

  return true;
}

function depositConfirmationEvidence(email: InboundEmailEvidence) {
  const text = [email.subject, inboundEmailText(email)].filter(Boolean).join("\n");
  const normalized = text.toLowerCase();
  const hasDepositContext =
    normalized.includes("deposit") ||
    normalized.includes("branch number") ||
    /\bpp\s+to\b/.test(normalized) ||
    /\bpayment\s+posted\b/.test(normalized);
  const hasConfirmation =
    /\bposted\b/.test(normalized) ||
    /\breceived\b/.test(normalized) ||
    /\bconfirmed\b/.test(normalized) ||
    /\bdeposit(ed)?\b/.test(normalized);
  const amount = text.match(/\$\s*\d[\d,]*(?:\.\d{2})?/)?.[0]?.replace(/\s+/g, "") ?? null;

  return {
    confirmed: hasDepositContext && hasConfirmation,
    amount,
    excerpt: text.replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

function inboundEmailText(email: Pick<InboundEmailEvidence, "body_text" | "body_html">) {
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

function emailBodyFieldsFromRouting(routing: Partial<LightRoutingResult> | null | undefined) {
  const value = routing?.email_body_fields;
  if (!Array.isArray(value)) return [];
  return value
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      const candidate = field as Record<string, unknown>;
      const fieldKey = typeof candidate.field_key === "string" ? candidate.field_key : "";
      const fieldValue = typeof candidate.value === "string" ? candidate.value.trim() : "";
      if (!fieldKey || !fieldValue) return null;
      return { field_key: fieldKey, value: fieldValue };
    })
    .filter((field): field is { field_key: string; value: string } => Boolean(field));
}

function inboundEmailToInput(email: InboundEmailForRestore): InboundEmailInput {
  return {
    fromEmail: email.from_email,
    fromName: email.from_name,
    toEmail: email.to_email,
    originalRecipient: email.original_recipient,
    forwardingAdminEmail: email.forwarding_admin_email,
    subject: email.subject,
    bodyText: email.body_text,
    bodyHtml: email.body_html,
    messageId: email.message_id,
    threadId: email.thread_id,
    receivedAt: email.received_at,
    attachments: [],
  };
}

async function linkAttachmentsToDeal(supabase: SupabaseClient, inboundEmailId: string, dealId: string) {
  await table(supabase, "email_attachments")
    .update({ deal_id: dealId, status: "linked_to_transaction", linked_at: new Date().toISOString() })
    .eq("inbound_email_id", inboundEmailId)
    .in("status", LINKABLE_ATTACHMENT_STATUSES);
}

async function markDealNeedsAttention(supabase: SupabaseClient, dealId: string, reason: string) {
  await table(supabase, "deals")
    .update({
      attention_reason: reason,
      attention_at: new Date().toISOString(),
      attention_cleared_at: null,
      attention_cleared_by: null,
    })
    .eq("id", dealId);
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
