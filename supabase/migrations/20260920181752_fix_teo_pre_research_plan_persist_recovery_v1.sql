-- TEO_PRE_RESEARCH_PLAN_PERSIST_RECOVERY_V1
-- Preserve latest-snapshot admission for ordinary Luna intake. An exact replay
-- of an already-authorized Control batch may instead use its immutable source
-- snapshot, but only while its OWNER/client capability remains enabled and the
-- durable member identity matches every canonical identity binding.

create or replace function public.create_or_reuse_luna_pre_research_plan_v1(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_plan_version text,
  p_input_hash text,
  p_identity_key text,
  p_luna_snapshot_id uuid,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_supplier_sku text,
  p_product_truth_fingerprint text,
  p_pre_research_policy_version text,
  p_source_fingerprint text,
  p_observed_at timestamptz,
  p_queries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_existing public.marketplace_product_research_query_plans%rowtype;
  v_plan_id uuid;
  v_pending integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or p_plan_id is null
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_version <> 'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15'
      or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
      or p_identity_key !~ '^sha256:[0-9a-f]{64}$'
      or p_luna_snapshot_id is null
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or char_length(coalesce(p_supplier_sku, '')) not between 1 and 160
      or p_product_truth_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_pre_research_policy_version <>
        'LUNA_PRE_RESEARCH_POLICY_V1_2026_09_15'
      or p_source_fingerprint !~ '^sha256:[0-9a-f]{64}$'
      or p_observed_at is null
      or jsonb_typeof(p_queries) is distinct from 'array'
      or jsonb_array_length(p_queries) not between 1 and 15 then
    raise exception 'LUNA_PRE_RESEARCH_PLAN_INPUT_INVALID';
  end if;
  if not exists (
    select 1
    from public.luna_catalog_snapshots_v1 snapshot
    join public.luna_catalog_snapshot_variants_v1 variant
      on variant.snapshot_id = snapshot.snapshot_id
    where snapshot.snapshot_id = p_luna_snapshot_id
      and snapshot.snapshot_status = 'COMPLETE'
      and variant.product_id = p_luna_product_id
      and variant.variant_id = p_luna_variant_id
      and variant.sku = p_supplier_sku
      and variant.source_fingerprint = p_source_fingerprint
      and variant.preflight_status = 'PREFLIGHT_PASS'
      and (
        not exists (
          select 1 from public.luna_catalog_snapshots_v1 newer
          where newer.snapshot_status = 'COMPLETE'
            and newer.snapshot_completed_at > snapshot.snapshot_completed_at)
        or exists (
          select 1
          from public.seller_os_pre_research_batches_v1 batch
          join public.seller_os_pre_research_batch_members_v1 member
            on member.batch_id = batch.batch_id
          join public.seller_os_pre_research_command_capabilities_v1 capability
            on capability.capability_id = batch.owner_authorization_id
          where batch.marketplace_account_key = p_marketplace_account_key
            and batch.source_snapshot_id = p_luna_snapshot_id
            and batch.contract_version =
              'LUNA_PRE_RESEARCH_RESULT_V2_2026_09_19'
            and batch.batch_state in
              ('AUTHORIZED','RUNNING','NEEDS_ATTENTION','COMPLETED')
            and member.luna_product_id = p_luna_product_id
            and member.luna_variant_id = p_luna_variant_id
            and member.luna_sku = p_supplier_sku
            and member.source_candidate_key = p_identity_key
            and member.product_truth_fingerprint =
              p_product_truth_fingerprint
            and capability.capability_code =
              'TEO_PRE_RESEARCH_NORMAL_BATCH_V1'
            and capability.marketplace_account_key =
              batch.marketplace_account_key
            and capability.owner_user_id = batch.owner_user_id
            and capability.command_client_id = batch.command_client_id
            and capability.allowed_contract_version = batch.contract_version
            and capability.enabled
            and (capability.expires_at is null
              or capability.expires_at > clock_timestamp()))
      )
  ) then
    raise exception 'LUNA_PRE_RESEARCH_AUTHORITATIVE_CANDIDATE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'luna-pre-research:' || p_marketplace_account_key || ':' ||
      p_identity_key, 0));
  select plan.* into v_existing
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.source_candidate_key = p_identity_key
    and plan.pre_research_rerun_cohort_id is null
  for update;
  if found then
    select count(*) into v_pending
    from public.marketplace_product_research_query_tasks task
    where task.plan_id = v_existing.id and task.status = 'PENDING';
    return jsonb_build_object('planId',v_existing.id,'created',false,
      'sourceContext',v_existing.source_context,
      'preResearchResult',v_existing.pre_research_result,
      'pendingTaskCount',v_pending,
      'idempotencyKey',v_existing.source_candidate_key);
  end if;
  insert into public.marketplace_product_research_query_plans (
    id, marketplace_account_key, marketplace, run_id, plan_version,
    input_hash, status, query_count, candidate_count, source_context,
    subject_supplier_variant_id, source_candidate_key,
    source_luna_product_id, source_supplier_sku, source_luna_snapshot_id,
    source_product_truth_fingerprint, pre_research_policy_version,
    pre_research_result, pre_research_trace_eligible,
    pre_research_evidence, research_intelligence_status,
    intelligence_contract_version, raw_competitor_content_stored,
    pii_stored, openai_calls, ebay_writes, pre_research_rerun_cohort_id)
  values (p_plan_id, p_marketplace_account_key, 'EBAY_US', null,
    p_plan_version, p_input_hash, 'ACTIVE', jsonb_array_length(p_queries), 1,
    'LUNA_PRE_RESEARCH', p_luna_variant_id, p_identity_key,
    p_luna_product_id, p_supplier_sku, p_luna_snapshot_id,
    p_product_truth_fingerprint, p_pre_research_policy_version, 'PENDING',
    false, '{}'::jsonb, 'RESEARCH_IN_PROGRESS',
    'LUNA_PRE_RESEARCH_INTAKE_V1_2026_09_15', false, false, 0, 0, null)
  returning id into v_plan_id;
  insert into public.marketplace_product_research_query_tasks (
    plan_id, marketplace_account_key, marketplace, ordinal, search_query,
    query_hash, cluster_key_hash, category_id, candidate_count,
    candidate_variant_hashes, query_intent, evidence_basis, strategy_version)
  select v_plan_id, p_marketplace_account_key, 'EBAY_US', query.ordinal,
    query.search_query, query.query_hash, query.cluster_key_hash,
    query.category_id, query.candidate_count,
    query.candidate_variant_hashes, query.query_intent,
    coalesce(query.evidence_basis, '[]'::jsonb), query.strategy_version
  from jsonb_to_recordset(p_queries) as query(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text);
  get diagnostics v_pending = row_count;
  if v_pending <> jsonb_array_length(p_queries) then
    raise exception 'LUNA_PRE_RESEARCH_TASK_PERSISTENCE_INCOMPLETE';
  end if;
  return jsonb_build_object('planId',v_plan_id,'created',true,
    'sourceContext','LUNA_PRE_RESEARCH','preResearchResult','PENDING',
    'pendingTaskCount',v_pending,'idempotencyKey',p_identity_key);
end
$function$;

revoke all on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_or_reuse_luna_pre_research_plan_v1(
  uuid,text,text,text,text,uuid,text,text,text,text,text,text,timestamptz,jsonb)
  to service_role;
