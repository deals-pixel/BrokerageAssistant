import { readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];

async function main() {
  const client = new Client({
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: "postgres",
    password: process.env.SUPABASE_DATABASE_PASSWORD!,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });

  await client.connect();
  try {
    const tables = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('agents', 'deal_tasks', 'reminder_emails')
      order by table_name
    `);
    const columns = await client.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'deals'
        and column_name in ('scenario_key', 'scenario_label', 'ready_for_back_office_at', 'submitted_at')
      order by column_name
    `);
    console.log(
      JSON.stringify({
        tables: tables.rows.map((row) => row.table_name),
        deal_columns: columns.rows.map((row) => row.column_name),
      }),
    );
  } finally {
    await client.end();
  }
}

readFileSync(join(__dirname, "..", "supabase", "migrations", "0002_workflow.sql"), "utf8");

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
