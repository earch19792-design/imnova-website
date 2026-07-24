-- Reconcile one legacy image control that reserved the OpenAI context-plate
-- lane but failed before any provider or durable image side effect. The
-- current deterministic compositor may then reuse the exact handoff binding.
-- This migration neither grants nor performs an eBay/Production write.

create or replace function public.enforce_same_day_pilot_image_package_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_legacy_reconcile_control_id text := current_setting(
    'imnova.same_day_image_control_reconcile_id', true
  );
  v_pregeneration_reconcile_control_id text := current_setting(
    'imnova.same_day_image_control_pregeneration_reconcile_id', true
  );
  v_expected_legacy_deterministic_hash text;
  v_expected_pregeneration_deterministic_hash text;
  v_exact_legacy_pre_network_reconciliation boolean := false;
  v_exact_pregeneration_mode_reconciliation boolean := false;
begin
  if tg_op = 'UPDATE' and (
    new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.created_by is distinct from old.created_by
    or new.run_id is distinct from old.run_id
    or new.candidate_id is distinct from old.candidate_id
    or new.listing_package_id is distinct from old.listing_package_id
    or new.fact_run_id is distinct from old.fact_run_id
    or new.handoff_id is distinct from old.handoff_id
    or new.handoff_hash is distinct from old.handoff_hash
    or new.generation_mode is distinct from old.generation_mode
    or new.image_set_version is distinct from old.image_set_version
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.created_at is distinct from old.created_at
  ) then
    -- Preserve the earlier accounting repair exactly as deployed.
    if v_legacy_reconcile_control_id = old.id::text then
      v_expected_legacy_deterministic_hash := encode(
        extensions.digest(
          new.marketplace_account_key || ':' || new.created_by::text || ':'
          || new.run_id::text || ':' || new.candidate_id::text || ':'
          || new.listing_package_id::text || ':' || new.fact_run_id::text || ':'
          || new.handoff_hash || ':deterministic',
          'sha256'
        ),
        'hex'
      );

      v_exact_legacy_pre_network_reconciliation := coalesce(
        old.marketplace_account_key = new.marketplace_account_key
        and old.created_by = new.created_by
        and old.run_id = new.run_id
        and old.candidate_id = new.candidate_id
        and old.listing_package_id = new.listing_package_id
        and old.fact_run_id = new.fact_run_id
        and old.handoff_id = new.handoff_id
        and old.handoff_hash = new.handoff_hash
        and old.image_set_version = new.image_set_version
        and old.created_at = new.created_at
        and old.generation_mode = 'OPENAI_CONTEXT_PLATE'
        and new.generation_mode = 'DETERMINISTIC_ONLY'
        and new.idempotency_key_hash =
          v_expected_legacy_deterministic_hash
        and old.status = 'FAILED_FINAL'
        and new.status = 'FAILED_RETRYABLE'
        and old.attempt = 1
        and new.attempt = old.attempt
        and old.last_error_code = 'EBAY_IMAGE_OPENAI_KEY_MISSING'
        and new.last_error_code =
          'EBAY_IMAGE_PRENETWORK_ACCOUNTING_RECONCILED'
        and old.openai_calls = 1
        and new.openai_calls = 0
        and old.provider_request_id is null
        and new.provider_request_id is null
        and old.asset_ids is null
        and new.asset_ids is null
        and old.image_set_hash is null
        and new.image_set_hash is null
        and old.completed_at is null
        and new.completed_at is null
        and old.lease_token is null
        and new.lease_token is null
        and old.lease_expires_at is null
        and new.lease_expires_at is null
        and new.failed_at = old.failed_at
        and old.reviewed_at is null
        and new.reviewed_at is null
        and old.reviewed_by is null
        and new.reviewed_by is null
        and old.human_decision is null
        and new.human_decision is null
        and old.competitor_image_count = 0
        and new.competitor_image_count = 0
        and old.product_byte_count_sent = 0
        and new.product_byte_count_sent = 0
        and old.product_url_count_sent = 0
        and new.product_url_count_sent = 0
        and old.ebay_writes = 0
        and new.ebay_writes = 0
        and old.production_changed = false
        and new.production_changed = false,
        false
      );
    end if;

    if v_pregeneration_reconcile_control_id = old.id::text then
      v_expected_pregeneration_deterministic_hash := encode(
        extensions.digest(
          new.marketplace_account_key || ':' || new.created_by::text || ':'
          || new.run_id::text || ':' || new.candidate_id::text || ':'
          || new.listing_package_id::text || ':' || new.fact_run_id::text || ':'
          || new.handoff_hash || ':deterministic:'
          || 'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
          'sha256'
        ),
        'hex'
      );

      v_exact_pregeneration_mode_reconciliation := coalesce(
        old.marketplace_account_key = new.marketplace_account_key
        and old.created_by = new.created_by
        and old.run_id = new.run_id
        and old.candidate_id = new.candidate_id
        and old.listing_package_id = new.listing_package_id
        and old.fact_run_id = new.fact_run_id
        and old.handoff_id = new.handoff_id
        and old.handoff_hash = new.handoff_hash
        and old.image_set_version = new.image_set_version
        and old.created_at = new.created_at
        and old.generation_mode = 'OPENAI_CONTEXT_PLATE'
        and new.generation_mode = 'DETERMINISTIC_ONLY'
        and new.idempotency_key_hash =
          v_expected_pregeneration_deterministic_hash
        and old.status = 'FAILED_RETRYABLE'
        and new.status = old.status
        and old.attempt = 1
        and new.attempt = old.attempt
        and old.last_error_code in (
          'NEEDS_MORE_VERIFIED_FACTS',
          'NEEDS_VERIFIED_PRODUCT_FACTS:VISUAL_STRATEGY'
        )
        and new.last_error_code = old.last_error_code
        and old.openai_calls = 0
        and new.openai_calls = 0
        and old.provider_request_id is null
        and new.provider_request_id is null
        and old.asset_ids is null
        and new.asset_ids is null
        and old.image_set_hash is null
        and new.image_set_hash is null
        and old.completed_at is null
        and new.completed_at is null
        and old.lease_token is null
        and new.lease_token is null
        and old.lease_expires_at is null
        and new.lease_expires_at is null
        and new.failed_at = old.failed_at
        and old.reviewed_at is null
        and new.reviewed_at is null
        and old.reviewed_by is null
        and new.reviewed_by is null
        and old.human_decision is null
        and new.human_decision is null
        and old.competitor_image_count = 0
        and new.competitor_image_count = 0
        and old.product_byte_count_sent = 0
        and new.product_byte_count_sent = 0
        and old.product_url_count_sent = 0
        and new.product_url_count_sent = 0
        and old.ebay_writes = 0
        and new.ebay_writes = 0
        and old.production_changed = false
        and new.production_changed = false,
        false
      );
    end if;

    if not (
      v_exact_legacy_pre_network_reconciliation
      or v_exact_pregeneration_mode_reconciliation
    ) then
      raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_IMMUTABLE';
    end if;
  end if;

  perform 1
  from public.ebay_same_day_pilot_runs pilot_run
  join public.ebay_same_day_pilot_candidates candidate
    on candidate.run_id = pilot_run.id
  join public.ebay_listing_packages listing_package
    on listing_package.opportunity_id = candidate.opportunity_id
    and listing_package.candidate_key = candidate.candidate_key
  join public.marketplace_product_fact_runs fact_run
    on fact_run.id = new.fact_run_id
  join public.ebay_same_day_pilot_handoffs handoff
    on handoff.run_id = pilot_run.id
    and handoff.candidate_id = candidate.id
    and handoff.fact_run_id = fact_run.id
  where pilot_run.id = new.run_id
    and pilot_run.marketplace_account_key = new.marketplace_account_key
    and pilot_run.marketplace = 'EBAY_US'
    and pilot_run.created_by = new.created_by
    and candidate.id = new.candidate_id
    and candidate.machine_state in (
      'PREPARING_IMAGE_PACKAGE', 'WAITING_IMAGE_APPROVAL'
    )
    and listing_package.id = new.listing_package_id
    and listing_package.account_key = new.marketplace_account_key
    and listing_package.created_by = new.created_by
    and listing_package.status <> 'archived'
    and fact_run.marketplace_account_key = new.marketplace_account_key
    and fact_run.marketplace = 'EBAY_US'
    and fact_run.status in ('COMPLETED', 'PARTIAL')
    and handoff.id = new.handoff_id
    and handoff.package_hash = new.handoff_hash
    and handoff.status = 'AWAITING_IMAGE_APPROVAL'
    and handoff.openai_calls = 0
    and handoff.ebay_writes = 0
    and handoff.production_changed = false;
  if not found then
    raise exception 'SAME_DAY_IMAGE_PACKAGE_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

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
as $$
declare
  v_control public.ebay_same_day_pilot_image_package_runs%rowtype;
  v_expected_hash text;
  v_previous_error text;
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

  if v_control.status <> 'FAILED_RETRYABLE'
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
    or v_control.production_changed then
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
      updated_at = clock_timestamp()
  where control.id = v_control.id
    and control.status = 'FAILED_RETRYABLE'
    and control.attempt = 1
    and control.generation_mode = 'OPENAI_CONTEXT_PLATE'
    and control.last_error_code = v_previous_error
    and control.openai_calls = 0
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
        'PREGENERATION_OPENAI_TO_DETERMINISTIC_V1_2026_07_24',
      'controlId', v_control.id,
      'previousErrorCode', v_previous_error,
      'providerRequestObserved', false,
      'persistedAssetCount', 0,
      'generationMode', 'DETERMINISTIC_ONLY',
      'compositorContractVersion',
        'EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22',
      'openAiCalls', 0,
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
    'status', 'RECONCILED_TO_DETERMINISTIC',
    'controlId', v_control.id,
    'openAiCalls', 0,
    'ebayWrites', 0,
    'productionChanged', false
  );
end;
$$;

revoke all on function public.reconcile_same_day_pregeneration_image_mode_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_same_day_pregeneration_image_mode_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) to service_role;

comment on function public.reconcile_same_day_pregeneration_image_mode_v1(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text
) is 'Rebinds one exact zero-side-effect pre-generation image control from the legacy OpenAI lane to the current deterministic compositor; never writes to eBay or Production.';

notify pgrst, 'reload schema';
