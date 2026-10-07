-- SELLER_OS_PRE_RESEARCH_ATTACHMENT_RECOVERY_V2_2
--
-- Attach every historical member that already has one exact canonical plan.
-- Candidates that cannot produce a canonical query are isolated separately by
-- the service-role reconciler; no synthetic query or marketplace write is
-- allowed.

with matches as (
  select member.member_id,member.batch_id,plan.id as plan_id,
    plan.status,plan.completed_at,
    row_number() over (partition by member.member_id
      order by plan.created_at desc,plan.id) as match_rank,
    count(*) over (partition by member.member_id) as match_count
  from public.seller_os_pre_research_batch_members_v1 member
  join public.seller_os_pre_research_batches_v1 batch
    on batch.batch_id = member.batch_id
  join public.marketplace_product_research_query_plans plan
    on plan.marketplace_account_key = batch.marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.pre_research_rerun_cohort_id is null
    and plan.source_luna_product_id = member.luna_product_id
    and plan.subject_supplier_variant_id = member.luna_variant_id
    and plan.source_supplier_sku = member.luna_sku
    and plan.source_candidate_key = member.source_candidate_key
    and plan.source_product_truth_fingerprint =
      member.product_truth_fingerprint
  where batch.batch_state = 'REQUESTED' and member.plan_id is null
), attached as (
  update public.seller_os_pre_research_batch_members_v1 member
  set plan_id = matches.plan_id,
    execution_state = case when matches.status = 'COMPLETED'
      then 'COMPLETED' else 'PENDING' end,
    completed_at = case when matches.status = 'COMPLETED'
      then matches.completed_at else null end,
    bounded_failure_reason = null,retry_safety = null,
    updated_at = clock_timestamp()
  from matches
  where member.member_id = matches.member_id
    and matches.match_rank = 1 and matches.match_count = 1
    and member.plan_id is null
  returning member.batch_id
)
insert into public.seller_os_pre_research_batch_events_v1(
  batch_id,event_type,actor_kind,actor_subject,detail)
select attached.batch_id,'PLAN_ATTACHED','DATABASE_RECONCILER',
  'SELLER_OS_PRE_RESEARCH_ATTACHMENT_RECOVERY_V2_2',
  jsonb_build_object('exactCanonicalPlansAttached',count(*),
    'recovery','HISTORICAL_EXACT_PLAN_REPLAY','marketplaceWrites',0)
from attached group by attached.batch_id;

create or replace function
public.quarantine_seller_os_missing_pre_research_plan_v2(
  p_marketplace_account_key text,p_batch_id uuid,p_member_id uuid,
  p_error_code text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_member public.seller_os_pre_research_batch_members_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
      or p_batch_id is null or p_member_id is null
      or p_error_code not in ('LUNA_PRE_RESEARCH_QUERY_EMPTY',
        'TEO_PRE_RESEARCH_ATTACHMENT_REPAIR_PLAN_FAILED') then
    raise exception 'TEO_PRE_RESEARCH_ATTACHMENT_QUARANTINE_INVALID';
  end if;
  select member.* into v_member
  from public.seller_os_pre_research_batch_members_v1 member
  join public.seller_os_pre_research_batches_v1 batch
    on batch.batch_id = member.batch_id
  where member.member_id = p_member_id and member.batch_id = p_batch_id
    and member.plan_id is null
    and batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state = 'REQUESTED'
  for update of member;
  if not found then
    raise exception 'TEO_PRE_RESEARCH_ATTACHMENT_QUARANTINE_TARGET_MISSING';
  end if;
  update public.seller_os_pre_research_batch_members_v1
  set execution_state = 'QUARANTINED',
    bounded_failure_reason = p_error_code,
    retry_safety = 'NOT_APPLICABLE',updated_at = clock_timestamp()
  where member_id = p_member_id and plan_id is null;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,member_id,event_type,actor_kind,actor_subject,detail)
  values (p_batch_id,p_member_id,'QUARANTINED','DATABASE_RECONCILER',
    'SELLER_OS_PRE_RESEARCH_ATTACHMENT_RECOVERY_V2_2',
    jsonb_build_object('failureCode',p_error_code,
      'retrySafety','NOT_APPLICABLE',
      'reason','CANONICAL_QUERY_GENERATOR_RETURNED_NO_VALID_QUERY',
      'marketplaceWrites',0));
  return jsonb_build_object('batchId',p_batch_id,'memberId',p_member_id,
    'state','QUARANTINED','errorCode',p_error_code,
    'retrySafety','NOT_APPLICABLE','marketplaceWrites',0);
end
$function$;

-- Missing means actionable attachment work. A candidate already quarantined
-- because the canonical query engine produced no query is reported under the
-- isolated count instead of remaining a false pending zero/positive.
do $patch_worker_reader$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(to_regprocedure(
    'public.read_seller_os_worker_resilience_v2(text)')) into v_definition;
  if v_definition is null then
    raise exception 'PRODUCT_RESEARCH_RESILIENCE_READER_MISSING';
  end if;
  v_patched := replace(v_definition,
    $$and batch.batch_state <> 'CANCELLED' and member.plan_id is null;$$,
    $$and batch.batch_state <> 'CANCELLED' and member.plan_id is null
    and member.execution_state <> 'QUARANTINED';$$);
  if v_patched = v_definition then
    raise exception 'PRODUCT_RESEARCH_RESILIENCE_READER_PATCH_NOT_APPLIED';
  end if;
  execute v_patched;
end
$patch_worker_reader$;

revoke all on function
  public.quarantine_seller_os_missing_pre_research_plan_v2(
    text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function
  public.quarantine_seller_os_missing_pre_research_plan_v2(
    text,uuid,uuid,text) to service_role;

comment on function
  public.quarantine_seller_os_missing_pre_research_plan_v2(
    text,uuid,uuid,text)
  is 'Fail-closed isolation for an exact historical batch member whose canonical query generator returned no valid query. Never invents queries or writes to a marketplace.';

notify pgrst, 'reload schema';
