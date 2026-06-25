import { Badge } from "@/components/ui/badge";

export function IntakeNewBadge({ reason }: { reason?: string | null }) {
  return (
    <Badge variant="secondary" className="h-4 border border-blue-200 bg-blue-50 px-1.5 text-[11px] leading-4 text-blue-800">
      {reason === "updated_from_intake" ? "Updated" : "New"}
    </Badge>
  );
}

export function acknowledgeDealAttention(dealId: string) {
  if (typeof window === "undefined") return;
  void fetch(`/api/deals/${dealId}/attention`, {
    method: "POST",
    keepalive: true,
  });
}
