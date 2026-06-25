create table if not exists public.ai_classification_cache (
  cache_key text primary key,
  model text not null,
  page_hashes text[] not null,
  classification_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_classification_cache_updated_at_idx
  on public.ai_classification_cache (updated_at desc);

drop trigger if exists ai_classification_cache_updated_at on public.ai_classification_cache;
create trigger ai_classification_cache_updated_at before update on public.ai_classification_cache
  for each row execute function public.set_updated_at();

alter table public.ai_classification_cache enable row level security;

drop policy if exists "ai classification cache read" on public.ai_classification_cache;
create policy "ai classification cache read" on public.ai_classification_cache
  for select to authenticated using (true);

drop policy if exists "ai classification cache write" on public.ai_classification_cache;
create policy "ai classification cache write" on public.ai_classification_cache
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table public.ai_classification_cache to authenticated, service_role;

update public.deal_pages
set standard_form_key = case
  when standard_form_key = 'form_120_123_124_sale_conditions' and standard_form_number ~ '120' then 'form_120_sale_amendment'
  when standard_form_key = 'form_120_123_124_sale_conditions' and standard_form_number ~ '123' then 'form_123_sale_waiver'
  when standard_form_key = 'form_120_123_124_sale_conditions' and standard_form_number ~ '124' then 'form_124_notice_fulfillment'
  when standard_form_key = 'forms_271_272_593_listing' and standard_form_number ~ '271' then 'form_271_seller_designated_rep'
  when standard_form_key = 'forms_271_272_593_listing' and standard_form_number ~ '272' then 'form_272_landlord_designated_rep'
  when standard_form_key = 'forms_271_272_593_listing' and standard_form_number ~ '593' then 'form_593_listing_agreement'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '320' then 'form_320_confirmation'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '324' then 'form_324_confirmation'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '325' then 'form_325_multiple_representation_consent'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '326' then 'form_326_multiple_representation_consent'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '327' then 'form_327_confirmation'
  when standard_form_key = 'forms_320_324_325_326_327_328_confirmation' and standard_form_number ~ '328' then 'form_328_confirmation'
  when standard_form_key = 'forms_400_401_403_404_420_lease' and standard_form_number ~ '400' then 'form_400_agreement_to_lease'
  when standard_form_key = 'forms_400_401_403_404_420_lease' and standard_form_number ~ '401' then 'form_401_agreement_to_lease'
  when standard_form_key = 'forms_400_401_403_404_420_lease' and standard_form_number ~ '403' then 'form_403_lease_amendment'
  when standard_form_key = 'forms_400_401_403_404_420_lease' and standard_form_number ~ '404' then 'form_404_lease_waiver'
  when standard_form_key = 'forms_400_401_403_404_420_lease' and standard_form_number ~ '420' then 'form_420_lease_notice_fulfillment'
  else standard_form_key
end
where standard_form_key in (
  'form_120_123_124_sale_conditions',
  'forms_271_272_593_listing',
  'forms_320_324_325_326_327_328_confirmation',
  'forms_400_401_403_404_420_lease'
);
