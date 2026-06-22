"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type SubmitArchiveButtonProps = {
  dealId: string;
  disabled?: boolean;
  size?: "default" | "sm";
  variant?: "default" | "outline";
};

export function SubmitArchiveButton({
  dealId,
  disabled = false,
  size = "sm",
  variant = "default",
}: SubmitArchiveButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/export`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not submit transaction");
      }
      toast.success("Transaction submitted and archived.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit transaction");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button size={size} variant={variant} onClick={submit} disabled={disabled || submitting}>
      {submitting ? "Submitting..." : "Submit & archive"}
    </Button>
  );
}
