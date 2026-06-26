alter table public.ai_classification_cache
  add column if not exists cache_scope text not null default 'batch',
  add column if not exists prompt_signature text,
  add column if not exists page_hash text;

create index if not exists ai_classification_cache_page_lookup_idx
  on public.ai_classification_cache (cache_scope, model, prompt_signature, page_hash)
  where cache_scope = 'page' and page_hash is not null;
