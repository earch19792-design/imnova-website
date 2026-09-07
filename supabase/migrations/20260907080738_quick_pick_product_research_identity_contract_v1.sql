-- QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_NAMESPACE_V1_2026_09_07
--
-- The browser completion path previously compared an external Luna product ID
-- with market_radar_latest_variants.product_id (the internal UUID namespace).
-- Application code now resolves external Luna identities exclusively through
-- supplier_product_id + supplier_variant_id. Re-open the bounded, durable
-- pre-fix cohort without recreating plans/tasks or weakening future retries.

update public.marketplace_product_research_query_plans as plan
set worker_claim_count = 0,
    worker_last_release_code = null,
    worker_next_retry_at = clock_timestamp(),
    worker_last_result = jsonb_build_object(
      'state', 'MECHANISM_FIX_RETRY_PENDING',
      'failureClass', 'PRODUCT_RESEARCH_IDENTITY_NAMESPACE_CONTRACT_MISMATCH',
      'mechanismVersion',
        'QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_NAMESPACE_V1_2026_09_07',
      'recoveryPolicy',
        'REUSE_EXISTING_PLAN_TASK_AND_NORMAL_BROWSER_WORKER_CLAIM',
      'retrySafety', 'SAFE_IDEMPOTENT_RUNTIME_RESUME',
      'previousClaimCount', plan.worker_claim_count,
      'previousWorkerResult', coalesce(plan.worker_last_result, '{}'::jsonb),
      'recoveredAt', clock_timestamp(),
      'marketplaceWrites', 0
    ),
    updated_at = clock_timestamp()
where plan.marketplace = 'EBAY_US'
  and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
  and plan.status = 'ACTIVE'
  and plan.created_at < '2026-09-07T08:07:38Z'::timestamptz
  and exists (
    select 1
    from public.marketplace_product_research_query_tasks as task
    where task.plan_id = plan.id
      and task.marketplace_account_key = plan.marketplace_account_key
      and task.marketplace = plan.marketplace
      and task.status = 'PENDING'
  );

comment on column public.marketplace_product_research_query_plans.source_luna_product_id is
  'External Luna/supplier product ID. It must resolve against supplier_product_id, never the internal UUID product_id.';

comment on column public.marketplace_product_research_query_plans.subject_supplier_variant_id is
  'External Luna/supplier variant ID, validated as belonging to source_luna_product_id under the supplier namespace.';
