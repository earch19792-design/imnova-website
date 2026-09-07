-- Upgrade the existing Product Research plan/task/capture authority with a
-- typed, auditable query strategy. No new queue, worker, business authority,
-- marketplace operation, or historical receipt deletion is introduced.

alter table public.marketplace_product_research_query_tasks
  add column if not exists query_intent text not null default 'LEGACY_UNCLASSIFIED',
  add column if not exists evidence_basis jsonb not null default '[]'::jsonb,
  add column if not exists strategy_version text null,
  add column if not exists quality_status text null,
  add column if not exists quality_metrics jsonb null,
  add column if not exists commercial_evidence_entities jsonb not null
    default '[]'::jsonb;

alter table public.marketplace_product_research_query_tasks
  add constraint marketplace_product_research_query_tasks_intent_v1_check check (
    query_intent in ('LEGACY_UNCLASSIFIED','EXACT_PRODUCT_QUERY',
      'CORE_FAMILY_QUERY','SEMANTIC_EXPANSION_QUERY')
  ),
  add constraint marketplace_product_research_query_tasks_evidence_v1_check check (
    jsonb_typeof(evidence_basis) = 'array'
  ),
  add constraint marketplace_product_research_query_tasks_quality_v1_check check (
    quality_status is null or quality_status in (
      'COMMERCIALLY_SUFFICIENT','LOW_PRECISION_REFORMULATION_REQUIRED',
      'NO_EVIDENCE_UNPROVEN')
  ),
  add constraint marketplace_product_research_query_tasks_quality_metrics_v1_check check (
    quality_metrics is null or jsonb_typeof(quality_metrics) = 'object'
  ),
  add constraint marketplace_product_research_query_tasks_evidence_entities_v1_check check (
    jsonb_typeof(commercial_evidence_entities) = 'array'
  );

alter table public.marketplace_product_research_query_plans
  add column if not exists research_intelligence_status text not null
    default 'UNPROVEN',
  add column if not exists intelligence_contract_version text null;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_query_plans_intelligence_v1_check check (
    research_intelligence_status in (
      'UNPROVEN','RESEARCH_IN_PROGRESS','COMMERCIALLY_SUFFICIENT',
      'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT')
  );

alter table public.marketplace_product_research_capture_batches
  add column if not exists commercial_quality_status text null,
  add column if not exists commercial_quality_metrics jsonb null;

alter table public.marketplace_product_research_capture_batches
  add constraint marketplace_product_research_capture_batches_commercial_quality_v1_check
    check (commercial_quality_status is null or commercial_quality_status in (
      'COMMERCIALLY_SUFFICIENT','LOW_PRECISION_REFORMULATION_REQUIRED',
      'NO_EVIDENCE_UNPROVEN')),
  add constraint marketplace_product_research_capture_batches_commercial_metrics_v1_check
    check (commercial_quality_metrics is null or
      jsonb_typeof(commercial_quality_metrics) = 'object');

alter table public.marketplace_product_research_capture_observations
  add column if not exists bounded_title_evidence text null,
  add column if not exists commercial_comparable_classification text null,
  add column if not exists commercial_classification_reasons text[] not null
    default '{}'::text[];

alter table public.marketplace_product_research_capture_observations
  add constraint marketplace_product_research_capture_observations_bounded_title_v1_check
    check (bounded_title_evidence is null or
      char_length(bounded_title_evidence) between 3 and 160),
  add constraint marketplace_product_research_capture_observations_commercial_class_v1_check
    check (commercial_comparable_classification is null or
      commercial_comparable_classification in (
        'EXACT_PRODUCT_COMPARABLE','CLOSE_VARIANT_COMPARABLE',
        'CORE_FAMILY_COMPARABLE','ADJACENT_BUT_NOT_COMPARABLE',
        'FALSE_POSITIVE'));

create or replace function public.annotate_product_research_capture_commercial_v1(
  p_marketplace_account_key text,
  p_capture_batch_id uuid,
  p_quality_status text,
  p_quality_metrics jsonb,
  p_annotations jsonb
) returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_expected integer := jsonb_array_length(coalesce(p_annotations, '[]'::jsonb));
  v_updated integer := 0;
