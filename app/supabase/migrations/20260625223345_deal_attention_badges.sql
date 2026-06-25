alter table public.deals
  add column if not exists attention_reason text,
  add column if not exists attention_at timestamptz,
  add column if not exists attention_cleared_at timestamptz,
  add column if not exists attention_cleared_by uuid references public.profiles(id) on delete set null;

create index if not exists deals_attention_at_idx
  on public.deals (attention_at desc)
  where attention_at is not null;
