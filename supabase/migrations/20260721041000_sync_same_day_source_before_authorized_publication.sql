-- Synchronize only the exact, approval-bound Luna source before the existing
-- one-shot publication ledger is prepared. This performs no eBay write.

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
  v_same_day_authorization jsonb;
  v_handoff_summary jsonb;
  v_handoff jsonb;
  v_image_summary jsonb;
  v_luna_confirmation jsonb;
  v_operator_observed_at timestamptz;
  v_latest_observed_at timestamptz;
  v_source_observed_at timestamptz;
  v_source_price numeric;
  v_approved_source_price numeric;
  v_source_quantity integer;
  v_source_kind text;
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
    or jsonb_array_length(coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)) <> 6
    or jsonb_array_length(coalesce(v_package.package_data->'imageAssetManifest', '[]'::jsonb)) <> 6 then
    raise exception 'EBAY_SAME_DAY_PUBLICATION_HANDOFF_INVALID';
  end if;
  if coalesce(v_image_summary->'publicUrls', '[]'::jsonb)
      is distinct from coalesce(v_package.package_data->'imageUrls', '[]'::jsonb)
    or coalesce(v_handoff#>'{images,urls}', '[]'::jsonb)
      is distinct from coalesce(v_package.package_data->'imageUrls', '[]'::jsonb) then
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
  if coalesce(v_luna_confirmation->>'confirmedAt', '')
    ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then
    v_operator_observed_at := (v_luna_confirmation->>'confirmedAt')::timestamptz;
  end if;
  if v_latest_observed_at is not null
    and (v_operator_observed_at is null
      or v_latest_observed_at >= v_operator_observed_at) then
    if v_latest_available is distinct from true
      or coalesce(v_latest_price, 0) <= 0 then
      raise exception 'EBAY_SAME_DAY_PUBLICATION_LUNA_UNAVAILABLE';
    end if;
    v_source_observed_at := v_latest_observed_at;
    v_source_price := v_latest_price;
    v_source_quantity := case
      when coalesce(v_latest_quantity, 0) >= 1
        then floor(v_latest_quantity)::integer
      when v_luna_confirmation->>'quantityVisible' is distinct from 'true'
        then 1
      else 0
    end;
    v_source_kind := 'LUNA_LATEST_VARIANT';
  else
    if v_luna_confirmation->>'source'
        is distinct from 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE'
      or v_luna_confirmation->>'status' not in (
        'AVAILABLE_QUANTITY_NOT_SHOWN', 'AVAILABLE_EXACT_QUANTITY'
      )
      or coalesce(v_candidate.economics_summary->>'confirmedLunaPrice', '')
        !~ '^[0-9]+([.][0-9]{1,4})?$' then
      raise exception 'EBAY_SAME_DAY_PUBLICATION_LUNA_CONFIRMATION_INVALID';
    end if;
    v_source_observed_at := v_operator_observed_at;
    v_source_price := (v_candidate.economics_summary->>'confirmedLunaPrice')::numeric;
    v_source_quantity := case
      when v_luna_confirmation->>'quantityVisible' = 'true'
        and coalesce(v_luna_confirmation->>'confirmedQuantity', '') ~ '^[0-9]+$'
        then (v_luna_confirmation->>'confirmedQuantity')::integer
      else 1
    end;
    v_source_kind := 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE';
  end if;

  if v_source_observed_at is null
    or v_source_observed_at < clock_timestamp() - interval '6 hours'
    or v_source_observed_at > clock_timestamp() + interval '5 minutes'
    or v_source_price <= 0
    or v_source_quantity < 1
    or coalesce(v_approval.approved_payload#>>'{sourceEvidence,supplierPrice}', '')
      !~ '^[0-9]+([.][0-9]{1,4})?$' then
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
) is 'Revalidates and synchronizes the exact same-day Luna source before the existing one-shot publication preview. Performs zero eBay writes.';

notify pgrst, 'reload schema';
