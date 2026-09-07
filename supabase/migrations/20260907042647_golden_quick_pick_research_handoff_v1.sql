-- Bind Quick Pick candidates that still require Market Research to the
-- existing Product Research plan/task authority. This is an additive context
-- on the current plan runtime, not a new queue, worker, ledger or scheduler.

alter table public.marketplace_product_research_query_plans
  add column source_candidate_key text null,
  add column source_luna_product_id text null,
  add column source_supplier_sku text null,
  add column source_opportunity_id uuid null
    references public.ebay_luna_opportunity_queue(id) on delete restrict;

alter table public.marketplace_product_research_query_plans
  drop constraint marketplace_product_research_query_plans_context_check;

alter table public.marketplace_product_research_query_plans
  add constraint marketplace_product_research_query_plans_context_check check (
    (source_context = 'SAME_DAY_RUN'
      and run_id is not null
      and subject_listing_id is null
      and subject_item_id is null
      and subject_supplier_variant_id is null
      and request_receipt_id is null
      and source_candidate_key is null
      and source_luna_product_id is null
      and source_supplier_sku is null
      and source_opportunity_id is null)
    or
    (source_context = 'LIVE_LISTING_REVALIDATION'
      and run_id is null
      and subject_listing_id is not null
      and subject_item_id ~ '^[0-9]{9,20}$'
      and char_length(subject_supplier_variant_id) between 1 and 160
      and request_receipt_id is not null
      and source_candidate_key is null
      and source_luna_product_id is null
      and source_supplier_sku is null
      and source_opportunity_id is null)
    or
    (source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
      and run_id is null
      and subject_listing_id is null
      and subject_item_id is null
      and request_receipt_id is null
      and source_candidate_key ~ '^sha256:[0-9a-f]{64}$'
      and source_luna_product_id ~ '^[0-9]{1,30}$'
      and subject_supplier_variant_id ~ '^[0-9]{1,30}$'
      and char_length(source_supplier_sku) between 1 and 160
      and source_opportunity_id is not null)
  );

create unique index marketplace_product_research_query_plans_quick_pick_identity_uidx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, source_candidate_key,
    source_luna_product_id, subject_supplier_variant_id
  ) where source_context = 'QUICK_PICK_RESEARCH_REQUIRED';

create index marketplace_product_research_query_plans_quick_pick_pending_idx
  on public.marketplace_product_research_query_plans(
    marketplace_account_key, marketplace, status, created_at
  ) where source_context = 'QUICK_PICK_RESEARCH_REQUIRED';

