create table public.seller_os_selfhost_runtime_sessions_v1 (
  session_id uuid primary key default extensions.gen_random_uuid(),
  instance_key text not null,
  started_at timestamptz not null,
  prior_heartbeat_at timestamptz null,
  last_heartbeat_at timestamptz not null,
  resume_gap_seconds integer null,
  resumed_from_gap boolean not null default false,
  catch_up_candidate_count integer not null default 0,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_selfhost_session_instance_check check (
    instance_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'
  ),
  constraint seller_os_selfhost_session_gap_check check (
    resume_gap_seconds is null or resume_gap_seconds between 0 and 2592000
  ),
  constraint seller_os_selfhost_session_catch_up_check check (
    catch_up_candidate_count between 0 and 16
  ),
  constraint seller_os_selfhost_session_status_check check (
    status in ('ACTIVE', 'SUPERSEDED')
  )
);

create index seller_os_selfhost_runtime_sessions_latest_v1
  on public.seller_os_selfhost_runtime_sessions_v1 (
    instance_key, started_at desc
  );

create table public.seller_os_selfhost_runtime_job_runs_v1 (
  run_id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references
    public.seller_os_selfhost_runtime_sessions_v1(session_id),
  job_name text not null,
  scheduled_slot bigint not null,
  trigger_kind text not null,
  status text not null,
  attempt_count integer not null default 1,
  lease_expires_at timestamptz not null,
  started_at timestamptz not null,
  last_started_at timestamptz not null,
  completed_at timestamptz null,
  http_status smallint null,
  outcome_code text null,
  elapsed_ms integer null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_selfhost_job_name_check check (
    job_name ~ '^[a-z0-9][a-z0-9-]{2,79}$'
  ),
  constraint seller_os_selfhost_job_slot_check check (scheduled_slot > 0),
  constraint seller_os_selfhost_job_trigger_check check (
    trigger_kind in ('SCHEDULE', 'CATCH_UP', 'ONCE', 'QUEUE')
  ),
  constraint seller_os_selfhost_job_status_check check (
    status in ('RUNNING', 'SUCCEEDED', 'FAILED')
  ),
  constraint seller_os_selfhost_job_attempt_check check (
    attempt_count between 1 and 20
  ),
  constraint seller_os_selfhost_job_http_check check (
    http_status is null or http_status between 100 and 599
  ),
  constraint seller_os_selfhost_job_outcome_check check (
    outcome_code is null or outcome_code ~ '^[A-Z0-9_]{2,80}$'
  ),
  constraint seller_os_selfhost_job_elapsed_check check (
    elapsed_ms is null or elapsed_ms between 0 and 14400000
  ),
  unique (job_name, scheduled_slot)
);

create index seller_os_selfhost_runtime_job_runs_latest_v1
  on public.seller_os_selfhost_runtime_job_runs_v1 (
    job_name, scheduled_slot desc
  );

create index seller_os_selfhost_runtime_job_runs_lease_v1
  on public.seller_os_selfhost_runtime_job_runs_v1 (
    status, lease_expires_at
  ) where status = 'RUNNING';

