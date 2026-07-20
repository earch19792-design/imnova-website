-- Close a same-day manual publication only after the authenticated Trading
-- read has registered the owned ACTIVE listing in ebay_active_listings. The
-- core registration and the pilot transition share one transaction: any
-- account, Item ID, SKU, opportunity, candidate or handoff-hash mismatch
-- rolls every write back.

alter function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) rename to register_ebay_manual_listing_link_bound_core_v2;

revoke all on function public.register_ebay_manual_listing_link_bound_core_v2(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated, service_role;

create function public.register_ebay_manual_listing_link(
  p_account_key text,
  p_ebay_item_id text,
  p_ebay_url text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_supplier_variant_id text,
  p_supplier_sku text,
  p_verification_status text,
  p_verification_method text,
  p_verification_reason text,
  p_connector_ebay_sku text,
  p_connector_observed_at timestamptz,
  p_safe_defaults jsonb,
  p_actor_user_id uuid
)
returns setof public.ebay_manual_listing_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.ebay_manual_listing_links%rowtype;
  v_monitor public.ebay_active_listings%rowtype;
  v_package public.ebay_listing_packages%rowtype;
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_handoff public.ebay_same_day_pilot_handoffs%rowtype;
  v_pilot_candidate_count integer := 0;
  v_eligible_candidate_count integer := 0;
  v_expected_ebay_sku text;
  v_candidate_custom_label text;
  v_handoff_custom_label text;
  v_candidate_package_hash text;
  v_previous_machine_state text;
  v_checkpoint jsonb;
  v_evidence_hash text;
  v_transition_key text;
  v_event_key text;
  v_ready_count integer := 0;
  v_verified_count integer := 0;
  v_exhausted boolean := false;
  v_has_blocked boolean := false;
  v_completed boolean := false;
  v_active_found boolean := false;
  v_active_machine_state text;
  v_active_next_automated_action text;
  v_active_next_human_action text;
begin
  select * into v_link
  from public.register_ebay_manual_listing_link_bound_core_v2(
    p_account_key,
    p_ebay_item_id,
    p_ebay_url,
    p_opportunity_id,
    p_candidate_key,
    p_supplier_variant_id,
    p_supplier_sku,
    p_verification_status,
    p_verification_method,
    p_verification_reason,
    p_connector_ebay_sku,
    p_connector_observed_at,
    p_safe_defaults,
    p_actor_user_id
  );

  if p_verification_status <> 'verified' then
    return next v_link;
    return;
  end if;

  -- A pilot may only close from GetItem evidence for the authenticated seller.
  -- The inner cores have already validated freshness and canonical/custom-label
  -- identity; these checks bind their persisted result to this exact call.
  if p_verification_method <> 'EBAY_TRADING_GET_ITEM_READONLY'
    or v_link.id is null
    or v_link.account_key is distinct from p_account_key
    or v_link.marketplace_id <> 'EBAY_US'
    or v_link.ebay_item_id is distinct from p_ebay_item_id
    or v_link.ebay_url is distinct from p_ebay_url
    or v_link.opportunity_id is distinct from p_opportunity_id
    or v_link.candidate_key is distinct from p_candidate_key
    or v_link.verification_status <> 'verified'
    or v_link.verification_method <> 'EBAY_TRADING_GET_ITEM_READONLY'
    or v_link.connector_listing_status <> 'active'
    or v_link.connector_ebay_sku is distinct from p_connector_ebay_sku
    or v_link.connector_listing_id is null
    or v_link.verified_at is null then
    raise exception 'MANUAL_LISTING_PILOT_ACTIVE_EVIDENCE_INVALID';
  end if;

  select listing.* into v_monitor
  from public.ebay_active_listings listing
  where listing.id = v_link.connector_listing_id
    and listing.account_key = p_account_key
    and listing.ebay_item_id = p_ebay_item_id
    and listing.listing_status = 'active'
    and listing.ebay_sku = p_connector_ebay_sku
  for update;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_MONITOR_REGISTRATION_INVALID';
  end if;

  select package.* into v_package
  from public.ebay_listing_packages package
  where package.opportunity_id = p_opportunity_id
    and package.candidate_key = p_candidate_key
    and package.account_key = p_account_key
  for key share;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_PACKAGE_REQUIRED';
  end if;
  v_expected_ebay_sku := concat(
    'IMNOVA-', upper(replace(v_package.id::text, '-', ''))
  );

  -- Manual registration also supports opportunities outside the same-day
  -- pilot. Only require a pilot transition when this opportunity is actually
  -- bound to a run; if it is, an ineligible or ambiguous candidate is fatal.
  select count(*) into v_pilot_candidate_count
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.opportunity_id = p_opportunity_id
    and candidate.candidate_key = p_candidate_key
    and run.marketplace_account_key = p_account_key
    and run.marketplace = 'EBAY_US';

  if v_pilot_candidate_count = 0 then
    return next v_link;
    return;
  end if;

  select count(*) into v_eligible_candidate_count
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.opportunity_id = p_opportunity_id
    and candidate.candidate_key = p_candidate_key
    and run.marketplace_account_key = p_account_key
    and run.marketplace = 'EBAY_US'
    and candidate.state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'PUBLISHED_PENDING_VERIFICATION',
      'VERIFIED_ACTIVE'
    )
    and candidate.machine_state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID',
      'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR',
      'VERIFIED_ACTIVE'
    );
  if v_eligible_candidate_count <> 1 then
    raise exception 'MANUAL_LISTING_PILOT_CANDIDATE_AMBIGUOUS_OR_INELIGIBLE';
  end if;

  select candidate.run_id into v_candidate.run_id
  from public.ebay_same_day_pilot_candidates candidate
  join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
  where candidate.opportunity_id = p_opportunity_id
    and candidate.candidate_key = p_candidate_key
    and run.marketplace_account_key = p_account_key
    and run.marketplace = 'EBAY_US'
    and candidate.state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'PUBLISHED_PENDING_VERIFICATION',
      'VERIFIED_ACTIVE'
    )
    and candidate.machine_state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID',
      'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR',
      'VERIFIED_ACTIVE'
    )
  limit 1;
  if v_candidate.run_id is null then
    raise exception 'MANUAL_LISTING_PILOT_CANDIDATE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_same_day_pilot_run:' || v_candidate.run_id::text, 0)
  );

  select run.* into v_run
  from public.ebay_same_day_pilot_runs run
  where run.id = v_candidate.run_id
  for update;
  if not found
    or v_run.marketplace_account_key is distinct from p_account_key
    or v_run.marketplace <> 'EBAY_US' then
    raise exception 'MANUAL_LISTING_PILOT_RUN_SCOPE_INVALID';
  end if;

  select candidate.* into v_candidate
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = v_run.id
    and candidate.opportunity_id = p_opportunity_id
    and candidate.candidate_key = p_candidate_key
  for update;
  if not found
    or v_candidate.state not in (
      'READY_FOR_MANUAL_PUBLICATION',
      'PUBLISHED_PENDING_VERIFICATION',
      'VERIFIED_ACTIVE'
    )
    or v_candidate.machine_state not in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID',
      'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR',
      'VERIFIED_ACTIVE'
    ) then
    raise exception 'MANUAL_LISTING_PILOT_CANDIDATE_STATE_INVALID';
  end if;
  if v_monitor.supplier_variant_id is distinct from v_candidate.supplier_variant_id
    or v_monitor.supplier_sku is distinct from v_candidate.supplier_sku then
    raise exception 'MANUAL_LISTING_PILOT_SUPPLIER_IDENTITY_MISMATCH';
  end if;

  select handoff.* into v_handoff
  from public.ebay_same_day_pilot_handoffs handoff
  where handoff.run_id = v_candidate.run_id
    and handoff.candidate_id = v_candidate.id
    and handoff.status = 'READY_FOR_MANUAL_PUBLICATION'
  order by handoff.created_at desc
  limit 1;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_HANDOFF_REQUIRED';
  end if;

  v_candidate_custom_label := nullif(trim(
    v_candidate.manual_handoff_package #>> '{package,customLabel}'
  ), '');
  v_handoff_custom_label := nullif(trim(
    v_handoff.package_data ->> 'customLabel'
  ), '');
  v_candidate_package_hash := nullif(trim(
    v_candidate.manual_handoff_package ->> 'packageHash'
  ), '');

  if v_candidate.manual_handoff_package #>> '{package,candidateId}'
      is distinct from v_candidate.id::text
    or v_handoff.package_data ->> 'candidateId'
      is distinct from v_candidate.id::text
    or v_candidate_package_hash !~ '^[0-9a-f]{64}$'
    or v_candidate_package_hash is distinct from v_handoff.package_hash
    or v_candidate_custom_label !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,49}$'
    or v_candidate_custom_label is distinct from v_handoff_custom_label
    or p_connector_ebay_sku not in (
      v_expected_ebay_sku,
      v_candidate_custom_label
    ) then
    raise exception 'MANUAL_LISTING_PILOT_HANDOFF_BINDING_INVALID';
  end if;

  v_previous_machine_state := v_candidate.machine_state;
  v_checkpoint := jsonb_build_object(
    'closureVersion', 'MANUAL_LISTING_ACTIVE_MONITOR_V1_2026_07_20',
    'manualListingLinkId', v_link.id,
    'activeListingId', v_monitor.id,
    'ebayItemId', p_ebay_item_id,
    'accountKey', p_account_key,
    'runId', v_run.id,
    'candidateId', v_candidate.id,
    'opportunityId', p_opportunity_id,
    'candidateKey', p_candidate_key,
    'observedEbaySku', p_connector_ebay_sku,
    'handoffPackageHash', v_candidate_package_hash,
    'verificationMethod', 'EBAY_TRADING_GET_ITEM_READONLY',
    'verifiedActive', true,
    'commercialMonitorTable', 'ebay_active_listings'
  );
  v_evidence_hash := encode(
    extensions.digest(v_checkpoint::text, 'sha256'),
    'hex'
  );
  v_transition_key := concat(
    v_run.id::text, ':', v_candidate.id::text,
    ':MANUAL_LISTING_VERIFIED_ACTIVE:', p_ebay_item_id, ':', v_evidence_hash
  );
  v_event_key := v_transition_key || ':EVENT';

  insert into public.ebay_same_day_pilot_transitions (
    run_id,
    candidate_id,
    previous_state,
    next_state,
    reason_code,
    triggered_by,
    started_at,
    completed_at,
    attempt,
    checkpoint,
    evidence_hash,
    idempotency_key,
    next_automatic_action,
    next_human_action
  ) values (
    v_run.id,
    v_candidate.id,
    v_previous_machine_state,
    'VERIFIED_ACTIVE',
    'MANUAL_LISTING_TRADING_ACTIVE_AND_MONITOR_REGISTERED',
    'SYSTEM',
    v_link.last_verification_at,
    v_link.last_verification_at,
    1,
    v_checkpoint,
    v_evidence_hash,
    v_transition_key,
    'Monitorear ventas, inventario, tráfico y riesgo comercial.',
    'Ninguna.'
  ) on conflict (idempotency_key) do nothing;

  perform 1
  from public.ebay_same_day_pilot_transitions transition_row
  where transition_row.idempotency_key = v_transition_key
    and transition_row.run_id = v_run.id
    and transition_row.candidate_id = v_candidate.id
    and transition_row.next_state = 'VERIFIED_ACTIVE'
    and transition_row.reason_code =
      'MANUAL_LISTING_TRADING_ACTIVE_AND_MONITOR_REGISTERED'
    and transition_row.evidence_hash = v_evidence_hash
    and transition_row.checkpoint = v_checkpoint;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_TRANSITION_CONFLICT';
  end if;

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
    'MANUAL_LISTING_VERIFIED_ACTIVE_MONITOR_REGISTERED',
    v_checkpoint || jsonb_build_object(
      'transitionEvidenceHash', v_evidence_hash,
      'verifiedAt', v_link.verified_at
    ),
    v_event_key,
    1,
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  perform 1
  from public.ebay_same_day_pilot_events event_row
  where event_row.idempotency_key = v_event_key
    and event_row.run_id = v_run.id
    and event_row.candidate_id = v_candidate.id
    and event_row.event_type =
      'MANUAL_LISTING_VERIFIED_ACTIVE_MONITOR_REGISTERED'
    and event_row.event_payload ->> 'transitionEvidenceHash' = v_evidence_hash;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_EVENT_CONFLICT';
  end if;

  update public.ebay_active_listings
  set raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object(
        'commercialMonitorRegistration', jsonb_build_object(
          'status', 'ACTIVE',
          'source', 'MANUAL_LISTING_TRADING_GET_ITEM',
          'manualListingLinkId', v_link.id,
          'runId', v_run.id,
          'candidateId', v_candidate.id,
          'handoffPackageHash', v_candidate_package_hash,
          'verifiedAt', v_link.verified_at
        )
      ),
      last_ebay_sync_at = p_connector_observed_at,
      updated_at = greatest(updated_at, p_connector_observed_at)
  where id = v_monitor.id
    and account_key = p_account_key
    and ebay_item_id = p_ebay_item_id
    and ebay_sku = p_connector_ebay_sku
    and listing_status = 'active';
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_MONITOR_PATCH_FAILED';
  end if;

  update public.ebay_same_day_pilot_candidates
  set state = 'VERIFIED_ACTIVE',
      machine_state = 'VERIFIED_ACTIVE',
      blockers = '{}'::text[],
      evidence_summary = coalesce(evidence_summary, '{}'::jsonb)
        || jsonb_build_object(
          'manualListingClosure', v_checkpoint || jsonb_build_object(
            'transitionEvidenceHash', v_evidence_hash,
            'verifiedAt', v_link.verified_at
          )
        ),
      next_automated_action =
        'Monitorear ventas, inventario, tráfico y riesgo comercial.',
      next_human_action = 'Ninguna.',
      updated_at = clock_timestamp()
  where id = v_candidate.id
    and run_id = v_run.id
    and state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'PUBLISHED_PENDING_VERIFICATION',
      'VERIFIED_ACTIVE'
    )
    and machine_state in (
      'READY_FOR_MANUAL_PUBLICATION',
      'WAITING_ITEM_ID',
      'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR',
      'VERIFIED_ACTIVE'
    );
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_CANDIDATE_PATCH_FAILED';
  end if;

  select
    count(*) filter (
      where candidate.machine_state = 'READY_FOR_MANUAL_PUBLICATION'
    ),
    count(*) filter (
      where candidate.machine_state = 'VERIFIED_ACTIVE'
    ),
    bool_or(candidate.machine_state = 'BLOCKED')
  into v_ready_count, v_verified_count, v_has_blocked
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = v_run.id;

  v_exhausted := not exists (
    select 1
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.run_id = v_run.id
      and candidate.machine_state not in (
        'REJECTED', 'BLOCKED', 'VERIFIED_ACTIVE', 'COMPLETED'
      )
  );
  v_completed := v_verified_count >= v_run.target_new_listings;

  select
    candidate.machine_state,
    candidate.next_automated_action,
    candidate.next_human_action
  into
    v_active_machine_state,
    v_active_next_automated_action,
    v_active_next_human_action
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = v_run.id
    and candidate.machine_state not in (
      'REJECTED', 'BLOCKED', 'READY_FOR_MANUAL_PUBLICATION',
      'VERIFIED_ACTIVE', 'COMPLETED'
    )
  order by candidate.ordinal
  limit 1;
  v_active_found := found;

  update public.ebay_same_day_pilot_runs
  set status = case
        when v_completed then 'COMPLETED'
        when v_exhausted then 'BLOCKED'
        when v_ready_count > 0 then 'READY_FOR_OPERATOR'
        when coalesce(v_has_blocked, false) then 'PARTIALLY_READY'
        else 'ACTIVE'
      end,
      stage = case
        when v_active_found then v_active_machine_state
        when v_completed then 'COMPLETED'
        when v_exhausted then 'BLOCKED'
        else 'QUEUE_PREPARED'
      end,
      ready_for_manual_publication_count = least(2, v_ready_count),
      verified_new_listings = least(2, v_verified_count),
      monitor_snapshot = coalesce(monitor_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'lastVerifiedManualListing', jsonb_build_object(
            'ebayItemId', p_ebay_item_id,
            'ebaySku', p_connector_ebay_sku,
            'activeListingId', v_monitor.id,
            'manualListingLinkId', v_link.id,
            'candidateId', v_candidate.id,
            'verifiedAt', v_link.verified_at,
            'status', 'ACTIVE'
          )
        ),
      next_automated_action = case
        when v_active_found then v_active_next_automated_action
        else 'Preservar el trabajo completado y mantener el monitor comercial.'
      end,
      next_human_action = case
        when v_active_found then v_active_next_human_action
        else 'Ninguna.'
      end,
      updated_at = clock_timestamp()
  where id = v_run.id;
  if not found then
    raise exception 'MANUAL_LISTING_PILOT_RUN_PATCH_FAILED';
  end if;

  return next v_link;
end;
$$;

revoke all on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) to service_role;

comment on function public.register_ebay_manual_listing_link(
  text, text, text, uuid, text, text, text, text, text, text, text,
  timestamptz, jsonb, uuid
) is
  'Registers an owned ACTIVE manual listing and atomically closes its bound same-day candidate into commercial monitoring; every account, Item ID, SKU and handoff-hash check is fail-closed and idempotent.';

notify pgrst, 'reload schema';
