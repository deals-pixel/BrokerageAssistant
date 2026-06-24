/* Creates a signed-in app user. Usage:
   npx tsx --env-file=.env.local scripts/create-user.ts <email> <password> [role]
   Roles: admin, brokerage_user, developer_superadmin, template_editor */
import { createClient } from "@supabase/supabase-js";

const [email, password, role = "admin"] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: create-user.ts <email> <password> [role]");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user!.id;

  const { error: roleErr } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);
  if (roleErr) throw roleErr;

  console.log(`Created ${email} (${role}) — id ${userId}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
