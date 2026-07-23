-- Additive repair for the extraordinary authorization resolver. The original
-- function's output column `extraordinary_ordinal` collided with an
-- unqualified table column in PL/pgSQL. This migration performs no data write.

create or replace function public.authorize_ebay_reference_guided_extraordinary_replacement(
  p_attempt_id uuid,p_position integer,p_human_authorized_by uuid
) returns table(authorization_id uuid,authorized_position integer,
  extraordinary_ordinal integer,reused boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_plan public.ebay_reference_guided_extraordinary_replacement_plans%rowtype;
  v_position public.ebay_reference_guided_extraordinary_replacement_positions%rowtype;
  v_attempt public.ebay_reference_guided_generation_attempts%rowtype;
  v_existing public.ebay_reference_guided_extraordinary_authorization_events%rowtype;
  v_id uuid;
begin
  if p_attempt_id<>'f166b395-8d3a-4921-b273-1a62a6032707'::uuid
    or p_position not in (4,6) then
    raise exception 'EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_SCOPE_INVALID';
  end if;
  select plan.* into v_plan
  from public.ebay_reference_guided_extraordinary_replacement_plans plan
  where plan.attempt_id=p_attempt_id
    and plan.plan_type='CONTROLLED_TWO_POSITION_REPLACEMENT_V1' for share;
  select binding.* into v_position
  from public.ebay_reference_guided_extraordinary_replacement_positions binding
  where binding.correction_plan_id=v_plan.id and binding.position=p_position for share;
  select attempt.* into v_attempt
  from public.ebay_reference_guided_generation_attempts attempt
  where attempt.id=p_attempt_id for update;
  if v_plan.id is null or v_position.id is null or v_attempt.id is null
    or p_human_authorized_by is distinct from v_plan.created_by
    or v_plan.plan_hash<>encode(extensions.digest(convert_to(v_plan.plan_text,'UTF8'),'sha256'),'hex')
    or v_attempt.provider_calls<>(case when p_position=4 then 6 else 7 end)
    or v_attempt.ebay_writes<>0 or v_attempt.production_changed or v_attempt.retry_consumed
    or exists(select 1 from public.ebay_reference_guided_generation_jobs job
      where job.generation_attempt_id=p_attempt_id
        and (job.lease_owner is not null or job.lease_expires_at is not null))
    or exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events consumed
      where consumed.correction_plan_id=v_plan.id and consumed.event_type='CONSUMED'
        and not exists(select 1 from public.ebay_reference_guided_extraordinary_provider_events terminal
          where terminal.consumed_event_id=consumed.id
            and terminal.event_type in ('OUTPUT_PERSISTED','FAILED_FINAL'))) then
    raise exception 'EXTRAORDINARY_REPLACEMENT_AUTHORIZATION_GATE_INVALID';
  end if;
  if p_position=4 and not exists(select 1
      from public.ebay_reference_guided_generation_jobs job4
      where job4.generation_attempt_id=p_attempt_id and job4.position=4
        and job4.status='BLOCKED_FIDELITY'
        and job4.output_sha256=v_position.rejected_output_sha256) then
    raise exception 'EXTRAORDINARY_POSITION_4_NOT_READY';
  end if;
  if p_position=6 and (not exists(select 1
      from public.ebay_reference_guided_generation_jobs job4
      where job4.generation_attempt_id=p_attempt_id and job4.position=4
        and job4.status='PASSED'
        and job4.output_sha256<>(select binding4.rejected_output_sha256
          from public.ebay_reference_guided_extraordinary_replacement_positions binding4
          where binding4.correction_plan_id=v_plan.id and binding4.position=4)
        and exists(select 1 from public.ebay_reference_guided_asset_review_events review
          where review.attempt_id=p_attempt_id and review.asset_ordinal=4
            and review.preview_sha256=job4.output_sha256
            and review.decision='APPROVED'))
    or not exists(select 1
      from public.ebay_reference_guided_extraordinary_authorization_events auth4
      where auth4.correction_plan_id=v_plan.id and auth4.position=4
        and auth4.extraordinary_ordinal=7)
    or not exists(select 1 from public.ebay_reference_guided_generation_jobs job6
      where job6.generation_attempt_id=p_attempt_id and job6.position=6
        and job6.status='BLOCKED_FIDELITY'
        and job6.output_sha256=v_position.rejected_output_sha256)) then
    raise exception 'EXTRAORDINARY_POSITION_6_BLOCKED_UNTIL_POSITION_4_PASSED';
  end if;
  select existing.* into v_existing
  from public.ebay_reference_guided_extraordinary_authorization_events existing
  where existing.correction_plan_id=v_plan.id and existing.position=p_position
    and existing.extraordinary_ordinal=v_position.extraordinary_ordinal;
  if found then
    return query select v_existing.id,p_position,v_position.extraordinary_ordinal,true;
    return;
  end if;
  insert into public.ebay_reference_guided_extraordinary_authorization_events(
    correction_plan_id,attempt_id,position,extraordinary_ordinal,event_type,
    human_authorized_by,human_confirmation_hash
  ) values(v_plan.id,p_attempt_id,p_position,v_position.extraordinary_ordinal,
    'AUTHORIZED',p_human_authorized_by,encode(extensions.digest(convert_to(
      v_plan.plan_hash||'|'||p_position::text||'|'||v_position.extraordinary_ordinal::text||'|'||p_human_authorized_by::text,
      'UTF8'),'sha256'),'hex')) returning id into v_id;
  return query select v_id,p_position,v_position.extraordinary_ordinal,false;
end;
$$;

revoke all on function public.authorize_ebay_reference_guided_extraordinary_replacement(uuid,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.authorize_ebay_reference_guided_extraordinary_replacement(uuid,integer,uuid)
  to service_role;

notify pgrst,'reload schema';
