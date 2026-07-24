-- Align every durable Seller OS image gate with the current V9 compositor and
-- the one-main-plus-six-secondary (seven asset) contract. Historical six
-- asset rows remain valid but cannot pass the current V9 publication gate.
-- Also permits one exact third claim for the live zero-effect V8/V9 gate
-- mismatch. No eBay or Production write is granted or performed here.

do $$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.create_ebay_same_day_image_revision_asset_set(uuid,text,uuid,uuid,uuid,text,jsonb)'::regprocedure,
    'public.complete_ebay_same_day_image_revision(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure,
    'public.assert_same_day_pilot_image_set_safe(uuid,uuid,uuid[])'::regprocedure,
    'public.assert_ebay_publish_image_set_high_quality(uuid,uuid,text)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into v_definition;
    if position(
      'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      in v_definition
    ) = 0 then
      if position(
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22'
        in v_definition
      ) = 0 then
        raise exception 'SELLER_OS_V9_GATE_PATCH_TARGET_MISSING';
      end if;
      execute replace(
        v_definition,
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V8_2026_07_22',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22'
      );
    end if;
  end loop;
end;
$$;

alter table public.ebay_same_day_pilot_image_package_runs
  drop constraint if exists ebay_same_day_image_attempt_check;
alter table public.ebay_same_day_pilot_image_package_runs
  add constraint ebay_same_day_image_attempt_check check (
    attempt between 1 and 3
  ) not valid;
alter table public.ebay_same_day_pilot_image_package_runs
  validate constraint ebay_same_day_image_attempt_check;

alter table public.ebay_same_day_pilot_image_package_runs
  drop constraint if exists ebay_same_day_image_output_check;
alter table public.ebay_same_day_pilot_image_package_runs
  add constraint ebay_same_day_image_output_check check (
    (
      status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and cardinality(asset_ids) in (6, 7)
      and image_set_hash ~ '^[0-9a-f]{64}$'
      and completed_at is not null
    )
    or (
      status not in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      and asset_ids is null
      and image_set_hash is null
      and completed_at is null
    )
  ) not valid;
alter table public.ebay_same_day_pilot_image_package_runs
  validate constraint ebay_same_day_image_output_check;

alter table public.ebay_same_day_pilot_handoffs
  drop constraint if exists ebay_same_day_pilot_handoffs_source_image_type_check;
alter table public.ebay_same_day_pilot_handoffs
  add constraint ebay_same_day_pilot_handoffs_source_image_type_check check (
    source_image_type = 'LUNA_AUTHORIZED_CATALOG'
    or (
      source_image_type = 'LUNA_AUTHORIZED_DERIVATIVE_SET'
      and image_count in (6, 7)
    )
  ) not valid;
alter table public.ebay_same_day_pilot_handoffs
  validate constraint ebay_same_day_pilot_handoffs_source_image_type_check;

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
      and authorized_source_count between 1 and 3
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

do $$
declare
  v_definition text;
  v_old text := 'and v_control.attempt < 2 then';
  v_new text := $claim$and (
        v_control.attempt < 2
        or (
          v_control.attempt = 2
          and v_control.last_error_code =
            'SAME_DAY_IMAGE_GATE_VERSION_RECONCILED'
        )
      ) then$claim$;
