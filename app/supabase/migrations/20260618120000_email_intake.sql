do $$
begin
  alter type deal_status add value if not exists 'draft_from_email';
  alter type deal_status add value if not exists 'awaiting_match_review';
  alter type deal_status add value if not exists 'awaiting_admin_process';
exception
  when duplicate_object then null;
end $$;

alter table public.deals
  alter column created_by drop not null,
  add column if not exists transaction_code text unique,
  add column if not exists source text not null default 'manual_upload';

create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  brokerage_id uuid,
  from_email text,
  from_name text,
  to_email text,
  original_recipient text,
  forwarding_admin_email text,
  subject text,
  body_text text,
  body_html text,
  message_id text,
  thread_id text,
  received_at timestamptz,
  status text not null default 'received',
  routing_json jsonb,
  routing_attempts int not null default 0,
  routing_started_at timestamptz,
  routing_completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inbound_emails_message_id_idx
  on public.inbound_emails (message_id)
  where message_id is not null;
create index if not exists inbound_emails_status_idx on public.inbound_emails (status);
create index if not exists inbound_emails_received_at_idx on public.inbound_emails (received_at desc);

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  inbound_email_id uuid not null references public.inbound_emails(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  original_filename text,
  mime_type text,
  file_size bigint,
  file_hash text,
  storage_path text,
  status text not null default 'stored',
  ignore_reason text,
  light_classification_type text,
  light_classification_confidence numeric,
  received_at timestamptz,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_attachments_email_idx on public.email_attachments (inbound_email_id);
create index if not exists email_attachments_deal_idx on public.email_attachments (deal_id);
create index if not exists email_attachments_status_idx on public.email_attachments (status);
create index if not exists email_attachments_file_hash_idx on public.email_attachments (file_hash);

create table if not exists public.deal_email_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  inbound_email_id uuid not null references public.inbound_emails(id) on delete cascade,
  match_score int,
  match_reason text,
  match_status text not null default 'auto_matched',
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (deal_id, inbound_email_id)
);

create index if not exists deal_email_links_status_idx on public.deal_email_links (match_status);
create index if not exists deal_email_links_email_idx on public.deal_email_links (inbound_email_id);

alter table public.deal_pages
  add column if not exists email_attachment_id uuid references public.email_attachments(id) on delete set null,
  add column if not exists source text not null default 'manual_upload',
  add column if not exists received_at timestamptz,
  add column if not exists classification_status text not null default 'unclassified',
  add column if not exists light_classification_type text,
  add column if not exists light_classification_confidence numeric,
  add column if not exists processing_status text not null default 'not_processed',
  add column if not exists lonewolf_status text not null default 'pending_upload';

create index if not exists deal_pages_email_attachment_idx
  on public.deal_pages (email_attachment_id);

drop trigger if exists inbound_emails_updated_at on public.inbound_emails;
create trigger inbound_emails_updated_at before update on public.inbound_emails
  for each row execute function public.set_updated_at();

drop trigger if exists email_attachments_updated_at on public.email_attachments;
create trigger email_attachments_updated_at before update on public.email_attachments
  for each row execute function public.set_updated_at();

alter table public.inbound_emails enable row level security;
alter table public.email_attachments enable row level security;
alter table public.deal_email_links enable row level security;

drop policy if exists "inbound emails read" on public.inbound_emails;
create policy "inbound emails read" on public.inbound_emails
  for select to authenticated using (true);

drop policy if exists "inbound emails write" on public.inbound_emails;
create policy "inbound emails write" on public.inbound_emails
  for all to authenticated using (true) with check (true);

drop policy if exists "email attachments read" on public.email_attachments;
create policy "email attachments read" on public.email_attachments
  for select to authenticated using (true);

drop policy if exists "email attachments write" on public.email_attachments;
create policy "email attachments write" on public.email_attachments
  for all to authenticated using (true) with check (true);

drop policy if exists "deal email links read" on public.deal_email_links;
create policy "deal email links read" on public.deal_email_links
  for select to authenticated using (true);

drop policy if exists "deal email links write" on public.deal_email_links;
create policy "deal email links write" on public.deal_email_links
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table
  public.inbound_emails,
  public.email_attachments,
  public.deal_email_links
to authenticated, service_role;
