create table if not exists public.template_region_drafts (
  form_key text primary key,
  form_title text not null,
  file_name text,
  regions jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint template_region_drafts_regions_array check (jsonb_typeof(regions) = 'array')
);

alter table public.template_region_drafts enable row level security;

grant select, insert, update, delete on public.template_region_drafts to authenticated;

drop policy if exists "template drafts read" on public.template_region_drafts;
drop policy if exists "template drafts write" on public.template_region_drafts;

create policy "template drafts read" on public.template_region_drafts
  for select to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','developer_superadmin','template_editor'));

create policy "template drafts write" on public.template_region_drafts
  for all to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','developer_superadmin','template_editor'))
  with check (public.current_role_of(auth.uid()) in ('admin','developer_superadmin','template_editor'));
