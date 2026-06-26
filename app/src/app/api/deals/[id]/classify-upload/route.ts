import { createHash } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyPages } from "@/lib/ai/classify";
import { buildPageStandardFormMatches } from "@/lib/ai/template-source";

export const maxDuration = 300;
const CLASSIFICATION_IMAGE_WIDTH = Math.max(600, Number(process.env.CLASSIFICATION_IMAGE_WIDTH ?? 1200) || 1200);
const CLASSIFICATION_IMAGE_QUALITY = Math.min(
  90,
  Math.max(40, Number(process.env.CLASSIFICATION_IMAGE_QUALITY ?? 58) || 58),
);

type PendingImage = {
  pageNumber: number;
  base64: string;
  mediaType: "image/jpeg" | "image/png";
  pageHash?: string | null;
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

  const hashedImages = await Promise.all(
    images.map(async (image) => {
      const pageHash = image.pageHash ?? hashBase64Image(image.base64);
      const optimized = await optimizeClassificationImage(image.base64);
      return {
        ...image,
        base64: optimized.toString("base64"),
        mediaType: "image/jpeg" as const,
        pageHash,
      };
    }),
  );

  const classification = await classifyPages(hashedImages, {
    dealId: id,
    metadata: {
      source: "pending_upload_preflight",
      image_mode: "thumbnail",
      image_width: CLASSIFICATION_IMAGE_WIDTH,
      image_quality: CLASSIFICATION_IMAGE_QUALITY,
    },
  });
  const standardFormMatches = buildPageStandardFormMatches(classification.pages);

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
      standard_forms: standardFormMatches
        .filter((pageMatch) => pageMatch.match)
        .map((pageMatch) => ({
          page: pageMatch.pageNumber,
          key: pageMatch.match?.key,
          number: pageMatch.match?.formNumber,
          title: pageMatch.match?.title,
          confidence: pageMatch.match?.confidence,
        })),
      conflicts,
    },
  });

  return NextResponse.json({
    classification,
    standardFormMatches,
    incomingDocTypes,
    conflicts,
  });
}

function hashBase64Image(base64: string) {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

async function optimizeClassificationImage(base64: string) {
  return sharp(Buffer.from(base64, "base64"))
    .resize({ width: CLASSIFICATION_IMAGE_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: CLASSIFICATION_IMAGE_QUALITY, mozjpeg: true })
    .toBuffer();
}
