alter table deal_pages
  add column standard_form_key text,
  add column standard_form_number text,
  add column standard_form_title text,
  add column standard_form_confidence field_confidence;

alter table deal_pages
  add constraint deal_pages_standard_form_key_not_blank check (
    standard_form_key is null or length(trim(standard_form_key)) > 0
  ),
  add constraint deal_pages_standard_form_number_not_blank check (
    standard_form_number is null or length(trim(standard_form_number)) > 0
  ),
  add constraint deal_pages_standard_form_title_not_blank check (
    standard_form_title is null or length(trim(standard_form_title)) > 0
  );

create index deal_pages_deal_standard_form_idx
  on deal_pages (deal_id, standard_form_key)
  where standard_form_key is not null;
