import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncMissingDocumentTasks } from "@/lib/workflow";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await syncMissingDocumentTasks(supabase, id, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not sync tasks" },
      { status: 500 },
    );
  }
}