begin
  if char_length(trim(coalesce(p_marketplace_account_key, ''))) not between 8 and 160
      or p_capture_batch_id is null
      or p_quality_status not in ('COMMERCIALLY_SUFFICIENT',
        'LOW_PRECISION_REFORMULATION_REQUIRED','NO_EVIDENCE_UNPROVEN')
      or jsonb_typeof(coalesce(p_quality_metrics, '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_annotations, '[]'::jsonb)) <> 'array' then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_INVALID';
  end if;

  update public.marketplace_product_research_capture_observations observation
  set bounded_title_evidence = annotation.bounded_title_evidence,
      commercial_comparable_classification =
        annotation.commercial_comparable_classification,
      commercial_classification_reasons =
        coalesce(annotation.commercial_classification_reasons, '{}'::text[])
  from jsonb_to_recordset(coalesce(p_annotations, '[]'::jsonb)) as annotation(
    evidence_deduplication_key text,
    bounded_title_evidence text,
    commercial_comparable_classification text,
    commercial_classification_reasons text[]
  )
  where observation.capture_batch_id = p_capture_batch_id
    and observation.marketplace_account_key = p_marketplace_account_key
    and observation.marketplace = 'EBAY_US'
    and observation.evidence_deduplication_key =
      annotation.evidence_deduplication_key;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'PRODUCT_RESEARCH_COMMERCIAL_ANNOTATION_COUNT_MISMATCH';
  end if;

  update public.marketplace_product_research_capture_batches batch
  set commercial_quality_status = p_quality_status,
      commercial_quality_metrics = p_quality_metrics
  where batch.id = p_capture_batch_id
    and batch.marketplace_account_key = p_marketplace_account_key
    and batch.marketplace = 'EBAY_US';
  return found;
end;
$$;

revoke all on function public.annotate_product_research_capture_commercial_v1(
  text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.annotate_product_research_capture_commercial_v1(
  text, uuid, text, jsonb, jsonb
) to service_role;

create or replace function public.create_or_reuse_quick_pick_product_research_plan_v2(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_plan_version text,
  p_input_hash text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_luna_product_id text,
  p_luna_variant_id text,
  p_supplier_sku text,
  p_worker_capability_fresh boolean,
  p_observed_at timestamptz,
  p_queries jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_base jsonb;
  v_plan_id uuid;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_base_ordinal integer := 0;
  v_inserted integer := 0;
  v_reopened boolean := false;
  v_state text;
begin
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_queries, '[]'::jsonb)) as q(
      query_intent text, evidence_basis jsonb, strategy_version text)
    where q.query_intent not in ('EXACT_PRODUCT_QUERY','CORE_FAMILY_QUERY',
      'SEMANTIC_EXPANSION_QUERY')
      or jsonb_typeof(coalesce(q.evidence_basis, '[]'::jsonb)) <> 'array'
      or char_length(trim(coalesce(q.strategy_version, ''))) < 8
  ) then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_QUERY_INTELLIGENCE_INVALID';
  end if;

  v_base := public.create_or_reuse_quick_pick_product_research_plan_v1(
    p_plan_id,p_marketplace_account_key,p_plan_version,p_input_hash,
    p_opportunity_id,p_candidate_key,p_luna_product_id,p_luna_variant_id,
    p_supplier_sku,p_worker_capability_fresh,p_observed_at,p_queries);
  v_plan_id := (v_base ->> 'planId')::uuid;

  select * into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.id = v_plan_id
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
  for update;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_PLAN_SCOPE_INVALID';
  end if;

  update public.marketplace_product_research_query_tasks task
  set query_intent = q.query_intent,
      evidence_basis = q.evidence_basis,
      strategy_version = q.strategy_version,
      updated_at = greatest(task.updated_at, p_observed_at)
  from jsonb_to_recordset(p_queries) as q(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text)
  where task.plan_id = v_plan_id and task.query_hash = q.query_hash;

  select coalesce(max(ordinal), 0) into v_base_ordinal
  from public.marketplace_product_research_query_tasks where plan_id = v_plan_id;

  insert into public.marketplace_product_research_query_tasks(
    plan_id,marketplace_account_key,marketplace,ordinal,search_query,query_hash,
    cluster_key_hash,category_id,candidate_count,candidate_variant_hashes,
    query_intent,evidence_basis,strategy_version
  )
  select v_plan_id,p_marketplace_account_key,'EBAY_US',
    v_base_ordinal + row_number() over (order by q.ordinal),q.search_query,
    q.query_hash,q.cluster_key_hash,q.category_id,q.candidate_count,
    q.candidate_variant_hashes,q.query_intent,q.evidence_basis,q.strategy_version
  from jsonb_to_recordset(p_queries) as q(
    ordinal integer, search_query text, query_hash text,
    cluster_key_hash text, category_id text, candidate_count integer,
    candidate_variant_hashes text[], query_intent text,
    evidence_basis jsonb, strategy_version text)
  where not exists (
    select 1 from public.marketplace_product_research_query_tasks existing
    where existing.plan_id = v_plan_id and existing.query_hash = q.query_hash)
    and v_base_ordinal + q.ordinal <= 15
  on conflict (plan_id,query_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    v_reopened := v_plan.status = 'COMPLETED';
    update public.marketplace_product_research_query_plans plan
    set status = 'ACTIVE', completed_at = null,
        plan_version = p_plan_version, input_hash = p_input_hash,
        query_count = (select count(*) from
          public.marketplace_product_research_query_tasks task
          where task.plan_id = v_plan_id),
        research_intelligence_status = 'RESEARCH_IN_PROGRESS',
        intelligence_contract_version = p_plan_version,
        worker_lease_owner = null, worker_lease_expires_at = null,
        worker_claim_count = 0, worker_next_retry_at = p_observed_at,
        worker_last_release_code = null,
        worker_last_result = jsonb_build_object(
          'state','RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT',
          'priorReceipt',v_plan.worker_last_result,
          'recoveryPolicy','BOUNDED_TYPED_QUERY_REFORMULATION',
          'observedAt',p_observed_at,'marketplaceWrites',0),
        updated_at = greatest(plan.updated_at,p_observed_at)
    where plan.id = v_plan_id;
  else
    update public.marketplace_product_research_query_plans plan
    set plan_version = p_plan_version,
        intelligence_contract_version = p_plan_version,
        updated_at = greatest(plan.updated_at,p_observed_at)
    where plan.id = v_plan_id;
  end if;

  select case when status = 'COMPLETED' then 'COMPLETED'
    when p_worker_capability_fresh then 'CLAIMABLE'
    else 'WAITING_FOR_WORKER' end into v_state
  from public.marketplace_product_research_query_plans where id = v_plan_id;

  return v_base || jsonb_build_object(
    'planId',v_plan_id,'addedQueryCount',v_inserted,
    'planReopened',v_reopened,'researchState',v_state,
    'queryStrategyVersion',p_plan_version,'marketplaceWrites',0);
end;
$$;

revoke all on function public.create_or_reuse_quick_pick_product_research_plan_v2(
  uuid,text,text,text,uuid,text,text,text,text,boolean,timestamptz,jsonb
) from public, anon, authenticated;
grant execute on function public.create_or_reuse_quick_pick_product_research_plan_v2(
  uuid,text,text,text,uuid,text,text,text,text,boolean,timestamptz,jsonb
) to service_role;

create or replace function public.complete_quick_pick_product_research_claim_v1(
  p_marketplace_account_key text,
  p_plan_id uuid,
  p_worker_id text,
  p_capture_batch_id uuid,
  p_completed_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
  v_plan_status text;
  v_intelligence_status text;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key, '')) not between 8 and 160
      or p_plan_id is null
      or p_worker_id !~ '^product-research-browser:[0-9a-f-]{36}$'
      or p_capture_batch_id is null
      or p_completed_at is null
      or p_completed_at > clock_timestamp() + interval '1 minute' then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_COMPLETION_INVALID';
  end if;

  select status into v_plan_status
  from public.marketplace_product_research_query_plans
  where id = p_plan_id and marketplace_account_key = p_marketplace_account_key
    and marketplace = 'EBAY_US'
    and source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
    and worker_lease_owner = p_worker_id
    and worker_lease_expires_at > clock_timestamp()
  for update;
  if not found then return false; end if;

  v_intelligence_status := case
    when v_plan_status = 'ACTIVE' then 'RESEARCH_IN_PROGRESS'
    when exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = p_plan_id
        and task.quality_status = 'COMMERCIALLY_SUFFICIENT'
    ) then 'COMMERCIALLY_SUFFICIENT'
    else 'RESEARCH_EXECUTED_BUT_COMMERCIAL_EVIDENCE_INSUFFICIENT'
  end;

  update public.marketplace_product_research_query_plans plan
  set worker_lease_owner = null, worker_lease_expires_at = null,
      worker_next_retry_at = case when v_plan_status = 'ACTIVE'
        then p_completed_at else null end,
      worker_last_release_code = null,
      research_intelligence_status = v_intelligence_status,
      worker_last_result = jsonb_build_object(
        'state',case when v_plan_status = 'ACTIVE'
          then 'QUERY_RECEIPT_CREATED' else 'RESEARCH_RECEIPT_CREATED' end,
        'captureBatchId',p_capture_batch_id,'completedAt',p_completed_at,
        'intelligenceStatus',v_intelligence_status,'marketplaceWrites',0),
      updated_at = greatest(plan.updated_at,p_completed_at)
  where plan.id = p_plan_id
    and exists (
      select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.capture_batch_id = p_capture_batch_id
        and task.status in ('CAPTURED','PROCESSED'));
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.complete_quick_pick_product_research_claim_v1(
  text,uuid,text,uuid,timestamptz
) to service_role;

