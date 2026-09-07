-- Preserve historical Research evidence while ensuring that current commercial
-- sufficiency and canonical evidence are derived only from the plan's current
-- query-intelligence contract. Older broad-query receipts remain durable.

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
  v_intelligence_contract_version text;
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

  select status, intelligence_contract_version
  into v_plan_status, v_intelligence_contract_version
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
        and task.strategy_version = v_intelligence_contract_version
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
where task.strategy_version = plan.intelligence_contract_version
  and entity.value ->> 'itemId' ~ '^[0-9]{9,20}$'
group by plan.id,task.marketplace_account_key,task.marketplace,
  entity.value ->> 'itemId';

revoke all on table public.seller_os_product_research_canonical_evidence_v1
  from public, anon, authenticated;
grant select on table public.seller_os_product_research_canonical_evidence_v1
  to service_role;

comment on view public.seller_os_product_research_canonical_evidence_v1 is
  'Current Product Research evidence only: one Item ID per plan under the active query-intelligence contract. Historical strategy receipts remain durable but cannot make a newer strategy falsely sufficient.';

notify pgrst, 'reload schema';
