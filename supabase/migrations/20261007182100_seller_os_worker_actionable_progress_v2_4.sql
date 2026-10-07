-- SELLER_OS_WORKER_RESILIENCE_AND_SELF_HEALING_V2.4
-- PROGRESS reports only work that the canonical acquisition paths can claim.
-- A plan attached exclusively to an incomplete REQUESTED batch is preserved as
-- evidence, but is not runnable work and must not create a false stuck signal.

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
    $$and plan.status = 'ACTIVE' and task.status = 'PENDING'
    and ($$,
    $$and plan.status = 'ACTIVE' and task.status = 'PENDING'
    and (
      not exists (select 1
        from public.seller_os_pre_research_batch_members_v1 member
        where member.plan_id = plan.id)
      or exists (select 1
        from public.seller_os_pre_research_batch_members_v1 member
        join public.seller_os_pre_research_batches_v1 batch
          on batch.batch_id = member.batch_id
        where member.plan_id = plan.id
          and batch.marketplace_account_key = p_marketplace_account_key
          and batch.batch_state in ('AUTHORIZED','RUNNING')
          and member.execution_state in
            ('PENDING','RUNNING','RETRY_WAIT'))
    )
    and ($$);
  if v_patched = v_definition then
    raise exception 'PRODUCT_RESEARCH_ACTIONABLE_PROGRESS_PATCH_NOT_APPLIED';
  end if;
  execute v_patched;
end
$patch_worker_reader$;

comment on function public.read_seller_os_worker_resilience_v2(text)
  is 'V2.4 read-only LIVENESS, READINESS and actionable PROGRESS projection. Incomplete REQUESTED batches remain durable but cannot create false pending work; marketplace writes: zero.';

notify pgrst, 'reload schema';
