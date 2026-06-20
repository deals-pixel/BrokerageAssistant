alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_layer_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_layer_check
  check (layer in ('light_routing', 'intake_analysis', 'classification', 'extraction'));
