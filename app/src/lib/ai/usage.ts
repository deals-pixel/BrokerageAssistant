import { createAdminClient } from "@/lib/supabase/admin";

type AiLayer = "light_routing" | "classification" | "extraction";

type UsagePayload = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type AiUsageEvent = {
  layer: AiLayer;
  model: string;
  dealId?: string | null;
  inboundEmailId?: string | null;
  cached?: boolean;
  usage?: UsagePayload | null;
  inputPages?: number | null;
  inputAttachments?: number | null;
  metadata?: Record<string, unknown>;
};

export async function logAiUsage(event: AiUsageEvent) {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("ai_usage_events").insert({
      deal_id: event.dealId ?? null,
      inbound_email_id: event.inboundEmailId ?? null,
      layer: event.layer,
      model: event.model,
      cached: event.cached ?? false,
      input_tokens: event.usage?.input_tokens ?? null,
      output_tokens: event.usage?.output_tokens ?? null,
      cache_creation_input_tokens: event.usage?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: event.usage?.cache_read_input_tokens ?? null,
      input_pages: event.inputPages ?? null,
      input_attachments: event.inputAttachments ?? null,
      metadata: event.metadata ?? null,
    });
    if (error) console.error("AI usage log failed", error.message);
  } catch (err) {
    console.error("AI usage log failed", err);
  }
}

export function usageFromResponse(response: unknown): UsagePayload | null {
  const usage = (response as { usage?: UsagePayload | null }).usage;
  if (!usage) return null;
  return {
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? null,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? null,
  };
}
