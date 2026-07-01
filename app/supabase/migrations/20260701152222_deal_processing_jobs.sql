create table if not exists public.deal_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  inbound_email_id uuid references public.inbound_emails(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued',
  step text not null default 'queued',
  current_attempt int not null default 0,
  max_attempts int not null default 3,
  next_run_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  heartbeat_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  result_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_processing_jobs_status_check
    check (status in ('queued', 'running', 'retrying', 'completed', 'failed_retryable', 'failed_final', 'cancelled')),
  constraint deal_processing_jobs_step_check
    check (step in ('queued', 'preparing_pages', 'classifying', 'extracting_fields', 'syncing_tasks', 'completed', 'failed'))
);

create index if not exists deal_processing_jobs_deal_idx
  on public.deal_processing_jobs (deal_id, created_at desc);

create index if not exists deal_processing_jobs_status_next_run_idx
  on public.deal_processing_jobs (status, next_run_at, created_at);

create unique index if not exists deal_processing_jobs_one_active_per_deal_idx
  on public.deal_processing_jobs (deal_id)
  where status in ('queued', 'running', 'retrying', 'failed_retryable');

drop trigger if exists deal_processing_jobs_updated_at on public.deal_processing_jobs;
create trigger deal_processing_jobs_updated_at before update on public.deal_processing_jobs
  for each row execute function public.set_updated_at();

alter table public.deal_processing_jobs enable row level security;

drop policy if exists "deal processing jobs read" on public.deal_processing_jobs;
create policy "deal processing jobs read" on public.deal_processing_jobs
  for select to authenticated using (true);

drop policy if exists "deal processing jobs write" on public.deal_processing_jobs;
create policy "deal processing jobs write" on public.deal_processing_jobs
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.deal_processing_jobs
to authenticated, service_role;
