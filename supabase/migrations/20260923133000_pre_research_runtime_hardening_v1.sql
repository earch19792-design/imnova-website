-- PRE_RESEARCH_RUNTIME_HARDENING_V1
-- Keep member failures local to the member. The browser worker remains the
-- only executor of market capture; this migration never performs market IO.

create or replace function public.reconcile_seller_os_pre_research_batch_member_v1()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_member public.seller_os_pre_research_batch_members_v1%rowtype;
  v_state text;
begin
  v_state := case
    when new.status = 'COMPLETED' then 'COMPLETED'
    when new.worker_lease_owner is not null
      and new.worker_lease_expires_at > clock_timestamp() then 'RUNNING'
    when new.worker_last_result->>'state' in
      ('RECOVERY_POLICY_EXHAUSTED','RELEASED_RETRY_SAFE',
        'STALE_LEASE_REVIEW_REQUIRED') then 'NEEDS_ATTENTION'
    else 'PENDING' end;

  -- Canonical plans can be reused by more than one idempotent batch. Reconcile
  -- every attached membership, never just the first row returned by plan_id.
  for v_member in
    select * from public.seller_os_pre_research_batch_members_v1
    where plan_id = new.id order by batch_id,ordinal for update
  loop
  update public.seller_os_pre_research_batch_members_v1
  set execution_state = v_state,
    started_at = case when v_state in ('RUNNING','NEEDS_ATTENTION','COMPLETED')
      then coalesce(started_at,new.worker_last_claimed_at,clock_timestamp())
      else started_at end,
    completed_at = case when v_state = 'COMPLETED' then new.completed_at
      else null end,
    bounded_failure_reason = case when v_state = 'NEEDS_ATTENTION'
      then new.worker_last_release_code else null end,
    retry_safety = case when v_state = 'NEEDS_ATTENTION'
      then new.worker_last_result->>'retrySafety' else null end,
    updated_at = clock_timestamp()
  where member_id = v_member.member_id;

  -- PENDING siblings have priority over a failed member in the batch state.
  -- NEEDS_ATTENTION is terminal only after every sibling has settled.
  update public.seller_os_pre_research_batches_v1 batch
  set batch_state = case
      when not exists (select 1
        from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id = batch.batch_id and m.execution_state <> 'COMPLETED')
        then 'COMPLETED'
      when exists (select 1
        from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id = batch.batch_id
          and m.execution_state in ('PENDING','RUNNING')) then 'RUNNING'
      else 'NEEDS_ATTENTION' end,
    started_at = coalesce(batch.started_at,clock_timestamp()),
    completed_at = case when not exists (select 1
      from public.seller_os_pre_research_batch_members_v1 m
      where m.batch_id = batch.batch_id
        and m.execution_state in ('PENDING','RUNNING'))
      then coalesce(batch.completed_at,clock_timestamp()) else null end,
    updated_at = clock_timestamp()
  where batch.batch_id = v_member.batch_id;

  if v_state is distinct from v_member.execution_state
      and v_state in ('RUNNING','NEEDS_ATTENTION','COMPLETED') then
    insert into public.seller_os_pre_research_batch_events_v1(
      batch_id,member_id,event_type,actor_kind,actor_subject,detail)
    values (v_member.batch_id,v_member.member_id,v_state,
      'DATABASE_RECONCILER','PRE_RESEARCH_RUNTIME_HARDENING_V1',
      jsonb_build_object('planId',new.id,'claimCount',new.worker_claim_count,
        'failureCode',case when v_state = 'NEEDS_ATTENTION'
          then new.worker_last_release_code else null end,
        'retrySafety',case when v_state = 'NEEDS_ATTENTION'
          then new.worker_last_result->>'retrySafety' else null end));
  end if;
  end loop;
  return new;
end $function$;

