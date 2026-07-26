begin;

-- Read-only operational projections and a staging-safe shadow bridge for the
-- resilient batch-5 factory. This migration creates no scheduler, dossier,
-- publication effect, eBay call, or change to the legacy state machine.
create or replace view public.ebay_listing_factory_intervention_baseline_v1
with (security_invoker = true)
as
with job_metrics as (
  select
    job.candidate_id,
    count(*) as total_jobs,
    count(*) filter (where job.status = 'COMPLETED') as completed_jobs,
    count(*) filter (where job.attempt > 1) as retry_jobs,
    count(*) filter (where job.status = 'DEAD_LETTER') as dead_letter_jobs,
    min(job.created_at) as first_job_at,
    max(job.updated_at) as last_job_at
  from public.ebay_same_day_pilot_jobs job
  where job.candidate_id is not null
  group by job.candidate_id
),
task_metrics as (
  select
    task.candidate_id,
    count(*) as human_task_count,
    count(*) filter (where task.status = 'OPEN') as open_human_task_count,
    count(*) filter (
      where task.status = 'OPEN'
        and task.created_at < now() - interval '24 hours'
    ) as stale_open_human_task_count,
    count(*) filter (where task.status = 'COMPLETED')
      as completed_human_task_count,
    coalesce(sum(task.estimated_seconds), 0) as estimated_human_seconds,
    min(task.created_at) as first_human_task_at,
    max(task.updated_at) as last_human_task_at
  from public.ebay_same_day_pilot_human_tasks task
  group by task.candidate_id
),
transition_metrics as (
  select
    transition.candidate_id,
    count(*) as total_transitions,
    min(transition.created_at) as first_transition_at,
    max(transition.created_at) as last_transition_at
  from public.ebay_same_day_pilot_transitions transition
  where transition.candidate_id is not null
  group by transition.candidate_id
),
event_metrics as (
  select
    event.candidate_id,
    count(*) as total_events,
    min(event.created_at) as first_event_at,
    max(event.created_at) as last_event_at
  from public.ebay_same_day_pilot_events event
  where event.candidate_id is not null
  group by event.candidate_id
),
handoff_metrics as (
  select
    handoff.candidate_id,
    count(*) as handoff_count,
    min(handoff.created_at) as first_handoff_at,
    max(handoff.created_at) as last_handoff_at
  from public.ebay_same_day_pilot_handoffs handoff
  group by handoff.candidate_id
)
select
  run.id as run_id,
  candidate.id as candidate_id,
  run.operation_date,
  candidate.ordinal,
  candidate.machine_state,
  candidate.factory_state,
  candidate.factory_registered_at,
  coalesce(job.total_jobs, 0) as total_jobs,
  coalesce(job.completed_jobs, 0) as completed_jobs,
  coalesce(job.retry_jobs, 0) as retry_jobs,
  coalesce(job.dead_letter_jobs, 0) as dead_letter_jobs,
  coalesce(transition.total_transitions, 0) as total_transitions,
  coalesce(event.total_events, 0) as total_events,
  coalesce(task.human_task_count, 0) as human_task_count,
  coalesce(task.open_human_task_count, 0) as open_human_task_count,
  coalesce(task.stale_open_human_task_count, 0)
    as stale_open_human_task_count,
  coalesce(task.completed_human_task_count, 0)
    as completed_human_task_count,
  coalesce(task.estimated_human_seconds, 0) as estimated_human_seconds,
  coalesce(handoff.handoff_count, 0) as handoff_count,
  least(
    candidate.created_at,
    job.first_job_at,
    transition.first_transition_at,
    event.first_event_at,
    task.first_human_task_at,
    handoff.first_handoff_at
  ) as first_activity_at,
  greatest(
    candidate.updated_at,
    job.last_job_at,
    transition.last_transition_at,
    event.last_event_at,
    task.last_human_task_at,
    handoff.last_handoff_at
  ) as last_activity_at,
  case
    when coalesce(job.completed_jobs, 0)
      + coalesce(task.completed_human_task_count, 0) = 0 then 0::numeric
    else round(
      coalesce(job.completed_jobs, 0)::numeric
      / (
        coalesce(job.completed_jobs, 0)
        + coalesce(task.completed_human_task_count, 0)
      )::numeric,
      4
    )
  end as automation_ratio
from public.ebay_same_day_pilot_candidates candidate
join public.ebay_same_day_pilot_runs run on run.id = candidate.run_id
left join job_metrics job on job.candidate_id = candidate.id
left join task_metrics task on task.candidate_id = candidate.id
left join transition_metrics transition
  on transition.candidate_id = candidate.id
left join event_metrics event on event.candidate_id = candidate.id
left join handoff_metrics handoff on handoff.candidate_id = candidate.id;