create or replace function public.create_or_reuse_quick_pick_product_research_plan_v1(
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
  v_queue public.ebay_luna_opportunity_queue%rowtype;
  v_plan public.marketplace_product_research_query_plans%rowtype;
  v_query_count integer := jsonb_array_length(coalesce(p_queries, '[]'::jsonb));
  v_variant_hash text;
  v_family_demand_status text;
  v_created boolean := false;
  v_research_state text;
  v_assessment jsonb;
begin
  if char_length(trim(coalesce(p_marketplace_account_key, ''))) not between 8 and 160
      or char_length(trim(coalesce(p_plan_version, ''))) < 8
      or p_input_hash !~ '^sha256:[0-9a-f]{64}$'
      or p_candidate_key !~ '^sha256:[0-9a-f]{64}$'
      or p_luna_product_id !~ '^[0-9]{1,30}$'
      or p_luna_variant_id !~ '^[0-9]{1,30}$'
      or char_length(trim(coalesce(p_supplier_sku, ''))) not between 1 and 160
      or p_observed_at is null
      or p_observed_at > clock_timestamp() + interval '1 minute'
      or v_query_count not between 1 and 15 then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_PLAN_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'quick-pick-product-research:' || p_marketplace_account_key || ':' ||
      p_candidate_key, 0));

  select * into v_queue
  from public.ebay_luna_opportunity_queue queue_row
  where queue_row.id = p_opportunity_id
    and queue_row.candidate_key = p_candidate_key
    and queue_row.supplier_product_id = p_luna_product_id
    and queue_row.supplier_variant_id = p_luna_variant_id
    and queue_row.supplier_sku = p_supplier_sku
    and queue_row.assessment #>>
      '{lunaQuickPickOperationV1,contractVersion}' =
      'QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1'
  for update;
  if not found then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_IDENTITY_UNPROVEN';
  end if;

  v_family_demand_status := coalesce(
    v_queue.assessment #>> '{market,familyDemandStatus}',
    v_queue.assessment #>> '{radarFactoryCandidateV1,familyDemandStatus}',
    v_queue.assessment #>>
      '{radarFactoryCandidateV1,lineage,familyDemandStatus}',
    v_queue.assessment #>>
      '{sellerOsDeterministicFactory,lineage,familyDemandStatus}',
    case when v_queue.assessment #>>
      '{productResearchRequiredV1,required}' = 'true'
      then 'FAMILY_DEMAND_UNPROVEN' else null end
  );
  if v_family_demand_status is null or v_family_demand_status not in (
      'FAMILY_DEMAND_UNPROVEN', 'FAMILY_DEMAND_UNAVAILABLE',
      'DEMAND_NOT_PROVEN') then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_NOT_REQUIRED';
  end if;

  v_variant_hash := 'sha256:' || encode(extensions.digest(
    convert_to(p_luna_variant_id, 'UTF8'), 'sha256'), 'hex');
  if exists (
    select 1
    from jsonb_to_recordset(p_queries) as query_row(
      ordinal integer,
      search_query text,
      query_hash text,
      cluster_key_hash text,
      category_id text,
      candidate_count integer,
      candidate_variant_hashes text[]
    )
    where query_row.ordinal not between 1 and 15
      or char_length(trim(coalesce(query_row.search_query, ''))) not between 3 and 100
      or query_row.query_hash !~ '^sha256:[0-9a-f]{64}$'
      or query_row.cluster_key_hash !~ '^sha256:[0-9a-f]{64}$'
      or query_row.candidate_count <> 1
      or query_row.candidate_variant_hashes is distinct from array[v_variant_hash]
  ) then
    raise exception 'QUICK_PICK_PRODUCT_RESEARCH_QUERY_SCOPE_INVALID';
  end if;

  select plan.* into v_plan
  from public.marketplace_product_research_query_plans plan
  where plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'QUICK_PICK_RESEARCH_REQUIRED'
    and plan.source_candidate_key = p_candidate_key
    and plan.source_luna_product_id = p_luna_product_id
    and plan.subject_supplier_variant_id = p_luna_variant_id
  order by plan.created_at desc
  limit 1;

  if not found then
    -- An already-active plan for the same exact Luna variant remains the
    -- authority. Link Quick Pick to it instead of creating competing work.
    select plan.* into v_plan
    from public.marketplace_product_research_query_plans plan
    join public.marketplace_product_research_query_tasks task
      on task.plan_id = plan.id
    where plan.marketplace_account_key = p_marketplace_account_key
      and plan.marketplace = 'EBAY_US'
      and plan.status = 'ACTIVE'
      and task.status = 'PENDING'
      and task.candidate_variant_hashes @> array[v_variant_hash]
    order by plan.created_at
    limit 1;
  end if;

  if not found then
    insert into public.marketplace_product_research_query_plans(
      id, marketplace_account_key, marketplace, run_id, plan_version,
      input_hash, status, query_count, candidate_count, source_context,
      subject_listing_id, subject_item_id, subject_supplier_variant_id,
      request_receipt_id, source_candidate_key, source_luna_product_id,
      source_supplier_sku, source_opportunity_id
    ) values (
      p_plan_id, p_marketplace_account_key, 'EBAY_US', null, p_plan_version,
      p_input_hash, 'ACTIVE', v_query_count, 1,
      'QUICK_PICK_RESEARCH_REQUIRED', null, null, p_luna_variant_id,
      null, p_candidate_key, p_luna_product_id, p_supplier_sku,
      p_opportunity_id
    ) returning * into v_plan;

    insert into public.marketplace_product_research_query_tasks(
      plan_id, marketplace_account_key, marketplace, ordinal, search_query,
      query_hash, cluster_key_hash, category_id, candidate_count,
      candidate_variant_hashes
    )
    select v_plan.id, p_marketplace_account_key, 'EBAY_US', query_row.ordinal,
      query_row.search_query, query_row.query_hash, query_row.cluster_key_hash,
      query_row.category_id, query_row.candidate_count,
      query_row.candidate_variant_hashes
    from jsonb_to_recordset(p_queries) as query_row(
      ordinal integer,
      search_query text,
      query_hash text,
      cluster_key_hash text,
      category_id text,
      candidate_count integer,
      candidate_variant_hashes text[]
    );
    v_created := true;
  end if;

  v_research_state := case
    when v_plan.status = 'COMPLETED' then 'COMPLETED'
    when p_worker_capability_fresh then 'CLAIMABLE'
    else 'WAITING_FOR_WORKER'
  end;
  v_assessment := v_queue.assessment || jsonb_build_object(
    'quickPickProductResearchHandoffV1', jsonb_build_object(
      'contractVersion', 'QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_V1',
      'candidateId', p_candidate_key,
      'lunaProductId', p_luna_product_id,
      'lunaVariantId', p_luna_variant_id,
      'supplierSku', p_supplier_sku,
      'planId', v_plan.id,
      'planStatus', v_plan.status,
      'researchState', v_research_state,
      'workerCapabilityFresh', p_worker_capability_fresh,
      'observedAt', p_observed_at,
      'marketplaceWrites', 0
    ));
  update public.ebay_luna_opportunity_queue
  set assessment = v_assessment,
      updated_at = greatest(updated_at, p_observed_at)
  where id = v_queue.id;

  return jsonb_build_object(
    'planId', v_plan.id,
    'planCreated', v_created,
    'planStatus', v_plan.status,
    'researchState', v_research_state,
    'workerCapabilityFresh', p_worker_capability_fresh,
    'candidateId', p_candidate_key,
    'lunaProductId', p_luna_product_id,
    'lunaVariantId', p_luna_variant_id,
    'marketplaceWrites', 0
  );
end;
$$;

revoke all on function public.create_or_reuse_quick_pick_product_research_plan_v1(
  uuid, text, text, text, uuid, text, text, text, text, boolean,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.create_or_reuse_quick_pick_product_research_plan_v1(
  uuid, text, text, text, uuid, text, text, text, text, boolean,
  timestamptz, jsonb
) to service_role;

comment on function public.create_or_reuse_quick_pick_product_research_plan_v1(
  uuid, text, text, text, uuid, text, text, text, text, boolean,
  timestamptz, jsonb
) is 'Idempotently binds one eligible processed Quick Pick candidate to the existing durable Product Research plan/task authority. Preserves pending work while the browser worker is unavailable and performs zero marketplace writes.';

notify pgrst, 'reload schema';
