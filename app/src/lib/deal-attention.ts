type SupabaseClient = {
  from: (table: string) => any;
};

export const DEAL_ATTENTION_REASONS = {
  createdFromIntake: "created_from_intake",
  updatedFromIntake: "updated_from_intake",
} as const;

export async function markDealNeedsAttention(
  supabase: SupabaseClient,
  dealId: string,
  reason: (typeof DEAL_ATTENTION_REASONS)[keyof typeof DEAL_ATTENTION_REASONS] = DEAL_ATTENTION_REASONS.updatedFromIntake,
) {
  const { error } = await supabase
    .from("deals")
    .update({
      attention_reason: reason,
      attention_at: new Date().toISOString(),
      attention_cleared_at: null,
      attention_cleared_by: null,
    })
    .eq("id", dealId);
  if (error) throw new Error(error.message);
}
