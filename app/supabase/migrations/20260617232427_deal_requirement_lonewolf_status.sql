create table if not exists public.deal_requirement_statuses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  requirement_id text not null,
  lonewolf_status text not null default 'pending_upload',
  lonewolf_uploaded_at timestamptz,
  lonewolf_uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, requirement_id),
  constraint deal_requirement_statuses_lonewolf_status_check check (
    lonewolf_status in ('not_required', 'pending_upload', 'uploaded', 'unknown')
  ),
  constraint deal_requirement_statuses_requirement_id_not_blank check (
    length(trim(requirement_id)) > 0
  )
);

create index if not exists deal_requirement_statuses_deal_idx
  on public.deal_requirement_statuses (deal_id);

drop trigger if exists deal_requirement_statuses_updated_at on public.deal_requirement_statuses;
create trigger deal_requirement_statuses_updated_at before update on public.deal_requirement_statuses
  for each row execute function public.set_updated_at();

alter table public.deal_requirement_statuses enable row level security;

drop policy if exists "requirement statuses read" on public.deal_requirement_statuses;
create policy "requirement statuses read" on public.deal_requirement_statuses
  for select to authenticated using (true);

drop policy if exists "requirement statuses write" on public.deal_requirement_statuses;
create policy "requirement statuses write" on public.deal_requirement_statuses
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.deal_requirement_statuses
to authenticated, service_role;
