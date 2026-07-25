alter table public.ebay_same_day_pilot_image_revisions
  drop constraint if exists ebay_same_day_image_revision_output_check;
alter table public.ebay_same_day_pilot_image_revisions
  add constraint ebay_same_day_image_revision_output_check check (
    ((status in ('PENDING_REVIEW','APPROVED','REJECTED')) and cardinality(asset_ids)=6 and jsonb_typeof(asset_manifest)='array' and jsonb_array_length(asset_manifest)=6 and image_set_hash ~ '^[0-9a-f]{64}$' and authorized_source_count between 1 and 3 and completed_at is not null)
    or ((status='READY_FOR_PREPARE' and strategy_version='VISUAL_STRATEGY_V3' and asset_ids is null and asset_manifest is null and image_set_hash is null and authorized_source_count=2 and completed_at is null)
    or (status <> 'READY_FOR_PREPARE' and status not in ('PENDING_REVIEW','APPROVED','REJECTED') and asset_ids is null and asset_manifest is null and image_set_hash is null and authorized_source_count=0 and completed_at is null))
  );
