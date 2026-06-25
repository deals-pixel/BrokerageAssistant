alter table public.deal_pages
  add column if not exists page_role text,
  add column if not exists page_role_confidence public.field_confidence,
  add column if not exists extraction_skip_reason text;

alter table public.deal_pages
  drop constraint if exists deal_pages_page_role_check;

alter table public.deal_pages
  add constraint deal_pages_page_role_check
  check (
    page_role is null
    or page_role in (
      'data_entry_page',
      'signature_page',
      'standard_clause_page',
      'schedule_clause_page',
      'empty_or_instruction_page',
      'possible_data_page'
    )
  );

alter table public.deal_pages
  drop constraint if exists deal_pages_extraction_skip_reason_not_blank;

alter table public.deal_pages
  add constraint deal_pages_extraction_skip_reason_not_blank
  check (extraction_skip_reason is null or length(trim(extraction_skip_reason)) > 0);

create index if not exists deal_pages_page_role_idx
  on public.deal_pages (deal_id, page_role);
