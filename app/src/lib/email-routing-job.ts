import { createAdminClient } from "@/lib/supabase/admin";
import {
  transactionTypeForDeal,
  type InboundEmailInput,
  type LightRoutingResult,
} from "@/lib/email-intake";
import { routeEmailWithLightAI, type LightRouteAttachmentInput } from "@/lib/ai/light-route";

type AdminClient = ReturnType<typeof createAdminClient>;

type DealCandidate = {
  id: string;
  transaction_code: string | null;
  property_address: string | null;
  status: string;
  created_at: string;
  deal_fields?: { field_key: string; value: string | null }[];
};

type InboundEmailRow = {
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

type EmailAttachmentRow = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  status: string;
};

export async function processQueuedInboundEmails(limit = 5) {
  const supabase = createAdminClient();
  const { data: emails, error } = await supabase
    .from("inbound_emails")
    .select("id, status, routing_attempts")
    .in("status", ["routing_queued", "routing_error", "routing"])
    .lt("routing_attempts", 3)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const results = [];
  for (const email of emails ?? []) {
    results.push(await processInboundEmailRouting(email.id));
  }
  return results;
}

export async function processInboundEmailRouting(inboundEmailId: string) {
  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();

  const { data: current, error: currentError } = await supabase
    .from("inbound_emails")
    .select("id, status, routing_attempts, routing_started_at")
    .eq("id", inboundEmailId)
    .single();
  if (currentError || !current) {
    return { inboundEmailId, status: "skipped", reason: currentError?.message ?? "not found" };
  }
  const staleRouting =
    current.status === "routing" &&
    current.routing_started_at &&
    new Date(current.routing_started_at).getTime() < Date.now() - 15 * 60_000;
  const claimable =
    ["routing_queued", "routing_error"].includes(current.status) || staleRouting;
  if (!claimable || current.routing_attempts >= 3) {
    return { inboundEmailId, status: "skipped", reason: "not claimable" };
  }

  const { data: claimed, error: claimError } = await supabase
    .from("inbound_emails")
    .update({
      status: "routing",
      routing_started_at: startedAt,
      routing_attempts: current.routing_attempts + 1,
      error_message: null,
    })
    .eq("id", inboundEmailId)
    .in("status", ["routing_queued", "routing_error", "routing"])
    .select("id, routing_attempts")
    .single();
  if (claimError || !claimed) {
    return { inboundEmailId, status: "skipped", reason: claimError?.message ?? "not claimable" };
  }

  try {
    const { data: email, error: emailError } = await supabase
      .from("inbound_emails")
      .select(
        "id, from_email, from_name, to_email, original_recipient, forwarding_admin_email, subject, body_text, body_html, message_id, thread_id, received_at",
      )
      .eq("id", inboundEmailId)
      .single();
    if (emailError || !email) throw new Error(emailError?.message ?? "Inbound email not found");

    const { data: attachments, error: attachmentError } = await supabase
      .from("email_attachments")
      .select("id, original_filename, mime_type, file_size, storage_path, status")
      .eq("inbound_email_id", inboundEmailId)
      .in("status", ["stored", "light_classified", "linked_to_transaction"]);
    if (attachmentError) throw new Error(attachmentError.message);

    const routeAttachments = await loadRouteAttachments(supabase, attachments ?? []);
    if (routeAttachments.length === 0) {
      await supabase
        .from("inbound_emails")
        .update({
          status: "ignored",
          error_message: "No valid document attachments found",
          routing_completed_at: new Date().toISOString(),
        })
        .eq("id", inboundEmailId);
      return { inboundEmailId, status: "ignored" };
    }

    const inbound = emailRowToInboundInput(email as InboundEmailRow, routeAttachments);
    const routing = await routeEmailWithLightAI(inbound, routeAttachments);

    for (const attachment of routeAttachments) {
      const guess = routing.document_type_guesses.find((item) => item.filename === attachment.name);
      await supabase
        .from("email_attachments")
        .update({
          status: "light_classified",
          light_classification_type: guess?.document_type ?? "unknown",
          light_classification_confidence: guess?.confidence ?? 0.2,
        })
        .eq("id", attachment.id);
    }

    const match = await matchDeal(supabase, routing, inbound.fromEmail);
    const attachmentIds = routeAttachments
      .map((attachment) => attachment.id)
      .filter((id): id is string => Boolean(id));
    const completedAt = new Date().toISOString();

    if (match.best && match.score >= 80) {
      await linkEmailToDeal(supabase, {
        emailId: inboundEmailId,
        dealId: match.best.id,
        attachmentIds,
        matchScore: match.score,
        matchReason: match.reason,
        matchStatus: "auto_matched",
      });
      await supabase
        .from("deals")
        .update({ status: "awaiting_admin_process", source: "email" })
        .eq("id", match.best.id);
      await supabase
        .from("inbound_emails")
        .update({ status: "matched", routing_json: routing, routing_completed_at: completedAt })
        .eq("id", inboundEmailId);
      await supabase.from("audit_logs").insert({
        deal_id: match.best.id,
        action: "email_auto_matched",
        details: { inbound_email_id: inboundEmailId, attachments: attachmentIds.length, match_score: match.score },
      });
      return { inboundEmailId, status: "matched", dealId: match.best.id };
    }

    if (match.best && match.score >= 50) {
      await supabase.from("deal_email_links").insert({
        deal_id: match.best.id,
        inbound_email_id: inboundEmailId,
        match_score: match.score,
        match_reason: match.reason,
        match_status: "needs_review",
      });
      await supabase
        .from("inbound_emails")
        .update({ status: "needs_match_review", routing_json: routing, routing_completed_at: completedAt })
        .eq("id", inboundEmailId);
      return { inboundEmailId, status: "needs_match_review", dealId: match.best.id };
    }

    const { data: draftDeal, error: draftError } = await supabase
      .from("deals")
      .insert({
        created_by: null,
        file_name: inbound.subject || "Email intake package",
        file_size: routeAttachments.reduce((sum, item) => sum + (item.contentLength ?? 0), 0),
        page_count: 0,
        status: "draft_from_email",
        transaction_type: transactionTypeForDeal(routing.transaction_type_guess),
        property_address: routing.property_address || null,
        source: "email",
        transaction_code: await nextTransactionCode(supabase),
      })
      .select("id")
      .single();
    if (draftError || !draftDeal) throw new Error(draftError?.message ?? "Could not create draft deal");

    await linkEmailToDeal(supabase, {
      emailId: inboundEmailId,
      dealId: draftDeal.id,
      attachmentIds,
      matchScore: match.score,
      matchReason: match.reason || "No confident existing match",
      matchStatus: "manually_confirmed",
    });
    await supabase
      .from("inbound_emails")
      .update({ status: "draft_transaction_created", routing_json: routing, routing_completed_at: completedAt })
      .eq("id", inboundEmailId);
    await supabase.from("audit_logs").insert({
      deal_id: draftDeal.id,
      action: "draft_deal_created_from_email",
      details: { inbound_email_id: inboundEmailId, attachments: attachmentIds.length, routing },
    });

    return { inboundEmailId, status: "draft_transaction_created", dealId: draftDeal.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("inbound_emails")
      .update({
        status: "routing_error",
        error_message: message,
      })
      .eq("id", inboundEmailId);
    return { inboundEmailId, status: "routing_error", error: message };
  }
}

async function loadRouteAttachments(
  supabase: AdminClient,
  attachments: EmailAttachmentRow[],
): Promise<LightRouteAttachmentInput[]> {
  const result: LightRouteAttachmentInput[] = [];
  for (const attachment of attachments) {
    if (!attachment.storage_path) continue;
    const { data: blob, error } = await supabase.storage.from("deals").download(attachment.storage_path);
    if (error || !blob) continue;
    const buffer = Buffer.from(await blob.arrayBuffer());
    result.push({
      id: attachment.id,
      name: attachment.original_filename ?? "email-attachment.pdf",
      contentType: attachment.mime_type,
      contentLength: attachment.file_size ?? buffer.byteLength,
      contentBase64: buffer.toString("base64"),
      buffer,
    });
  }
  return result;
}

function emailRowToInboundInput(
  email: InboundEmailRow,
  attachments: LightRouteAttachmentInput[],
): InboundEmailInput {
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
    attachments: attachments.map(({ name, contentType, contentLength, contentBase64 }) => ({
      name,
      contentType,
      contentLength,
      contentBase64,
    })),
  };
}

