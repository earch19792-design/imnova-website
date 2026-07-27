begin;

create or replace function public.reconcile_same_day_pregeneration_image_mode_v1(
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
as $function$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_expected_hash text;
  v_previous_error text;
  v_source_reuse_recovery boolean := false;
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
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_RECONCILIATION_INVALID';
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
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_HASH_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_account_key || ':' || p_candidate_id::text || ':' || p_handoff_hash,
    0
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
    or v_control.handoff_id <> p_handoff_id then
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_BINDING_INVALID';
  end if;

  if v_control.generation_mode = 'DETERMINISTIC_ONLY'
    and v_control.idempotency_key_hash = p_expected_idempotency_hash then
    return jsonb_build_object(
      'reconciled', false,
      'status', 'ALREADY_CURRENT',
      'controlId', v_control.id,
      'openAiCalls', v_control.openai_calls,
      'ebayWrites', v_control.ebay_writes,
      'productionChanged', v_control.production_changed
    );
  end if;

  v_source_reuse_recovery :=
    v_control.status = 'FAILED_FINAL'
    and v_control.attempt = 1
    and v_control.generation_mode = 'OPENAI_CONTEXT_PLATE'
    and v_control.last_error_code =
      'SAME_DAY_IMAGE_SET_SOURCE_REUSE_LIMIT_EXCEEDED'
    and v_control.openai_calls = 1
    and v_control.provider_request_id is null
    and v_control.asset_ids is null
    and v_control.image_set_hash is null
    and v_control.completed_at is null
    and v_control.lease_token is null
    and v_control.lease_expires_at is null
    and v_control.competitor_image_count = 0
    and v_control.product_byte_count_sent = 0
    and v_control.product_url_count_sent = 0
    and v_control.ebay_writes = 0
    and not v_control.production_changed;

  if not v_source_reuse_recovery
    and (
      v_control.status <> 'FAILED_RETRYABLE'
      or v_control.attempt <> 1
      or v_control.generation_mode <> 'OPENAI_CONTEXT_PLATE'
      or v_control.last_error_code not in (
        'NEEDS_MORE_VERIFIED_FACTS',
        'NEEDS_VERIFIED_PRODUCT_FACTS:VISUAL_STRATEGY'
      )
      or v_control.openai_calls <> 0
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
      or v_control.production_changed
    ) then
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_CONTROL_UNSAFE';
  end if;

  if exists (
    select 1
    from public.ebay_listing_image_assets asset
    where asset.account_key = p_account_key
      and asset.created_by = p_actor
      and asset.listing_package_id = p_listing_package_id
      and asset.transformation->>'sameDayImageControlId' = v_control.id::text
  ) then
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_ASSETS_EXIST';
  end if;
  if exists (
    select 1
    from public.ebay_same_day_pilot_image_package_runs other_control
    where other_control.idempotency_key_hash = p_expected_idempotency_hash
      and other_control.id <> v_control.id
  ) then
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_HASH_CONFLICT';
  end if;

  v_previous_error := v_control.last_error_code;
  perform set_config(
    'imnova.same_day_image_control_pregeneration_reconcile_id',
    v_control.id::text,
    true
  );
  update public.ebay_same_day_pilot_image_package_runs control
  set generation_mode = 'DETERMINISTIC_ONLY',
      idempotency_key_hash = p_expected_idempotency_hash,
      status = case
        when v_source_reuse_recovery then 'FAILED_RETRYABLE'
        else control.status
      end,
      openai_calls = case
        when v_source_reuse_recovery then 0
        else control.openai_calls
      end,
      last_error_code = case
        when v_source_reuse_recovery
          then 'SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_RECONCILED'
        else control.last_error_code
      end,
      updated_at = clock_timestamp()
  where control.id = v_control.id
    and control.status = v_control.status
    and control.attempt = v_control.attempt
    and control.generation_mode = 'OPENAI_CONTEXT_PLATE'
    and control.last_error_code = v_previous_error
    and control.openai_calls = v_control.openai_calls
    and control.provider_request_id is null
    and control.asset_ids is null
    and control.image_set_hash is null
    and control.lease_token is null
    and control.lease_expires_at is null;
  if not found then
    raise exception 'SAME_DAY_IMAGE_PREGENERATION_PATCH_FAILED';
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
    'SAME_DAY_IMAGE_PREGENERATION_MODE_RECONCILED',
    jsonb_build_object(
      'recoveryVersion',
        case
          when v_source_reuse_recovery
            then 'SOURCE_REUSE_FAILED_FINAL_TO_DETERMINISTIC_V1_2026_07_27'
          else 'PREGENERATION_OPENAI_TO_DETERMINISTIC_V1_2026_07_24'
        end,
      'controlId', v_control.id,
      'previousErrorCode', v_previous_error,
      'previousOpenAiCalls', v_control.openai_calls,
      'providerRequestObserved', false,
      'persistedAssetCount', 0,
      'generationMode', 'DETERMINISTIC_ONLY',
      'compositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
      'openAiCallsForNextAttempt', 0,
      'ebayWrites', 0,
      'productionChanged', false
    ),
    'same-day-image:' || v_control.id::text
      || ':pregeneration-mode-reconciliation-v1',
    0,
    0,
    false
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'reconciled', true,
    'status', case
      when v_source_reuse_recovery
        then 'SOURCE_REUSE_RECONCILED_TO_DETERMINISTIC'
      else 'RECONCILED_TO_DETERMINISTIC'
    end,
    'controlId', v_control.id,
    'previousOpenAiCalls', v_control.openai_calls,
    'openAiCallsForNextAttempt', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$function$;

revoke all on function public.reconcile_same_day_pregeneration_image_mode_v1(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.reconcile_same_day_pregeneration_image_mode_v1(
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text
) to service_role;

commit;
