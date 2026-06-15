-- Workflow expansion: scenarios, task engine, reminder drafts, and agent management.

alter table public.deals
  add column if not exists scenario_key text,
  add column if not exists scenario_label text,
  add column if not exists ready_for_back_office_at timestamptz,
  add column if not exists submitted_at timestamptz;

do $$
begin
  create type task_status as enum ('open', 'completed', 'dismissed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type reminder_status as enum ('draft', 'sent');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  brokerage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.deal_tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  requirement_id text,
  document_type text,
  title text not null,
  description text,
  status task_status not null default 'open',
  auto_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (deal_id, requirement_id)
);

create table if not exists public.reminder_emails (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  task_id uuid references public.deal_tasks(id) on delete set null,
  recipient text not null,
  subject text not null,
  body text not null,
  status reminder_status not null default 'draft',
  drafted_at timestamptz,
  sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_tasks_deal_status_idx on public.deal_tasks (deal_id, status);
create index if not exists deal_tasks_document_type_idx on public.deal_tasks (document_type);
create index if not exists reminder_emails_deal_status_idx on public.reminder_emails (deal_id, status);
create index if not exists agents_email_idx on public.agents (email);

drop trigger if exists agents_updated_at on public.agents;
create trigger agents_updated_at before update on public.agents
  for each row execute function public.set_updated_at();

drop trigger if exists deal_tasks_updated_at on public.deal_tasks;
create trigger deal_tasks_updated_at before update on public.deal_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists reminder_emails_updated_at on public.reminder_emails;
create trigger reminder_emails_updated_at before update on public.reminder_emails
  for each row execute function public.set_updated_at();

alter table public.agents enable row level security;
alter table public.deal_tasks enable row level security;
alter table public.reminder_emails enable row level security;

drop policy if exists "agents read" on public.agents;
create policy "agents read" on public.agents for select to authenticated using (true);

drop policy if exists "agents write" on public.agents;
create policy "agents write" on public.agents for all to authenticated using (true) with check (true);

drop policy if exists "tasks read" on public.deal_tasks;
create policy "tasks read" on public.deal_tasks for select to authenticated using (true);

drop policy if exists "tasks write" on public.deal_tasks;
create policy "tasks write" on public.deal_tasks for all to authenticated using (true) with check (true);

drop policy if exists "reminders read" on public.reminder_emails;
create policy "reminders read" on public.reminder_emails for select to authenticated using (true);

drop policy if exists "reminders write" on public.reminder_emails;
create policy "reminders write" on public.reminder_emails for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table
  public.profiles,
  public.deals,
  public.deal_pages,
  public.deal_fields,
  public.audit_logs,
  public.agents,
  public.deal_tasks,
  public.reminder_emails
to authenticated, service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
