create or replace function public.prepare_ebay_active_listing_image_revision(
  p_revision_id uuid,
  p_base_control_id uuid,
  p_actor uuid,
  p_account_key text,
  p_ebay_item_id text,
  p_idempotency_key_hash text
)
returns setof public.ebay_active_listing_image_revision_executions
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_revision public.ebay_same_day_pilot_image_revisions%rowtype;
  v_base public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_link public.ebay_manual_listing_links%rowtype;
  v_active public.ebay_active_listings%rowtype;
  v_execution public.ebay_active_listing_image_revision_executions%rowtype;
  v_urls jsonb;
  v_asset_count integer;
  v_request_hash text;
begin
  if p_revision_id is null or p_base_control_id is null or p_actor is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_ebay_item_id !~ '^[0-9]{9,20}$'
    or p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_PREPARE_INVALID';
  end if;

  select * into v_revision
  from public.ebay_same_day_pilot_image_revisions
  where id = p_revision_id
  for key share;
  if not found
    or v_revision.base_control_id is distinct from p_base_control_id
    or v_revision.marketplace_account_key is distinct from p_account_key
    or v_revision.created_by is distinct from p_actor
    or v_revision.reviewed_by is distinct from p_actor
    or v_revision.status <> 'APPROVED'
    or v_revision.human_decision <> 'APPROVED'
    or v_revision.revision_version <> 'EBAY_LISTING_IMAGE_REVISION_V1'
    or v_revision.ebay_writes <> 0
    or v_revision.production_changed is distinct from false then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_APPROVED_REVISION_REQUIRED';
  end if;

  select * into v_base
  from public.ebay_same_day_pilot_image_package_runs
  where id = p_base_control_id
  for key share;
  if not found
    or v_base.marketplace_account_key is distinct from p_account_key
    or v_base.created_by is distinct from p_actor
    or v_base.status <> 'APPROVED'
    or v_base.human_decision <> 'APPROVED'
    or v_base.run_id is distinct from v_revision.run_id
    or v_base.candidate_id is distinct from v_revision.candidate_id
    or v_base.listing_package_id is distinct from v_revision.listing_package_id
    or v_base.fact_run_id is distinct from v_revision.fact_run_id then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_BASE_CONTROL_MISMATCH';
  end if;

  select jsonb_agg(to_jsonb(asset.public_url) order by manifest.ordinality),
         count(*)
  into v_urls, v_asset_count
  from jsonb_array_elements(v_revision.asset_manifest)
    with ordinality manifest(value, ordinality)
  join public.ebay_listing_image_assets asset
    on asset.id = (manifest.value->>'assetId')::uuid
  where asset.id = any(v_revision.asset_ids)
    and asset.account_key = p_account_key
    and asset.created_by = p_actor
    and asset.listing_package_id = v_revision.listing_package_id
    and asset.status = 'approved'
    and asset.output_sha256 = manifest.value->>'outputSha256';
  if v_asset_count <> 6
    or not public.is_exact_six_ebay_revision_urls(v_urls) then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_EXACT_SIX_APPROVED_REQUIRED';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = v_revision.listing_package_id
    and account_key = p_account_key
    and created_by = p_actor
  for key share;
  if not found or v_package.status = 'archived'
    or v_package.package_data->>'preferredImageRevisionId' <> p_revision_id::text
    or v_package.package_data->'imageUrls' is distinct from v_urls then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_PACKAGE_PROJECTION_MISMATCH';
  end if;

  select link.* into v_link
  from public.ebay_manual_listing_links link
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.id = v_revision.candidate_id
    and link.opportunity_id = candidate.opportunity_id
    and link.candidate_key = candidate.candidate_key
  where link.account_key = p_account_key
    and link.ebay_item_id = p_ebay_item_id
  limit 1;
  if not found
    or v_link.verification_status <> 'verified'
    or v_link.verification_method <> 'EBAY_TRADING_GET_ITEM_READONLY'
    or v_link.connector_listing_status <> 'active'
    or v_link.connector_listing_id is null
    or v_link.connector_ebay_sku is null
    or v_link.created_by is distinct from p_actor then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_VERIFIED_LINK_REQUIRED';
  end if;

  select * into v_active
  from public.ebay_active_listings
  where id = v_link.connector_listing_id
    and account_key = p_account_key
    and ebay_item_id = p_ebay_item_id
  for key share;
  if not found or v_active.listing_status <> 'active'
    or v_active.ebay_sku is distinct from v_link.connector_ebay_sku then
    raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ACTIVE_LISTING_REQUIRED';
  end if;

  v_request_hash := encode(digest(convert_to(concat_ws('|',
    'EBAY_ACTIVE_LISTING_IMAGE_REVISION_V1', p_revision_id::text,
    p_base_control_id::text, v_revision.listing_package_id::text,
    v_link.id::text, v_active.id::text, p_account_key, p_ebay_item_id,
    v_active.ebay_sku, v_revision.image_set_hash, v_urls::text
  ), 'UTF8'), 'sha256'), 'hex');

  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where idempotency_key_hash = p_idempotency_key_hash
  for update;
  if found then
    if v_execution.revision_id is distinct from p_revision_id
      or v_execution.base_control_id is distinct from p_base_control_id
      or v_execution.actor_user_id is distinct from p_actor
      or v_execution.marketplace_account_key is distinct from p_account_key
      or v_execution.ebay_item_id is distinct from p_ebay_item_id
      or v_execution.request_hash is distinct from v_request_hash then
      raise exception 'EBAY_ACTIVE_IMAGE_REVISION_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_execution;
    return;
  end if;

  select * into v_execution
  from public.ebay_active_listing_image_revision_executions
  where revision_id = p_revision_id
  for update;
  if found then
    if v_execution.base_control_id is distinct from p_base_control_id
      or v_execution.actor_user_id is distinct from p_actor
      or v_execution.marketplace_account_key is distinct from p_account_key
      or v_execution.ebay_item_id is distinct from p_ebay_item_id
      or v_execution.request_hash is distinct from v_request_hash then
      raise exception 'EBAY_ACTIVE_IMAGE_REVISION_ALREADY_BOUND';
    end if;
    return next v_execution;
    return;
  end if;

  insert into public.ebay_active_listing_image_revision_executions (
    revision_id, base_control_id, listing_package_id, candidate_id,
    opportunity_id, manual_listing_link_id, active_listing_id, actor_user_id,
    marketplace_account_key, account_fingerprint, ebay_item_id, ebay_sku,
    image_set_hash, image_urls, request_hash, idempotency_key_hash
  ) values (
    v_revision.id, v_base.id, v_package.id, v_revision.candidate_id,
    v_link.opportunity_id, v_link.id, v_active.id, p_actor,
    p_account_key, right(p_account_key, 64), p_ebay_item_id, v_active.ebay_sku,
    v_revision.image_set_hash, v_urls, v_request_hash, p_idempotency_key_hash
  ) returning * into v_execution;
  return next v_execution;
end;
$$;

comment on function public.prepare_ebay_active_listing_image_revision(
  uuid, uuid, uuid, text, text, text
) is 'Prepares or safely resumes the exact bound ACTIVE image execution without depending on browser session storage.';
