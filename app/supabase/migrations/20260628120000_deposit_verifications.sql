create table if not exists public.deal_deposit_verifications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  status text not null default 'confirmed',
  proof_amount text,
  confirmed_amount text,
  note text,
  source_inbound_email_id uuid references public.inbound_emails(id) on delete set null,
  source_email text,
  source_name text,
  source_received_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id),
  constraint deal_deposit_verifications_status_check check (
    status in ('confirmed')
  )
);

create index if not exists deal_deposit_verifications_deal_idx
  on public.deal_deposit_verifications (deal_id);

drop trigger if exists deal_deposit_verifications_updated_at on public.deal_deposit_verifications;
create trigger deal_deposit_verifications_updated_at before update on public.deal_deposit_verifications
  for each row execute function public.set_updated_at();

alter table public.deal_deposit_verifications enable row level security;

drop policy if exists "deposit verifications read" on public.deal_deposit_verifications;
create policy "deposit verifications read" on public.deal_deposit_verifications
  for select to authenticated using (true);

drop policy if exists "deposit verifications write" on public.deal_deposit_verifications;
create policy "deposit verifications write" on public.deal_deposit_verifications
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.deal_deposit_verifications
to authenticated, service_role;