create or replace function public.start_seller_os_selfhost_runtime_v1(
  p_instance_key text,
  p_started_at timestamptz,
  p_jobs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_instance_key text := lower(trim(coalesce(p_instance_key, '')));
  v_started_at timestamptz := coalesce(p_started_at, clock_timestamp());
  v_prior_heartbeat_at timestamptz;
  v_resume_gap_seconds integer;
  v_session_id uuid;
  v_plan jsonb := '[]'::jsonb;
  v_job jsonb;
  v_job_name text;
  v_every_minutes integer;
  v_minute_offset integer;
  v_max_catch_up_minutes integer;
  v_current_slot bigint;
  v_latest_slot bigint;
  v_last_success_slot bigint;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_instance_key !~ '^[a-z0-9][a-z0-9_-]{2,63}$'
      or jsonb_typeof(p_jobs) <> 'array'
      or jsonb_array_length(p_jobs) not between 1 and 16 then
    raise exception 'SELFHOST_RUNTIME_START_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'seller-os-selfhost:' || v_instance_key, 0));
  select last_heartbeat_at into v_prior_heartbeat_at
  from public.seller_os_selfhost_runtime_sessions_v1
  where instance_key = v_instance_key
  order by started_at desc, created_at desc
  limit 1;

  if v_prior_heartbeat_at is not null then
    v_resume_gap_seconds := greatest(0, least(2592000,
      floor(extract(epoch from v_started_at - v_prior_heartbeat_at))::integer));
  end if;

  update public.seller_os_selfhost_runtime_sessions_v1
  set status = 'SUPERSEDED', updated_at = clock_timestamp()
  where instance_key = v_instance_key and status = 'ACTIVE';

  insert into public.seller_os_selfhost_runtime_sessions_v1 (
    instance_key, started_at, prior_heartbeat_at, last_heartbeat_at,
    resume_gap_seconds, resumed_from_gap
  ) values (
    v_instance_key, v_started_at, v_prior_heartbeat_at, v_started_at,
    v_resume_gap_seconds, coalesce(v_resume_gap_seconds > 180, false)
  ) returning session_id into v_session_id;

  v_current_slot := floor(extract(epoch from v_started_at) / 60)::bigint;
  for v_job in select value from jsonb_array_elements(p_jobs)
  loop
    v_job_name := trim(coalesce(v_job ->> 'name', ''));
    if v_job_name !~ '^[a-z0-9][a-z0-9-]{2,79}$'
        or coalesce(v_job ->> 'everyMinutes', '') !~ '^[0-9]{1,5}$'
        or coalesce(v_job ->> 'minuteOffset', '') !~ '^[0-9]{1,5}$'
        or coalesce(v_job ->> 'maxCatchUpMinutes', '') !~ '^[0-9]{1,5}$' then
      raise exception 'SELFHOST_RUNTIME_JOB_SPEC_INVALID';
    end if;
    v_every_minutes := (v_job ->> 'everyMinutes')::integer;
    v_minute_offset := (v_job ->> 'minuteOffset')::integer;
    v_max_catch_up_minutes := (v_job ->> 'maxCatchUpMinutes')::integer;
    if v_every_minutes not between 1 and 10080
        or v_minute_offset not between 0 and 10079
        or v_max_catch_up_minutes not between 1 and 10080 then
      raise exception 'SELFHOST_RUNTIME_JOB_SPEC_OUT_OF_RANGE';
    end if;
    if v_job -> 'catchUp' <> 'true'::jsonb then
      continue;
    end if;
    v_latest_slot := v_current_slot - (
      ((v_current_slot - v_minute_offset) % v_every_minutes
        + v_every_minutes) % v_every_minutes
    );
    select max(scheduled_slot) into v_last_success_slot
    from public.seller_os_selfhost_runtime_job_runs_v1
    where job_name = v_job_name and status = 'SUCCEEDED';
    if v_latest_slot > coalesce(v_last_success_slot, 0)
        and v_current_slot - v_latest_slot <= v_max_catch_up_minutes then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'name', v_job_name,
        'scheduledSlot', v_latest_slot,
        'delayMinutes', v_current_slot - v_latest_slot
      ));
    end if;
  end loop;

  update public.seller_os_selfhost_runtime_sessions_v1
  set catch_up_candidate_count = jsonb_array_length(v_plan),
      updated_at = clock_timestamp()
  where session_id = v_session_id;

  return jsonb_build_object(
    'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_START_V1',
    'sessionId', v_session_id,
    'startedAt', v_started_at,
    'priorHeartbeatAt', v_prior_heartbeat_at,
    'resumeGapSeconds', v_resume_gap_seconds,
    'resumedFromGap', coalesce(v_resume_gap_seconds > 180, false),
    'catchUp', v_plan,
    'secretValuesDisplayed', false
  );
