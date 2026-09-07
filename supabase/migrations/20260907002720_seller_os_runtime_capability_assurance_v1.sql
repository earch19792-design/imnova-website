-- System-wide, read-only capability evidence aggregation. The health runtime
-- reuses operational integrity runs and the operational learning ledger; this
-- migration deliberately creates neither a second health ledger nor a
-- marketplace mutation primitive.

create or replace function public.get_seller_os_runtime_capability_evidence_v1(
  p_marketplace_account_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_marketplace_account_key is null
      or char_length(p_marketplace_account_key) not between 8 and 160
      or p_marketplace_account_key = 'default'
      or p_marketplace_account_key ~ '[[:cntrl:]]' then
    raise exception 'SELLER_OS_RUNTIME_CAPABILITY_EVIDENCE_FORBIDDEN';
  end if;

  select jsonb_build_object(
    'observedAt', clock_timestamp(),
    'scheduler', coalesce((select jsonb_agg(to_jsonb(row_value)
      order by row_value.lane) from (
        select scheduler.lane, scheduler.schedule,
          scheduler.dispatch_window_seconds, scheduler.enabled,
          scheduler.updated_at,
          (select max(receipt.requested_at)
            from public.seller_os_post_runtime_dispatch_receipts_v1 receipt
            where receipt.lane = scheduler.lane) as last_dispatch_at
        from public.seller_os_post_runtime_scheduler_v1 scheduler
      ) row_value), '[]'::jsonb),
    'currentLive', (select to_jsonb(row_value) from (
      select state.current_live_source_state,
        state.current_live_last_attempt_at,
        state.current_live_next_retry_at,
        state.current_live_last_error_code,
        state.last_certified_live_scope_id,
        state.last_certified_live_count,
        state.last_certified_live_observed_at,
        state.last_certified_live_fresh_until,
        state.last_certified_live_source_authority,
        state.last_success_run_id, state.last_success_at,
        state.last_error_at, state.last_error_code,
        state.targeted_luna_last_success_run_id,
        state.targeted_luna_last_success_at,
        state.targeted_luna_last_error_at,
        state.targeted_luna_last_error_code
      from public.ebay_active_listing_sync_state state
      where state.account_key = p_marketplace_account_key
      limit 1
    ) row_value),
    'researchCapture', (select to_jsonb(row_value) from (
      select batch.id, batch.captured_at, batch.valid_count,
        batch.imported_count, batch.rejected_count, batch.error_counts
      from public.marketplace_product_research_capture_batches batch
      where batch.marketplace_account_key = p_marketplace_account_key
      order by batch.captured_at desc limit 1
    ) row_value),
    'researchPlans', (select jsonb_build_object(
      'activeCount', count(*) filter (where plan.status = 'ACTIVE'),
      'completedCount', count(*) filter (where plan.status = 'COMPLETED'),
      'latestUpdatedAt', max(plan.updated_at),
      'latestCompletedAt', max(plan.completed_at)
    ) from public.marketplace_product_research_query_plans plan
      where plan.marketplace_account_key = p_marketplace_account_key),
    'researchTasks', (select jsonb_build_object(
      'pendingCount', count(*) filter (where task.status = 'PENDING'),
      'processedCount', count(*) filter (where task.status = 'PROCESSED'),
      'latestCapturedAt', max(task.captured_at),
      'latestProcessedAt', max(task.processed_at)
    ) from public.marketplace_product_research_query_tasks task
      where task.marketplace_account_key = p_marketplace_account_key),
    'radar', (select to_jsonb(row_value) from (
      select run.run_id, run.status, run.started_at, run.completed_at,
        run.failed_at, run.next_retry_at, run.last_error_code,
        run.output_digest
      from public.seller_os_daily_dollar_radar_runs run
      where run.account_key = p_marketplace_account_key
      order by run.created_at desc limit 1
    ) row_value),
    'radarReceipt', (select to_jsonb(row_value) from (
      select receipt.receipt_id, receipt.run_id, receipt.run_status,
        receipt.recorded_at, receipt.event_type, receipt.output_digest
      from public.seller_os_daily_dollar_radar_run_receipts receipt
      join public.seller_os_daily_dollar_radar_runs run
        on run.run_id = receipt.run_id
      where run.account_key = p_marketplace_account_key
      order by receipt.recorded_at desc limit 1
    ) row_value),
    'radarPolicy', (select to_jsonb(row_value) from (
      select policy.scheduler_enabled, policy.policy_status,
        policy.utc_cron_schedule, policy.business_timezone
      from public.seller_os_daily_dollar_radar_scheduler_policy policy
      where policy.singleton limit 1
    ) row_value),
    'economics', (select jsonb_build_object(
      'evidenceCount', count(*),
      'expiredCount', count(*) filter (
        where evidence.fresh_until is not null
          and evidence.fresh_until < clock_timestamp()),
      'persistedFreshExpiredCount', count(*) filter (
        where evidence.freshness_status = 'FRESH'
          and evidence.fresh_until is not null
          and evidence.fresh_until < clock_timestamp()),
      'latestCapturedAt', max(evidence.captured_at),
      'latestFreshUntil', max(evidence.fresh_until)
    ) from public.seller_os_live_economic_evidence_v1 evidence
      where evidence.marketplace_account_key = p_marketplace_account_key),
    'economicJobs', (select jsonb_build_object(
      'jobCount', count(*),
      'latestUpdatedAt', max(job.updated_at),
      'retryableCount', count(*) filter (where job.status in
        ('FAILED_RETRYABLE', 'WAITING_FOR_WORKER', 'SOURCE_UNAVAILABLE')),
      'waitingWorkerCount', count(*) filter (
        where job.status = 'WAITING_FOR_WORKER'),
      'nextRetryAt', min(job.next_retry_at) filter (
        where job.next_retry_at is not null)
    ) from public.seller_os_economic_evidence_refresh_jobs_v1 job
      where job.marketplace_account_key = p_marketplace_account_key),
    'economicsReadback', (select jsonb_build_object(
      'readbackCount', count(*),
      'latestCalculatedAt', max(readback.calculated_at),
      'provenCount', count(*) filter (where readback.status = 'PROVEN'),
      'partialCount', count(*) filter (where readback.status = 'PARTIAL')
    ) from public.seller_os_live_economics_readbacks_v1 readback
      where readback.marketplace_account_key = p_marketplace_account_key),
    'shipping', (select jsonb_build_object(
      'evidenceCount', count(*),
      'latestObservedAt', max(evidence.observed_at)
    ) from public.seller_os_live_listing_shipping_evidence evidence
      where evidence.account_key = p_marketplace_account_key),
    'shippingClaims', (select jsonb_build_object(
      'claimCount', count(*),
      'latestClaimAt', max(claim.claimed_at),
      'latestCompletedAt', max(claim.completed_at),
      'activeCount', count(*) filter (
        where claim.status not in ('COMPLETED', 'FAILED_TERMINAL'))
    ) from public.seller_os_luna_shipping_job_claims claim
      where claim.account_key = p_marketplace_account_key),
    'productFacts', (select jsonb_build_object(
      'observationCount', count(*),
      'latestFetchedAt', max(observation.fetched_at),
      'latestObservedAt', max(observation.source_observed_at),
      'missingFreshnessPolicyCount', count(*) filter (
        where observation.expires_at is null),
      'expiredCount', count(*) filter (
        where observation.expires_at is not null
          and observation.expires_at < clock_timestamp())
    ) from public.marketplace_product_fact_observations observation
      where observation.marketplace_account_key = p_marketplace_account_key),
    'factSources', coalesce((select jsonb_agg(to_jsonb(row_value)
      order by row_value.source_type) from (
        select snapshot.source_type,
          max(snapshot.fetched_at) as latest_fetched_at,
          max(snapshot.source_observed_at) as latest_observed_at,
          max(snapshot.expires_at) as latest_expires_at,
          count(*) filter (where snapshot.snapshot_status = 'AVAILABLE')
            as available_count,
          count(*) filter (where snapshot.snapshot_status <> 'AVAILABLE')
            as unavailable_count
        from public.marketplace_product_fact_source_snapshots snapshot
        where snapshot.marketplace_account_key = p_marketplace_account_key
        group by snapshot.source_type
      ) row_value), '[]'::jsonb),
    'accountPolicies', (select to_jsonb(row_value) from (
      select profile.id, profile.verified_at, profile.expires_at,
        profile.verification_source
      from public.ebay_account_policy_profiles profile
      where profile.account_key = p_marketplace_account_key
      order by profile.verified_at desc limit 1
    ) row_value),
    'orders', (select jsonb_build_object(
      'snapshotCount', count(*),
      'latestObservedAt', max(snapshot.observed_at)
    ) from public.marketplace_order_snapshots snapshot
      where snapshot.marketplace_account_key = p_marketplace_account_key),
    'analytics', (select jsonb_build_object(
      'snapshotCount', count(*),
      'latestObservedAt', max(snapshot.observed_at)
    ) from public.ebay_listing_performance_snapshots snapshot
      where snapshot.account_key = p_marketplace_account_key),
    'mayel', (select jsonb_build_object(
      'executionCount', count(*),
      'latestAppliedAt', max(execution.applied_verified_at),
      'latestReadbackAt', max(execution.postwrite_readback_at),
      'latestUpdatedAt', max(execution.updated_at)
    ) from public.ebay_mayel_visual_phase_b_executions_v1 execution
      where execution.marketplace_account_key = p_marketplace_account_key),
    'publisher', (select jsonb_build_object(
      'publicationCount', count(*),
      'latestUpdatedAt', max(publication.updated_at),
      'latestVerifiedAt', max(publication.verified_active_at),
      'latestErrorAt', max(publication.updated_at) filter (
        where publication.last_error_code is not null)
    ) from public.ebay_authorized_listing_publications publication
      where publication.marketplace_account_key = p_marketplace_account_key),
    'publisherBatch', (select jsonb_build_object(
      'childCount', count(*),
      'activeCount', count(*) filter (where child.status in
        ('AUTHORIZED', 'CLAIMED', 'RUNNING', 'FAILED_RETRY_SAFE')),
      'completedCount', count(*) filter (where child.status = 'COMPLETED'),
      'latestUpdatedAt', max(child.updated_at),
      'latestCompletedAt', max(child.completed_at),
      'nextRetryAt', min(child.retry_after_at) filter (
        where child.retry_after_at is not null)
    ) from public.seller_os_publisher_batch_children_v1 child
      where child.marketplace_account_key = p_marketplace_account_key),
    'quota', coalesce((select jsonb_agg(to_jsonb(row_value)
      order by row_value.api_family) from (
        select distinct on (state.api_family) state.api_family,
          state.status, state.remaining, state.reset_at,
          state.last_refreshed_at
        from public.ebay_api_quota_states state
        where state.marketplace = 'EBAY_US'
        order by state.api_family, state.last_refreshed_at desc nulls last
      ) row_value), '[]'::jsonb),
    'integrity', (select to_jsonb(row_value) from (
      select run.id, run.mechanism_version, run.status, run.observed_at,
        run.audit_receipt
      from public.seller_os_operational_integrity_runs_v1 run
      where run.marketplace_account_key = p_marketplace_account_key
        and run.mechanism_version =
          'SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_V1'
      order by run.observed_at desc limit 1
    ) row_value)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_seller_os_runtime_capability_evidence_v1(text)
  from public, anon, authenticated;
grant execute on function public.get_seller_os_runtime_capability_evidence_v1(text)
  to service_role;

alter table public.seller_os_post_runtime_scheduler_v1
  drop constraint seller_os_post_runtime_lane_check;
alter table public.seller_os_post_runtime_scheduler_v1
  add constraint seller_os_post_runtime_lane_check check (lane in (
    'QUICK_PICK_RUNTIME_RECOVERY',
    'MARKET_RADAR_LUNA_SYNC',
    'EBAY_LUNA_OPPORTUNITY_SCAN',
    'DAILY_DOLLAR_RADAR_AUTOPILOT',
    'OPERATIONAL_INTEGRITY_AUDITOR',
    'PUBLISHER_BATCH_RUNTIME',
    'PUBLISHER_PREAUTHORIZATION_RECOVERY',
    'RUNTIME_CAPABILITY_ASSURANCE'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select 'RUNTIME_CAPABILITY_ASSURANCE',
  '/api/runtime/capability-assurance', '12-59/15 * * * *', 900,
  source.enabled and source.endpoint_url_secret_name is not null
    and source.authorization_secret_name is not null,
  source.endpoint_url_secret_name, source.authorization_secret_name,
  source.vercel_bypass_secret_name,
  'EBAY_SAME_DAY_PILOT_SCHEDULER_CONFIG_SECRET_REFERENCES'
from public.ebay_same_day_pilot_scheduler_config source
where source.singleton
on conflict (lane) do update set
  endpoint_path = excluded.endpoint_path,
  schedule = excluded.schedule,
  dispatch_window_seconds = excluded.dispatch_window_seconds,
  enabled = excluded.enabled,
  endpoint_url_secret_name = excluded.endpoint_url_secret_name,
  authorization_secret_name = excluded.authorization_secret_name,
  vercel_bypass_secret_name = excluded.vercel_bypass_secret_name,
  source_authority = excluded.source_authority,
  updated_at = clock_timestamp();

select cron.schedule(
  'seller-os-post-runtime-capability-assurance-v1',
  '12-59/15 * * * *',
  $$select public.dispatch_seller_os_post_runtime_v1(
    'RUNTIME_CAPABILITY_ASSURANCE');$$
);

comment on function public.get_seller_os_runtime_capability_evidence_v1(text)
  is 'Bounded service-role-only aggregation of existing capability receipts. Read-only over business and marketplace state.';
comment on column public.seller_os_post_runtime_scheduler_v1.lane
  is 'POST-only runtime lane. Capability assurance performs bounded read-only probes and writes only operational integrity/learning receipts.';

notify pgrst, 'reload schema';
