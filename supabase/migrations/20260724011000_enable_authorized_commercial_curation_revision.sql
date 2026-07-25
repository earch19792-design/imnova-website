-- Repair the append-only image-revision path for the current seven-image
-- contract and permit up to five independently authorized catalog views.
-- Existing approved image controls and revisions are immutable. This migration
-- performs no provider, eBay, or Production write.

do $migration$
declare
  v_definition text;
  v_old text :=
    'and cardinality(control.asset_ids) = 6';
  v_new text :=
    'and cardinality(control.asset_ids) in (6, 7)';
begin
  select pg_get_functiondef(
    'public.claim_ebay_same_day_pilot_image_revision(text,uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'COMMERCIAL_CURATION_REVISION_CLAIM_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text := $old$  ) <> 6 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_EVIDENCE_INVALID';$old$;
  v_new text := $new$  ) <> 7 then
    raise exception 'SAME_DAY_IMAGE_REVISION_ASSET_EVIDENCE_INVALID';$new$;
begin
  select pg_get_functiondef(
    'public.create_ebay_same_day_image_revision_asset_set(uuid,text,uuid,uuid,uuid,text,jsonb)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'COMMERCIAL_CURATION_REVISION_ASSET_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old text :=
    'v_source_count not between 1 and 3';
  v_new text :=
    'v_source_count not between 1 and 5';
begin
  select pg_get_functiondef(
    'public.complete_ebay_same_day_image_revision(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'COMMERCIAL_CURATION_REVISION_SOURCE_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;

alter table public.ebay_same_day_pilot_image_revisions
  drop constraint if exists ebay_same_day_image_revision_output_check;
alter table public.ebay_same_day_pilot_image_revisions
  add constraint ebay_same_day_image_revision_output_check check (
    (
      status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and cardinality(asset_ids) in (6, 7)
      and jsonb_typeof(asset_manifest) = 'array'
      and jsonb_array_length(asset_manifest) = cardinality(asset_ids)
      and image_set_hash ~ '^[0-9a-f]{64}$'
      and authorized_source_count between 1 and 5
      and completed_at is not null
    )
    or (
      status = 'READY_FOR_PREPARE'
      and strategy_version = 'VISUAL_STRATEGY_V3'
      and asset_ids is null
      and asset_manifest is null
      and image_set_hash is null
      and authorized_source_count = 2
      and completed_at is null
    )
    or (
      status <> 'READY_FOR_PREPARE'
      and status not in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and asset_ids is null
      and asset_manifest is null
      and image_set_hash is null
      and authorized_source_count = 0
      and completed_at is null
    )
  ) not valid;
alter table public.ebay_same_day_pilot_image_revisions
  validate constraint ebay_same_day_image_revision_output_check;

comment on function public.claim_ebay_same_day_pilot_image_revision(
  text, uuid, uuid, text, uuid
) is
  'Claims an append-only image revision from an approved six- or seven-image '
  'base control; it performs zero eBay writes.';

comment on function public.create_ebay_same_day_image_revision_asset_set(
  uuid, text, uuid, uuid, uuid, text, jsonb
) is
  'Creates an exact seven-image append-only revision with seven distinct '
  'slots, layouts, and output hashes.';

comment on function public.complete_ebay_same_day_image_revision(
  uuid, uuid, uuid, uuid[], jsonb
) is
  'Completes an exact seven-image revision backed by one to five authorized '
  'catalog views; competitor pixels and eBay writes remain forbidden.';
