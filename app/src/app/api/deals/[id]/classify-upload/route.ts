import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyPages } from "@/lib/ai/classify";

export const maxDuration = 300;

type PendingImage = {
  pageNumber: number;
  base64: string;
  mediaType: "image/jpeg" | "image/png";
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { images?: PendingImage[] } | null;
  const images = body?.images ?? [];
  if (images.length === 0) {
    return NextResponse.json({ error: "No page images provided" }, { status: 400 });
  }

  const classification = await classifyPages(images);

  const { data: existingPages, error } = await supabase
    .from("deal_pages")
    .select("doc_type")
    .eq("deal_id", id)
    .not("doc_type", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const existingDocTypes = new Set((existingPages ?? []).map((page) => page.doc_type));
  const incomingDocTypes = Array.from(
    new Set(classification.pages.map((page) => page.doc_type).filter((docType) => docType !== "other")),
  );
  const conflicts = incomingDocTypes.filter((docType) => existingDocTypes.has(docType));

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    deal_id: id,
    action: "pending_upload_classified",
    details: {
      pages: classification.pages.length,
      incoming_doc_types: incomingDocTypes,
      conflicts,
    },
  });

  return NextResponse.json({
    classification,
    incomingDocTypes,
    conflicts,
  });
}