async function matchDeal(
  supabase: AdminClient,
  routing: LightRoutingResult,
  senderEmail: string | null,
) {
  const { data } = await supabase
    .from("deals")
    .select("id, transaction_code, property_address, status, created_at, deal_fields(field_key, value)")
    .order("created_at", { ascending: false })
    .limit(100);

  let best: DealCandidate | null = null;
  let score = 0;
  let reason = "No matching signals";

  for (const deal of (data ?? []) as DealCandidate[]) {
    const current = scoreDeal(deal, routing, senderEmail);
    if (current.score > score) {
      best = deal;
      score = current.score;
      reason = current.reason;
    }
  }

  return { best, score, reason };
}

function scoreDeal(deal: DealCandidate, routing: LightRoutingResult, senderEmail: string | null) {
  const reasons: string[] = [];
  let score = 0;
  const fields = deal.deal_fields ?? [];
  const mlsField = fields.find((field) => field.field_key === "mls_number")?.value;
  const address = deal.property_address ?? fields.find((field) => field.field_key === "property_address")?.value;
  const emailValues = fields
    .filter((field) => field.field_key.includes("email"))
    .map((field) => field.value?.toLowerCase())
    .filter(Boolean);
  const nameValues = fields
    .filter((field) => field.field_key.includes("name") || field.field_key.includes("agent"))
    .map((field) => field.value)
    .filter((value): value is string => Boolean(value));

  if (routing.transaction_code && deal.transaction_code === routing.transaction_code) {
    score += 100;
    reasons.push("transaction code exact match");
  }
  if (routing.mls_number && mlsField && normalizeText(mlsField) === normalizeText(routing.mls_number)) {
    score += 60;
    reasons.push("MLS exact match");
  }
  if (routing.property_address && address) {
    if (normalizeText(address) === normalizeText(routing.property_address)) {
      score += 50;
      reasons.push("property address exact match");
    } else if (
      normalizeText(address).includes(normalizeText(routing.property_address)) ||
      normalizeText(routing.property_address).includes(normalizeText(address))
    ) {
      score += 35;
      reasons.push("property address fuzzy match");
    }
  }
  if (senderEmail && emailValues.includes(senderEmail.toLowerCase())) {
    score += 10;
    reasons.push("sender email match");
  }
  const partyMatch = routing.party_names.find((name) => nameMatches(name, nameValues));
  if (partyMatch) {
    score += 20;
    reasons.push(`party name match: ${partyMatch}`);
  }
  const agentMatch = routing.agent_names.find((name) => nameMatches(name, nameValues));
  if (agentMatch) {
    score += 10;
    reasons.push(`agent name match: ${agentMatch}`);
  }

  return { score, reason: reasons.join(", ") || "No matching signals" };
}

async function linkEmailToDeal(
  supabase: AdminClient,
  {
    emailId,
    dealId,
    attachmentIds,
    matchScore,
    matchReason,
    matchStatus,
  }: {
    emailId: string;
    dealId: string;
    attachmentIds: string[];
    matchScore: number;
    matchReason: string;
    matchStatus: string;
  },
) {
  await supabase.from("deal_email_links").upsert(
    {
      deal_id: dealId,
      inbound_email_id: emailId,
      match_score: matchScore,
      match_reason: matchReason,
      match_status: matchStatus,
    },
    { onConflict: "deal_id,inbound_email_id" },
  );

  if (attachmentIds.length > 0) {
    await supabase
      .from("email_attachments")
      .update({ deal_id: dealId, status: "linked_to_transaction", linked_at: new Date().toISOString() })
      .in("id", attachmentIds);
  }
}

async function nextTransactionCode(supabase: AdminClient) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${year}-01-01T00:00:00.000Z`);
  return `TX-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function nameMatches(candidate: string, values: string[]) {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) return false;
  return values.some((value) => {
    const normalizedValue = normalizeText(value);
    return (
      normalizedValue === normalizedCandidate ||
      normalizedValue.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedValue)
    );
  });
}
