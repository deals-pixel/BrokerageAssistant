"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acknowledgeDealAttention } from "@/components/intake-new-badge";
import { toast } from "sonner";

type ProcessDealButtonProps = {
  dealId: string;
  status: string;
  pageCount?: number | null;
  size?: "default" | "sm";
  variant?: "default" | "outline";
};

export function ProcessDealButton({
  dealId,
  status,
  pageCount,
  size = "sm",
  variant = "default",
}: ProcessDealButtonProps) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const disabled = processing || status === "processing" || !pageCount;
  const label =
    status === "processing" || processing
      ? "Processing..."
      : status === "uploaded" || status === "awaiting_admin_process"
        ? "Process"
        : "Re-process";

  async function process() {
    setProcessing(true);
    try {
      acknowledgeDealAttention(dealId);
      const res = await fetch(`/api/deals/${dealId}/process`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Processing failed");
      }
      toast.success("Processing complete.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Button size={size} variant={variant} onClick={process} disabled={disabled}>
      {label}
    </Button>
  );
}