create or replace view public.seller_os_product_research_canonical_evidence_v1
with (security_invoker = true)
as
select plan.id as plan_id,
  task.marketplace_account_key,
  task.marketplace,
  entity.value ->> 'itemId' as item_id,
  max(entity.value ->> 'boundedTitleEvidence') as bounded_title_evidence,
  array_agg(distinct task.query_intent order by task.query_intent)
    as query_intents,
  array_agg(distinct task.query_hash order by task.query_hash)
    as query_provenance_hashes,
  (array_agg(entity.value ->> 'classification' order by
    case entity.value ->> 'classification'
      when 'EXACT_PRODUCT_COMPARABLE' then 1
      when 'CLOSE_VARIANT_COMPARABLE' then 2
      when 'CORE_FAMILY_COMPARABLE' then 3
      when 'ADJACENT_BUT_NOT_COMPARABLE' then 4
      else 5 end))[1] as commercial_comparable_classification,
  max((entity.value ->> 'soldQuantity')::integer) as confirmed_sold_quantity,
  min((entity.value ->> 'price')::numeric) as minimum_observed_price,
  max((entity.value ->> 'price')::numeric) as maximum_observed_price,
  count(*) as provenance_row_count
from public.marketplace_product_research_query_plans plan
join public.marketplace_product_research_query_tasks task on task.plan_id = plan.id
cross join lateral jsonb_array_elements(task.commercial_evidence_entities) entity(value)
where entity.value ->> 'itemId' ~ '^[0-9]{9,20}$'
group by plan.id,task.marketplace_account_key,task.marketplace,
  entity.value ->> 'itemId';

revoke all on table public.seller_os_product_research_canonical_evidence_v1
  from public, anon, authenticated;
grant select on table public.seller_os_product_research_canonical_evidence_v1
  to service_role;

comment on view public.seller_os_product_research_canonical_evidence_v1 is
  'Read-only Product Research projection: one canonical commercial evidence entity per plan and eBay Item ID, retaining bounded multi-query provenance without double-counting sold quantity, comparable count, or price evidence.';

comment on column public.marketplace_product_research_capture_observations.bounded_title_evidence is
  'Bounded normalized marketplace listing title evidence (max 160 chars). It is commercial evidence, not Product Truth, and excludes raw HTML, images, buyer PII, and seller credentials.';

notify pgrst, 'reload schema';
