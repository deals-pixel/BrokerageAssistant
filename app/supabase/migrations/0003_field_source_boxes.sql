alter table deal_fields
  add column source_box jsonb;

alter table deal_fields
  add constraint deal_fields_source_box_shape check (
    source_box is null
    or (
      jsonb_typeof(source_box) = 'object'
      and source_box ? 'x'
      and source_box ? 'y'
      and source_box ? 'width'
      and source_box ? 'height'
      and jsonb_typeof(source_box->'x') = 'number'
      and jsonb_typeof(source_box->'y') = 'number'
      and jsonb_typeof(source_box->'width') = 'number'
      and jsonb_typeof(source_box->'height') = 'number'
    )
  );
