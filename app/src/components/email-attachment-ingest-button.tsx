"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  renderFilePages,
} from "@/lib/pdf-render-client";
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

  const { data: lastPage } = await supabase
    .from("deal_pages")
    .select("page_number")
    .eq("deal_id", dealId)
    .order("page_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextPageNumber = (lastPage?.page_number ?? 0) + 1;
  let uploadedPages = 0;
  const preparedFiles: { name: string; pages: number }[] = [];

  for (const attachment of pendingAttachments) {
    const filename = attachment.original_filename ?? `email-attachment-${attachment.id}.pdf`;
    onProgress?.(`Downloading ${filename}...`);
    const response = await fetch(`/api/email-attachments/${attachment.id}/download?raw=1`);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? `Could not download ${filename}`);
    }

    const blob = await response.blob();
    const file = new File([blob], filename, {
      type: attachment.mime_type ?? blob.type ?? "application/pdf",
    });
    const pages = await renderFilePages(file, (message) => onProgress?.(message));
    for (const pageUpload of pages) {
      const pageNumber = nextPageNumber++;
      const imagePath = `${dealId}/pages/p${String(pageNumber).padStart(3, "0")}-${attachment.id}.jpg`;
      onProgress?.(`Uploading ${filename}, page ${pageNumber}...`);

      const { error: imageError } = await supabase.storage
        .from("deals")
        .upload(imagePath, pageUpload.blob, { contentType: "image/jpeg" });
      if (imageError) throw new Error(`Page ${pageNumber} upload failed: ${imageError.message}`);

      const { error: pageError } = await supabase.from("deal_pages").insert({
        deal_id: dealId,
        page_number: pageNumber,
        image_path: imagePath,
        doc_type: null,
        doc_confidence: null,
        email_attachment_id: attachment.id,
        source: "email",
        received_at: attachment.received_at,
        classification_status: "unclassified",
        light_classification_type: attachment.light_classification_type,
        light_classification_confidence: attachment.light_classification_confidence,
        processing_status: "awaiting_admin_process",
        lonewolf_status: "pending_upload",
      });
      if (pageError) throw new Error(`Page ${pageNumber} record failed: ${pageError.message}`);
      uploadedPages += 1;
    }

    await supabase
      .from("email_attachments")
      .update({ status: "linked_to_transaction", linked_at: new Date().toISOString() })
      .eq("id", attachment.id);

    preparedFiles.push({ name: filename, pages: pages.length });
  }

  const { count } = await supabase
    .from("deal_pages")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  await supabase
    .from("deals")
    .update({
      page_count: count ?? uploadedPages,
      status: "awaiting_admin_process",
      error_message: null,
    })
    .eq("id", dealId);

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: dealId,
    action: "email_attachments_prepared",
    details: {
      attachments: preparedFiles,
      pages_added: uploadedPages,
      page_count: count ?? uploadedPages,
    },
  });

  return {
    uploadedPages,
    pageCount: count ?? uploadedPages,
    preparedFiles,
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
