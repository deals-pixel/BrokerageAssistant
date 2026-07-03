import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { fullName?: unknown } | null;
  if (!body || typeof body.fullName !== "string") {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }

  const fullName = body.fullName.trim().replace(/\s+/g, " ");
  if (fullName.length > 80) {
    return NextResponse.json({ error: "Name must be 80 characters or fewer." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "profile_name_updated",
    details: { source: "account_portal" },
  });

  return NextResponse.json({ ok: true, fullName });
}