end;
$function$;

create or replace function public.heartbeat_seller_os_selfhost_runtime_v1(
  p_session_id uuid,
  p_observed_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_updated integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  update public.seller_os_selfhost_runtime_sessions_v1
  set last_heartbeat_at = greatest(last_heartbeat_at,
        coalesce(p_observed_at, clock_timestamp())),
      updated_at = clock_timestamp()
  where session_id = p_session_id and status = 'ACTIVE';
  get diagnostics v_updated = row_count;
  return jsonb_build_object(
    'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_HEARTBEAT_V1',
    'status', case when v_updated = 1 then 'HEARTBEAT_RECORDED'
      else 'SESSION_NOT_ACTIVE' end,
    'recorded', v_updated = 1,
    'secretValuesDisplayed', false
  );
end;
$function$;

create or replace function public.claim_seller_os_selfhost_runtime_job_v1(
  p_session_id uuid,
  p_job_name text,
  p_scheduled_slot bigint,
  p_trigger_kind text,
  p_lease_seconds integer,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_job_name text := trim(coalesce(p_job_name, ''));
  v_trigger_kind text := upper(trim(coalesce(p_trigger_kind, '')));
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_run_id uuid;
  v_attempt_count integer;
  v_existing_status text;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if v_job_name !~ '^[a-z0-9][a-z0-9-]{2,79}$'
      or p_scheduled_slot <= 0
      or v_trigger_kind not in ('SCHEDULE', 'CATCH_UP', 'ONCE', 'QUEUE')
      or p_lease_seconds not between 30 and 14400
      or not exists (
        select 1 from public.seller_os_selfhost_runtime_sessions_v1
        where session_id = p_session_id and status = 'ACTIVE'
      ) then
    raise exception 'SELFHOST_RUNTIME_JOB_CLAIM_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    v_job_name || ':' || p_scheduled_slot::text, 0));

  update public.seller_os_selfhost_runtime_job_runs_v1
  set session_id = p_session_id,
      trigger_kind = v_trigger_kind,
      status = 'RUNNING',
      attempt_count = attempt_count + 1,
      lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      last_started_at = v_now,
      completed_at = null,
      http_status = null,
      outcome_code = null,
      elapsed_ms = null,
      updated_at = clock_timestamp()
  where job_name = v_job_name
    and scheduled_slot = p_scheduled_slot
    and status = 'RUNNING'
    and lease_expires_at <= v_now
    and attempt_count < 20
  returning run_id, attempt_count into v_run_id, v_attempt_count;

  if v_run_id is null then
    insert into public.seller_os_selfhost_runtime_job_runs_v1 (
      session_id, job_name, scheduled_slot, trigger_kind, status,
      lease_expires_at, started_at, last_started_at
    ) values (
      p_session_id, v_job_name, p_scheduled_slot, v_trigger_kind, 'RUNNING',
      v_now + make_interval(secs => p_lease_seconds), v_now, v_now
    ) on conflict (job_name, scheduled_slot) do nothing
    returning run_id, attempt_count into v_run_id, v_attempt_count;
  end if;

  if v_run_id is null then
    select status into v_existing_status
    from public.seller_os_selfhost_runtime_job_runs_v1
    where job_name = v_job_name and scheduled_slot = p_scheduled_slot;
  else
    update public.seller_os_selfhost_runtime_sessions_v1
    set last_heartbeat_at = greatest(last_heartbeat_at, v_now),
        updated_at = clock_timestamp()
    where session_id = p_session_id;
  end if;

  return jsonb_build_object(
    'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_JOB_CLAIM_V1',
    'claimed', v_run_id is not null,
    'runId', v_run_id,
    'attemptCount', v_attempt_count,
    'status', case when v_run_id is not null then 'CLAIMED'
      when v_existing_status = 'SUCCEEDED' then 'ALREADY_SUCCEEDED'
      when v_existing_status = 'FAILED' then 'ALREADY_FAILED'
      else 'ALREADY_RUNNING' end,
    'secretValuesDisplayed', false
  );
end;
$function$;

create or replace function public.complete_seller_os_selfhost_runtime_job_v1(
  p_session_id uuid,
  p_run_id uuid,
  p_succeeded boolean,
  p_http_status integer,
  p_outcome_code text,
  p_elapsed_ms integer,
  p_completed_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_outcome_code text := upper(trim(coalesce(p_outcome_code, '')));
  v_completed_at timestamptz := coalesce(p_completed_at, clock_timestamp());
  v_updated integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  if p_http_status is not null and p_http_status not between 100 and 599
      or v_outcome_code !~ '^[A-Z0-9_]{2,80}$'
      or p_elapsed_ms not between 0 and 14400000 then
    raise exception 'SELFHOST_RUNTIME_JOB_COMPLETION_INPUT_INVALID';
  end if;
  update public.seller_os_selfhost_runtime_job_runs_v1
  set status = case when p_succeeded then 'SUCCEEDED' else 'FAILED' end,
      completed_at = v_completed_at,
      http_status = p_http_status,
      outcome_code = v_outcome_code,
      elapsed_ms = p_elapsed_ms,
      updated_at = clock_timestamp()
  where run_id = p_run_id and session_id = p_session_id
    and status = 'RUNNING';
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    update public.seller_os_selfhost_runtime_sessions_v1
    set last_heartbeat_at = greatest(last_heartbeat_at, v_completed_at),
        updated_at = clock_timestamp()
    where session_id = p_session_id;
  end if;
  return jsonb_build_object(
    'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_JOB_COMPLETION_V1',
    'recorded', v_updated = 1,
    'status', case when v_updated = 1 then 'COMPLETED'
      else 'RUN_NOT_ACTIVE' end,
    'secretValuesDisplayed', false
  );
end;
$function$;

create or replace function public.get_seller_os_selfhost_runtime_status_v1()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.seller_os_selfhost_runtime_sessions_v1%rowtype;
  v_jobs jsonb := '[]'::jsonb;
  v_heartbeat_age_seconds integer;
  v_running_count integer;
  v_stale_count integer;
  v_failed_24h_count integer;
begin
  if not public.is_seller_os_service_role_request_v1() then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;
  select * into v_session
  from public.seller_os_selfhost_runtime_sessions_v1
  order by started_at desc, created_at desc
  limit 1;
  if not found then
    return jsonb_build_object(
      'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_STATUS_V1',
      'observedAt', v_now,
      'runtimeStatus', 'NOT_STARTED',
      'session', null,
      'jobs', '[]'::jsonb,
      'counts', jsonb_build_object('running', 0, 'stale', 0,
        'failedLast24Hours', 0),
      'safety', jsonb_build_object('readOnly', true,
        'credentialsIncluded', false, 'environmentValuesIncluded', false,
        'marketplaceWrites', 0, 'databaseBusinessMutations', 0)
    );
  end if;

  v_heartbeat_age_seconds := greatest(0, floor(extract(epoch from
    v_now - v_session.last_heartbeat_at))::integer);
  select count(*) filter (where status = 'RUNNING' and lease_expires_at > v_now),
         count(*) filter (where status = 'RUNNING' and lease_expires_at <= v_now),
         count(*) filter (where status = 'FAILED'
           and completed_at >= v_now - interval '24 hours')
  into v_running_count, v_stale_count, v_failed_24h_count
  from public.seller_os_selfhost_runtime_job_runs_v1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', recent.job_name,
    'scheduledSlot', recent.scheduled_slot,
    'triggerKind', recent.trigger_kind,
    'status', case when recent.status = 'RUNNING'
        and recent.lease_expires_at <= v_now then 'STALE'
      else recent.status end,
    'attemptCount', recent.attempt_count,
    'startedAt', recent.last_started_at,
    'completedAt', recent.completed_at,
    'httpStatus', recent.http_status,
    'outcomeCode', recent.outcome_code,
    'elapsedMs', recent.elapsed_ms
  ) order by recent.job_name), '[]'::jsonb) into v_jobs
  from (
    select distinct on (job_name) *
    from public.seller_os_selfhost_runtime_job_runs_v1
    order by job_name, scheduled_slot desc, updated_at desc
  ) recent;

  return jsonb_build_object(
    'contractVersion', 'SELLER_OS_SELFHOST_RUNTIME_STATUS_V1',
    'observedAt', v_now,
    'runtimeStatus', case
      when v_heartbeat_age_seconds <= 180 then 'ONLINE'
      when v_heartbeat_age_seconds <= 86400 then 'OFFLINE_OR_HIBERNATING'
      else 'STALE' end,
    'heartbeatAgeSeconds', v_heartbeat_age_seconds,
    'session', jsonb_build_object(
      'startedAt', v_session.started_at,
      'priorHeartbeatAt', v_session.prior_heartbeat_at,
      'lastHeartbeatAt', v_session.last_heartbeat_at,
      'resumeGapSeconds', v_session.resume_gap_seconds,
      'resumedFromGap', v_session.resumed_from_gap,
      'catchUpCandidateCount', v_session.catch_up_candidate_count
    ),
    'jobs', v_jobs,
    'counts', jsonb_build_object('running', v_running_count,
      'stale', v_stale_count, 'failedLast24Hours', v_failed_24h_count),
    'safety', jsonb_build_object('readOnly', true,
      'credentialsIncluded', false, 'environmentValuesIncluded', false,
      'marketplaceWrites', 0, 'databaseBusinessMutations', 0)
  );
