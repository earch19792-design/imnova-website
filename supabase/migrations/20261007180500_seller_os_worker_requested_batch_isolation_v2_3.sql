-- SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2.3
-- Keep incomplete REQUESTED batches fail-closed without allowing their
-- member-plan updates to abort the global worker reconciler.

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
      ('RETRY_WAIT','RELEASED_RETRY_SAFE','STALE_LEASE_RECOVERED')
      and new.worker_last_result->>'retrySafety' =
        'SAFE_IDEMPOTENT_RUNTIME_RESUME' then 'RETRY_WAIT'
    when new.worker_last_result->>'state' in
      ('QUARANTINED','RECOVERY_POLICY_EXHAUSTED',
        'STALE_LEASE_REVIEW_REQUIRED') then 'QUARANTINED'
    else 'PENDING' end;
  for v_member in select *
    from public.seller_os_pre_research_batch_members_v1
    where plan_id = new.id order by batch_id,ordinal for update
  loop
    update public.seller_os_pre_research_batch_members_v1
    set execution_state = v_state,
      started_at = case when v_state in
        ('RUNNING','RETRY_WAIT','QUARANTINED','COMPLETED')
        then coalesce(started_at,new.worker_last_claimed_at,clock_timestamp())
        else started_at end,
      completed_at = case when v_state = 'COMPLETED'
        then new.completed_at else null end,
      bounded_failure_reason = case when v_state in
        ('RETRY_WAIT','QUARANTINED') then new.worker_last_release_code
        else null end,
      retry_safety = case when v_state in ('RETRY_WAIT','QUARANTINED')
        then new.worker_last_result->>'retrySafety' else null end,
      updated_at = clock_timestamp()
    where member_id = v_member.member_id;

    -- REQUESTED is the durable fail-closed state for a batch whose complete
    -- plan invariant has not been proven. Only an already authorized runtime
    -- batch may advance from member-plan observations.
    update public.seller_os_pre_research_batches_v1 batch
    set batch_state = case
        when not exists (select 1
          from public.seller_os_pre_research_batch_members_v1 m
          where m.batch_id = batch.batch_id
            and m.execution_state <> 'COMPLETED') then 'COMPLETED'
        when exists (select 1
          from public.seller_os_pre_research_batch_members_v1 m
          where m.batch_id = batch.batch_id
            and m.execution_state in ('PENDING','RUNNING','RETRY_WAIT'))
          then 'RUNNING'
        else 'NEEDS_ATTENTION' end,
      started_at = coalesce(batch.started_at,clock_timestamp()),
      completed_at = case when not exists (select 1
        from public.seller_os_pre_research_batch_members_v1 m
        where m.batch_id = batch.batch_id
          and m.execution_state in ('PENDING','RUNNING','RETRY_WAIT'))
        then coalesce(batch.completed_at,clock_timestamp()) else null end,
      updated_at = clock_timestamp()
    where batch.batch_id = v_member.batch_id
      and batch.batch_state in ('AUTHORIZED','RUNNING','NEEDS_ATTENTION');
    if v_state is distinct from v_member.execution_state
        and v_state in ('RUNNING','RETRY_WAIT','QUARANTINED','COMPLETED') then
      insert into public.seller_os_pre_research_batch_events_v1(
        batch_id,member_id,event_type,actor_kind,actor_subject,detail)
      values (v_member.batch_id,v_member.member_id,v_state,
        'DATABASE_RECONCILER',
        'SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2',
        jsonb_build_object('planId',new.id,
          'failureCode',case when v_state in ('RETRY_WAIT','QUARANTINED')
            then new.worker_last_release_code else null end,
          'retrySafety',case when v_state in ('RETRY_WAIT','QUARANTINED')
            then new.worker_last_result->>'retrySafety' else null end,
          'requestedBatchHeldFailClosed',true,'marketplaceWrites',0));
    end if;
  end loop;
  return new;
end
$function$;

revoke all on function public.reconcile_seller_os_pre_research_batch_member_v1()
  from public,anon,authenticated,service_role;

comment on function public.reconcile_seller_os_pre_research_batch_member_v1()
  is 'V2.3 fail-isolated member reconciler: REQUESTED batches remain fail-closed until their full plan invariant is proven; marketplace writes: zero.';
