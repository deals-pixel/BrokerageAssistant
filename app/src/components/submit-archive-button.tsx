"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeDealAttention } from "@/components/intake-new-badge";
import { toast } from "sonner";

type SubmitArchiveButtonProps = {
  dealId: string;
  disabled?: boolean;
  size?: "default" | "sm";
  variant?: "default" | "outline";
  label?: string;
  warningItems?: string[];
};

export function SubmitArchiveButton({
  dealId,
  disabled = false,
  size = "sm",
  variant = "default",
  label = "Submit & archive",
  warningItems = [],
}: SubmitArchiveButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function requestSubmit() {
    if (warningItems.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void submit();
  }

  async function submit() {
    setConfirmOpen(false);
    setSubmitting(true);
    try {
      acknowledgeDealAttention(dealId);
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
    <>
      <Button size={size} variant={variant} onClick={requestSubmit} disabled={disabled || submitting}>
        {submitting ? "Submitting..." : label}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive incomplete transaction?</DialogTitle>
            <DialogDescription>
              This transaction still has missing required information. Archiving will move it out of the active
              workspace anyway.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="font-medium">Missing before archive</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {warningItems.slice(0, 6).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {warningItems.length > 6 && <li>{warningItems.length - 6} more item(s)</li>}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Archiving..." : "Archive anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
