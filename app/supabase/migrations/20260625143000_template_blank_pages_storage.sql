alter table public.template_region_drafts
  add column if not exists blank_pages jsonb not null default '[]'::jsonb,
  add column if not exists blank_updated_at timestamptz,
  add constraint template_region_drafts_blank_pages_array check (jsonb_typeof(blank_pages) = 'array');