end;
$function$;

alter table public.seller_os_selfhost_runtime_sessions_v1
  enable row level security;
alter table public.seller_os_selfhost_runtime_sessions_v1
  force row level security;
alter table public.seller_os_selfhost_runtime_job_runs_v1
  enable row level security;
alter table public.seller_os_selfhost_runtime_job_runs_v1
  force row level security;

revoke all on table public.seller_os_selfhost_runtime_sessions_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_selfhost_runtime_job_runs_v1
  from public, anon, authenticated, service_role;
revoke all on function public.start_seller_os_selfhost_runtime_v1(
  text, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.heartbeat_seller_os_selfhost_runtime_v1(
  uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_seller_os_selfhost_runtime_job_v1(
  uuid, text, bigint, text, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_seller_os_selfhost_runtime_job_v1(
  uuid, uuid, boolean, integer, text, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_seller_os_selfhost_runtime_status_v1()
  from public, anon, authenticated;

grant execute on function public.start_seller_os_selfhost_runtime_v1(
  text, timestamptz, jsonb
) to service_role;
grant execute on function public.heartbeat_seller_os_selfhost_runtime_v1(
  uuid, timestamptz
) to service_role;
grant execute on function public.claim_seller_os_selfhost_runtime_job_v1(
  uuid, text, bigint, text, integer, timestamptz
) to service_role;
grant execute on function public.complete_seller_os_selfhost_runtime_job_v1(
  uuid, uuid, boolean, integer, text, integer, timestamptz
) to service_role;
grant execute on function public.get_seller_os_selfhost_runtime_status_v1()
  to service_role;

comment on table public.seller_os_selfhost_runtime_sessions_v1 is
  'Sanitized durable workstation runtime sessions and resume gaps. No secrets.';
comment on table public.seller_os_selfhost_runtime_job_runs_v1 is
  'Idempotent scheduler claims and bounded completion receipts for local jobs.';
comment on function public.get_seller_os_selfhost_runtime_status_v1() is
  'Service-only sanitized operational read model for the owner console and TEO.';
