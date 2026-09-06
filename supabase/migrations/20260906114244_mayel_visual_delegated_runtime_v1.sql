-- Generalize the certified Trading pictures-only ledger from the historical
-- one-asset canary to an ordered delegated gallery. This migration does not
-- create an execution and performs no marketplace operation.

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add column if not exists media_assets jsonb not null default '[]'::jsonb;

update public.ebay_mayel_visual_phase_b_executions_v1
set media_assets = jsonb_build_array(jsonb_build_object(
  'assetId', canonical_asset_ids ->> 0,
  'assetSha256', canonical_asset_sha256s ->> 0,
  'imageId', media_image_id,
  'epsImageUrl', media_eps_url,
  'mediaReceiptDigest', media_receipt_digest,
  'reused', media_preparation_write_count = 0
))
where management_model = 'TRADING_MANAGED'
  and jsonb_array_length(media_assets) = 0;

create or replace function public.is_mayel_trading_media_asset_set_v1(
  p_assets jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_typeof(p_assets) = 'array'
    and jsonb_array_length(p_assets) between 1 and 24
    and (
      select count(distinct value ->> 'assetId') = jsonb_array_length(p_assets)
      from jsonb_array_elements(p_assets)
    )
    and not exists (
      select 1
      from jsonb_array_elements(p_assets) asset(value)
      where jsonb_typeof(asset.value) <> 'object'
        or coalesce(asset.value ->> 'assetId', '') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(asset.value ->> 'assetSha256', '') !~ '^[0-9a-f]{64}$'
        or coalesce(asset.value ->> 'imageId', '') !~ '^[A-Za-z0-9_-]{1,200}$'
        or coalesce(asset.value ->> 'epsImageUrl', '') !~
          '^https://([A-Za-z0-9-]+\.)*ebayimg\.com/'
        or coalesce(asset.value ->> 'mediaReceiptDigest', '') !~ '^sha256:[0-9a-f]{64}$'
        or jsonb_typeof(asset.value -> 'reused') <> 'boolean'
    );
$$;

revoke all on function public.is_mayel_trading_media_asset_set_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_mayel_trading_media_asset_set_v1(jsonb)
  to service_role;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  drop constraint ebay_mayel_visual_phase_b_media_check,
  drop constraint ebay_mayel_visual_phase_b_verified_check;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add constraint ebay_mayel_visual_phase_b_media_check check (
    media_preparation_write_count between 0 and 24
    and (
      (management_model = 'INVENTORY_API_MANAGED'
        and media_preparation_write_count = 0
        and media_preparation_route is null
        and media_image_id is null
        and media_eps_url is null
        and media_receipt_digest is null
        and media_assets = '[]'::jsonb)
      or
      (management_model = 'TRADING_MANAGED'
        and media_preparation_route =
          'EBAY_MEDIA_CREATE_IMAGE_FROM_URL_GET_IMAGE_EPS_V1'
        and media_image_id ~ '^[A-Za-z0-9_-]{1,200}$'
        and media_eps_url ~ '^https://([A-Za-z0-9-]+\.)*ebayimg\.com/'
        and media_receipt_digest ~ '^sha256:[0-9a-f]{64}$'
        and public.is_mayel_trading_media_asset_set_v1(media_assets)
        and media_preparation_write_count <= jsonb_array_length(media_assets))
    )
  ),
  add constraint ebay_mayel_visual_phase_b_verified_check check (
    phase <> 'APPLIED_AND_OFFICIALLY_VERIFIED' or (
      final_state = 'APPLIED_AND_OFFICIALLY_VERIFIED'
      and marketplace_write_count = 1
      and ebay_response_class in (
        'EBAY_WRITE_ACCEPTED',
        'EBAY_WRITE_CONFIRMED_BY_OFFICIAL_READBACK'
      )
      and postwrite_snapshot is not null
      and postwrite_snapshot ->> 'officialOrderedImageSetMatch' = 'true'
      and postwrite_snapshot ->> 'nonAuthorizedFieldsUnchanged' = 'true'
      and (
        (management_model = 'INVENTORY_API_MANAGED'
          and postwrite_snapshot ->> 'inventoryImagesMatch' = 'true')
        or
        (management_model = 'TRADING_MANAGED'
          and postwrite_snapshot ->> 'listingActive' = 'true'
          and coalesce(postwrite_snapshot ->> 'heroPositionMatch',
            postwrite_snapshot ->> 'mainImageUnchanged') = 'true'
          and coalesce(postwrite_snapshot ->> 'approvedAssetsPresent',
            postwrite_snapshot ->> 'mayelAssetPresent') = 'true'
          and (postwrite_snapshot ->> 'afterImageCount')::integer
            = jsonb_array_length(proposed_final_ordered_image_urls)
          and postwrite_snapshot ->> 'unauthorizedFieldDiffCount' = '0')
      )
      and applied_verified_at is not null
    )
  );

create or replace function public.enforce_ebay_mayel_visual_phase_b_scope_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.owner_approval_id is distinct from old.owner_approval_id
    or new.visual_task_id is distinct from old.visual_task_id
    or new.visual_manifest_id is distinct from old.visual_manifest_id
    or new.active_listing_id is distinct from old.active_listing_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.owner_user_id is distinct from old.owner_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.marketplace_id is distinct from old.marketplace_id
    or new.ebay_item_id is distinct from old.ebay_item_id
    or new.ebay_sku is distinct from old.ebay_sku
    or new.visual_manifest_digest is distinct from old.visual_manifest_digest
    or new.owner_authorization_digest is distinct from
      old.owner_authorization_digest
    or new.authorized_current_image_set_digest is distinct from
      old.authorized_current_image_set_digest
    or new.proposed_final_ordered_image_urls is distinct from
      old.proposed_final_ordered_image_urls
    or new.main_image_url is distinct from old.main_image_url
    or new.canonical_asset_ids is distinct from old.canonical_asset_ids
    or new.canonical_asset_sha256s is distinct from
      old.canonical_asset_sha256s
    or new.management_model is distinct from old.management_model
    or new.management_evidence_digest is distinct from
      old.management_evidence_digest
    or new.executor is distinct from old.executor
    or new.owner_approved_at is distinct from old.owner_approved_at
    or new.created_at is distinct from old.created_at
    or new.delegation_authority_id is distinct from
      old.delegation_authority_id
    or new.before_image_digest is distinct from old.before_image_digest
    or new.proposed_image_digest is distinct from old.proposed_image_digest
    or new.idempotency_binding_digest is distinct from
      old.idempotency_binding_digest
    or new.media_preparation_route is distinct from
      old.media_preparation_route
    or new.media_image_id is distinct from old.media_image_id
    or new.media_eps_url is distinct from old.media_eps_url
    or new.media_receipt_digest is distinct from old.media_receipt_digest
    or new.media_preparation_write_count is distinct from
      old.media_preparation_write_count
    or new.media_assets is distinct from old.media_assets then
    raise exception 'MAYEL_VISUAL_PHASE_B_AUTHORIZATION_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

comment on column public.ebay_mayel_visual_phase_b_executions_v1.media_assets is
  'Exact durable Mayel asset-to-EPS lineage for the authorized ordered gallery. Reused EPS receipts perform no duplicate Media write.';

notify pgrst, 'reload schema';
