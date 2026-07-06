create table if not exists public.deal_conditions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  condition_type text,
  due_date text,
  met_date text,
  completed boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_conditions_deal_idx
  on public.deal_conditions (deal_id, sort_order);

drop trigger if exists deal_conditions_updated_at on public.deal_conditions;
create trigger deal_conditions_updated_at before update on public.deal_conditions
  for each row execute function public.set_updated_at();

alter table public.deal_conditions enable row level security;

drop policy if exists "deal conditions read" on public.deal_conditions;
create policy "deal conditions read" on public.deal_conditions
  for select to authenticated using (true);

drop policy if exists "deal conditions write" on public.deal_conditions;
create policy "deal conditions write" on public.deal_conditions
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.deal_conditions
to authenticated, service_role;
