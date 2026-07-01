"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acknowledgeDealAttention } from "@/components/intake-new-badge";
import { toast } from "sonner";

type ProcessingJob = {
  id: string;
  status: "queued" | "running" | "retrying" | "completed" | "failed_retryable" | "failed_final" | "cancelled";
  step: string;
  last_error: string | null;
};

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
  const [localStatus, setLocalStatus] = useState<ProcessingJob["status"] | null>(null);
  const disabled = processing || status === "processing" || !pageCount;
  const label =
    status === "processing" || localStatus === "running" || processing
      ? "Processing..."
      : localStatus === "queued"
        ? "Queued..."
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
        throw new Error(body?.error ?? "Could not queue processing");
      }
      const body = (await res.json().catch(() => null)) as { job?: ProcessingJob } | null;
      if (body?.job?.status) setLocalStatus(body.job.status);
      toast.success("Processing queued.");
      await waitForProcessingResult();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setProcessing(false);
      setLocalStatus(null);
    }
  }

  async function waitForProcessingResult() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 750 : 2000));
      const res = await fetch(`/api/deals/${dealId}/processing-job`, { cache: "no-store" });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as { job?: ProcessingJob | null } | null;
      const job = body?.job;
      if (!job) continue;
      setLocalStatus(job.status);
      if (job.status === "completed") {
        toast.success("Processing complete.");
        return;
      }
      if (job.status === "failed_retryable") {
        toast.warning("Processing hit a temporary issue. A retry is scheduled.");
        return;
      }
      if (job.status === "failed_final" || job.status === "cancelled") {
        throw new Error(job.last_error ?? "Processing failed");
      }
    }
    toast.info("Processing is still running in the background.");
  }

  return (
    <Button size={size} variant={variant} onClick={process} disabled={disabled}>
      {label}
    </Button>
  );
}
