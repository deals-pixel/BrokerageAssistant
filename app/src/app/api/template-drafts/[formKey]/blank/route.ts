import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = new Set(["admin", "developer_superadmin", "template_editor"]);
const pageSchema = z.object({
  pageNumber: z.number().int().min(1).max(200),
  dataUrl: z.string().min(1),
  contentType: z.enum(["image/jpeg", "image/png"]),
});
const saveBlankSchema = z.object({
  formTitle: z.string().min(1).max(220),
  fileName: z.string().min(1).max(260),
  pages: z.array(pageSchema).min(1).max(200),
});

type BlankPageRecord = {
  pageNumber: number;
  path: string;
  contentType: "image/jpeg" | "image/png";
  size: number;
};

export const maxDuration = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const auth = await requireTemplateAccess();
  if ("response" in auth) return auth.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("template_region_drafts")
    .select("file_name, blank_pages, blank_updated_at")
    .eq("form_key", formKey)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const pages = blankPagesFromUnknown(data?.blank_pages);
  if (!data || pages.length === 0) {
    return NextResponse.json({ blank: null });
  }

  const signedPages = await Promise.all(
    pages.map(async (page) => {
      const { data: signed, error: signedError } = await admin.storage
        .from("deals")
        .createSignedUrl(page.path, 60 * 60 * 24);
      if (signedError || !signed?.signedUrl) {
        throw new Error(signedError?.message ?? `Could not sign template page ${page.pageNumber}`);
      }
      return { ...page, signedUrl: signed.signedUrl };
    }),
  );

  return NextResponse.json({
    blank: {
      fileName: data.file_name,
      savedAt: data.blank_updated_at,
      pages: signedPages,
    },
  });
}

export async function PUT(req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const auth = await requireTemplateAccess();
  if ("response" in auth) return auth.response;

  const parsed = saveBlankSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid blank form" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("template_region_drafts")
    .select("blank_pages, regions")
    .eq("form_key", formKey)
    .maybeSingle();
  const oldPages = blankPagesFromUnknown(current?.blank_pages);
  const batch = `${Date.now()}-${crypto.randomUUID()}`;
  const safeKey = safePathSegment(formKey);
  const blankPages: BlankPageRecord[] = [];

  try {
    for (const page of parsed.data.pages) {
      const buffer = bufferFromDataUrl(page.dataUrl, page.contentType);
      const extension = page.contentType === "image/png" ? "png" : "jpg";
      const path = `brokerages/default/template-blanks/${safeKey}/${batch}/p${String(page.pageNumber).padStart(3, "0")}.${extension}`;
      const { error: uploadError } = await admin.storage
        .from("deals")
        .upload(path, buffer, { contentType: page.contentType, upsert: true });
      if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });
      blankPages.push({
        pageNumber: page.pageNumber,
        path,
        contentType: page.contentType,
        size: buffer.byteLength,
      });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid blank form page image." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("template_region_drafts")
    .upsert(
      {
        form_key: formKey,
        form_title: parsed.data.formTitle,
        file_name: parsed.data.fileName,
        regions: Array.isArray(current?.regions) ? current.regions : [],
        blank_pages: blankPages,
        blank_updated_at: now,
        updated_by: auth.userId,
        updated_at: now,
      },
      { onConflict: "form_key" },
    )
    .select("file_name, blank_pages, blank_updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (oldPages.length > 0) {
    await admin.storage.from("deals").remove(oldPages.map((page) => page.path)).catch(() => undefined);
  }

  return NextResponse.json({
    blank: {
      fileName: data.file_name,
      savedAt: data.blank_updated_at,
      pages: blankPages,
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const auth = await requireTemplateAccess();
  if ("response" in auth) return auth.response;

  const admin = createAdminClient();
  const { data: current } = await admin
    .from("template_region_drafts")
    .select("blank_pages")
    .eq("form_key", formKey)
    .maybeSingle();
  const oldPages = blankPagesFromUnknown(current?.blank_pages);

  const { error } = await admin
    .from("template_region_drafts")
    .update({
      blank_pages: [],
      blank_updated_at: null,
      file_name: null,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("form_key", formKey);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (oldPages.length > 0) {
    await admin.storage.from("deals").remove(oldPages.map((page) => page.path)).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}

async function requireTemplateAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!allowedRoles.has(profile?.role ?? "")) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { userId: user.id };
}

function blankPagesFromUnknown(value: unknown): BlankPageRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((page) => {
      if (!page || typeof page !== "object") return null;
      const candidate = page as Record<string, unknown>;
      const pageNumber = Number(candidate.pageNumber);
      const path = typeof candidate.path === "string" ? candidate.path : "";
      const contentType = candidate.contentType === "image/png" ? "image/png" : "image/jpeg";
      const size = Number(candidate.size ?? 0);
      if (!Number.isFinite(pageNumber) || pageNumber < 1 || !path) return null;
      return { pageNumber, path, contentType, size: Number.isFinite(size) ? size : 0 };
    })
    .filter((page): page is BlankPageRecord => Boolean(page))
    .sort((a, b) => a.pageNumber - b.pageNumber);
}

function bufferFromDataUrl(dataUrl: string, expectedContentType: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || match[1] !== expectedContentType) {
    throw new Error("Invalid page image payload.");
  }
  return Buffer.from(match[2], "base64");
}

function safePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "standard-form";
}
