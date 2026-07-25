-- Allow reconfirm to operate with both legacy 6-image and V3 7-image package states.
-- This keeps the reconfirm path aligned with the V3 authoring flow while preserving
-- the existing no-write safety contract:
-- - Only updates internal source evidence and does not create Inventory Item / Offer / listing.
-- - No eBay publication writes.
-- - Preserves prior blocking gates and audit logging behavior.

create or replace function public.reconfirm_ebay_ready_publication_luna_v1(
  p_account_key text,
  p_actor uuid,
  p_listing_package_id uuid,
  p_candidate_id uuid,
  p_supplier_price numeric,
  p_available boolean,
  p_quantity integer default null,
  p_now timestamptz default clock_timestamp()
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
  v_economics jsonb;
  v_confirmation jsonb;
  v_previous_price numeric;
  v_previous_confirmed_at text;
  v_event_key text;
  v_binding jsonb;
  v_handoff_summary jsonb;
  v_handoff jsonb;
  v_image_summary jsonb;
  v_package_urls jsonb;
  v_handoff_urls jsonb;
  v_approved_urls jsonb;
  v_control_id text;
  v_package_url_count int;
  v_handoff_url_count int;
  v_approved_url_count int;
begin
  if nullif(trim(coalesce(p_account_key, '')), '') is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_listing_package_id is null
    or p_candidate_id is null then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_SCOPE_REQUIRED';
  end if;
  if p_now is null
    or p_now < clock_timestamp() - interval '5 minutes'
    or p_now > clock_timestamp() + interval '5 minutes' then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_TIME_INVALID';
  end if;
  if p_available is distinct from true then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_UNAVAILABLE';
  end if;
  if p_supplier_price is null or p_supplier_price <= 0
    or p_supplier_price > 100000
    or p_quantity is not null and (p_quantity < 1 or p_quantity > 1000000) then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_VALUES_INVALID';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.id = p_listing_package_id
    and package.account_key = p_account_key
    and package.created_by = p_actor
  for update;
  if not found then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_PACKAGE_SCOPE_INVALID';
  end if;
  v_package_urls := v_package.package_data->'imageUrls';
  v_package_url_count := coalesce(jsonb_array_length(v_package_urls), 0);
  v_handoff_url_count := coalesce(jsonb_array_length(v_package.package_data->'imageAssetManifest'), 0);
  if v_package.status not in ('draft', 'ready_for_review')
    or jsonb_typeof(v_package.package_data->'imageUrls') is distinct from 'array'
    or jsonb_typeof(v_package.package_data->'imageAssetManifest') is distinct from 'array' then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_PACKAGE_INVALID';
  end if;
  if v_package_url_count not in (6, 7)
    or v_handoff_url_count not in (6, 7)
    or v_handoff_url_count <> v_package_url_count then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_PACKAGE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.id = p_candidate_id
    and candidate.opportunity_id = v_package.opportunity_id
    and candidate.candidate_key = v_package.candidate_key
  for update;
  if not found then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_CANDIDATE_SCOPE_INVALID';
  end if;

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id
    and run.marketplace_account_key = p_account_key
    and run.created_by = p_actor
  for update;
  if not found then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_RUN_SCOPE_INVALID';
  end if;

  v_binding := coalesce(v_package.package_data->'sameDayPilot', '{}'::jsonb);
  v_handoff_summary := coalesce(v_candidate.manual_handoff_package, '{}'::jsonb);
  v_handoff := coalesce(v_handoff_summary->'package', '{}'::jsonb);
  v_image_summary := coalesce(v_candidate.image_package_summary, '{}'::jsonb);
  v_package_urls := coalesce(v_package.package_data->'imageUrls', '[]'::jsonb);
  v_handoff_urls := coalesce(v_handoff->'images'->'urls', '[]'::jsonb);
  v_approved_urls := coalesce(v_image_summary->'publicUrls', '[]'::jsonb);
  v_control_id := coalesce(v_image_summary->>'controlId', '');
  v_handoff_url_count := coalesce(jsonb_array_length(v_handoff_urls), 0);
  v_approved_url_count := coalesce(jsonb_array_length(v_approved_urls), 0);

  if v_candidate.state is distinct from 'READY_FOR_MANUAL_PUBLICATION'
    or v_candidate.machine_state is distinct from 'READY_FOR_MANUAL_PUBLICATION'
    or cardinality(v_candidate.blockers) <> 0
    or v_handoff_summary->>'status' is distinct from 'READY_FOR_MANUAL_PUBLICATION'
    or coalesce(v_handoff_summary->>'packageHash', '') !~ '^[0-9a-f]{64}$'
    or v_handoff->>'candidateId' is distinct from v_candidate.id::text
    or v_handoff->>'quantity' is distinct from '1'
    or coalesce(v_handoff->>'price', '') !~ '^[0-9]+([.][0-9]{1,4})?$'
    or v_image_summary->>'approved' is distinct from 'true'
    or v_image_summary->>'listingPackageId' is distinct from v_package.id::text
    or v_binding->>'runId' is distinct from v_run.id::text
    or v_binding->>'candidateId' is distinct from v_candidate.id::text
    or v_control_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or jsonb_typeof(v_handoff_urls) is distinct from 'array'
    or jsonb_typeof(v_approved_urls) is distinct from 'array' then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_READY_BINDING_INVALID';
  end if;

  if v_handoff_url_count is distinct from v_package_url_count
    or v_approved_url_count is distinct from v_package_url_count
    or v_handoff_urls is distinct from v_package_urls
    or v_approved_urls is distinct from v_package_urls
    or (select count(distinct value)
        from jsonb_array_elements_text(v_package_urls) as url(value)) <> v_package_url_count
    or (select count(*)
        from jsonb_array_elements_text(v_package_urls) as url(value)
        where value ~ '^https://') <> v_package_url_count then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_IMAGE_BINDING_INVALID';
  end if;

  if not exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs control
    join public.ebay_same_day_pilot_handoffs handoff
      on handoff.id = control.handoff_id
      and handoff.run_id = control.run_id
      and handoff.candidate_id = control.candidate_id
      and handoff.fact_run_id = control.fact_run_id
      and handoff.package_hash = control.handoff_hash
    where control.id = v_control_id::uuid
      and control.marketplace_account_key = p_account_key
      and control.created_by = p_actor
      and control.reviewed_by = p_actor
      and control.run_id = v_run.id
      and control.candidate_id = v_candidate.id
      and control.listing_package_id = v_package.id
      and control.status = 'APPROVED'
      and control.human_decision = 'APPROVED'
      and control.ebay_writes = 0
      and not control.production_changed
      and handoff.status in ('AWAITING_IMAGE_APPROVAL', 'READY_FOR_MANUAL_PUBLICATION')
      and handoff.operator_price_approved
      and handoff.ebay_writes = 0
      and not handoff.production_changed
      and cardinality(control.asset_ids) = v_package_url_count
  ) then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_IMAGE_CONTROL_INVALID';
  end if;

  if exists (
      select 1 from public.ebay_draft_only_approvals approval
      where approval.listing_package_id = v_package.id
        and approval.status = 'approved'
        and approval.expires_at > clock_timestamp()
    )
    or exists (
      select 1 from public.ebay_draft_only_execution_ledger execution
      where execution.listing_package_id = v_package.id
    )
    or exists (
      select 1 from public.ebay_authorized_listing_publications publication
      where publication.listing_package_id = v_package.id
    ) then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_PRIOR_AUTHORIZATION_INVALID';
  end if;

  select opportunity.* into v_opportunity
  from public.ebay_luna_opportunity_queue opportunity
  where opportunity.id = v_package.opportunity_id
    and opportunity.candidate_key = v_package.candidate_key
  for update;
  if not found then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_OPPORTUNITY_INVALID';
  end if;

  v_economics := coalesce(v_candidate.economics_summary, '{}'::jsonb);
  if coalesce(v_economics->>'confirmedLunaPrice', '')
      !~ '^[0-9]+([.][0-9]{1,4})?$' then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_RECHECK_PRIOR_COST_INVALID';
  end if;
  v_previous_price := (v_economics->>'confirmedLunaPrice')::numeric;
  if abs(v_previous_price - p_supplier_price) >= 0.005 then
    raise exception 'SAME_DAY_PUBLICATION_LUNA_COST_CHANGED';
  end if;

  v_confirmation := coalesce(v_economics->'lunaConfirmation', '{}'::jsonb);
  v_previous_confirmed_at := v_confirmation->>'confirmedAt';
  v_confirmation := v_confirmation || jsonb_build_object(
    'status', case when p_quantity is null
      then 'AVAILABLE_QUANTITY_NOT_SHOWN' else 'AVAILABLE_EXACT_QUANTITY' end,
    'confirmedUnitCost', p_supplier_price,
    'confirmedQuantity', p_quantity,
    'quantityVisible', p_quantity is not null,
    'recheckAfterSale', true,
    'source', 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE',
    'confirmedAt', p_now,
    'confirmedByActorRecorded', true,
    'publicationRecheck', true,
    'ebayConfirmedSupplierStock', false
  );
  v_economics := v_economics || jsonb_build_object(
    'confirmedLunaPrice', p_supplier_price,
    'available', true,
    'quantity', p_quantity,
    'quantityUnknown', p_quantity is null,
    'lunaConfirmation', v_confirmation
  );

  update public.ebay_same_day_pilot_candidates candidate
  set economics_summary = v_economics,
      listing_quantity = 1,
      recheck_after_sale = true,
      next_automated_action = 'Abrir Seller OS y preparar un preview final con evidencia Luna reciente.',
      next_human_action = 'Revisar el preview exacto y autorizar la publicación final.',
      updated_at = p_now
  where candidate.id = v_candidate.id;

  update public.ebay_luna_opportunity_queue opportunity
  set supplier_available = true,
      supplier_inventory_quantity = coalesce(p_quantity, 1),
      supplier_price = p_supplier_price,
      supplier_snapshot_at = p_now,
      last_scanned_at = p_now,
      queue_status = 'ready',
      updated_at = p_now
  where opportunity.id = v_opportunity.id;

  update public.ebay_listing_packages package
  set source_observed_at = p_now,
      updated_at = p_now
  where package.id = v_package.id;

  v_event_key := v_run.id::text || ':' || v_candidate.id::text
    || ':READY_PUBLICATION_LUNA_RECHECK:'
    || replace(extract(epoch from p_now)::text, '.', '_');
  insert into public.ebay_same_day_pilot_events (
    run_id, candidate_id, event_type, event_payload, idempotency_key,
    ebay_read_calls, openai_calls, ebay_writes, production_changed
  ) values (
    v_run.id,
    v_candidate.id,
    'READY_PUBLICATION_LUNA_RECONFIRMED',
    jsonb_build_object(
      'listingPackageId', v_package.id,
      'previousConfirmedAt', v_previous_confirmed_at,
      'confirmedAt', p_now,
      'supplierPriceUnchanged', true,
      'quantityVisible', p_quantity is not null,
      'confirmedQuantity', p_quantity,
      'source', 'OPERATOR_VISIBLE_LUNA_PRODUCT_PAGE',
      'actorRecorded', true,
      'imagesRegenerated', false,
      'handoffRegenerated', false,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    v_event_key,
    0, 0, 0, false
  );

  return jsonb_build_object(
    'candidateId', v_candidate.id,
    'listingPackageId', v_package.id,
    'confirmedAt', p_now,
    'confirmedPrice', p_supplier_price,
    'quantityVisible', p_quantity is not null,
    'confirmedQuantity', p_quantity,
    'imagesRegenerated', false,
    'handoffRegenerated', false,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.reconfirm_ebay_ready_publication_luna_v1(
  text, uuid, uuid, uuid, numeric, boolean, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.reconfirm_ebay_ready_publication_luna_v1(
  text, uuid, uuid, uuid, numeric, boolean, integer, timestamptz
) to service_role;

notify pgrst, 'reload schema';
