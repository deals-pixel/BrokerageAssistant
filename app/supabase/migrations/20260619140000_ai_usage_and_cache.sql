alter table public.deal_pages
  add column if not exists page_hash text;

create index if not exists deal_pages_page_hash_idx
  on public.deal_pages (page_hash);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete set null,
  inbound_email_id uuid references public.inbound_emails(id) on delete set null,
  layer text not null check (layer in ('light_routing', 'classification', 'extraction')),
  model text,
  cached boolean not null default false,
  input_tokens int,
  output_tokens int,
  cache_creation_input_tokens int,
  cache_read_input_tokens int,
  input_pages int,
  input_attachments int,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_deal_idx
  on public.ai_usage_events (deal_id, created_at desc);

create index if not exists ai_usage_events_inbound_email_idx
  on public.ai_usage_events (inbound_email_id, created_at desc);

create index if not exists ai_usage_events_layer_model_idx
  on public.ai_usage_events (layer, model, created_at desc);

create table if not exists public.ai_extraction_cache (
  cache_key text primary key,
  model text not null,
  document_type text not null,
  page_hashes text[] not null,
  extraction_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_extraction_cache_document_type_idx
  on public.ai_extraction_cache (document_type, created_at desc);

drop trigger if exists ai_extraction_cache_updated_at on public.ai_extraction_cache;
create trigger ai_extraction_cache_updated_at before update on public.ai_extraction_cache
  for each row execute function public.set_updated_at();

alter table public.ai_usage_events enable row level security;
alter table public.ai_extraction_cache enable row level security;

drop policy if exists "ai usage read" on public.ai_usage_events;
create policy "ai usage read" on public.ai_usage_events
  for select to authenticated using (true);

drop policy if exists "ai usage write" on public.ai_usage_events;
create policy "ai usage write" on public.ai_usage_events
  for all to authenticated using (true) with check (true);

drop policy if exists "ai extraction cache read" on public.ai_extraction_cache;
create policy "ai extraction cache read" on public.ai_extraction_cache
  for select to authenticated using (true);

drop policy if exists "ai extraction cache write" on public.ai_extraction_cache;
create policy "ai extraction cache write" on public.ai_extraction_cache
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table
  public.ai_usage_events,
  public.ai_extraction_cache
to authenticated, service_role;
