alter table deal_fields
  add column conflict_sources jsonb;

alter table deal_fields
  add constraint deal_fields_conflict_sources_shape check (
    conflict_sources is null
    or jsonb_typeof(conflict_sources) = 'array'
  );
