import { NextResponse } from "next/server";
import { latestDealProcessingJob } from "@/lib/deal-processing-jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const job = await latestDealProcessingJob(createAdminClient(), id);
  return NextResponse.json({ ok: true, job });
}
