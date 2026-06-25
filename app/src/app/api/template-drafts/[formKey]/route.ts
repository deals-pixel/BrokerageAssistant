import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { FIELD_REGISTRY_SECTIONS } from "@/lib/types";

const FIELD_KEYS = new Set(FIELD_REGISTRY_SECTIONS.flatMap((section) => section.fields.map((field) => field.key)));

const sourceBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const regionSchema = z.object({
  id: z.string().min(1),
  fieldKey: z.string().refine((value) => FIELD_KEYS.has(value), "Unknown field key"),
  label: z.string().min(1).max(160),
  page: z.number().int().min(1),
  box: sourceBoxSchema,
});

const saveDraftSchema = z.object({
  formTitle: z.string().min(1).max(220),
  fileName: z.string().max(260).optional().nullable(),
  regions: z.array(regionSchema).max(400),
});

export async function GET(_req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("template_region_drafts")
    .select("form_key, form_title, file_name, regions, updated_at, updated_by")
    .eq("form_key", formKey)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data ?? null });
}

export async function PUT(req: Request, { params }: { params: Promise<{ formKey: string }> }) {
  const { formKey } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = saveDraftSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid template draft" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("template_region_drafts")
    .upsert(
      {
        form_key: formKey,
        form_title: body.data.formTitle,
        file_name: body.data.fileName ?? null,
        regions: body.data.regions,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "form_key" },
    )
    .select("form_key, form_title, file_name, regions, updated_at, updated_by")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}
