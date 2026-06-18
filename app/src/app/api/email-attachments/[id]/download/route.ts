import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: attachment, error } = await supabase
    .from("email_attachments")
    .select("storage_path, original_filename, mime_type")
    .eq("id", id)
    .single();
  if (error || !attachment?.storage_path) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const raw = new URL(req.url).searchParams.get("raw") === "1";
  if (raw) {
    const admin = createAdminClient();
    const { data: blob, error: downloadError } = await admin.storage
      .from("deals")
      .download(attachment.storage_path);
    if (downloadError || !blob) {
      return NextResponse.json(
        { error: downloadError?.message ?? "Could not download attachment" },
        { status: 500 },
      );
    }

    return new NextResponse(await blob.arrayBuffer(), {
      headers: {
        "content-type": attachment.mime_type ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${safeDownloadName(attachment.original_filename)}"`,
      },
    });
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from("deals")
    .createSignedUrl(attachment.storage_path, 60);
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: signedError?.message ?? "Could not sign attachment" }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}

function safeDownloadName(name: string | null) {
  return (name ?? "attachment").replace(/["\r\n]/g, "");
}
