# Brokerage Deal Intake Assistant

Private internal web app: upload a real estate transaction package PDF → AI classifies pages and extracts deal fields → admin reviews/edits → export Deal Information Sheet (CSV / clipboard / PDF) for Lone Wolf entry.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind 4, shadcn/ui)
- Supabase (Auth, Postgres + RLS, private Storage)
- Claude API (vision-based page classification + field extraction, structured JSON output)
- pdfjs-dist (client-side page rendering), pdf-lib (Deal Sheet PDF generation)

## How it works

1. **Upload** — admin drops a PDF. The browser renders each page to JPEG (the example packages are scans with no text layer) and uploads the original + page images to a private Supabase bucket.
2. **Classify** — page images go to Claude in batches; each page gets a document type (APS, Form 801, Form 320, FINTRAC 630/631/635, deposit proof, lease, etc.) and the deal gets a transaction type (purchase/lease).
3. **Extract** — for each recognized document group, Claude extracts deal fields (address, price, deposit, commissions, dates, parties, lawyers, agents) with per-field confidence and source page.
4. **Merge + validate** — fields from multiple documents are merged (confidence first, then document authority — Deal Info Sheet > APS > others); disagreements and failed sanity checks (date order, deposit > price, odd commission %) are flagged for review.
5. **Review** — green = high confidence, yellow = needs review, red = missing. Click a field's `p.N` link to see the source page. Document checklist shows found/missing required docs.
6. **Export** — CSV (one row, Lone Wolf-ready), copy-to-clipboard summary, or a typed Deal Information Sheet PDF.

## Setup

### 1. Supabase

Create a project at supabase.com (or use the Supabase MCP/CLI), then run the migration:

```sh
# with the Supabase CLI linked to your project
supabase db push
# or paste supabase/migrations/0001_init.sql into the SQL editor
```

This creates tables (`profiles`, `deals`, `deal_pages`, `deal_fields`, `audit_logs`), RLS policies, the private `deals` storage bucket, and a trigger that auto-creates a profile per auth user.

Create staff users in Authentication → Users (email + password; disable public signups in Auth settings since this is a private tool). Set roles:

```sql
update profiles set role = 'admin' where email = 'admin@example.com';
update profiles set role = 'developer_superadmin' where email = 'dev@example.com';
```

### 2. Environment

```sh
cp .env.example .env.local
# fill in Supabase URL/keys and ANTHROPIC_API_KEY
```

### 3. Run

```sh
npm install
npm run dev
```

## Security

- Supabase Auth required everywhere (`src/proxy.ts` gates all routes).
- RLS on all tables; storage bucket is private; page images served via short-lived signed URLs only.
- Audit log rows for upload, processing, edits, review, export, deletion.
- Original PDFs auto-delete after `NEXT_PUBLIC_PDF_RETENTION_DAYS` (default 14). Schedule `GET /api/cron/cleanup` with header `x-cron-secret: $CRON_SECRET` (Railway cron or GitHub Action) daily.
- Uploaded documents are only sent to the Claude API to process the package; API inputs are not used to train models.

## Email Intake

Inbound transaction emails should be forwarded to `deals@teamadmiral.com` and delivered by Postmark Inbound to:

```text
POST https://<app-domain>/api/inbound-email
```

Set one of these on the Postmark webhook request:

```text
x-inbound-email-secret: $INBOUND_EMAIL_WEBHOOK_SECRET
Authorization: Bearer $INBOUND_EMAIL_WEBHOOK_SECRET
?secret=$INBOUND_EMAIL_WEBHOOK_SECRET
```

The webhook only stores the email and private attachments, then marks the email `routing_queued`. It intentionally does not run AI inside the webhook request. After the response is sent, it triggers the light-routing job for that email.

The light-routing worker can also be run from a scheduler as a retry/backstop:

```text
GET https://<app-domain>/api/jobs/email-routing?limit=5
x-cron-secret: $EMAIL_ROUTING_JOB_SECRET
```

`EMAIL_ROUTING_JOB_SECRET` defaults to `CRON_SECRET` when unset. The job reads first-page PDF subsets / image attachments, runs light routing, matches to an existing deal or creates a draft deal, and leaves the transaction awaiting admin processing.

## Deploy (Railway)

1. Create a Railway service from this repo (`app/` as root).
2. Set all env vars from `.env.example`.
3. Add a daily cron hitting `/api/cron/cleanup` with the `x-cron-secret` header.
4. Optional: add a frequent retry cron, for example every 5 minutes, hitting `/api/jobs/email-routing?limit=5` with the `x-cron-secret` or `x-job-secret` header.