begin
  select pg_get_functiondef(
    'public.claim_ebay_same_day_pilot_image_package_run(text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,uuid)'::regprocedure
  ) into v_definition;
  if position('SAME_DAY_IMAGE_GATE_VERSION_RECONCILED' in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'SAME_DAY_IMAGE_V9_SPECIAL_CLAIM_PATCH_TARGET_MISSING';
    end if;
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$$;

create or replace function public.reconcile_same_day_visual_gate_version_v1(
  p_account_key text,
  p_actor uuid,
  p_run_id uuid,
  p_candidate_id uuid,
  p_listing_package_id uuid,
  p_fact_run_id uuid,
  p_handoff_id uuid,
  p_handoff_hash text,
  p_expected_idempotency_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_expected_hash text;
begin
  if p_account_key is null
    or p_account_key = 'default'
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_actor is null
    or p_run_id is null
    or p_candidate_id is null
    or p_listing_package_id is null
    or p_fact_run_id is null
    or p_handoff_id is null
    or p_handoff_hash is null
    or p_handoff_hash !~ '^[0-9a-f]{64}$'
    or p_expected_idempotency_hash is null
    or p_expected_idempotency_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_RECONCILIATION_INVALID';
  end if;

  v_expected_hash := encode(
    extensions.digest(
      p_account_key || ':' || p_actor::text || ':' || p_run_id::text || ':'
      || p_candidate_id::text || ':' || p_listing_package_id::text || ':'
      || p_fact_run_id::text || ':' || p_handoff_hash || ':deterministic:'
      || 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
      'sha256'
    ),
    'hex'
  );
  if p_expected_idempotency_hash <> v_expected_hash then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_HASH_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_account_key || ':' || p_candidate_id::text || ':' || p_handoff_hash, 0
  ));

  select control.*
  into v_control
  from public.ebay_same_day_pilot_image_package_runs control
  where control.marketplace_account_key = p_account_key
    and control.candidate_id = p_candidate_id
    and control.handoff_hash = p_handoff_hash
  for update;
  if not found then
    return jsonb_build_object(
      'reconciled', false,
      'status', 'NO_EXISTING_CONTROL',
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    );
  end if;

  if v_control.created_by <> p_actor
    or v_control.run_id <> p_run_id
    or v_control.listing_package_id <> p_listing_package_id
    or v_control.fact_run_id <> p_fact_run_id
    or v_control.handoff_id <> p_handoff_id
    or v_control.idempotency_key_hash <> p_expected_idempotency_hash
    or v_control.generation_mode <> 'DETERMINISTIC_ONLY' then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_BINDING_INVALID';
  end if;

  if v_control.status <> 'FAILED_FINAL'
    or v_control.attempt <> 2
    or v_control.last_error_code
      <> 'SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID' then
    return jsonb_build_object(
      'reconciled', false,
      'status', 'NOT_ELIGIBLE',
      'controlId', v_control.id,
      'openAiCalls', v_control.openai_calls,
      'ebayWrites', v_control.ebay_writes,
      'productionChanged', v_control.production_changed
    );
  end if;

  if v_control.openai_calls <> 0
    or v_control.provider_request_id is not null
    or v_control.asset_ids is not null
    or v_control.image_set_hash is not null
    or v_control.completed_at is not null
    or v_control.lease_token is not null
    or v_control.lease_expires_at is not null
    or v_control.competitor_image_count <> 0
    or v_control.product_byte_count_sent <> 0
    or v_control.product_url_count_sent <> 0
    or v_control.ebay_writes <> 0
    or v_control.production_changed then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_CONTROL_UNSAFE';
  end if;

  if exists (
    select 1
    from public.ebay_listing_image_assets asset
    where asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.listing_package_id = p_listing_package_id
      and asset.transformation->>'sameDayImageControlId' = v_control.id::text
  ) then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_ASSETS_EXIST';
  end if;

  perform public.assert_ebay_listing_package_account_scope(
    p_listing_package_id,
    p_account_key,
    p_actor
  );
  update public.ebay_same_day_pilot_image_package_runs control
  set status = 'FAILED_RETRYABLE',
      last_error_code = 'SAME_DAY_IMAGE_GATE_VERSION_RECONCILED',
      updated_at = clock_timestamp()
  where control.id = v_control.id
    and control.status = 'FAILED_FINAL'
    and control.attempt = 2
    and control.last_error_code =
      'SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID'
    and control.openai_calls = 0
    and control.provider_request_id is null
    and control.asset_ids is null
    and control.image_set_hash is null
    and control.lease_token is null
    and control.lease_expires_at is null;
  if not found then
    raise exception 'SAME_DAY_IMAGE_VISUAL_GATE_PATCH_FAILED';
  end if;

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    p_run_id,
    p_candidate_id,
    'SAME_DAY_IMAGE_VISUAL_GATE_VERSION_RECONCILED',
    jsonb_build_object(
      'recoveryVersion', 'V8_TO_V9_SEVEN_IMAGE_GATE_V1_2026_07_24',
      'controlId', v_control.id,
      'previousErrorCode',
        'SAME_DAY_IMAGE_SET_VISUAL_STRATEGY_V2_INVALID',
      'previousAttempt', 2,
      'nextAttempt', 3,
      'persistedAssetCount', 0,
      'compositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
      'imageCount', 7,
      'openAiCalls', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    'same-day-image:' || v_control.id::text
      || ':visual-gate-version-reconciliation-v1',
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'reconciled', true,
    'status', 'RECONCILED_FOR_V9_SEVEN_IMAGE_GATE',
    'controlId', v_control.id,
    'nextAttempt', 3,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.reconcile_same_day_visual_gate_version_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_same_day_visual_gate_version_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) to service_role;

comment on function public.reconcile_same_day_visual_gate_version_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) is 'Allows one exact third claim after the obsolete V8/six-asset gate rejected a zero-effect V9/seven-asset set; never writes to eBay or Production.';

notify pgrst, 'reload schema';