create or replace view public.ebay_listing_factory_dossier_utilization_v1
with (security_invoker = true)
as
select
  dossier.run_id,
  dossier.candidate_id,
  dossier.id as dossier_id,
  dossier.version as dossier_version,
  dossier.status as dossier_status,
  dossier.completeness_score,
  dossier.evidence_observed_at,
  dossier.evidence_expires_at,
  dossier.evidence_expires_at <= now() as is_stale,
  dossier.identity <> '{}'::jsonb as identity_present,
  dossier.supplier_and_compliance <> '{}'::jsonb as supplier_present,
  dossier.ebay_market <> '{}'::jsonb as market_present,
  dossier.economics <> '{}'::jsonb as economics_present,
  dossier.listing_package <> '{}'::jsonb as listing_present,
  dossier.visual_package <> '{}'::jsonb as visual_present,
  dossier.traceability <> '{}'::jsonb as traceability_present,
  section_metrics.section_count,
  case jsonb_typeof(dossier.traceability)
    when 'object' then (
      select count(*) from jsonb_object_keys(dossier.traceability)
    )
    when 'array' then jsonb_array_length(dossier.traceability)
    else 0
  end as traceability_entry_count,
  dossier.frozen_payload_hash is not null as frozen_payload_present,
  section_metrics.fields_used_count,
  7 - section_metrics.section_count as fields_missing_count
from public.ebay_listing_factory_dossiers dossier
cross join lateral (
  select
    count(*) filter (
      where section.value is not null
        and section.value <> '{}'::jsonb
        and section.value <> '[]'::jsonb
        and section.value <> 'null'::jsonb
    ) as section_count,
    coalesce(sum(
      case jsonb_typeof(section.value)
        when 'object' then (
          select count(*) from jsonb_object_keys(section.value)
        )
        when 'array' then jsonb_array_length(section.value)
        else case when section.value = 'null'::jsonb then 0 else 1 end
      end
    ), 0) as fields_used_count
  from (
    values
      (dossier.identity),
      (dossier.supplier_and_compliance),
      (dossier.ebay_market),
      (dossier.economics),
      (dossier.listing_package),
      (dossier.visual_package),
      (dossier.traceability)
  ) as section(value)
) section_metrics;

create or replace view public.ebay_listing_factory_shadow_bridge_coverage_v1
with (security_invoker = true)
as
with candidate_metrics as (
  select
    candidate.run_id,
    count(*) as legacy_candidate_count,
    count(*) filter (
      where candidate.factory_registered_at is not null
    ) as factory_registered_count,
    count(*) filter (where candidate.active_slot) as active_slot_count,
    max(candidate.updated_at) as last_legacy_candidate_activity_at,
    max(candidate.factory_updated_at) filter (
      where candidate.factory_registered_at is not null
    ) as last_factory_candidate_activity_at
  from public.ebay_same_day_pilot_candidates candidate
  group by candidate.run_id
),
dossier_metrics as (
  select
    dossier.run_id,
    count(*) as dossier_count,
    max(dossier.created_at) as last_dossier_activity_at
  from public.ebay_listing_factory_dossiers dossier
  group by dossier.run_id
),
transition_metrics as (
  select
    transition.run_id,
    count(*) as factory_transition_count,
    max(transition.occurred_at) as last_factory_transition_at
  from public.ebay_listing_factory_transitions transition
  group by transition.run_id
),
effect_metrics as (
  select
    effect.run_id,
    count(*) as effect_count,
    max(effect.updated_at) as last_effect_activity_at
  from public.ebay_listing_factory_effect_outbox effect
  group by effect.run_id
),
quarantine_metrics as (
  select
    quarantine.run_id,
    count(*) as quarantine_count,
    max(quarantine.updated_at) as last_quarantine_activity_at
  from public.ebay_listing_factory_quarantine_cases quarantine
  group by quarantine.run_id
),
legacy_activity as (
  select activity.run_id, max(activity.observed_at) as last_legacy_activity_at
  from (
    select run.id as run_id, run.updated_at as observed_at
    from public.ebay_same_day_pilot_runs run
    union all
    select candidate.run_id, candidate.updated_at
    from public.ebay_same_day_pilot_candidates candidate
    union all
    select job.run_id, job.updated_at
    from public.ebay_same_day_pilot_jobs job
    union all
    select event.run_id, event.created_at
    from public.ebay_same_day_pilot_events event
  ) activity
  group by activity.run_id
)
select
  run.id as run_id,
  run.operation_date,
  coalesce(candidate.legacy_candidate_count, 0) as legacy_candidate_count,
  coalesce(candidate.factory_registered_count, 0)
    as factory_registered_count,
  coalesce(candidate.active_slot_count, 0) as active_slot_count,
  coalesce(dossier.dossier_count, 0) as dossier_count,
  coalesce(transition.factory_transition_count, 0)
    as factory_transition_count,
  coalesce(effect.effect_count, 0) as effect_count,
  coalesce(quarantine.quarantine_count, 0) as quarantine_count,
  run.factory_initialized_at is not null as factory_initialized,
  coalesce(candidate.legacy_candidate_count, 0) = 5
    as exactly_five_candidates,
  (
    run.factory_initialized_at is not null
    and run.factory_mode = 'DRY_RUN'
    and run.publication_kill_switch_engaged
    and not run.automatic_publication_allowed
    and coalesce(effect.effect_count, 0) = 0
  ) as safe_shadow_only,
  legacy.last_legacy_activity_at,
  greatest(
    case
      when run.factory_initialized_at is not null then run.factory_updated_at
      else null
    end,
    candidate.last_factory_candidate_activity_at,
    dossier.last_dossier_activity_at,
    transition.last_factory_transition_at,
    effect.last_effect_activity_at,
    quarantine.last_quarantine_activity_at
  ) as last_factory_activity_at
