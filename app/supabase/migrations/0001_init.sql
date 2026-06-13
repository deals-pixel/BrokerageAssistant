-- Brokerage Deal Intake Assistant — initial schema
-- Roles: admin, brokerage_user, developer_superadmin

create type user_role as enum ('admin', 'brokerage_user', 'developer_superadmin');
create type deal_status as enum ('uploaded', 'processing', 'extracted', 'in_review', 'reviewed', 'exported', 'error');
create type transaction_type as enum ('purchase', 'lease', 'unknown');
create type field_confidence as enum ('high', 'medium', 'low');

-- Profiles (one per auth user)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role user_role not null default 'brokerage_user',
  created_at timestamptz not null default now()
);

-- Deals (one per uploaded transaction package)
create table deals (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id),
  file_name text not null,
  file_size bigint,
  page_count int,
  status deal_status not null default 'uploaded',
  transaction_type transaction_type not null default 'unknown',
  property_address text,
  error_message text,
  -- original PDF auto-delete (security requirement)
  original_pdf_path text,
  delete_original_after timestamptz,
  original_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per PDF page, with classification result
create table deal_pages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  page_number int not null,
  image_path text not null,
  doc_type text,              -- DocumentType key, null until classified
  doc_confidence field_confidence,
  unique (deal_id, page_number)
);

-- One row per extracted field
create table deal_fields (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  field_key text not null,
  value text,
  confidence field_confidence not null default 'low',
  source_doc_type text,
  source_page int,
  needs_review boolean not null default true,
  edited_by uuid references profiles(id),
  edited_at timestamptz,
  notes text,                 -- cross-check / validation notes
  unique (deal_id, field_key)
);

-- Audit log
create table audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id),
  deal_id uuid references deals(id) on delete set null,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- updated_at trigger
create or replace function set_updated_at() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger deals_updated_at before update on deals
  for each row execute function set_updated_at();

-- Auto-create profile on signup
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Row Level Security
alter table profiles enable row level security;
alter table deals enable row level security;
alter table deal_pages enable row level security;
alter table deal_fields enable row level security;
alter table audit_logs enable row level security;

-- helper: current user's role
create or replace function current_role_of(uid uuid) returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = uid
$$;

-- All authenticated staff can read/write deals (internal tool, three trusted roles).
-- Superadmin additionally manages profiles.
create policy "profiles self read" on profiles for select to authenticated
  using (id = auth.uid() or current_role_of(auth.uid()) in ('admin','developer_superadmin'));
create policy "profiles superadmin update" on profiles for update to authenticated
  using (current_role_of(auth.uid()) = 'developer_superadmin');

create policy "deals read" on deals for select to authenticated using (true);
create policy "deals insert" on deals for insert to authenticated with check (created_by = auth.uid());
create policy "deals update" on deals for update to authenticated using (true);
create policy "deals delete" on deals for delete to authenticated
  using (current_role_of(auth.uid()) in ('admin','developer_superadmin'));

create policy "pages read" on deal_pages for select to authenticated using (true);
create policy "pages write" on deal_pages for all to authenticated using (true) with check (true);

create policy "fields read" on deal_fields for select to authenticated using (true);
create policy "fields write" on deal_fields for all to authenticated using (true) with check (true);

create policy "audit read" on audit_logs for select to authenticated
  using (current_role_of(auth.uid()) in ('admin','developer_superadmin'));
create policy "audit insert" on audit_logs for insert to authenticated with check (true);

-- Private storage bucket for deal files (PDF + page images). No public access.
insert into storage.buckets (id, name, public) values ('deals', 'deals', false)
on conflict (id) do nothing;

create policy "deals bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'deals');
create policy "deals bucket write" on storage.objects for insert to authenticated
  with check (bucket_id = 'deals');
create policy "deals bucket update" on storage.objects for update to authenticated
  using (bucket_id = 'deals');
create policy "deals bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'deals');
