import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { PasswordForm } from "@/components/account/password-form";
import { ProfileNameForm } from "@/components/account/profile-name-form";
import { SignOutButton } from "@/components/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";

type ProfileRole = "admin" | "brokerage_user" | "developer_superadmin" | "template_editor";

type Profile = {
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  created_at: string | null;
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role, created_at")
    .eq("id", user.id)
    .maybeSingle();
  const accountProfile = profile as Profile | null;
  const role = accountProfile?.role ?? "brokerage_user";
  const accessItems = accessSummary(role);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeft className="size-4" />
            Dashboard
          </Button>
          <h1 className="mt-3 text-2xl font-semibold">User portal</h1>
          <p className="text-sm text-muted-foreground">Manage your account, security, and app access.</p>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1">
          {roleLabel(role)}
        </Badge>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.45fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4" />
              Account details
            </CardTitle>
            <CardDescription>Your staff profile in the brokerage workspace.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Detail label="Email" value={accountProfile?.email ?? user.email ?? "Unknown"} />
            <ProfileNameForm initialName={accountProfile?.full_name ?? ""} />
            <Detail label="Role" value={roleLabel(role)} />
            <Detail label="Account created" value={formatDate(accountProfile?.created_at ?? user.created_at)} />
            <Detail label="Last sign-in" value={formatDate(user.last_sign_in_at)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Access
            </CardTitle>
            <CardDescription>What this account can use.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {accessItems.map((item) => (
              <div key={item} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4" />
            Password
          </CardTitle>
          <CardDescription>Update your password without changing your role or app access.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session</CardTitle>
          <CardDescription>Sign out of this browser session when you are done.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Separator />
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/20 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm">{value}</div>
    </div>
  );
}

function roleLabel(role: ProfileRole) {
  if (role === "developer_superadmin") return "Developer superadmin";
  if (role === "template_editor") return "Template editor";
  if (role === "brokerage_user") return "Brokerage user";
  return "Admin";
}

function accessSummary(role: ProfileRole) {
  if (role === "developer_superadmin") {
    return ["Full brokerage workspace", "Template editor", "AI usage and developer tools"];
  }
  if (role === "template_editor") {
    return ["Template editor", "Password and account portal"];
  }
  if (role === "brokerage_user") {
    return ["Brokerage transaction workspace", "Password and account portal"];
  }
  return ["Full brokerage workspace", "Template editor", "Password and account portal"];
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