-- Explicit worker preparation performs bounded lease recovery. The separate
-- next-plan lookup below remains strictly read-only.
create or replace function public.prepare_seller_os_pre_research_batch_runner_v1(
  p_marketplace_account_key text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_stale record;
  v_retry_safe boolean;
  v_healed integer := 0;
  v_recovered integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
      or char_length(coalesce(p_marketplace_account_key,'')) not between 8 and 160
    then raise exception 'TEO_PRE_RESEARCH_RUNNER_PREPARE_DENIED'; end if;

  -- Heal historical batches that were stranded by the old batch-state order.
  update public.seller_os_pre_research_batches_v1 batch
  set batch_state = 'RUNNING',
    started_at = coalesce(batch.started_at,clock_timestamp()),
    completed_at = null,updated_at = clock_timestamp()
  from public.seller_os_pre_research_command_capabilities_v1 capability
  where capability.capability_id = batch.owner_authorization_id
    and batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state = 'NEEDS_ATTENTION' and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
    and exists (select 1 from public.seller_os_pre_research_batch_members_v1 m
      where m.batch_id = batch.batch_id and m.execution_state = 'PENDING');
  get diagnostics v_healed = row_count;

  select plan.id as plan_id,plan.worker_claim_count,
    plan.worker_lease_owner is not null as had_lease,
    exists (select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.status = 'PENDING'
        and task.marketplace_account_key = p_marketplace_account_key
        and task.marketplace = 'EBAY_US') as has_pending_task
  into v_stale
  from public.marketplace_product_research_query_plans plan
  join public.seller_os_pre_research_batch_members_v1 member
    on member.plan_id = plan.id
  join public.seller_os_pre_research_batches_v1 batch
    on batch.batch_id = member.batch_id
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id = batch.owner_authorization_id
  where batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state in ('AUTHORIZED','RUNNING','NEEDS_ATTENTION')
    and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
    and member.execution_state in ('PENDING','RUNNING','NEEDS_ATTENTION')
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.pre_research_rerun_cohort_id is null
    and plan.status = 'ACTIVE'
    and (plan.worker_lease_owner is not null
      or member.execution_state = 'RUNNING'
      or (member.execution_state in ('PENDING','RUNNING')
        and not exists (select 1
        from public.marketplace_product_research_query_tasks task
        where task.plan_id = plan.id and task.status = 'PENDING'
          and task.marketplace_account_key = p_marketplace_account_key
          and task.marketplace = 'EBAY_US')))
    and (plan.worker_lease_expires_at is null
      or plan.worker_lease_expires_at <= clock_timestamp())
  order by batch.created_at,member.ordinal
  limit 1 for update of plan skip locked;

  if found then
    v_recovered := 1;
    v_retry_safe := v_stale.worker_claim_count < 5
      and v_stale.has_pending_task;
    update public.marketplace_product_research_query_plans plan
    set worker_lease_owner = null,worker_lease_expires_at = null,
      worker_last_release_code = case
        when v_retry_safe then 'PRODUCT_RESEARCH_STALE_LEASE_RECOVERED'
        when not v_stale.has_pending_task
          then 'PRODUCT_RESEARCH_CAPTURE_SETTLED_REVIEW_REQUIRED'
        else 'PRODUCT_RESEARCH_STALE_LEASE_REVIEW_REQUIRED' end,
      worker_next_retry_at = null,
      worker_last_result = coalesce(plan.worker_last_result,'{}'::jsonb)
        || jsonb_build_object('state',case when v_retry_safe
          then 'STALE_LEASE_RECOVERED' else 'STALE_LEASE_REVIEW_REQUIRED' end,
          'errorCode',case
            when v_retry_safe then 'PRODUCT_RESEARCH_STALE_LEASE_RECOVERED'
            when not v_stale.has_pending_task
              then 'PRODUCT_RESEARCH_CAPTURE_SETTLED_REVIEW_REQUIRED'
            else 'PRODUCT_RESEARCH_STALE_LEASE_REVIEW_REQUIRED' end,
          'retrySafety',case when v_retry_safe
            then 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
            else 'ENGINEERING_REQUIRED' end,
          'recoveredAt',clock_timestamp()),
      updated_at = clock_timestamp()
    where plan.id = v_stale.plan_id and plan.status = 'ACTIVE';
    insert into public.seller_os_pre_research_batch_events_v1(
      batch_id,member_id,event_type,actor_kind,actor_subject,detail)
    select member.batch_id,member.member_id,'RESUMED',
      'DATABASE_RECONCILER','PRE_RESEARCH_RUNTIME_HARDENING_V1',
      jsonb_build_object('planId',v_stale.plan_id,
        'leaseRecovery',case when v_stale.had_lease
          then 'EXPIRED' else 'ORPHANED' end,
        'retrySafe',v_retry_safe,
        'claimCount',v_stale.worker_claim_count)
    from public.seller_os_pre_research_batch_members_v1 member
    where member.plan_id = v_stale.plan_id;
  end if;

  return jsonb_build_object('healedBatches',v_healed,
    'recoveredLeases',v_recovered);
end $function$;

create or replace function public.next_seller_os_pre_research_batch_plan_v1(
  p_marketplace_account_key text)
returns jsonb language sql security definer set search_path = '' stable as $function$
  select case when not public.is_seller_os_service_role_request_v1()
    then null::jsonb else coalesce((select jsonb_build_object(
      'batchId',batch.batch_id,'memberId',member.member_id,
      'planId',member.plan_id)
  from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id = batch.owner_authorization_id
  join public.seller_os_pre_research_batch_members_v1 member
    on member.batch_id = batch.batch_id
  join public.marketplace_product_research_query_plans plan
    on plan.id = member.plan_id
  where batch.marketplace_account_key = p_marketplace_account_key
    and batch.batch_state in ('AUTHORIZED','RUNNING')
    and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
    and member.execution_state = 'PENDING'
    and plan.marketplace_account_key = p_marketplace_account_key
    and plan.marketplace = 'EBAY_US'
    and plan.status = 'ACTIVE'
    and plan.source_context = 'LUNA_PRE_RESEARCH'
    and plan.pre_research_rerun_cohort_id is null
    and plan.worker_claim_count < 5
    and plan.worker_lease_owner is null
    and (plan.worker_lease_expires_at is null
      or plan.worker_lease_expires_at <= clock_timestamp())
    and (plan.worker_next_retry_at is null
      or plan.worker_next_retry_at <= clock_timestamp())
    and exists (select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.status = 'PENDING'
        and task.marketplace_account_key = p_marketplace_account_key
        and task.marketplace = 'EBAY_US')
  order by batch.created_at,member.ordinal limit 1),
    jsonb_build_object('batchId',null,'memberId',null,'planId',null)) end
$function$;

-- A resume is selective: a non-retry-safe member cannot hold up a safe one.
-- Completed members are never touched, including on repeated resume calls.
create or replace function public.resume_seller_os_pre_research_batch_v1(
  p_batch_id uuid,p_owner_user_id uuid,p_command_client_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_batch public.seller_os_pre_research_batches_v1%rowtype;
  v_count integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'TEO_PRE_RESEARCH_RESUME_DENIED'; end if;
  select batch.* into v_batch
  from public.seller_os_pre_research_batches_v1 batch
  join public.seller_os_pre_research_command_capabilities_v1 capability
    on capability.capability_id = batch.owner_authorization_id
  where batch.batch_id = p_batch_id and batch.owner_user_id = p_owner_user_id
    and batch.command_client_id = p_command_client_id and capability.enabled
    and (capability.expires_at is null
      or capability.expires_at > clock_timestamp())
  for update of batch;
  if not found then raise exception 'TEO_PRE_RESEARCH_RESUME_DENIED'; end if;

  update public.seller_os_pre_research_batch_members_v1 member
  set execution_state = 'PENDING',bounded_failure_reason = null,
    retry_safety = null,updated_at = clock_timestamp()
  from public.marketplace_product_research_query_plans plan
  where member.batch_id = p_batch_id and member.plan_id = plan.id
    and member.execution_state = 'NEEDS_ATTENTION'
    and member.retry_safety = 'SAFE_IDEMPOTENT_RUNTIME_RESUME'
    and plan.status = 'ACTIVE' and plan.worker_claim_count < 5
    and (plan.worker_lease_owner is null
      or plan.worker_lease_expires_at <= clock_timestamp())
    and exists (select 1 from public.marketplace_product_research_query_tasks task
      where task.plan_id = plan.id and task.status = 'PENDING');
  get diagnostics v_count = row_count;
  if v_count > 0 then
    update public.seller_os_pre_research_batches_v1
    set batch_state = 'RUNNING',completed_at = null,
      started_at = coalesce(started_at,clock_timestamp()),
      updated_at = clock_timestamp()
    where batch_id = p_batch_id;
    insert into public.seller_os_pre_research_batch_events_v1(
      batch_id,event_type,actor_kind,actor_subject,detail)
    values (p_batch_id,'RESUMED','COMMAND_CLIENT',p_command_client_id,
      jsonb_build_object('resumedMembers',v_count));
  end if;
  return jsonb_build_object('batchId',p_batch_id,'resumedMembers',v_count);
end $function$;

revoke all on function public.next_seller_os_pre_research_batch_plan_v1(text)
  from public,anon,authenticated;
revoke all on function public.prepare_seller_os_pre_research_batch_runner_v1(text)
  from public,anon,authenticated;
revoke all on function public.resume_seller_os_pre_research_batch_v1(
  uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.next_seller_os_pre_research_batch_plan_v1(text)
  to service_role;
grant execute on function public.prepare_seller_os_pre_research_batch_runner_v1(text)
  to service_role;
grant execute on function public.resume_seller_os_pre_research_batch_v1(
  uuid,uuid,text) to service_role;
