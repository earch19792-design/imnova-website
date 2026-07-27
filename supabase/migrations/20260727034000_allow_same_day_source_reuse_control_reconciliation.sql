begin;

create or replace function public.enforce_same_day_pilot_image_package_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_legacy_reconcile_control_id text := current_setting(
    'imnova.same_day_image_control_reconcile_id',
    true
  );
  v_pregeneration_reconcile_control_id text := current_setting(
    'imnova.same_day_image_control_pregeneration_reconcile_id',
    true
  );
  v_expected_legacy_deterministic_hash text;
  v_expected_pregeneration_deterministic_hash text;
  v_exact_legacy_pre_network_reconciliation boolean := false;
  v_exact_pregeneration_mode_reconciliation boolean := false;
  v_exact_source_reuse_reconciliation boolean := false;
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
    if v_legacy_reconcile_control_id = old.id::text then
      v_expected_legacy_deterministic_hash := encode(
        extensions.digest(
          new.marketplace_account_key || ':' || new.created_by::text || ':'
          || new.run_id::text || ':' || new.candidate_id::text || ':'
          || new.listing_package_id::text || ':' || new.fact_run_id::text
          || ':' || new.handoff_hash || ':deterministic',
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
          || new.listing_package_id::text || ':' || new.fact_run_id::text
          || ':' || new.handoff_hash || ':deterministic:'
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

      v_exact_source_reuse_reconciliation := coalesce(
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
        and old.status = 'FAILED_FINAL'
        and new.status = 'FAILED_RETRYABLE'
        and old.attempt = 1
        and new.attempt = old.attempt
        and old.last_error_code =
          'SAME_DAY_IMAGE_SET_SOURCE_REUSE_LIMIT_EXCEEDED'
        and new.last_error_code =
          'SAME_DAY_IMAGE_SOURCE_REUSE_RECOVERY_RECONCILED'
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

    if not (
      v_exact_legacy_pre_network_reconciliation
      or v_exact_pregeneration_mode_reconciliation
      or v_exact_source_reuse_reconciliation
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
      'PREPARING_IMAGE_PACKAGE',
      'WAITING_IMAGE_APPROVAL'
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
$function$;

revoke all on function
  public.enforce_same_day_pilot_image_package_scope()
  from public, anon, authenticated;

commit;
