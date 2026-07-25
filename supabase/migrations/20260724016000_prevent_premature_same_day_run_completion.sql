-- A pilot run is durable until every candidate in its bounded batch has
-- reached a terminal state and no operator/background work remains. Reaching
-- the verified-listing target alone must not hide an unfinished Research run.

create or replace function public.guard_same_day_pilot_run_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.ebay_same_day_pilot_candidates%rowtype;
  v_has_candidates boolean;
  v_has_ready boolean;
  v_has_blocked boolean;
  v_has_open_tasks boolean;
  v_has_unresolved_jobs boolean;
begin
  if new.status <> 'COMPLETED' then
    return new;
  end if;

  select exists (
    select 1
    from public.ebay_same_day_pilot_candidates candidate
    where candidate.run_id = new.id
  ) into v_has_candidates;

  select candidate.*
  into v_active
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = new.id
    and candidate.machine_state not in (
      'REJECTED', 'BLOCKED', 'READY_FOR_MANUAL_PUBLICATION',
      'VERIFIED_ACTIVE', 'COMPLETED'
    )
  order by candidate.ordinal
  limit 1;

  select
    bool_or(candidate.machine_state = 'READY_FOR_MANUAL_PUBLICATION'),
    bool_or(candidate.machine_state = 'BLOCKED')
  into v_has_ready, v_has_blocked
  from public.ebay_same_day_pilot_candidates candidate
  where candidate.run_id = new.id;

  select exists (
    select 1
    from public.ebay_same_day_pilot_human_tasks task
    where task.run_id = new.id
      and task.status = 'OPEN'
  ) into v_has_open_tasks;

  select exists (
    select 1
    from public.ebay_same_day_pilot_jobs job
    where job.run_id = new.id
      and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
  ) into v_has_unresolved_jobs;

  if not v_has_candidates or v_active.id is not null
    or coalesce(v_has_ready, false)
    or v_has_open_tasks or v_has_unresolved_jobs then
    new.status := case
      when not v_has_candidates then 'BLOCKED'
      when coalesce(v_has_ready, false) then 'READY_FOR_OPERATOR'
      when coalesce(v_has_blocked, false) then 'PARTIALLY_READY'
      else 'ACTIVE'
    end;
    new.stage := case
      when not v_has_candidates then 'BLOCKED'
      when v_active.id is not null then v_active.machine_state
      else 'QUEUE_PREPARED'
    end;
    if v_active.id is not null then
      new.next_automated_action := v_active.next_automated_action;
      new.next_human_action := v_active.next_human_action;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_same_day_pilot_run_completion
  on public.ebay_same_day_pilot_runs;
create trigger guard_same_day_pilot_run_completion
before insert or update of status
on public.ebay_same_day_pilot_runs
for each row
execute function public.guard_same_day_pilot_run_completion();

revoke all on function public.guard_same_day_pilot_run_completion()
  from public, anon, authenticated;
grant execute on function public.guard_same_day_pilot_run_completion()
  to service_role;

-- Repair only runs whose durable children prove that completion was
-- premature. Terminal historical runs remain untouched.
update public.ebay_same_day_pilot_runs run
set status = case
      when exists (
        select 1
        from public.ebay_same_day_pilot_candidates candidate
        where candidate.run_id = run.id
          and candidate.machine_state = 'READY_FOR_MANUAL_PUBLICATION'
      ) then 'READY_FOR_OPERATOR'
      when exists (
        select 1
        from public.ebay_same_day_pilot_candidates candidate
        where candidate.run_id = run.id
          and candidate.machine_state = 'BLOCKED'
      ) then 'PARTIALLY_READY'
      else 'ACTIVE'
    end,
    stage = coalesce((
      select candidate.machine_state
      from public.ebay_same_day_pilot_candidates candidate
      where candidate.run_id = run.id
        and candidate.machine_state not in (
          'REJECTED', 'BLOCKED', 'READY_FOR_MANUAL_PUBLICATION',
          'VERIFIED_ACTIVE', 'COMPLETED'
        )
      order by candidate.ordinal
      limit 1
    ), 'QUEUE_PREPARED'),
    updated_at = clock_timestamp()
where run.status = 'COMPLETED'
  and (
    exists (
      select 1
      from public.ebay_same_day_pilot_candidates candidate
      where candidate.run_id = run.id
        and candidate.machine_state not in (
          'REJECTED', 'BLOCKED', 'VERIFIED_ACTIVE', 'COMPLETED'
        )
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_human_tasks task
      where task.run_id = run.id
        and task.status = 'OPEN'
    )
    or exists (
      select 1
      from public.ebay_same_day_pilot_jobs job
      where job.run_id = run.id
        and job.status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER')
    )
  );
