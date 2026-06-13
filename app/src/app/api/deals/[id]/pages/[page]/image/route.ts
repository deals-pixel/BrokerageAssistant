import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Signed-URL redirect for a page image. Keeps the bucket private; links expire.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; page: string }> },
) {
  const { id, page } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row } = await supabase
    .from("deal_pages")
    .select("image_path")
    .eq("deal_id", id)
    .eq("page_number", Number(page))
    .single();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from("deals")
    .createSignedUrl(row.image_path, 300);
  if (error || !signed) return NextResponse.json({ error: "Sign failed" }, { status: 500 });

  return NextResponse.redirect(signed.signedUrl);
}
