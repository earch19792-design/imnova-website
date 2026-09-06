-- Extend the existing Phase B execution ledger for the account-wide Mayel
-- visual delegation and the Trading-managed, pictures-only executor. This is
-- not a second visual runtime. No execution rows are created by this migration.

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add column delegation_authority_id uuid null references
    public.ebay_mayel_visual_delegation_authorities_v1(id) on delete restrict,
  add column before_image_digest text null,
  add column proposed_image_digest text null,
  add column idempotency_binding_digest text null,
  add column media_preparation_route text null,
  add column media_image_id text null,
  add column media_eps_url text null,
  add column media_receipt_digest text null,
  add column media_preparation_write_count integer not null default 0;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  drop constraint ebay_mayel_visual_phase_b_digest_check,
  drop constraint ebay_mayel_visual_phase_b_management_check,
  drop constraint ebay_mayel_visual_phase_b_verified_check;

alter table public.ebay_mayel_visual_phase_b_executions_v1
  add constraint ebay_mayel_visual_phase_b_digest_check check (
    visual_manifest_digest ~ '^sha256:[0-9a-f]{64}$'
    and owner_authorization_digest ~ '^sha256:[0-9a-f]{64}$'
    and authorized_current_image_set_digest ~ '^sha256:[0-9a-f]{64}$'
    and management_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    and (
      (management_model = 'INVENTORY_API_MANAGED'
        and delegation_authority_id is null
        and owner_authorization_digest = visual_manifest_digest
        and before_image_digest is null
        and proposed_image_digest is null
        and idempotency_binding_digest is null)
      or
      (management_model = 'TRADING_MANAGED'
        and delegation_authority_id is not null
        and owner_approval_id = delegation_authority_id
        and before_image_digest = authorized_current_image_set_digest
        and proposed_image_digest ~ '^sha256:[0-9a-f]{64}$'
        and idempotency_binding_digest ~ '^sha256:[0-9a-f]{64}$')
    )
  ),
  add constraint ebay_mayel_visual_phase_b_management_check check (
    (management_model = 'INVENTORY_API_MANAGED'
      and executor =
        'EBAY_INVENTORY_CREATE_OR_REPLACE_INVENTORY_ITEM_IMAGE_ONLY_V1')
    or
    (management_model = 'TRADING_MANAGED'
      and executor =
        'EBAY_TRADING_REVISE_FIXED_PRICE_ITEM_PICTURE_DETAILS_ONLY_V1')
  ),
  add constraint ebay_mayel_visual_phase_b_media_check check (
    media_preparation_write_count between 0 and 1
    and (
      (management_model = 'INVENTORY_API_MANAGED'
        and media_preparation_write_count = 0
        and media_preparation_route is null
        and media_image_id is null
        and media_eps_url is null
        and media_receipt_digest is null)
      or
      (management_model = 'TRADING_MANAGED'
        and media_preparation_write_count = 1
        and media_preparation_route =
          'EBAY_MEDIA_CREATE_IMAGE_FROM_URL_GET_IMAGE_EPS_V1'
        and media_image_id ~ '^[A-Za-z0-9_-]{1,200}$'
        and media_eps_url ~ '^https://([A-Za-z0-9-]+\.)*ebayimg\.com/'
        and media_receipt_digest ~ '^sha256:[0-9a-f]{64}$')
    )
  ),
  add constraint ebay_mayel_visual_phase_b_verified_check check (
    phase <> 'APPLIED_AND_OFFICIALLY_VERIFIED' or (
      final_state = 'APPLIED_AND_OFFICIALLY_VERIFIED'
      and marketplace_write_count = 1
      and ebay_response_class = 'EBAY_WRITE_ACCEPTED'
      and postwrite_snapshot is not null
      and postwrite_snapshot ->> 'officialOrderedImageSetMatch' = 'true'
      and postwrite_snapshot ->> 'nonAuthorizedFieldsUnchanged' = 'true'
      and (
        (management_model = 'INVENTORY_API_MANAGED'
          and postwrite_snapshot ->> 'inventoryImagesMatch' = 'true')
        or
        (management_model = 'TRADING_MANAGED'
          and postwrite_snapshot ->> 'listingActive' = 'true'
          and postwrite_snapshot ->> 'mainImageUnchanged' = 'true'
          and postwrite_snapshot ->> 'mayelAssetPresent' = 'true'
          and postwrite_snapshot ->> 'afterImageCount' = '2'
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
      old.media_preparation_write_count then
    raise exception 'MAYEL_VISUAL_PHASE_B_AUTHORIZATION_SCOPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create unique index ebay_mayel_visual_phase_b_trading_binding_uidx
  on public.ebay_mayel_visual_phase_b_executions_v1(
    idempotency_binding_digest
  ) where management_model = 'TRADING_MANAGED';

create or replace function public.claim_ebay_mayel_trading_visual_write_v1(
  p_execution_id uuid,
  p_idempotency_binding_digest text,
  p_claim_token uuid,
  p_preflight_snapshot jsonb
)
returns setof public.ebay_mayel_visual_phase_b_executions_v1
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_execution_id is null or p_claim_token is null
    or p_idempotency_binding_digest !~ '^sha256:[0-9a-f]{64}$'
    or jsonb_typeof(p_preflight_snapshot) <> 'object'
    or p_preflight_snapshot ->> 'currentImageDigest'
      is distinct from p_preflight_snapshot ->> 'manifestBaselineDigest'
    or p_preflight_snapshot ->> 'visualOnlyDiff' <> 'true'
    or p_preflight_snapshot ->> 'unauthorizedFieldDiffCount' <> '0'
    or p_preflight_snapshot ->> 'listingActive' <> 'true' then
    raise exception 'MAYEL_TRADING_VISUAL_CLAIM_INPUT_INVALID';
  end if;

  return query
  update public.ebay_mayel_visual_phase_b_executions_v1 execution
  set phase = 'EXECUTING',
      marketplace_write_count = 1,
      claim_token = p_claim_token,
      lease_expires_at = now() + interval '60 seconds',
      preflight_snapshot = p_preflight_snapshot,
      write_attempt_at = now(),
      updated_at = now()
  where execution.id = p_execution_id
    and execution.management_model = 'TRADING_MANAGED'
    and execution.executor =
      'EBAY_TRADING_REVISE_FIXED_PRICE_ITEM_PICTURE_DETAILS_ONLY_V1'
    and execution.phase = 'PREFLIGHT'
    and execution.marketplace_write_count = 0
    and execution.claim_token is null
    and execution.idempotency_binding_digest =
      p_idempotency_binding_digest
    and execution.before_image_digest =
      p_preflight_snapshot ->> 'currentImageDigest'
  returning execution.*;
end;
$$;

revoke all on function public.claim_ebay_mayel_trading_visual_write_v1(
  uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.claim_ebay_mayel_trading_visual_write_v1(
  uuid, text, uuid, jsonb) to service_role;

comment on function public.claim_ebay_mayel_trading_visual_write_v1(
  uuid, text, uuid, jsonb) is
  'Atomic, single-flight claim for exactly one Trading ReviseFixedPriceItem image-only write. A missing row means the write must not be dispatched.';
comment on column public.ebay_mayel_visual_phase_b_executions_v1.media_preparation_write_count is
  'Counts Media API EPS ingestion separately from the single listing ReviseFixedPriceItem write.';

notify pgrst, 'reload schema';
