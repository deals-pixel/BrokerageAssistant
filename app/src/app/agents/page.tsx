import Link from "next/link";
import { AgentManager } from "@/components/agent-manager";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function AgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: agents } = await supabase
    .from("agents")
    .select("id, name, email, phone, brokerage")
    .order("name", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/" />}>
            Dashboard
          </Button>
          <h1 className="mt-3 text-2xl font-semibold">Agent Management</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </div>
        <SignOutButton />
      </header>
      <AgentManager agents={agents ?? []} />
    </div>
  );
}
