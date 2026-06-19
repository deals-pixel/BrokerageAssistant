alter table public.deal_pages
  add column if not exists classification_reviewed_at timestamptz,
  add column if not exists classification_reviewed_by uuid references public.profiles(id) on delete set null;

create index if not exists deal_pages_classification_reviewed_idx
  on public.deal_pages (deal_id, classification_reviewed_at)
  where classification_reviewed_at is not null;
