-- Staging-only scheduler control plane for the durable same-day pilot worker.
--
-- Applying this migration never creates or enables a cron job. Activation is
-- an explicit service_role operation and requires the imnova-staging project
-- reference plus Vault secret *names*. Secret values are resolved only inside
-- the SECURITY DEFINER dispatch function and are never copied into public
-- configuration or audit rows.

create table if not exists public.ebay_same_day_pilot_scheduler_config (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'UNCONFIGURED'
    check (environment in ('UNCONFIGURED', 'STAGING')),
  supabase_project_ref text not null default 'vsfthqydfrdzulldbfbe'
    check (supabase_project_ref = 'vsfthqydfrdzulldbfbe'),
  deployment_scope text not null default 'PREVIEW'
    check (deployment_scope = 'PREVIEW'),
  enabled boolean not null default false,
  schedule text not null default '*/5 * * * *'
    check (schedule = '*/5 * * * *'),
  cron_job_name text not null default 'seller-os-same-day-pilot-staging-v1'
    check (cron_job_name = 'seller-os-same-day-pilot-staging-v1'),
  cron_job_id bigint null,
  endpoint_url_secret_name text null,
  authorization_secret_name text null,
  vercel_bypass_secret_name text null,
  endpoint_reference_hash text null
    check (endpoint_reference_hash is null or endpoint_reference_hash ~ '^[0-9a-f]{64}$'),
  enabled_at timestamptz null,
  disabled_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint ebay_same_day_pilot_scheduler_enabled_staging_check check (
    not enabled
    or (
      environment = 'STAGING'
      and deployment_scope = 'PREVIEW'
      and supabase_project_ref = 'vsfthqydfrdzulldbfbe'
      and endpoint_url_secret_name is not null
      and authorization_secret_name is not null
      and cron_job_id is not null
    )
  ),
  constraint ebay_same_day_pilot_scheduler_vault_names_check check (
    (endpoint_url_secret_name is null or endpoint_url_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
    and (authorization_secret_name is null or authorization_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
    and (vercel_bypass_secret_name is null or vercel_bypass_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
  )
);

comment on table public.ebay_same_day_pilot_scheduler_config is
  'Disabled-by-default staging scheduler configuration. Stores Vault secret names, never secret values.';

create table if not exists public.ebay_same_day_pilot_scheduler_dispatch_audit (
  id bigint generated always as identity primary key,
  dispatch_key text not null unique
    check (dispatch_key ~ '^same-day-scheduler:v1:[0-9a-f]{64}$'),
  dispatch_slot timestamptz not null,
  trigger_source text not null check (trigger_source in ('CRON', 'MANUAL', 'RETRY')),
  environment text not null check (environment in ('UNCONFIGURED', 'STAGING')),
  deployment_scope text not null check (deployment_scope = 'PREVIEW'),
  status text not null check (
    status in ('QUEUED', 'DUPLICATE_SUPPRESSED', 'SKIPPED_DISABLED',
      'BLOCKED_CONFIGURATION', 'QUEUE_FAILED')
  ),
  reason_code text not null,
  request_id bigint null,
  endpoint_reference_hash text null
    check (endpoint_reference_hash is null or endpoint_reference_hash ~ '^[0-9a-f]{64}$'),
  bypass_configured boolean not null default false,
  active_run_id uuid null references public.ebay_same_day_pilot_runs(id) on delete restrict,
  due_job_count integer not null default 0 check (due_job_count >= 0),
  worker_heartbeat_observed_at timestamptz null,
  requested_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.ebay_same_day_pilot_scheduler_dispatch_audit is
  'Append-only scheduler request metadata. Contains no URL, bearer token, bypass token, headers, response body, or secret value.';

create unique index if not exists ebay_same_day_pilot_scheduler_one_queued_slot_idx
  on public.ebay_same_day_pilot_scheduler_dispatch_audit(dispatch_slot)
  where status = 'QUEUED';

alter table public.ebay_same_day_pilot_scheduler_config enable row level security;
alter table public.ebay_same_day_pilot_scheduler_config force row level security;
alter table public.ebay_same_day_pilot_scheduler_dispatch_audit enable row level security;
alter table public.ebay_same_day_pilot_scheduler_dispatch_audit force row level security;

revoke all on table public.ebay_same_day_pilot_scheduler_config
  from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_scheduler_config
  from public, service_role;
revoke all on table public.ebay_same_day_pilot_scheduler_dispatch_audit
  from anon, authenticated;
revoke all on table public.ebay_same_day_pilot_scheduler_dispatch_audit
  from public, service_role;
revoke all on sequence public.ebay_same_day_pilot_scheduler_dispatch_audit_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.ebay_same_day_pilot_scheduler_config to service_role;
grant select on table public.ebay_same_day_pilot_scheduler_dispatch_audit to service_role;

insert into public.ebay_same_day_pilot_scheduler_config (
  singleton,
  environment,
  supabase_project_ref,
  deployment_scope,
  enabled,
  schedule,
  cron_job_name
) values (
  true,
  'UNCONFIGURED',
  'vsfthqydfrdzulldbfbe',
  'PREVIEW',
  false,
  '*/5 * * * *',
  'seller-os-same-day-pilot-staging-v1'
) on conflict (singleton) do nothing;

create or replace function public.prevent_same_day_pilot_scheduler_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'SAME_DAY_PILOT_SCHEDULER_AUDIT_APPEND_ONLY';
end;
$$;

drop trigger if exists ebay_same_day_pilot_scheduler_audit_append_only
  on public.ebay_same_day_pilot_scheduler_dispatch_audit;
create trigger ebay_same_day_pilot_scheduler_audit_append_only
before update or delete on public.ebay_same_day_pilot_scheduler_dispatch_audit
for each row execute function public.prevent_same_day_pilot_scheduler_audit_mutation();

revoke all on function public.prevent_same_day_pilot_scheduler_audit_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.dispatch_same_day_pilot_staging_worker(
  p_trigger_source text default 'CRON',
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.ebay_same_day_pilot_scheduler_config%rowtype;
  v_trigger_source text := upper(trim(coalesce(p_trigger_source, '')));
  v_dispatch_slot timestamptz := to_timestamp(
    floor(extract(epoch from p_now) / 300) * 300
  );
  v_dispatch_key text;
  v_endpoint_url text;
  v_authorization_secret text;
  v_vercel_bypass_secret text;
  v_headers jsonb;
  v_request_id bigint;
  v_active_run_id uuid;
  v_due_job_count integer := 0;
  v_worker_heartbeat timestamptz;
  v_existing_request_id bigint;
begin
  if p_now is null then
    raise exception 'SAME_DAY_PILOT_SCHEDULER_TIME_REQUIRED';
  end if;
  if v_trigger_source not in ('CRON', 'MANUAL', 'RETRY') then
    raise exception 'SAME_DAY_PILOT_SCHEDULER_TRIGGER_INVALID';
  end if;

  -- Serialize a five-minute dispatch slot. This prevents duplicate pg_net
  -- requests if cron and a manual retry arrive together.
  perform pg_advisory_xact_lock(hashtextextended('seller-os-same-day-pilot-staging-v1', 0));

  select *
    into v_config
  from public.ebay_same_day_pilot_scheduler_config
  where singleton = true;

  if not found then
    raise exception 'SAME_DAY_PILOT_SCHEDULER_CONFIG_MISSING';
  end if;

  select audit.request_id
    into v_existing_request_id
  from public.ebay_same_day_pilot_scheduler_dispatch_audit as audit
  where audit.dispatch_slot = v_dispatch_slot
    and audit.status = 'QUEUED'
  limit 1;

  if found then
    return jsonb_build_object(
      'status', 'DUPLICATE_SUPPRESSED',
      'requestId', v_existing_request_id,
      'dispatchSlot', v_dispatch_slot,
      'secretValuesDisplayed', false
    );
  end if;

  select run.id, run.last_worker_heartbeat_at
    into v_active_run_id, v_worker_heartbeat
  from public.ebay_same_day_pilot_runs as run
  where run.status in ('ACTIVE', 'PARTIALLY_READY', 'READY_FOR_OPERATOR')
  order by run.created_at desc
  limit 1;

  if v_active_run_id is not null then
    select count(*)::integer
      into v_due_job_count
    from public.ebay_same_day_pilot_jobs as job
    where job.run_id = v_active_run_id
      and (
        (job.status in ('PENDING', 'WAITING_RETRY') and job.available_at <= p_now)
        or (job.status = 'LEASED' and job.lease_expires_at <= p_now)
      );
  end if;

  v_dispatch_key := 'same-day-scheduler:v1:' || encode(
    extensions.digest(
      v_trigger_source || ':' || v_dispatch_slot::text || ':' || gen_random_uuid()::text,
      'sha256'
    ),
    'hex'
  );

  if not v_config.enabled then
    insert into public.ebay_same_day_pilot_scheduler_dispatch_audit (
      dispatch_key, dispatch_slot, trigger_source, environment, deployment_scope,
      status, reason_code, bypass_configured, active_run_id, due_job_count,
      worker_heartbeat_observed_at, requested_at
    ) values (
      v_dispatch_key, v_dispatch_slot, v_trigger_source, v_config.environment,
      v_config.deployment_scope, 'SKIPPED_DISABLED', 'SCHEDULER_DISABLED', false,
      v_active_run_id, v_due_job_count, v_worker_heartbeat, p_now
    );
    return jsonb_build_object(
      'status', 'SKIPPED_DISABLED',
      'dispatchSlot', v_dispatch_slot,
      'secretValuesDisplayed', false
    );
  end if;

  if v_config.environment <> 'STAGING'
    or v_config.deployment_scope <> 'PREVIEW'
    or v_config.supabase_project_ref <> 'vsfthqydfrdzulldbfbe' then
    insert into public.ebay_same_day_pilot_scheduler_dispatch_audit (
      dispatch_key, dispatch_slot, trigger_source, environment, deployment_scope,
      status, reason_code, bypass_configured, active_run_id, due_job_count,
      worker_heartbeat_observed_at, requested_at
    ) values (
      v_dispatch_key, v_dispatch_slot, v_trigger_source, v_config.environment,
      v_config.deployment_scope, 'BLOCKED_CONFIGURATION',
      'STAGING_PREVIEW_SCOPE_REQUIRED', false, v_active_run_id, v_due_job_count,
      v_worker_heartbeat, p_now
    );
    return jsonb_build_object(
      'status', 'BLOCKED_CONFIGURATION',
      'reasonCode', 'STAGING_PREVIEW_SCOPE_REQUIRED',
      'secretValuesDisplayed', false
    );
  end if;

  select secret.decrypted_secret
    into v_endpoint_url
  from vault.decrypted_secrets as secret
  where secret.name = v_config.endpoint_url_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;

  select secret.decrypted_secret
    into v_authorization_secret
  from vault.decrypted_secrets as secret
  where secret.name = v_config.authorization_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;

  if v_config.vercel_bypass_secret_name is not null then
    select secret.decrypted_secret
      into v_vercel_bypass_secret
    from vault.decrypted_secrets as secret
    where secret.name = v_config.vercel_bypass_secret_name
    order by secret.updated_at desc nulls last, secret.created_at desc
    limit 1;
  end if;

  v_endpoint_url := rtrim(trim(coalesce(v_endpoint_url, '')), '/');
  v_authorization_secret := trim(coalesce(v_authorization_secret, ''));
  v_vercel_bypass_secret := nullif(trim(coalesce(v_vercel_bypass_secret, '')), '');

  if v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app$'
    or length(v_authorization_secret) < 32
    or (v_config.vercel_bypass_secret_name is not null and v_vercel_bypass_secret is null) then
    insert into public.ebay_same_day_pilot_scheduler_dispatch_audit (
      dispatch_key, dispatch_slot, trigger_source, environment, deployment_scope,
      status, reason_code, bypass_configured, active_run_id, due_job_count,
      worker_heartbeat_observed_at, requested_at
    ) values (
      v_dispatch_key, v_dispatch_slot, v_trigger_source, v_config.environment,
      v_config.deployment_scope, 'BLOCKED_CONFIGURATION',
      'VAULT_REFERENCE_INVALID_OR_MISSING',
      v_config.vercel_bypass_secret_name is not null,
      v_active_run_id, v_due_job_count, v_worker_heartbeat, p_now
    );
    return jsonb_build_object(
      'status', 'BLOCKED_CONFIGURATION',
      'reasonCode', 'VAULT_REFERENCE_INVALID_OR_MISSING',
      'secretValuesDisplayed', false
    );
  end if;

  v_config.endpoint_reference_hash := encode(
    extensions.digest(v_endpoint_url, 'sha256'),
    'hex'
  );
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_authorization_secret,
    'User-Agent', 'seller-os-same-day-staging-scheduler/1',
    'X-Seller-OS-Dispatch-Key', v_dispatch_key
  );
  if v_vercel_bypass_secret is not null then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', v_vercel_bypass_secret
    );
  end if;

  begin
    select net.http_get(
      url := v_endpoint_url || '/api/cron/ebay-same-day-pilot',
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 240000
    ) into v_request_id;
  exception when others then
    -- Never persist SQLERRM: network errors may echo request details.
    insert into public.ebay_same_day_pilot_scheduler_dispatch_audit (
      dispatch_key, dispatch_slot, trigger_source, environment, deployment_scope,
      status, reason_code, endpoint_reference_hash, bypass_configured,
      active_run_id, due_job_count, worker_heartbeat_observed_at, requested_at
    ) values (
      v_dispatch_key, v_dispatch_slot, v_trigger_source, v_config.environment,
      v_config.deployment_scope, 'QUEUE_FAILED', 'PG_NET_REQUEST_QUEUE_FAILED',
      v_config.endpoint_reference_hash,
      v_config.vercel_bypass_secret_name is not null,
      v_active_run_id, v_due_job_count, v_worker_heartbeat, p_now
    );
    return jsonb_build_object(
      'status', 'QUEUE_FAILED',
      'reasonCode', 'PG_NET_REQUEST_QUEUE_FAILED',
      'secretValuesDisplayed', false
    );
  end;

  insert into public.ebay_same_day_pilot_scheduler_dispatch_audit (
    dispatch_key, dispatch_slot, trigger_source, environment, deployment_scope,
    status, reason_code, request_id, endpoint_reference_hash, bypass_configured,
    active_run_id, due_job_count, worker_heartbeat_observed_at, requested_at
  ) values (
    v_dispatch_key, v_dispatch_slot, v_trigger_source, v_config.environment,
    v_config.deployment_scope, 'QUEUED', 'PG_NET_REQUEST_QUEUED', v_request_id,
    v_config.endpoint_reference_hash,
    v_config.vercel_bypass_secret_name is not null,
    v_active_run_id, v_due_job_count, v_worker_heartbeat, p_now
  );

  return jsonb_build_object(
    'status', 'QUEUED',
    'requestId', v_request_id,
    'dispatchSlot', v_dispatch_slot,
    'activeRunPresent', v_active_run_id is not null,
    'dueJobsObserved', v_due_job_count,
    'secretValuesDisplayed', false
  );
end;
$$;

create or replace function public.enable_same_day_pilot_staging_scheduler(
  p_confirm_project_ref text,
  p_endpoint_url_secret_name text,
  p_authorization_secret_name text,
  p_vercel_bypass_secret_name text default null,
  p_schedule text default '*/5 * * * *'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_endpoint_url text;
  v_authorization_secret text;
  v_vercel_bypass_secret text;
  v_endpoint_hash text;
  v_job_name constant text := 'seller-os-same-day-pilot-staging-v1';
  v_job_id bigint;
begin
  if trim(coalesce(p_confirm_project_ref, '')) <> 'vsfthqydfrdzulldbfbe' then
    raise exception 'SAME_DAY_PILOT_STAGING_PROJECT_CONFIRMATION_REQUIRED';
  end if;
  if p_schedule is distinct from '*/5 * * * *' then
    raise exception 'SAME_DAY_PILOT_SCHEDULER_SCHEDULE_NOT_ALLOWED';
  end if;
  if coalesce(p_endpoint_url_secret_name, '') !~ '^[A-Za-z0-9_.:-]{3,200}$'
    or coalesce(p_authorization_secret_name, '') !~ '^[A-Za-z0-9_.:-]{3,200}$'
    or (p_vercel_bypass_secret_name is not null
      and p_vercel_bypass_secret_name !~ '^[A-Za-z0-9_.:-]{3,200}$') then
    raise exception 'SAME_DAY_PILOT_VAULT_SECRET_NAME_INVALID';
  end if;
  if p_endpoint_url_secret_name = p_authorization_secret_name
    or p_endpoint_url_secret_name = coalesce(p_vercel_bypass_secret_name, '')
    or p_authorization_secret_name = coalesce(p_vercel_bypass_secret_name, '') then
    raise exception 'SAME_DAY_PILOT_VAULT_REFERENCES_MUST_BE_DISTINCT';
  end if;

  select secret.decrypted_secret
    into v_endpoint_url
  from vault.decrypted_secrets as secret
  where secret.name = p_endpoint_url_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  select secret.decrypted_secret
    into v_authorization_secret
  from vault.decrypted_secrets as secret
  where secret.name = p_authorization_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if p_vercel_bypass_secret_name is not null then
    select secret.decrypted_secret
      into v_vercel_bypass_secret
    from vault.decrypted_secrets as secret
    where secret.name = p_vercel_bypass_secret_name
    order by secret.updated_at desc nulls last, secret.created_at desc
    limit 1;
  end if;

  v_endpoint_url := rtrim(trim(coalesce(v_endpoint_url, '')), '/');
  v_authorization_secret := trim(coalesce(v_authorization_secret, ''));
  v_vercel_bypass_secret := nullif(trim(coalesce(v_vercel_bypass_secret, '')), '');
  if v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app$'
    or length(v_authorization_secret) < 32
    or (p_vercel_bypass_secret_name is not null and v_vercel_bypass_secret is null) then
    raise exception 'SAME_DAY_PILOT_VAULT_REFERENCE_INVALID_OR_MISSING';
  end if;

  v_endpoint_hash := encode(extensions.digest(v_endpoint_url, 'sha256'), 'hex');

  -- Lock the singleton row so concurrent enable/disable attempts cannot create
  -- duplicate cron jobs.
  perform 1
  from public.ebay_same_day_pilot_scheduler_config
  where singleton = true
  for update;

  if exists (select 1 from cron.job where jobname = v_job_name) then
    perform cron.unschedule(v_job_name);
  end if;

  v_job_id := cron.schedule(
    v_job_name,
    p_schedule,
    $command$select public.dispatch_same_day_pilot_staging_worker('CRON');$command$
  );

  update public.ebay_same_day_pilot_scheduler_config
  set environment = 'STAGING',
      supabase_project_ref = 'vsfthqydfrdzulldbfbe',
      deployment_scope = 'PREVIEW',
      enabled = true,
      schedule = p_schedule,
      cron_job_name = v_job_name,
      cron_job_id = v_job_id,
      endpoint_url_secret_name = p_endpoint_url_secret_name,
      authorization_secret_name = p_authorization_secret_name,
      vercel_bypass_secret_name = p_vercel_bypass_secret_name,
      endpoint_reference_hash = v_endpoint_hash,
      enabled_at = clock_timestamp(),
      disabled_at = null,
      updated_at = clock_timestamp()
  where singleton = true;

  return jsonb_build_object(
    'status', 'ENABLED_STAGING_PREVIEW',
    'projectRef', 'vsfthqydfrdzulldbfbe',
    'schedule', p_schedule,
    'jobName', v_job_name,
    'jobId', v_job_id,
    'vaultReferencesConfigured', true,
    'secretValuesDisplayed', false,
    'productionChanged', false
  );
end;
$$;

create or replace function public.disable_same_day_pilot_staging_scheduler(
  p_reason_code text default 'OPERATOR_DISABLED'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_name constant text := 'seller-os-same-day-pilot-staging-v1';
  v_unscheduled boolean := false;
begin
  if coalesce(p_reason_code, '') !~ '^[A-Z0-9_:-]{3,120}$' then
    raise exception 'SAME_DAY_PILOT_DISABLE_REASON_INVALID';
  end if;

  perform 1
  from public.ebay_same_day_pilot_scheduler_config
  where singleton = true
  for update;

  if exists (select 1 from cron.job where jobname = v_job_name) then
    v_unscheduled := cron.unschedule(v_job_name);
  end if;

  update public.ebay_same_day_pilot_scheduler_config
  set environment = 'UNCONFIGURED',
      enabled = false,
      cron_job_id = null,
      endpoint_url_secret_name = null,
      authorization_secret_name = null,
      vercel_bypass_secret_name = null,
      endpoint_reference_hash = null,
      disabled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where singleton = true;

  return jsonb_build_object(
    'status', 'DISABLED',
    'reasonCode', p_reason_code,
    'cronJobRemoved', v_unscheduled,
    'secretValuesDisplayed', false,
    'productionChanged', false
  );
end;
$$;

create or replace function public.get_same_day_pilot_scheduler_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'environment', config.environment,
    'deploymentScope', config.deployment_scope,
    'enabled', config.enabled,
    'schedule', config.schedule,
    'jobName', config.cron_job_name,
    'cronJobPresent', exists (
      select 1 from cron.job where jobname = config.cron_job_name
    ),
    'vaultReferencesConfigured',
      config.endpoint_url_secret_name is not null
      and config.authorization_secret_name is not null,
    'bypassConfigured', config.vercel_bypass_secret_name is not null,
    'lastDispatch', (
      select jsonb_build_object(
        'status', audit.status,
        'reasonCode', audit.reason_code,
        'requestId', audit.request_id,
        'requestedAt', audit.requested_at,
        'dueJobsObserved', audit.due_job_count,
        'workerHeartbeatObservedAt', audit.worker_heartbeat_observed_at
      )
      from public.ebay_same_day_pilot_scheduler_dispatch_audit as audit
      order by audit.created_at desc
      limit 1
    ),
    'secretValuesDisplayed', false,
    'productionChanged', false
  )
  from public.ebay_same_day_pilot_scheduler_config as config
  where config.singleton = true;
$$;

revoke all on function public.dispatch_same_day_pilot_staging_worker(text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.enable_same_day_pilot_staging_scheduler(text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.disable_same_day_pilot_staging_scheduler(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_same_day_pilot_scheduler_status()
  from public, anon, authenticated, service_role;

grant execute on function public.dispatch_same_day_pilot_staging_worker(text,timestamptz)
  to service_role;
grant execute on function public.enable_same_day_pilot_staging_scheduler(text,text,text,text,text)
  to service_role;
grant execute on function public.disable_same_day_pilot_staging_scheduler(text)
  to service_role;
grant execute on function public.get_same_day_pilot_scheduler_status()
  to service_role;

-- Deliberately no cron.schedule call here. The migration leaves the singleton
-- disabled and Production untouched until service_role explicitly invokes the
-- staging enable helper with Vault references.

notify pgrst, 'reload schema';
