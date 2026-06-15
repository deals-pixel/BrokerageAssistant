/* Applies a migration file from supabase/migrations to the project in .env.local.
   Tries the direct host first (IPv6), then regional poolers (IPv4). */
import { readFileSync } from "fs";
import { join } from "path";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: join(__dirname, "..", ".env.local") });
config({ path: join(__dirname, "..", ".env") });

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
const password = process.env.SUPABASE_DATABASE_PASSWORD!;

const candidates = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  ...["ca-central-1", "us-east-1", "us-east-2", "us-west-1"].map((region) => ({
    host: `aws-0-${region}.pooler.supabase.com`,
    port: 5432,
    user: `postgres.${ref}`,
  })),
];

async function connect(): Promise<Client> {
  let lastErr: unknown;
  for (const c of candidates) {
    const client = new Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${c.host}`);
      return client;
    } catch (err) {
      console.log(`  ${c.host}: ${err instanceof Error ? err.message : err}`);
      lastErr = err;
      await client.end().catch(() => {});
    }
  }
  throw lastErr;
}

async function main() {
  const migrationFile = process.argv[2] ?? "0001_init.sql";
  const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", migrationFile), "utf8");
  const client = await connect();
  try {
    await client.query(sql);
    console.log(`${migrationFile} applied successfully.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
