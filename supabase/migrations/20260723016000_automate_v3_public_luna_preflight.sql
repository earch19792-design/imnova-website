-- Refresh the exact Luna product and variant from its public Shopify JSON
-- before the one-click V3 authorization. The public observation is bound to
-- the immutable seven-image transport and remains an internal, audited write.
-- Neither function in this migration calls or writes to eBay.

create or replace function public.record_ebay_v3_public_luna_preflight_v1(
  p_account_key text,
  p_actor uuid,
  p_listing_package_id uuid,
  p_candidate_id uuid,
  p_supplier_product_id text,
  p_supplier_variant_id text,
  p_supplier_sku text,
  p_supplier_price numeric,
  p_available boolean,
  p_observed_at timestamptz,
  p_observation_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_review public.ebay_reference_guided_final_listing_review_previews%rowtype;
  v_transport public.ebay_v3_publication_image_transports%rowtype;
  v_urls jsonb;
  v_manifest jsonb;
  v_asset_count integer;
  v_assets_valid boolean;
  v_roles text[] := array[
    'PRIMARY_MAIN',
    'SECONDARY_MATERIAL_DETAIL',
    'SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY',
    'SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE',
    'SECONDARY_HUMAN_CONTEXT'
  ];
  v_economics jsonb;
  v_confirmation jsonb;
  v_prior_price numeric;
begin
  if p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_listing_package_id is null
    or p_candidate_id is null
    or p_supplier_product_id !~ '^[0-9]{1,30}$'
    or p_supplier_variant_id !~ '^[0-9]{1,30}$'
    or nullif(trim(coalesce(p_supplier_sku, '')), '') is null
    or length(p_supplier_sku) > 120
    or p_supplier_price is null
    or p_supplier_price <= 0
    or p_supplier_price > 100000
    or p_available is distinct from true
    or p_observed_at < clock_timestamp() - interval '5 minutes'
    or p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_observation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_INPUT_INVALID';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = p_listing_package_id
    and package.account_key = p_account_key
    and package.created_by = p_actor
    and package.status in ('draft', 'ready_for_review', 'approved')
  for update;
  if not found then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_PACKAGE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.opportunity_id = v_package.opportunity_id
    and candidate.candidate_key = v_package.candidate_key
    and candidate.state = 'READY_FOR_MANUAL_PUBLICATION'
    and candidate.machine_state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID'
    )
    and cardinality(candidate.blockers) = 0
  for update;
  if not found then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_CANDIDATE_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id
    and run.marketplace_account_key = p_account_key
    and run.created_by = p_actor
  for share;
  if not found
    or v_package.package_data#>>'{sameDayPilot,runId}'
      is distinct from v_run.id::text
    or v_package.package_data#>>'{sameDayPilot,candidateId}'
      is distinct from v_candidate.id::text then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_RUN_INVALID';
  end if;

  select opportunity.* into v_opportunity
  from public.ebay_luna_opportunity_queue opportunity
  where opportunity.id = v_candidate.opportunity_id
    and opportunity.candidate_key = v_candidate.candidate_key
    and opportunity.supplier_product_id = p_supplier_product_id
    and opportunity.supplier_variant_id = p_supplier_variant_id
    and opportunity.supplier_sku = p_supplier_sku
  for update;
  if not found
    or v_candidate.supplier_variant_id is distinct from p_supplier_variant_id
    or v_candidate.supplier_sku is distinct from p_supplier_sku then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_IDENTITY_INVALID';
  end if;

  select review.* into v_review
  from public.ebay_reference_guided_final_listing_review_previews review
  where review.listing_package_id = v_package.id
    and review.created_by = p_actor
    and review.visual_phase = 'COMPLETED'
    and review.final_visual_set_locked
    and review.generation_controls_hidden
    and review.ready_for_unpublished_offer_authorization
    and review.provider_calls_snapshot = 8
    and cardinality(review.blockers) = 0
  order by review.created_at desc
  limit 1
  for share;
  if not found then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_REVIEW_INVALID';
  end if;

  select transport.* into v_transport
  from public.ebay_v3_publication_image_transports transport
  where transport.listing_package_id = v_package.id
    and transport.final_preview_id = v_review.id
    and transport.revision_id = v_review.revision_id
    and transport.attempt_id = v_review.attempt_id
    and transport.preview_hash = v_review.preview_hash
    and transport.status = 'READY'
    and transport.image_count = 7
    and transport.scope = 'EBAY_US_UNPUBLISHED_OFFER_ONLY'
    and transport.created_by = p_actor
  limit 1
  for share;
  if not found then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_TRANSPORT_INVALID';
  end if;

  select
    count(*),
    coalesce(bool_and(
      (asset->>'position') ~ '^[0-6]$'
      and (asset->>'sha256') ~ '^[0-9a-f]{64}$'
      and (asset->>'url') ~ '^https://'
      and asset->>'assetRole' = v_roles[
        ((asset->>'position')::integer) + 1
      ]
    ), false),
    jsonb_agg(asset->'url' order by (asset->>'position')::integer),
    jsonb_agg(asset order by (asset->>'position')::integer)
  into v_asset_count, v_assets_valid, v_urls, v_manifest
  from jsonb_array_elements(v_transport.assets) asset;
  if v_asset_count <> 7
    or not v_assets_valid
    or v_package.package_data->'imageUrls' is distinct from v_urls
    or v_package.package_data->'imageAssetManifest' is distinct from v_manifest
    or v_package.package_data#>>'{draftConfiguration,imageAuthorization,approved}'
      is distinct from 'true'
    or v_package.package_data
      #>>'{draftConfiguration,imageAuthorization,protectedManifestVerified}'
      is distinct from 'true' then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_IMAGE_AUTHORITY_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger execution
    where execution.listing_package_id = v_package.id
  ) or exists (
    select 1
    from public.ebay_authorized_listing_publications publication
    where publication.listing_package_id = v_package.id
  ) then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_EXECUTION_EXISTS';
  end if;

  v_economics := coalesce(v_candidate.economics_summary, '{}'::jsonb);
  if coalesce(v_economics->>'confirmedLunaPrice', '')
      !~ '^[0-9]+([.][0-9]{1,4})?$' then
    raise exception 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_PRIOR_COST_INVALID';
  end if;
  v_prior_price := (v_economics->>'confirmedLunaPrice')::numeric;
  if abs(v_prior_price - p_supplier_price) >= 0.005 then
    raise exception 'EBAY_V3_PUBLIC_LUNA_COST_CHANGED';
  end if;

  v_confirmation := coalesce(
    v_economics->'lunaConfirmation',
    '{}'::jsonb
  ) || jsonb_build_object(
    'status', 'AVAILABLE_QUANTITY_NOT_SHOWN',
    'confirmedUnitCost', p_supplier_price,
    'confirmedQuantity', null,
    'quantityVisible', false,
    'recheckAfterSale', true,
    'source', 'LUNA_PUBLIC_PRODUCT_JSON',
    'confirmedAt', p_observed_at,
    'confirmedByActorRecorded', false,
    'automatedPublicPreflight', true,
    'publicProductId', p_supplier_product_id,
    'publicVariantId', p_supplier_variant_id,
    'publicSku', p_supplier_sku,
    'observationHash', p_observation_hash,
    'publicationRecheck', true,
    'ebayConfirmedSupplierStock', false
  );
  v_economics := v_economics || jsonb_build_object(
    'confirmedLunaPrice', p_supplier_price,
    'available', true,
    'quantity', null,
    'quantityUnknown', true,
    'lunaConfirmation', v_confirmation
  );

  update public.ebay_same_day_pilot_candidates
  set economics_summary = v_economics,
      listing_quantity = 1,
      recheck_after_sale = true,
      updated_at = p_observed_at
  where id = v_candidate.id;

  update public.ebay_luna_opportunity_queue
  set supplier_available = true,
      supplier_inventory_quantity = 1,
      supplier_price = p_supplier_price,
      supplier_snapshot_at = p_observed_at,
      last_scanned_at = p_observed_at,
      queue_status = 'ready',
      updated_at = p_observed_at
  where id = v_opportunity.id;

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    ebay_read_calls,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    v_run.id,
    v_candidate.id,
    'V3_PUBLIC_LUNA_PREFLIGHT_OBSERVED',
    jsonb_build_object(
      'listingPackageId', v_package.id,
      'finalPreviewId', v_review.id,
      'imageTransportId', v_transport.id,
      'supplierProductId', p_supplier_product_id,
      'supplierVariantId', p_supplier_variant_id,
      'supplierSku', p_supplier_sku,
      'supplierPriceUnchanged', true,
      'available', true,
      'quantityScope', 'AVAILABILITY_ONLY',
      'source', 'LUNA_PUBLIC_PRODUCT_JSON',
      'observedAt', p_observed_at,
      'observationHash', p_observation_hash,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    'v3-public-luna-preflight:' || v_candidate.id::text || ':'
      || p_observation_hash,
    0,
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'candidateId', v_candidate.id,
    'listingPackageId', v_package.id,
    'source', 'LUNA_PUBLIC_PRODUCT_JSON',
    'observedAt', p_observed_at,
    'supplierPriceUnchanged', true,
    'available', true,
    'quantityScope', 'AVAILABILITY_ONLY',
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.record_ebay_v3_public_luna_preflight_v1(
  text, uuid, uuid, uuid, text, text, text, numeric, boolean, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_ebay_v3_public_luna_preflight_v1(
  text, uuid, uuid, uuid, text, text, text, numeric, boolean, timestamptz, text
) to service_role;

-- Final source synchronization for a completed V3 Inventory Item + Offer.
-- The legacy six-image synchronization remains unchanged for legacy packages.
create or replace function public.sync_ebay_v3_source_before_authorized_publication(
  p_draft_execution_id uuid,
  p_actor_user_id uuid,
  p_marketplace_account_key text
)
returns setof public.ebay_luna_opportunity_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_transport public.ebay_v3_publication_image_transports%rowtype;
  v_binding jsonb;
  v_same_day_authorization jsonb;
  v_confirmation jsonb;
  v_latest_price numeric;
  v_latest_available boolean;
  v_latest_quantity numeric;
  v_latest_observed_at timestamptz;
  v_confirmed_observed_at timestamptz;
  v_source_observed_at timestamptz;
  v_source_price numeric;
  v_source_quantity integer;
  v_source_kind text;
  v_approved_source_price numeric;
  v_urls jsonb;
  v_asset_count integer;
  v_assets_valid boolean;
  v_roles text[] := array[
    'PRIMARY_MAIN',
    'SECONDARY_MATERIAL_DETAIL',
    'SECONDARY_PACKAGE_CONTENTS',
    'SECONDARY_SCALE_CAPACITY',
    'SECONDARY_USE_CONTEXT',
    'SECONDARY_ASPIRATIONAL_LIFESTYLE',
    'SECONDARY_HUMAN_CONTEXT'
  ];
begin
  if p_draft_execution_id is null
    or p_actor_user_id is null
    or p_marketplace_account_key
      !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_V3_SOURCE_SYNC_INPUT_INVALID';
  end if;

  select execution.* into v_execution
  from public.ebay_draft_only_execution_ledger execution
  where execution.id = p_draft_execution_id
    and execution.actor_user_id = p_actor_user_id
    and execution.phase = 'completed'
    and execution.target = 'PRODUCTION'
  for key share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_EXECUTION_INVALID';
  end if;

  select approval.* into v_approval
  from public.ebay_draft_only_approvals approval
  where approval.id = v_execution.approval_id
    and approval.actor_user_id = p_actor_user_id
    and approval.status = 'consumed'
    and approval.consumed_at is not null
    and approval.payload_hash = v_execution.request_hash
  for key share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_APPROVAL_INVALID';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = v_execution.listing_package_id
    and package.created_by = p_actor_user_id
    and package.account_key = p_marketplace_account_key
    and package.status = 'approved'
  for key share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_PACKAGE_INVALID';
  end if;

  v_binding := v_approval.approved_payload
    #> '{compliance,v3FinalSetAuthorization}';
  v_same_day_authorization := v_approval.approved_payload
    #> '{compliance,sameDayPilotAuthorization}';
  if jsonb_typeof(v_binding) <> 'object'
    or coalesce(v_binding->>'imageTransportId', '')
      !~ '^[0-9a-f-]{36}$'
    or coalesce(v_binding->>'finalPreviewHash', '')
      !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_same_day_authorization) <> 'object'
    or v_same_day_authorization->>'validated' is distinct from 'true'
    or v_same_day_authorization->>'listingPackageId'
      is distinct from v_package.id::text
    or v_same_day_authorization->>'finalHumanAuthorizationRequired'
      is distinct from 'true'
    or v_same_day_authorization->>'unattendedPublicationAllowed'
      is distinct from 'false' then
    raise exception 'EBAY_V3_SOURCE_SYNC_BINDING_INVALID';
  end if;

  select transport.* into v_transport
  from public.ebay_v3_publication_image_transports transport
  where transport.id = (v_binding->>'imageTransportId')::uuid
    and transport.listing_package_id = v_package.id
    and transport.preview_hash = v_binding->>'finalPreviewHash'
    and transport.transport_hash = v_binding->>'imageTransportHash'
    and transport.status = 'READY'
    and transport.image_count = 7
    and transport.scope = 'EBAY_US_UNPUBLISHED_OFFER_ONLY'
    and transport.created_by = p_actor_user_id
  for share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_TRANSPORT_INVALID';
  end if;

  select
    count(*),
    coalesce(bool_and(
      (asset->>'position') ~ '^[0-6]$'
      and (asset->>'sha256') ~ '^[0-9a-f]{64}$'
      and (asset->>'url') ~ '^https://'
      and asset->>'assetRole' = v_roles[
        ((asset->>'position')::integer) + 1
      ]
    ), false),
    jsonb_agg(asset->'url' order by (asset->>'position')::integer)
  into v_asset_count, v_assets_valid, v_urls
  from jsonb_array_elements(v_transport.assets) asset;
  if v_asset_count <> 7
    or not v_assets_valid
    or v_package.package_data->'imageUrls' is distinct from v_urls then
    raise exception 'EBAY_V3_SOURCE_SYNC_IMAGE_BINDING_INVALID';
  end if;

  select opportunity.* into v_opportunity
  from public.ebay_luna_opportunity_queue opportunity
  where opportunity.id = v_execution.opportunity_id
    and opportunity.id = v_package.opportunity_id
    and opportunity.candidate_key = v_approval.candidate_key
  for update;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_OPPORTUNITY_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id::text = v_same_day_authorization->>'candidateId'
    and candidate.run_id::text = v_same_day_authorization->>'runId'
    and candidate.opportunity_id = v_opportunity.id
    and candidate.candidate_key = v_opportunity.candidate_key
    and candidate.state = 'READY_FOR_MANUAL_PUBLICATION'
    and candidate.machine_state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID'
    )
    and cardinality(candidate.blockers) = 0
  for key share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_CANDIDATE_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id
    and run.marketplace_account_key = p_marketplace_account_key
    and run.created_by = p_actor_user_id
  for share;
  if not found then
    raise exception 'EBAY_V3_SOURCE_SYNC_RUN_INVALID';
  end if;

  select
    variant.price,
    variant.available,
    variant.inventory_quantity,
    variant.captured_at
  into
    v_latest_price,
    v_latest_available,
    v_latest_quantity,
    v_latest_observed_at
  from public.market_radar_latest_variants variant
  where variant.source_key = 'lunaportex'
    and variant.product_id = v_opportunity.market_radar_product_id
    and variant.supplier_variant_id = v_candidate.supplier_variant_id
  order by variant.captured_at desc
  limit 1;

  v_confirmation := v_candidate.economics_summary->'lunaConfirmation';
  if coalesce(v_confirmation->>'confirmedAt', '')
      ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
    v_confirmed_observed_at :=
      (v_confirmation->>'confirmedAt')::timestamptz;
  end if;

  if v_latest_observed_at is not null
    and (
      v_confirmed_observed_at is null
      or v_latest_observed_at >= v_confirmed_observed_at
    ) then
    if v_latest_available is distinct from true
      or coalesce(v_latest_price, 0) <= 0 then
      raise exception 'EBAY_V3_SOURCE_SYNC_LUNA_UNAVAILABLE';
    end if;
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      else 1
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  else
    if v_confirmation->>'status' not in (
        'AVAILABLE_QUANTITY_NOT_SHOWN',
        'AVAILABLE_EXACT_QUANTITY'
      )
      or v_confirmation->>'source' not in (
        'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE',
        'LUNA_PUBLIC_PRODUCT_JSON'
      )
      or (
        v_confirmation->>'source' = 'LUNA_PUBLIC_PRODUCT_JSON'
        and (
          v_confirmation->>'automatedPublicPreflight'
            is distinct from 'true'
          or v_confirmation->>'confirmedByActorRecorded'
            is distinct from 'false'
          or coalesce(v_confirmation->>'observationHash', '')
            !~ '^[0-9a-f]{64}$'
          or v_confirmation->>'publicVariantId'
            is distinct from v_candidate.supplier_variant_id
          or v_confirmation->>'publicSku'
            is distinct from v_candidate.supplier_sku
        )
      )
      or coalesce(
        v_candidate.economics_summary->>'confirmedLunaPrice',
        ''
      ) !~ '^[0-9]+([.][0-9]{1,4})?$' then
      raise exception 'EBAY_V3_SOURCE_SYNC_LUNA_CONFIRMATION_INVALID';
    end if;
    v_source_observed_at := v_confirmed_observed_at;
    v_source_price :=
      (v_candidate.economics_summary->>'confirmedLunaPrice')::numeric;
    v_source_quantity := case
      when v_confirmation->>'quantityVisible' = 'true'
        and coalesce(v_confirmation->>'confirmedQuantity', '')
          ~ '^[0-9]+$'
        then (v_confirmation->>'confirmedQuantity')::integer
      else 1
    end;
    v_source_kind := v_confirmation->>'source';
  end if;

  if v_source_observed_at is null
    or v_source_observed_at < clock_timestamp() - interval '6 hours'
    or v_source_observed_at > clock_timestamp() + interval '5 minutes'
    or v_source_price <= 0
    or v_source_quantity < 1
    or coalesce(
      v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}',
      ''
    ) !~ '^[0-9]+([.][0-9]{1,4})?$' then
    raise exception 'EBAY_V3_SOURCE_SYNC_LUNA_RECHECK_REQUIRED';
  end if;
  v_approved_source_price :=
    (v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}')::numeric;
  if abs(v_approved_source_price - v_source_price) >= 0.005 then
    raise exception 'EBAY_V3_SOURCE_SYNC_LUNA_COST_CHANGED';
  end if;

  update public.ebay_luna_opportunity_queue opportunity
  set supplier_available = true,
      supplier_inventory_quantity = v_source_quantity,
      supplier_price = v_source_price,
      supplier_snapshot_at = v_source_observed_at,
      last_scanned_at = greatest(
        coalesce(opportunity.last_scanned_at, v_source_observed_at),
        v_source_observed_at
      ),
      queue_status = 'ready',
      assessment = jsonb_set(
        coalesce(opportunity.assessment, '{}'::jsonb),
        '{v3SellerOsPublication}',
        jsonb_build_object(
          'version', 'EBAY_V3_PUBLIC_LUNA_PREFLIGHT_V1',
          'candidateId', v_candidate.id,
          'runId', v_candidate.run_id,
          'listingPackageId', v_package.id,
          'source', v_source_kind,
          'sourceObservedAt', v_source_observed_at,
          'synchronizedAt', clock_timestamp(),
          'ebayWrites', 0,
          'finalHumanAuthorizationRequired', true
        ),
        true
      ),
      updated_at = clock_timestamp()
  where opportunity.id = v_opportunity.id
  returning opportunity.* into v_opportunity;

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    ebay_read_calls,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    v_candidate.run_id,
    v_candidate.id,
    'V3_SELLER_OS_PUBLICATION_SOURCE_SYNCHRONIZED',
    jsonb_build_object(
      'listingPackageId', v_package.id,
      'imageTransportId', v_transport.id,
      'source', v_source_kind,
      'sourceObservedAt', v_source_observed_at,
      'quantity', v_source_quantity,
      'ebayWrites', 0
    ),
    'v3-seller-os-publication-source:'
      || v_execution.id::text || ':'
      || extract(epoch from v_source_observed_at)::bigint::text,
    0,
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return next v_opportunity;
end;
$$;

revoke all on function
  public.sync_ebay_v3_source_before_authorized_publication(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.sync_ebay_v3_source_before_authorized_publication(uuid, uuid, text)
to service_role;

comment on function public.record_ebay_v3_public_luna_preflight_v1(
  text, uuid, uuid, uuid, text, text, text, numeric, boolean, timestamptz, text
) is 'Records an exact public Luna product/variant observation before V3 human authorization; performs zero eBay writes.';

comment on function
  public.sync_ebay_v3_source_before_authorized_publication(uuid, uuid, text)
is 'Synchronizes the approval-bound public Luna source for a completed V3 unpublished offer; performs zero eBay writes.';

notify pgrst, 'reload schema';
