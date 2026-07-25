-- Harden source synchronization right before final listing publication so a valid and
-- recent operator reconfirmation can proceed without forcing unnecessary rechecks.
-- This keeps the one-shot write path unchanged (no eBay/Production writes) and
-- preserves current image/asset and approval binding guarantees.

create or replace function public.sync_same_day_source_before_authorized_publication(
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
  v_latest_price numeric;
  v_latest_available boolean;
  v_latest_quantity numeric;
  v_latest_observed_at timestamptz;
  v_same_day_authorization jsonb;
  v_handoff_summary jsonb;
  v_handoff jsonb;
  v_image_summary jsonb;
  v_luna_confirmation jsonb;
  v_operator_observed_at timestamptz;
  v_operator_recheck_valid boolean;
  v_latest_evidence_usable boolean;
  v_source_observed_at timestamptz;
  v_source_price numeric;
  v_source_quantity integer;
  v_source_kind text;
  v_approved_source_price numeric;
  v_operator_price numeric;
  v_operator_quantity integer;
  v_luna_confirmation_status text;
  v_luna_confirmation_source text;
  v_quantity_visible boolean;
  v_quantity_text text;
begin
  if p_draft_execution_id is null
    or p_actor_user_id is null
    or p_marketplace_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_SOURCE_INPUT_INVALID';
  end if;

  select * into v_execution
  from public.ebay_draft_only_execution_ledger
  where id = p_draft_execution_id
    and actor_user_id = p_actor_user_id
    and phase = 'completed'
    and target = 'PRODUCTION'
  for key share;
  if not found then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_EXECUTION_INVALID';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_execution.approval_id
    and actor_user_id = p_actor_user_id
    and status = 'consumed'
    and consumed_at is not null
    and payload_hash = v_execution.request_hash
  for key share;
  if not found then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_APPROVAL_INVALID';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = v_execution.listing_package_id
    and created_by = p_actor_user_id
    and account_key = p_marketplace_account_key
    and status = 'approved'
  for key share;
  if not found then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_PACKAGE_INVALID';
  end if;

  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = v_execution.opportunity_id
    and id = v_package.opportunity_id
    and candidate_key = v_approval.candidate_key
  for update;
  if not found then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_OPPORTUNITY_INVALID';
  end if;

  v_same_day_authorization := v_approval.approved_payload
    #> '{compliance,sameDayPilotAuthorization}';
  if jsonb_typeof(v_same_day_authorization) <> 'object'
    or v_same_day_authorization->>'validated' is distinct from 'true'
    or v_same_day_authorization->>'version'
      is distinct from 'SELLER_OS_AUTHORIZED_PUBLICATION_V1_2026_07_20'
    or v_same_day_authorization->>'listingPackageId'
      is distinct from v_package.id::text
    or v_same_day_authorization->>'finalHumanAuthorizationRequired'
      is distinct from 'true'
    or v_same_day_authorization->>'unattendedPublicationAllowed'
      is distinct from 'false'
    or v_package.package_data#>>'{sameDayPilot,runId}'
      is distinct from v_same_day_authorization->>'runId'
    or v_package.package_data#>>'{sameDayPilot,candidateId}'
      is distinct from v_same_day_authorization->>'candidateId' then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_BINDING_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.id::text = v_same_day_authorization->>'candidateId'
    and candidate.run_id::text = v_same_day_authorization->>'runId'
    and candidate.opportunity_id = v_opportunity.id
    and candidate.candidate_key = v_opportunity.candidate_key
    and candidate.state = 'READY_FOR_MANUAL_PUBLICATION'
    and candidate.machine_state in ('READY_FOR_MANUAL_PUBLICATION', 'WAITING_ITEM_ID')
    and cardinality(candidate.blockers) = 0
    and run.marketplace_account_key = p_marketplace_account_key
    and run.created_by = p_actor_user_id
  for update of candidate;
  if not found then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_CANDIDATE_INVALID';
  end if;

  v_handoff_summary := v_candidate.manual_handoff_package;
  v_handoff := v_handoff_summary->'package';
  v_image_summary := v_candidate.image_package_summary;
  if v_handoff_summary->>'status'
      is distinct from 'READY_FOR_MANUAL_PUBLICATION'
    or coalesce(v_handoff_summary->>'packageHash', '') !~ '^[0-9a-f]{64}$'
    or v_handoff_summary->>'packageHash'
      is distinct from v_same_day_authorization->>'handoffPackageHash'
    or v_handoff->>'candidateId' is distinct from v_candidate.id::text
    or v_handoff->>'quantity' is distinct from '1'
    or v_handoff->>'conditionId' is distinct from '1000'
    or coalesce(v_handoff->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$'
    or v_image_summary->>'approved' is distinct from 'true'
    or v_image_summary->>'listingPackageId'
      is distinct from v_package.id::text
    or v_image_summary->>'controlId'
      is distinct from v_same_day_authorization->>'imageControlId'
    or not (
      (
        jsonb_array_length(coalesce(
          v_package.package_data->'imageUrls', '[]'::jsonb
        )) = 6
        and jsonb_array_length(coalesce(
          v_package.package_data->'imageAssetManifest', '[]'::jsonb
        )) = 6
      )
      or public.is_ebay_approved_visual_v2_revision_set(
        p_marketplace_account_key,
        p_actor_user_id,
        v_package.id,
        v_candidate.id,
        v_candidate.run_id
      )
    ) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_HANDOFF_INVALID';
  end if;
  if not (
    (
      coalesce(v_image_summary->'publicUrls', '[]'::jsonb)
        = coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
      and coalesce(v_handoff#>'{images,urls}', '[]'::jsonb)
        = coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
    )
    or public.is_ebay_approved_visual_v2_revision_set(
      p_marketplace_account_key,
      p_actor_user_id,
      v_package.id,
      v_candidate.id,
      v_candidate.run_id
    )
  ) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_IMAGE_BINDING_INVALID';
  end if;

  select variant.price, variant.available, variant.inventory_quantity,
    variant.captured_at
  into v_latest_price, v_latest_available, v_latest_quantity,
    v_latest_observed_at
  from public.market_radar_latest_variants variant
  where variant.source_key = 'lunaportex'
    and variant.product_id = v_opportunity.market_radar_product_id
    and variant.supplier_variant_id = v_candidate.supplier_variant_id
  order by variant.captured_at desc
  limit 1;

  v_luna_confirmation := v_candidate.economics_summary->'lunaConfirmation';
  v_luna_confirmation_status := text(v_luna_confirmation->>'status');
  v_luna_confirmation_source := text(v_luna_confirmation->>'source');
  v_quantity_visible := (v_luna_confirmation->>'quantityVisible') = 'true';
  v_quantity_text := text(v_luna_confirmation->>'confirmedQuantity');
  v_operator_price := null;
  v_operator_quantity := null;
  if coalesce(v_luna_confirmation->>'confirmedAt', '')
    ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
    v_operator_observed_at := (v_luna_confirmation->>'confirmedAt')::timestamptz;
  end if;
  if v_operator_observed_at is not null
    and coalesce(v_candidate.economics_summary->>'confirmedLunaPrice', '')
      ~ '^[0-9]+([.][0-9]{1,4})?$' then
    v_operator_price := (v_candidate.economics_summary->>'confirmedLunaPrice')::numeric;
  end if;
  if v_quantity_visible then
    if v_quantity_text ~ '^[0-9]+$' then
      v_operator_quantity := v_quantity_text::integer;
    end if;
  else
    v_operator_quantity := 1;
  end if;

  v_operator_recheck_valid := v_operator_observed_at is not null
    and v_operator_observed_at <= clock_timestamp() + interval '5 minutes'
    and v_operator_observed_at >= clock_timestamp() - interval '24 hours'
    and v_luna_confirmation_status in (
      'AVAILABLE_QUANTITY_NOT_SHOWN',
      'AVAILABLE_EXACT_QUANTITY'
    )
    and v_luna_confirmation_source = 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
    and v_operator_price is not null
    and v_operator_price > 0
    and v_operator_quantity is not null
    and v_operator_quantity >= 1
    and (
      (v_luna_confirmation->>'confirmedByActorRecorded') = 'true'
      or (v_luna_confirmation->>'publicationRecheck') = 'true'
    );

  v_latest_evidence_usable := v_latest_observed_at is not null
    and v_latest_observed_at <= clock_timestamp() + interval '5 minutes'
    and v_latest_observed_at >= clock_timestamp() - interval '6 hours'
    and v_latest_available is true
    and coalesce(v_latest_price, 0) > 0;

  if v_latest_evidence_usable
    and (
      v_operator_observed_at is null
      or v_latest_observed_at >= v_operator_observed_at
    ) then
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      else 1
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  elsif v_operator_recheck_valid then
    v_source_observed_at := v_operator_observed_at;
    v_source_price := v_operator_price;
    v_source_quantity := v_operator_quantity;
    v_source_kind := 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE';
  elsif v_latest_evidence_usable then
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      else 1
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  else
    raise exception 'EBAY_SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED';
  end if;

  if v_source_observed_at is null
    or v_source_price <= 0
    or v_source_quantity < 1
    or coalesce(v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}', '')
      !~ '^[0-9]+([.][0-9]{1,4})?$'
    or v_source_observed_at > clock_timestamp() + interval '5 minutes'
    or (
      v_source_kind = 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
      and v_source_observed_at < clock_timestamp() - interval '24 hours'
    )
    or (
      v_source_kind <> 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
      and v_source_observed_at < clock_timestamp() - interval '6 hours'
    ) then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED';
  end if;

  v_approved_source_price :=
    (v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}')::numeric;
  if abs(v_approved_source_price - v_source_price) >= 0.005 then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_LUNA_COST_CHANGED';
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
        '{sameDaySellerOsPublication}',
        jsonb_build_object(
          'version', v_same_day_authorization->>'version',
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
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_candidate.run_id, v_candidate.id,
    'SELLER_OS_PUBLICATION_SOURCE_SYNCHRONIZED',
    jsonb_build_object(
      'version', v_same_day_authorization->>'version',
      'listingPackageId', v_package.id,
      'source', v_source_kind,
      'sourceObservedAt', v_source_observed_at,
      'quantity', v_source_quantity,
      'ebayWrites', 0
    ),
    'seller-os-publication-source:' || v_execution.id::text || ':'
      || extract(epoch from v_source_observed_at)::bigint::text,
    0, 0, 0, false
  ) on conflict (idempotency_key) do nothing;

  return next v_opportunity;
end;
$$;

revoke all on function public.sync_same_day_source_before_authorized_publication(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.sync_same_day_source_before_authorized_publication(
  uuid, uuid, text
) to service_role;

comment on function public.sync_same_day_source_before_authorized_publication(
  uuid, uuid, text
) is 'Synchronizes fresh Luna evidence for a completed unpublished Offer using either a valid latest Luna scan or a valid operator reconfirmation; no eBay writes.';

-- Keep V3 finalization robust for the same reconfirmation pattern:
-- OPERATOR_SOURCE can proceed with a longer freshness window when valid.
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
  v_operator_observed_at timestamptz;
  v_operator_recheck_valid boolean;
  v_operator_price numeric;
  v_operator_quantity integer;
  v_public_confirmation_valid boolean;
  v_latest_evidence_usable boolean;
  v_confirmation_status text;
  v_confirmation_source text;
  v_quantity_visible boolean;
  v_quantity_text text;
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
  v_confirmation_status := text(v_confirmation->>'status');
  v_confirmation_source := text(v_confirmation->>'source');
  v_quantity_visible := (v_confirmation->>'quantityVisible') = 'true';
  v_quantity_text := text(v_confirmation->>'confirmedQuantity');
  if coalesce(v_confirmation->>'confirmedAt', '')
      ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
    v_confirmed_observed_at := (v_confirmation->>'confirmedAt')::timestamptz;
  end if;
  v_operator_price := null;
  v_operator_quantity := null;
  if v_confirmation_source = 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
    and coalesce(v_candidate.economics_summary->>'confirmedLunaPrice', '')
      ~ '^[0-9]+([.][0-9]{1,4})?$' then
    v_operator_price := (v_candidate.economics_summary->>'confirmedLunaPrice')::numeric;
  end if;
  if v_quantity_visible then
    if v_quantity_text ~ '^[0-9]+$' then
      v_operator_quantity := v_quantity_text::integer;
    end if;
  else
    v_operator_quantity := 1;
  end if;
  v_operator_recheck_valid := v_confirmation_source = 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
    and v_confirmed_observed_at is not null
    and v_confirmed_observed_at >= clock_timestamp() - interval '24 hours'
    and v_confirmed_observed_at <= clock_timestamp() + interval '5 minutes'
    and v_confirmation_status in (
      'AVAILABLE_QUANTITY_NOT_SHOWN',
      'AVAILABLE_EXACT_QUANTITY'
    )
    and v_operator_price is not null
    and v_operator_price > 0
    and v_operator_quantity is not null
    and v_operator_quantity >= 1
    and (
      (v_confirmation->>'confirmedByActorRecorded') = 'true'
      or (v_confirmation->>'publicationRecheck') = 'true'
    );

  v_public_confirmation_valid := v_confirmation_status in (
      'AVAILABLE_QUANTITY_NOT_SHOWN',
      'AVAILABLE_EXACT_QUANTITY'
    )
    and v_confirmation_source = 'LUNA_PUBLIC_PRODUCT_JSON'
    and (v_confirmation->>'automatedPublicPreflight') = 'true'
    and (v_confirmation->>'confirmedByActorRecorded') = 'false'
    and coalesce(v_confirmation->>'observationHash', '')
      ~ '^[0-9a-f]{64}$'
    and v_confirmation->>'publicVariantId'
      is not distinct from v_candidate.supplier_variant_id
    and v_confirmation->>'publicSku'
      is not distinct from v_candidate.supplier_sku
    and coalesce(v_candidate.economics_summary->>'confirmedLunaPrice', '')
      ~ '^[0-9]+([.][0-9]{1,4})?$';

  v_latest_evidence_usable := v_latest_observed_at is not null
    and v_latest_observed_at <= clock_timestamp() + interval '5 minutes'
    and v_latest_observed_at >= clock_timestamp() - interval '6 hours'
    and v_latest_available is true
    and coalesce(v_latest_price, 0) > 0;

  if v_latest_evidence_usable
    and (
      v_confirmed_observed_at is null
      or v_latest_observed_at >= v_confirmed_observed_at
    ) then
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      else 1
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  elsif v_operator_recheck_valid then
    v_source_observed_at := v_confirmed_observed_at;
    v_source_price := v_operator_price;
    v_source_quantity := v_operator_quantity;
    v_source_kind := 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE';
  elsif v_public_confirmation_valid then
    v_source_observed_at := v_confirmed_observed_at;
    v_source_price := (v_candidate.economics_summary->>'confirmedLunaPrice')::numeric;
    v_source_quantity := case
      when v_quantity_visible and v_quantity_text ~ '^[0-9]+$'
        then v_quantity_text::integer
      else 1
    end;
    v_source_kind := v_confirmation_source;
  elsif v_latest_evidence_usable then
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      else 1
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  else
    raise exception 'EBAY_V3_SOURCE_SYNC_LUNA_RECHECK_REQUIRED';
  end if;

  if v_source_observed_at is null
    or v_source_price <= 0
    or v_source_quantity < 1
    or coalesce(
      v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}',
      ''
    ) !~ '^[0-9]+([.][0-9]{1,4})?$'
    or v_source_observed_at > clock_timestamp() + interval '5 minutes'
    or (
      v_source_kind = 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
      and v_source_observed_at < clock_timestamp() - interval '24 hours'
    )
    or (
      v_source_kind <> 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
      and v_source_observed_at < clock_timestamp() - interval '6 hours'
    ) then
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

revoke all on function public.sync_ebay_v3_source_before_authorized_publication(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.sync_ebay_v3_source_before_authorized_publication(
  uuid, uuid, text
) to service_role;

comment on function public.sync_ebay_v3_source_before_authorized_publication(
  uuid, uuid, text
) is 'Synchronizes Luna source before V3 authorized publication with operator reconfirmation support and no eBay writes.';

notify pgrst, 'reload schema';