from public.ebay_same_day_pilot_runs run
left join candidate_metrics candidate on candidate.run_id = run.id
left join dossier_metrics dossier on dossier.run_id = run.id
left join transition_metrics transition on transition.run_id = run.id
left join effect_metrics effect on effect.run_id = run.id
left join quarantine_metrics quarantine on quarantine.run_id = run.id
left join legacy_activity legacy on legacy.run_id = run.id;

create or replace function public.shadow_initialize_ebay_listing_factory_run_v1(
  p_run_id uuid,
  p_actor text,
  p_correlation_id uuid default gen_random_uuid(),
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_candidate_count integer;
  v_effect_count integer;
  v_initialize_result jsonb;
begin
  if p_run_id is null
    or nullif(trim(p_actor), '') is null
    or p_correlation_id is null
    or p_now is null then
    raise exception 'LISTING_FACTORY_SHADOW_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'ebay_listing_factory_shadow:' || p_run_id::text,
      0
    )
  );

  select * into v_run
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;
  if not found then
    raise exception 'LISTING_FACTORY_RUN_NOT_FOUND';
  end if;

  if v_run.factory_mode <> 'DRY_RUN'
    or not v_run.publication_kill_switch_engaged
    or v_run.automatic_publication_allowed then
    raise exception 'LISTING_FACTORY_SHADOW_SAFETY_POLICY_REQUIRED';
  end if;

  select count(*) into v_candidate_count
  from public.ebay_same_day_pilot_candidates
  where run_id = p_run_id;
  if v_candidate_count < 5 then
    raise exception 'LISTING_FACTORY_REQUIRES_FIVE_CANDIDATES';
  end if;

  select count(*) into v_effect_count
  from public.ebay_listing_factory_effect_outbox
  where run_id = p_run_id;
  if v_effect_count <> 0 then
    raise exception 'LISTING_FACTORY_SHADOW_EFFECTS_MUST_BE_ZERO';
  end if;

  -- The reused initializer only registers candidates, slots and append-only
  -- transitions. It does not create dossiers, outbox rows or external calls.
  select public.initialize_ebay_listing_factory_run_v1(
    p_run_id,
    p_actor,
    p_correlation_id
  ) into v_initialize_result;

  select * into v_run
  from public.ebay_same_day_pilot_runs
  where id = p_run_id
  for update;

  select count(*) into v_effect_count
  from public.ebay_listing_factory_effect_outbox
  where run_id = p_run_id;

  if v_run.factory_mode <> 'DRY_RUN'
    or not v_run.publication_kill_switch_engaged
    or v_run.automatic_publication_allowed
    or v_effect_count <> 0 then
    raise exception 'LISTING_FACTORY_SHADOW_POSTCONDITION_FAILED';
  end if;

  return jsonb_build_object(
    'runId', p_run_id,
    'observedAt', p_now,
    'mode', v_run.factory_mode,
    'killSwitchEngaged', v_run.publication_kill_switch_engaged,
    'automaticPublicationAllowed', v_run.automatic_publication_allowed,
    'registeredCandidates', (
      select count(*)
      from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id
        and factory_registered_at is not null
    ),
    'activeSlots', (
      select count(*)
      from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and active_slot
    ),
    'reserveCandidates', (
      select count(*)
      from public.ebay_same_day_pilot_candidates
      where run_id = p_run_id and candidate_role = 'RESERVE'
    ),
    'dossierCount', (
      select count(*)
      from public.ebay_listing_factory_dossiers
      where run_id = p_run_id
    ),
    'factoryTransitionCount', (
      select count(*)
      from public.ebay_listing_factory_transitions
      where run_id = p_run_id
    ),
    'effectCount', v_effect_count,
    'safeShadowOnly', true,
    'initializer', v_initialize_result
  );
end
$$;

revoke all on public.ebay_listing_factory_intervention_baseline_v1
  from public, anon, authenticated;
revoke all on public.ebay_listing_factory_dossier_utilization_v1
  from public, anon, authenticated;
revoke all on public.ebay_listing_factory_shadow_bridge_coverage_v1
  from public, anon, authenticated;
grant select on public.ebay_listing_factory_intervention_baseline_v1
  to service_role;
grant select on public.ebay_listing_factory_dossier_utilization_v1
  to service_role;
grant select on public.ebay_listing_factory_shadow_bridge_coverage_v1
  to service_role;

revoke all on function public.shadow_initialize_ebay_listing_factory_run_v1(
  uuid,text,uuid,timestamptz
) from public, anon, authenticated;
grant execute on function public.shadow_initialize_ebay_listing_factory_run_v1(
  uuid,text,uuid,timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
