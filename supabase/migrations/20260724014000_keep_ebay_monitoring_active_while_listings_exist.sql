-- Keep the explicitly enabled Preview monitoring control plane alive for the
-- lifetime of exact active listings. The original dry-run approval remains a
-- prerequisite and revocation/disable remain immediate kill switches; only
-- the legacy automatic 24-hour expiry is retired.

create or replace function public.ebay_continuous_monitoring_authorized(
  p_marketplace_account_key text,
  p_marketplace text
)
returns boolean
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    p_marketplace = 'EBAY_US'
    and exists (
      select 1
      from public.ebay_monitoring_scheduler_config as config
      where config.singleton = true
        and config.enabled is true
        and config.environment = 'STAGING'
        and config.deployment_scope = 'PREVIEW'
        and config.supabase_project_ref = 'vsfthqydfrdzulldbfbe'
        and config.marketplace_account_key = p_marketplace_account_key
    )
    and (
      public.get_exact_ebay_monitoring_state(p_marketplace_account_key)
        -> 'ready'
    ) = 'true'::jsonb
    and exists (
      select 1
      from public.commercial_monitor_scheduler_authorizations as authz
      join public.commercial_monitor_runs as dry_run
        on dry_run.id = authz.dry_run_id
      where authz.marketplace_account_key = p_marketplace_account_key
        and authz.marketplace = p_marketplace
        and authz.revoked_at is null
        and dry_run.trigger_source = 'dry_run'
        and dry_run.status = 'completed'
        and dry_run.dry_run_satisfactory is true
        and dry_run.errors = '[]'::jsonb
    );
$$;

create or replace function public.require_active_commercial_monitor_scheduler_authorization(
  p_marketplace_account_key text,
  p_marketplace text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_authorization_id uuid;
begin
  if not public.ebay_continuous_monitoring_authorized(
    p_marketplace_account_key,
    p_marketplace
  ) then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED';
  end if;

  select authz.id into v_authorization_id
  from public.commercial_monitor_scheduler_authorizations as authz
  join public.commercial_monitor_runs as dry_run
    on dry_run.id = authz.dry_run_id
  where authz.marketplace_account_key = p_marketplace_account_key
    and authz.marketplace = p_marketplace
    and authz.revoked_at is null
    and dry_run.trigger_source = 'dry_run'
    and dry_run.status = 'completed'
    and dry_run.dry_run_satisfactory is true
    and dry_run.errors = '[]'::jsonb
  order by authz.authorized_at desc
  limit 1;

  if v_authorization_id is null then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED';
  end if;
  return v_authorization_id;
end;
$$;

create or replace function public.start_authorized_commercial_monitor_scheduled_run(
  p_marketplace_account_key text,
  p_marketplace text,
  p_requested_lanes text[],
  p_worker_id text,
  p_lease_seconds integer default 240
)
returns setof public.commercial_monitor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_authorization_id uuid;
  v_run public.commercial_monitor_runs%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_worker_id), '') is null then
    raise exception 'COMMERCIAL_MONITOR_SCOPE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  );

  v_authorization_id :=
    public.require_active_commercial_monitor_scheduler_authorization(
      p_marketplace_account_key,
      p_marketplace
    );

  select * into v_run
  from public.start_commercial_monitor_run(
    p_marketplace_account_key,
    p_marketplace,
    'schedule',
    coalesce(p_requested_lanes, '{}'::text[]),
    p_worker_id,
    p_lease_seconds
  );

  if v_run.id is null then
    return;
  end if;

  update public.commercial_monitor_scheduler_authorizations
  set last_used_at = v_now,
      use_count = use_count + 1
  where id = v_authorization_id;

  return next v_run;
end;
$$;

-- Preserve the existing dispatcher implementation and replace only its
-- authorization predicate. PostgreSQL stores the function body in pg_proc, so
-- the guarded text replacement is deterministic and fails closed if the
-- expected legacy predicate is no longer present.
do $migration$
declare
  v_definition text;
  v_old text := $old$
    select exists (
      select 1
      from public.commercial_monitor_scheduler_authorizations as authz
      join public.commercial_monitor_runs as dry_run
        on dry_run.id = authz.dry_run_id
      where authz.marketplace_account_key = v_config.marketplace_account_key
        and authz.marketplace = 'EBAY_US'
        and authz.revoked_at is null
        and authz.expires_at > p_now
        and dry_run.trigger_source = 'dry_run'
        and dry_run.status = 'completed'
        and dry_run.dry_run_satisfactory is true
        and dry_run.errors = '[]'::jsonb
    ) into v_authorized;
$old$;
  v_new text := $new$
    select public.ebay_continuous_monitoring_authorized(
      v_config.marketplace_account_key,
      'EBAY_US'
    ) into v_authorized;
$new$;
begin
  select pg_get_functiondef(
    'public.dispatch_ebay_monitoring_staging_worker(text,timestamptz)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'EBAY_MONITORING_LEGACY_AUTHORIZATION_PREDICATE_NOT_FOUND';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;

revoke all on function public.ebay_continuous_monitoring_authorized(text, text)
  from public, anon, authenticated;
revoke all on function public.require_active_commercial_monitor_scheduler_authorization(
  text, text
) from public, anon, authenticated;
revoke all on function public.start_authorized_commercial_monitor_scheduled_run(
  text, text, text[], text, integer
) from public, anon, authenticated;

grant execute on function public.ebay_continuous_monitoring_authorized(text, text)
  to service_role;
grant execute on function public.require_active_commercial_monitor_scheduler_authorization(
  text, text
) to service_role;
grant execute on function public.start_authorized_commercial_monitor_scheduled_run(
  text, text, text[], text, integer
) to service_role;
