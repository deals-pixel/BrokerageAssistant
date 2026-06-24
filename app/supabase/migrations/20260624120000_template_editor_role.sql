-- Allow client-side form calibrators into the template editor without exposing deal data.

do $$
begin
  alter type public.user_role add value 'template_editor';
exception
  when duplicate_object then null;
end $$;

drop policy if exists "deals read" on public.deals;
drop policy if exists "deals insert" on public.deals;
drop policy if exists "deals update" on public.deals;
drop policy if exists "deals delete" on public.deals;

create policy "deals read" on public.deals for select to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));
create policy "deals insert" on public.deals for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin')
  );
create policy "deals update" on public.deals for update to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));
create policy "deals delete" on public.deals for delete to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','developer_superadmin'));

drop policy if exists "pages read" on public.deal_pages;
drop policy if exists "pages write" on public.deal_pages;

create policy "pages read" on public.deal_pages for select to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));
create policy "pages write" on public.deal_pages for all to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'))
  with check (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));

drop policy if exists "fields read" on public.deal_fields;
drop policy if exists "fields write" on public.deal_fields;

create policy "fields read" on public.deal_fields for select to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));
create policy "fields write" on public.deal_fields for all to authenticated
  using (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'))
  with check (public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin'));

drop policy if exists "deals bucket read" on storage.objects;
drop policy if exists "deals bucket write" on storage.objects;
drop policy if exists "deals bucket update" on storage.objects;
drop policy if exists "deals bucket delete" on storage.objects;

create policy "deals bucket read" on storage.objects for select to authenticated
  using (
    bucket_id = 'deals'
    and public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin')
  );
create policy "deals bucket write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deals'
    and public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin')
  );
create policy "deals bucket update" on storage.objects for update to authenticated
  using (
    bucket_id = 'deals'
    and public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin')
  );
create policy "deals bucket delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'deals'
    and public.current_role_of(auth.uid()) in ('admin','brokerage_user','developer_superadmin')
  );
