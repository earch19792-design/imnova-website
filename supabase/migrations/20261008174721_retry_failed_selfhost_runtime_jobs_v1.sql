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
    and (
      (status = 'RUNNING' and lease_expires_at <= v_now)
      or (status = 'FAILED'
        and completed_at <= v_now - interval '60 seconds')
    )
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
      when v_existing_status = 'FAILED' then 'RETRY_COOLDOWN'
      else 'ALREADY_RUNNING' end,
    'secretValuesDisplayed', false
  );
end;
$function$;

revoke all on function public.claim_seller_os_selfhost_runtime_job_v1(
  uuid, text, bigint, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_seller_os_selfhost_runtime_job_v1(
  uuid, text, bigint, text, integer, timestamptz
) to service_role;

comment on function public.claim_seller_os_selfhost_runtime_job_v1(
  uuid, text, bigint, text, integer, timestamptz
) is 'Idempotent scheduler claim with stale-lease and bounded failed-run recovery.';
