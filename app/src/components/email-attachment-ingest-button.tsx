"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export type EmailAttachmentForIngest = {
  id: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  status: string;
  light_classification_type: string | null;
  light_classification_confidence: number | null;
  received_at: string | null;
};

type EmailAttachmentIngestButtonProps = {
  dealId: string;
  attachments: EmailAttachmentForIngest[];
  renderedAttachmentIds: string[];
};

const INGESTIBLE_STATUSES = new Set(["stored", "light_classified", "linked_to_transaction"]);

export async function prepareEmailAttachmentsForProcessing({
  supabase,
  dealId,
  attachments,
  renderedAttachmentIds,
  onProgress,
}: {
  supabase: ReturnType<typeof createClient>;
  dealId: string;
  attachments: EmailAttachmentForIngest[];
  renderedAttachmentIds: string[];
  onProgress?: (message: string) => void;
}) {
  const renderedSet = new Set(renderedAttachmentIds);
  const pendingAttachments = attachments.filter(
    (attachment) =>
      INGESTIBLE_STATUSES.has(attachment.status) && !renderedSet.has(attachment.id),
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  onProgress?.("Rendering attachments on the server...");
  const response = await fetch(`/api/deals/${dealId}/prepare-attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attachmentIds: pendingAttachments.map((attachment) => attachment.id) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error ?? "Could not prepare email attachments");
  }
  return result as {
    uploadedPages: number;
    pageCount: number;
    preparedFiles: { name: string; pages: number; qualityWarnings?: number }[];
  };
}

export function EmailAttachmentIngestButton({
  dealId,
  attachments,
  renderedAttachmentIds,
}: EmailAttachmentIngestButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  const renderedSet = useMemo(() => new Set(renderedAttachmentIds), [renderedAttachmentIds]);
  const pendingAttachments = useMemo(
    () =>
      attachments.filter(
        (attachment) =>
          INGESTIBLE_STATUSES.has(attachment.status) && !renderedSet.has(attachment.id),
      ),
    [attachments, renderedSet],
  );
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");

  async function prepareAttachments() {
    if (pendingAttachments.length === 0) return;
    setWorking(true);

    try {
      const result = await prepareEmailAttachmentsForProcessing({
        supabase,
        dealId,
        attachments,
        renderedAttachmentIds,
        onProgress: setProgress,
      });

      toast.success(`${result.uploadedPages} page${result.uploadedPages === 1 ? "" : "s"} prepared for processing.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not prepare email attachments");
    } finally {
      setWorking(false);
      setProgress("");
    }
  }

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        onClick={prepareAttachments}
        disabled={working || pendingAttachments.length === 0}
      >
        {working ? "Preparing..." : "Prepare for Processing"}
      </Button>
      {working && <p className="text-xs text-muted-foreground">{progress}</p>}
      {!working && pendingAttachments.length === 0 && (
        <p className="text-xs text-muted-foreground">All email attachments are already prepared.</p>
      )}
    </div>
  );
}
