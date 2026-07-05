create table if not exists public.deal_lonewolf_workspaces (
  deal_id uuid primary key references public.deals(id) on delete cascade,
  trade_number text,
  sub_trade text,
  status text not null default 'not_started',
  key_info_status text not null default 'not_started',
  people_status text not null default 'not_started',
  outside_brokers_status text not null default 'not_started',
  commissions_status text not null default 'not_started',
  initial_documents_status text not null default 'not_started',
  trade_record_sheet_status text not null default 'not_started',
  signed_trade_record_sheet_status text not null default 'not_started',
  notes text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_lonewolf_workspaces_trade_number_not_blank check (
    trade_number is null or length(trim(trade_number)) > 0
  ),
  constraint deal_lonewolf_workspaces_sub_trade_not_blank check (
    sub_trade is null or length(trim(sub_trade)) > 0
  ),
  constraint deal_lonewolf_workspaces_status_check check (
    status in ('not_started', 'open', 'complete', 'blocked')
  ),
  constraint deal_lonewolf_workspaces_key_info_status_check check (
    key_info_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_people_status_check check (
    people_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_outside_brokers_status_check check (
    outside_brokers_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_commissions_status_check check (
    commissions_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_initial_documents_status_check check (
    initial_documents_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_trade_record_sheet_status_check check (
    trade_record_sheet_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  ),
  constraint deal_lonewolf_workspaces_signed_trade_record_sheet_status_check check (
    signed_trade_record_sheet_status in ('not_started', 'in_progress', 'completed', 'blocked', 'skipped')
  )
);

drop trigger if exists deal_lonewolf_workspaces_updated_at on public.deal_lonewolf_workspaces;
create trigger deal_lonewolf_workspaces_updated_at before update on public.deal_lonewolf_workspaces
  for each row execute function public.set_updated_at();

alter table public.deal_lonewolf_workspaces enable row level security;

drop policy if exists "lonewolf workspaces read" on public.deal_lonewolf_workspaces;
create policy "lonewolf workspaces read" on public.deal_lonewolf_workspaces
  for select to authenticated using (true);

drop policy if exists "lonewolf workspaces write" on public.deal_lonewolf_workspaces;
create policy "lonewolf workspaces write" on public.deal_lonewolf_workspaces
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.deal_lonewolf_workspaces
to authenticated, service_role;
