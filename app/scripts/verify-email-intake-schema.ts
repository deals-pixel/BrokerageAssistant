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
        and table_name in ('inbound_emails', 'email_attachments', 'deal_email_links')
      order by table_name
    `);
    const columns = await client.query<{ table_name: string; column_name: string }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (
          (
            table_name = 'inbound_emails'
            and column_name in ('routing_attempts', 'routing_started_at', 'routing_completed_at')
          )
          or (
            table_name = 'deal_pages'
            and column_name in ('email_attachment_id', 'source', 'processing_status', 'lonewolf_status')
          )
        )
      order by table_name, column_name
    `);

    console.log(
      JSON.stringify(
        {
          tables: tables.rows.map((row) => row.table_name),
          columns: columns.rows,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
