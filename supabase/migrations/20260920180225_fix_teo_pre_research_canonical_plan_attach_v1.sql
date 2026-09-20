-- TEO_PRE_RESEARCH_CANONICAL_PLAN_ATTACH_FIX_V1
-- Normal Pre-Research plan reuse is keyed by source_candidate_key, whose
-- canonical identity already binds product, variant, SKU, product truth, and
-- policy. A safely reused historical plan retains its original source snapshot;
-- the current batch and immutable member retain the current snapshot binding.

create or replace function public.attach_seller_os_pre_research_batch_plans_v1(
  p_batch_id uuid, p_owner_user_id uuid, p_command_client_id text,
  p_plans jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_batch public.seller_os_pre_research_batches_v1%rowtype; v_attached integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception 'TEO_PRE_RESEARCH_PLAN_ATTACH_INVALID';
  end if;
  select batch.* into v_batch from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id=batch.owner_authorization_id
  where batch.batch_id=p_batch_id and batch.owner_user_id=p_owner_user_id
    and batch.command_client_id=p_command_client_id and capability.enabled
    and (capability.expires_at is null or capability.expires_at > clock_timestamp())
  for update of batch;
  if not found then raise exception 'TEO_PRE_RESEARCH_BATCH_AUTHORITY_DENIED'; end if;
  if exists (select 1 from jsonb_array_elements(p_plans) item
    left join public.seller_os_pre_research_batch_members_v1 member
      on member.batch_id=p_batch_id
      and member.luna_product_id=item->>'productId'
      and member.luna_variant_id=item->>'variantId' and member.luna_sku=item->>'sku'
    left join public.marketplace_product_research_query_plans plan
      on plan.id=(item->>'planId')::uuid
      and plan.marketplace_account_key=v_batch.marketplace_account_key
      and plan.marketplace='EBAY_US' and plan.source_context='LUNA_PRE_RESEARCH'
      and plan.pre_research_rerun_cohort_id is null
      and plan.source_luna_product_id=member.luna_product_id
      and plan.subject_supplier_variant_id=member.luna_variant_id
      and plan.source_supplier_sku=member.luna_sku
      and plan.source_candidate_key=member.source_candidate_key
      and plan.source_product_truth_fingerprint=member.product_truth_fingerprint
    where member.member_id is null or plan.id is null
      or (member.plan_id is not null and member.plan_id <> plan.id)) then
    raise exception 'TEO_PRE_RESEARCH_PLAN_IDENTITY_MISMATCH';
  end if;
  update public.seller_os_pre_research_batch_members_v1 member
  set plan_id=plan.id,
    execution_state=case when plan.status='COMPLETED' then 'COMPLETED'
      else 'PENDING' end,
    completed_at=case when plan.status='COMPLETED' then plan.completed_at else null end,
    updated_at=clock_timestamp()
  from jsonb_array_elements(p_plans) item(value)
  join public.marketplace_product_research_query_plans plan
    on plan.id=(item.value->>'planId')::uuid
  where member.batch_id=p_batch_id
    and member.luna_product_id=item.value->>'productId'
    and member.luna_variant_id=item.value->>'variantId'
    and member.luna_sku=item.value->>'sku' and member.plan_id is null;
  get diagnostics v_attached=row_count;
  update public.seller_os_pre_research_batches_v1 batch set
    batch_state=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then 'COMPLETED' else batch.batch_state end,
    started_at=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then coalesce(batch.started_at,clock_timestamp()) else batch.started_at end,
    completed_at=case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 member
      where member.batch_id=p_batch_id and member.execution_state<>'COMPLETED')
      then coalesce(batch.completed_at,clock_timestamp()) else batch.completed_at end,
    updated_at=clock_timestamp() where batch.batch_id=p_batch_id;
  insert into public.seller_os_pre_research_batch_events_v1(
    batch_id,event_type,actor_kind,actor_subject,detail)
  values (p_batch_id,'PLAN_ATTACHED','COMMAND_CLIENT',p_command_client_id,
    jsonb_build_object('newPlanAttachments',v_attached));
  return jsonb_build_object('batchId',p_batch_id,'newPlanAttachments',v_attached,
    'attachedPlanCount',(select count(*) from public.seller_os_pre_research_batch_members_v1
      where batch_id=p_batch_id and plan_id is not null));
end $function$;

revoke all on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.attach_seller_os_pre_research_batch_plans_v1(
  uuid,uuid,text,jsonb) to service_role;
