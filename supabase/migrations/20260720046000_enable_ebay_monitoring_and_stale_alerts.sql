-- Preview-only control plane for eBay commercial monitoring, Luna heartbeat,
-- WhatsApp dispatch, and stale-heartbeat alerts.
--
-- Applying this migration does not schedule a job, call Vercel, read eBay or
-- Luna, or send WhatsApp. Activation remains an explicit service_role action
-- after the existing commercial dry-run authorization and Vercel preflight.

create or replace function public.get_exact_ebay_monitoring_state(
  p_marketplace_account_key text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_active_count integer := 0;
  v_invalid_count integer := 0;
begin
  if p_marketplace_account_key is null
    or p_marketplace_account_key = 'default'
    or p_marketplace_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$' then
    raise exception 'EBAY_MONITORING_ACCOUNT_SCOPE_INVALID';
  end if;

  select
    count(*)::integer,
    count(*) filter (where
      listing.ebay_item_id !~ '^[0-9]{9,20}$'
      or nullif(trim(listing.ebay_sku), '') is null
      or nullif(trim(listing.title), '') is null
      or listing.title ~ '^eBay listing [0-9]{9,20}$'
      or listing.ebay_quantity is null
      or listing.ebay_quantity < 0
      or listing.ebay_price is null
      or listing.ebay_price <= 0
      or listing.currency <> 'USD'
      or nullif(trim(listing.supplier_sku), '') is null
      or nullif(trim(listing.supplier_variant_id), '') is null
      or listing.supplier_cost_at_linking is null
      or listing.supplier_cost_at_linking <= 0
      or listing.last_ebay_sync_at is null
      or listing.source not in (
        'EBAY_TRADING_GET_ITEM_READONLY',
        'EBAY_SELL_INVENTORY_READONLY'
      )
    )::integer
  into v_active_count, v_invalid_count
  from public.ebay_active_listings as listing
  where listing.account_key = p_marketplace_account_key
    and listing.listing_status = 'active';

  return jsonb_build_object(
    'ready', v_active_count > 0 and v_invalid_count = 0,
    'activeListingCount', v_active_count,
    'invalidActiveListingCount', v_invalid_count,
    'reasonCode', case
      when v_active_count = 0 then 'ACTIVE_LISTING_REQUIRED'
      when v_invalid_count > 0 then 'ACTIVE_LISTING_EXACT_MONITORING_FIELDS_REQUIRED'
      else 'EXACT_MONITORING_STATE_READY'
    end
  );
end;
$$;

revoke all on function public.get_exact_ebay_monitoring_state(text)
  from public, anon, authenticated;
grant execute on function public.get_exact_ebay_monitoring_state(text)
  to service_role;

create or replace function public.enqueue_ebay_monitoring_heartbeat_alerts(
  p_marketplace_account_key text,
  p_marketplace text default 'EBAY_US',
  p_ebay_stale_minutes integer default 20,
  p_luna_stale_minutes integer default 45,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state jsonb;
  v_source text;
  v_heartbeat timestamptz;
  v_threshold integer;
  v_stale boolean;
  v_episode_anchor text;
  v_event_key text;
  v_event_id uuid;
  v_event_created boolean;
  v_outbox_created integer;
  v_cancelled integer;
  v_events_created integer := 0;
  v_alerts_created integer := 0;
  v_alerts_cancelled integer := 0;
  v_sources jsonb := '[]'::jsonb;
begin
  if p_marketplace <> 'EBAY_US' then
    raise exception 'EBAY_MONITORING_MARKETPLACE_INVALID';
  end if;
  if p_now is null
    or p_ebay_stale_minutes not between 10 and 1440
    or p_luna_stale_minutes not between 15 and 1440 then
    raise exception 'EBAY_MONITORING_HEARTBEAT_INPUT_INVALID';
  end if;

  v_state := public.get_exact_ebay_monitoring_state(p_marketplace_account_key);
  if v_state -> 'ready' is distinct from 'true'::jsonb then
    return jsonb_build_object(
      'status', 'BLOCKED_INEXACT_ACTIVE_LISTING_STATE',
      'monitoringState', v_state,
      'eventsCreated', 0,
      'alertsCreated', 0,
      'alertsCancelled', 0
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay-monitoring-heartbeat:' || p_marketplace_account_key, 0)
  );

  foreach v_source in array array['EBAY', 'LUNA'] loop
    if v_source = 'EBAY' then
      v_threshold := p_ebay_stale_minutes;
      select max(run.heartbeat_at)
      into v_heartbeat
      from public.commercial_monitor_runs as run
      where run.marketplace_account_key = p_marketplace_account_key
        and run.marketplace = p_marketplace
        and run.status in ('completed', 'partial')
        and run.heartbeat_at is not null
        and run.readers #>> '{orders,status}' = 'available'
        and run.metrics -> 'listingIdentityVerified' = 'true'::jsonb;
    else
      v_threshold := p_luna_stale_minutes;
      select state.targeted_luna_last_success_at
      into v_heartbeat
      from public.ebay_active_listing_sync_state as state
      where state.account_key = p_marketplace_account_key;
    end if;

    v_stale := v_heartbeat is null
      or v_heartbeat <= p_now - make_interval(mins => v_threshold);

    if v_stale then
      v_episode_anchor := coalesce(
        floor(extract(epoch from v_heartbeat))::bigint::text,
        'NEVER'
      );
      v_event_key := 'commercial-v1:' || encode(
        extensions.digest(
          p_marketplace_account_key || ':MONITOR_HEARTBEAT_STALE:' ||
          v_source || ':' || v_episode_anchor,
          'sha256'
        ),
        'hex'
      );
      v_event_id := null;
      insert into public.commercial_alert_events (
        marketplace_account_key,
        marketplace,
        event_type,
        severity,
        evidence,
        threshold_config_version,
        detected_at,
        listing_id,
        sku,
        marketplace_order_id,
        marketplace_line_item_id,
        deduplication_key,
        recommended_action
      ) values (
        p_marketplace_account_key,
        p_marketplace,
        'MONITOR_HEARTBEAT_STALE',
        'critical',
        jsonb_build_object(
          'source', 'SELLER_OS_MONITORING_CONTROL_PLANE',
          'heartbeatSource', v_source,
          'heartbeatObservedAt', v_heartbeat,
          'thresholdMinutes', v_threshold,
          'evaluatedAt', p_now,
          'activeListingCount', (v_state ->> 'activeListingCount')::integer,
          'exactMonitoringStateVerified', true
        ),
        'MONITOR_HEARTBEAT_V1',
        p_now,
        null,
        null,
        null,
        null,
        v_event_key,
        case v_source
          when 'EBAY' then 'Restaurar el monitor oficial eBay antes de confiar en ventas o métricas.'
          else 'Restaurar el heartbeat Luna dirigido antes de confiar en stock o costo.'
        end
      ) on conflict (deduplication_key) do nothing
      returning id into v_event_id;
      v_event_created := found;

      if v_event_id is null then
        select event.id into v_event_id
        from public.commercial_alert_events as event
        where event.deduplication_key = v_event_key;
      end if;
      if v_event_id is null then
        raise exception 'EBAY_MONITORING_STALE_EVENT_RECOVERY_FAILED';
      end if;
      if v_event_created then
        v_events_created := v_events_created + 1;
      end if;

      insert into public.alert_delivery_outbox (
        marketplace_account_key,
        marketplace,
        commercial_event_id,
        channel,
        delivery_class,
        severity,
        deduplication_key,
        status,
        payload,
        due_at
      ) values (
        p_marketplace_account_key,
        p_marketplace,
        v_event_id,
        'whatsapp',
        'immediate',
        'critical',
        'whatsapp:' || v_event_key,
        'pending',
        jsonb_build_object(
          'title', case v_source
            when 'EBAY' then 'Heartbeat eBay vencido'
            else 'Heartbeat Luna vencido'
          end,
          'summary', case v_source
            when 'EBAY' then 'Seller OS no tiene una lectura oficial eBay reciente para los listings activos.'
            else 'Seller OS no tiene una comprobación Luna reciente para los listings activos.'
          end,
          'action', case v_source
            when 'EBAY' then 'Revisa OAuth, autorización del scheduler y el cron del monitor comercial.'
            else 'Revisa el cron Luna, la identidad exacta del producto y la fuente de inventario.'
          end,
          'heartbeatSource', v_source,
          'thresholdMinutes', v_threshold,
          'heartbeatObservedAt', v_heartbeat,
          'buyerDataIncluded', false
        ),
        p_now
      ) on conflict (deduplication_key) do nothing;
      get diagnostics v_outbox_created = row_count;
      v_alerts_created := v_alerts_created + v_outbox_created;
    else
      update public.alert_delivery_outbox as outbox
      set status = 'cancelled',
          lease_owner = null,
          lease_expires_at = null,
          last_error_code = null,
          updated_at = p_now
      where outbox.marketplace_account_key = p_marketplace_account_key
        and outbox.marketplace = p_marketplace
        and outbox.channel = 'whatsapp'
        and outbox.status in ('pending', 'failed', 'dead_letter')
        and outbox.commercial_event_id in (
          select event.id
          from public.commercial_alert_events as event
          where event.marketplace_account_key = p_marketplace_account_key
            and event.marketplace = p_marketplace
            and event.event_type = 'MONITOR_HEARTBEAT_STALE'
            and event.evidence ->> 'heartbeatSource' = v_source
        );
      get diagnostics v_cancelled = row_count;
      v_alerts_cancelled := v_alerts_cancelled + v_cancelled;
    end if;

    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'source', v_source,
      'status', case when v_stale then 'STALE' else 'FRESH' end,
      'heartbeatObservedAt', v_heartbeat,
      'thresholdMinutes', v_threshold
    ));
  end loop;

  return jsonb_build_object(
    'status', 'RECONCILED',
    'monitoringState', v_state,
    'sources', v_sources,
    'eventsCreated', v_events_created,
    'alertsCreated', v_alerts_created,
    'alertsCancelled', v_alerts_cancelled
  );
end;
$$;

revoke all on function public.enqueue_ebay_monitoring_heartbeat_alerts(
  text, text, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_ebay_monitoring_heartbeat_alerts(
  text, text, integer, integer, timestamptz
) to service_role;

create table if not exists public.ebay_monitoring_scheduler_config (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'UNCONFIGURED'
    check (environment in ('UNCONFIGURED', 'STAGING')),
  supabase_project_ref text not null default 'vsfthqydfrdzulldbfbe'
    check (supabase_project_ref = 'vsfthqydfrdzulldbfbe'),
  deployment_scope text not null default 'PREVIEW'
    check (deployment_scope = 'PREVIEW'),
  marketplace_account_key text null,
  enabled boolean not null default false,
  endpoint_url_secret_name text null,
  authorization_secret_name text null,
  vercel_bypass_secret_name text null,
  endpoint_reference_hash text null
    check (endpoint_reference_hash is null or endpoint_reference_hash ~ '^[0-9a-f]{64}$'),
  commercial_monitor_job_id bigint null,
  alert_dispatcher_job_id bigint null,
  luna_monitor_job_id bigint null,
  enabled_at timestamptz null,
  disabled_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint ebay_monitoring_scheduler_vault_names_check check (
    (endpoint_url_secret_name is null or endpoint_url_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
    and (authorization_secret_name is null or authorization_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
    and (vercel_bypass_secret_name is null or vercel_bypass_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$')
  ),
  constraint ebay_monitoring_scheduler_enabled_scope_check check (
    not enabled or (
      environment = 'STAGING'
      and deployment_scope = 'PREVIEW'
      and supabase_project_ref = 'vsfthqydfrdzulldbfbe'
      and marketplace_account_key is not null
      and marketplace_account_key <> 'default'
      and endpoint_url_secret_name is not null
      and authorization_secret_name is not null
      and commercial_monitor_job_id is not null
      and alert_dispatcher_job_id is not null
      and luna_monitor_job_id is not null
    )
  )
);

create table if not exists public.ebay_monitoring_scheduler_dispatch_audit (
  id bigint generated always as identity primary key,
  dispatch_key text not null unique
    check (dispatch_key ~ '^ebay-monitoring-scheduler:v1:[0-9a-f]{64}$'),
  lane text not null check (lane in (
    'COMMERCIAL_MONITOR', 'ALERT_DISPATCHER', 'LUNA_MONITOR'
  )),
  dispatch_slot timestamptz not null,
  status text not null check (status in (
    'QUEUED', 'SKIPPED_DISABLED', 'BLOCKED_CONFIGURATION',
    'BLOCKED_MONITORING_STATE', 'BLOCKED_SCHEDULER_AUTHORIZATION', 'QUEUE_FAILED'
  )),
  reason_code text not null check (reason_code ~ '^[A-Z0-9_]{3,100}$'),
  request_id bigint null,
  endpoint_reference_hash text null
    check (endpoint_reference_hash is null or endpoint_reference_hash ~ '^[0-9a-f]{64}$'),
  bypass_configured boolean not null default false,
  monitoring_state jsonb not null default '{}'::jsonb,
  requested_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ebay_monitoring_scheduler_lane_slot_idx
  on public.ebay_monitoring_scheduler_dispatch_audit(lane, dispatch_slot);

alter table public.ebay_monitoring_scheduler_config enable row level security;
alter table public.ebay_monitoring_scheduler_config force row level security;
alter table public.ebay_monitoring_scheduler_dispatch_audit enable row level security;
alter table public.ebay_monitoring_scheduler_dispatch_audit force row level security;

revoke all on table public.ebay_monitoring_scheduler_config
  from anon, authenticated;
revoke all on table public.ebay_monitoring_scheduler_config
  from public, service_role;
revoke all on table public.ebay_monitoring_scheduler_dispatch_audit
  from anon, authenticated;
revoke all on table public.ebay_monitoring_scheduler_dispatch_audit
  from public, service_role;
revoke all on sequence public.ebay_monitoring_scheduler_dispatch_audit_id_seq
  from public, anon, authenticated, service_role;
grant select on table public.ebay_monitoring_scheduler_config to service_role;
grant select on table public.ebay_monitoring_scheduler_dispatch_audit to service_role;

insert into public.ebay_monitoring_scheduler_config (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.prevent_ebay_monitoring_scheduler_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'EBAY_MONITORING_SCHEDULER_AUDIT_APPEND_ONLY';
end;
$$;

drop trigger if exists ebay_monitoring_scheduler_audit_append_only
  on public.ebay_monitoring_scheduler_dispatch_audit;
create trigger ebay_monitoring_scheduler_audit_append_only
before update or delete on public.ebay_monitoring_scheduler_dispatch_audit
for each row execute function public.prevent_ebay_monitoring_scheduler_audit_mutation();

revoke all on function public.prevent_ebay_monitoring_scheduler_audit_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.dispatch_ebay_monitoring_staging_worker(
  p_lane text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lane text := upper(trim(coalesce(p_lane, '')));
  v_config public.ebay_monitoring_scheduler_config%rowtype;
  v_slot_seconds integer;
  v_dispatch_slot timestamptz;
  v_dispatch_key text;
  v_state jsonb := '{}'::jsonb;
  v_authorized boolean := false;
  v_endpoint_url text;
  v_authorization_secret text;
  v_vercel_bypass_secret text;
  v_endpoint_path text;
  v_headers jsonb;
  v_request_id bigint;
  v_status text;
  v_reason text;
begin
  if p_now is null or v_lane not in (
    'COMMERCIAL_MONITOR', 'ALERT_DISPATCHER', 'LUNA_MONITOR'
  ) then
    raise exception 'EBAY_MONITORING_SCHEDULER_INPUT_INVALID';
  end if;

  v_slot_seconds := case when v_lane = 'LUNA_MONITOR' then 900 else 300 end;
  v_dispatch_slot := to_timestamp(
    floor(extract(epoch from p_now) / v_slot_seconds) * v_slot_seconds
  );
  v_dispatch_key := 'ebay-monitoring-scheduler:v1:' || encode(
    extensions.digest(v_lane || ':' || floor(extract(epoch from v_dispatch_slot))::bigint::text, 'sha256'),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended('ebay-monitoring-scheduler:' || v_lane, 0)
  );
  if exists (
    select 1 from public.ebay_monitoring_scheduler_dispatch_audit
    where dispatch_key = v_dispatch_key
  ) then
    return jsonb_build_object(
      'status', 'DUPLICATE_SUPPRESSED',
      'lane', v_lane,
      'dispatchSlot', v_dispatch_slot,
      'secretValuesDisplayed', false
    );
  end if;

  select * into v_config
  from public.ebay_monitoring_scheduler_config
  where singleton = true;
  if not found then
    raise exception 'EBAY_MONITORING_SCHEDULER_CONFIG_MISSING';
  end if;

  if not v_config.enabled then
    v_status := 'SKIPPED_DISABLED';
    v_reason := 'SCHEDULER_DISABLED';
  elsif v_config.environment <> 'STAGING'
    or v_config.deployment_scope <> 'PREVIEW'
    or v_config.supabase_project_ref <> 'vsfthqydfrdzulldbfbe'
    or v_config.marketplace_account_key is null then
    v_status := 'BLOCKED_CONFIGURATION';
    v_reason := 'STAGING_PREVIEW_SCOPE_REQUIRED';
  else
    v_state := public.get_exact_ebay_monitoring_state(
      v_config.marketplace_account_key
    );
    if v_state -> 'ready' is distinct from 'true'::jsonb then
      v_status := 'BLOCKED_MONITORING_STATE';
      v_reason := 'EXACT_ACTIVE_LISTING_STATE_REQUIRED';
    end if;
  end if;

  if v_status is null and v_lane in ('COMMERCIAL_MONITOR', 'ALERT_DISPATCHER') then
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
    if not v_authorized then
      v_status := 'BLOCKED_SCHEDULER_AUTHORIZATION';
      v_reason := 'COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED';
    end if;
  end if;

  if v_status is not null then
    insert into public.ebay_monitoring_scheduler_dispatch_audit (
      dispatch_key, lane, dispatch_slot, status, reason_code,
      bypass_configured, monitoring_state, requested_at
    ) values (
      v_dispatch_key, v_lane, v_dispatch_slot, v_status, v_reason,
      false, v_state, p_now
    );
    return jsonb_build_object(
      'status', v_status,
      'reasonCode', v_reason,
      'lane', v_lane,
      'dispatchSlot', v_dispatch_slot,
      'monitoringState', v_state,
      'secretValuesDisplayed', false
    );
  end if;

  select secret.decrypted_secret into v_endpoint_url
  from vault.decrypted_secrets as secret
  where secret.name = v_config.endpoint_url_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  select secret.decrypted_secret into v_authorization_secret
  from vault.decrypted_secrets as secret
  where secret.name = v_config.authorization_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if v_config.vercel_bypass_secret_name is not null then
    select secret.decrypted_secret into v_vercel_bypass_secret
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
    insert into public.ebay_monitoring_scheduler_dispatch_audit (
      dispatch_key, lane, dispatch_slot, status, reason_code,
      bypass_configured, monitoring_state, requested_at
    ) values (
      v_dispatch_key, v_lane, v_dispatch_slot, 'BLOCKED_CONFIGURATION',
      'VAULT_REFERENCE_INVALID_OR_MISSING',
      v_config.vercel_bypass_secret_name is not null, v_state, p_now
    );
    return jsonb_build_object(
      'status', 'BLOCKED_CONFIGURATION',
      'reasonCode', 'VAULT_REFERENCE_INVALID_OR_MISSING',
      'lane', v_lane,
      'secretValuesDisplayed', false
    );
  end if;

  v_endpoint_path := case v_lane
    when 'COMMERCIAL_MONITOR' then '/api/cron/ebay-commercial-monitor'
    when 'ALERT_DISPATCHER' then '/api/cron/commercial-alert-dispatcher'
    else '/api/cron/ebay-active-listing-luna-monitor'
  end;
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_authorization_secret,
    'User-Agent', 'seller-os-ebay-monitoring-staging-scheduler/1',
    'X-Seller-OS-Monitoring-Lane', v_lane
  );
  if v_vercel_bypass_secret is not null then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', v_vercel_bypass_secret
    );
  end if;

  begin
    select net.http_get(
      url := v_endpoint_url || v_endpoint_path,
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 60000
    ) into v_request_id;
  exception when others then
    insert into public.ebay_monitoring_scheduler_dispatch_audit (
      dispatch_key, lane, dispatch_slot, status, reason_code,
      endpoint_reference_hash, bypass_configured, monitoring_state, requested_at
    ) values (
      v_dispatch_key, v_lane, v_dispatch_slot, 'QUEUE_FAILED',
      'PG_NET_REQUEST_QUEUE_FAILED', v_config.endpoint_reference_hash,
      v_config.vercel_bypass_secret_name is not null, v_state, p_now
    );
    return jsonb_build_object(
      'status', 'QUEUE_FAILED',
      'reasonCode', 'PG_NET_REQUEST_QUEUE_FAILED',
      'lane', v_lane,
      'secretValuesDisplayed', false
    );
  end;

  insert into public.ebay_monitoring_scheduler_dispatch_audit (
    dispatch_key, lane, dispatch_slot, status, reason_code, request_id,
    endpoint_reference_hash, bypass_configured, monitoring_state, requested_at
  ) values (
    v_dispatch_key, v_lane, v_dispatch_slot, 'QUEUED',
    'PG_NET_REQUEST_QUEUED', v_request_id, v_config.endpoint_reference_hash,
    v_config.vercel_bypass_secret_name is not null, v_state, p_now
  );
  return jsonb_build_object(
    'status', 'QUEUED',
    'lane', v_lane,
    'requestId', v_request_id,
    'dispatchSlot', v_dispatch_slot,
    'secretValuesDisplayed', false
  );
end;
$$;

create or replace function public.enable_ebay_monitoring_staging_scheduler(
  p_confirm_project_ref text,
  p_marketplace_account_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.ebay_same_day_pilot_scheduler_config%rowtype;
  v_state jsonb;
  v_authorized boolean := false;
  v_endpoint_url text;
  v_authorization_secret text;
  v_vercel_bypass_secret text;
  v_endpoint_hash text;
  v_commercial_job_id bigint;
  v_dispatcher_job_id bigint;
  v_luna_job_id bigint;
begin
  if trim(coalesce(p_confirm_project_ref, '')) <> 'vsfthqydfrdzulldbfbe' then
    raise exception 'EBAY_MONITORING_STAGING_PROJECT_CONFIRMATION_REQUIRED';
  end if;
  v_state := public.get_exact_ebay_monitoring_state(p_marketplace_account_key);
  if v_state -> 'ready' is distinct from 'true'::jsonb then
    raise exception 'EBAY_MONITORING_EXACT_ACTIVE_LISTING_STATE_REQUIRED';
  end if;

  select exists (
    select 1
    from public.commercial_monitor_scheduler_authorizations as authz
    join public.commercial_monitor_runs as dry_run on dry_run.id = authz.dry_run_id
    where authz.marketplace_account_key = p_marketplace_account_key
      and authz.marketplace = 'EBAY_US'
      and authz.revoked_at is null
      and authz.expires_at > clock_timestamp()
      and dry_run.trigger_source = 'dry_run'
      and dry_run.status = 'completed'
      and dry_run.dry_run_satisfactory is true
      and dry_run.errors = '[]'::jsonb
  ) into v_authorized;
  if not v_authorized then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED';
  end if;

  select * into v_source
  from public.ebay_same_day_pilot_scheduler_config
  where singleton = true
  for update;
  if not found
    or not v_source.enabled
    or v_source.environment <> 'STAGING'
    or v_source.deployment_scope <> 'PREVIEW'
    or v_source.supabase_project_ref <> 'vsfthqydfrdzulldbfbe' then
    raise exception 'EBAY_MONITORING_EXISTING_VAULT_CONTROL_PLANE_REQUIRED';
  end if;

  select secret.decrypted_secret into v_endpoint_url
  from vault.decrypted_secrets as secret
  where secret.name = v_source.endpoint_url_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  select secret.decrypted_secret into v_authorization_secret
  from vault.decrypted_secrets as secret
  where secret.name = v_source.authorization_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if v_source.vercel_bypass_secret_name is not null then
    select secret.decrypted_secret into v_vercel_bypass_secret
    from vault.decrypted_secrets as secret
    where secret.name = v_source.vercel_bypass_secret_name
    order by secret.updated_at desc nulls last, secret.created_at desc
    limit 1;
  end if;

  v_endpoint_url := rtrim(trim(coalesce(v_endpoint_url, '')), '/');
  v_authorization_secret := trim(coalesce(v_authorization_secret, ''));
  v_vercel_bypass_secret := nullif(trim(coalesce(v_vercel_bypass_secret, '')), '');
  if v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.vercel\.app$'
    or length(v_authorization_secret) < 32
    or (v_source.vercel_bypass_secret_name is not null and v_vercel_bypass_secret is null) then
    raise exception 'EBAY_MONITORING_VAULT_REFERENCE_INVALID_OR_MISSING';
  end if;
  v_endpoint_hash := encode(extensions.digest(v_endpoint_url, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('ebay-monitoring-staging-scheduler', 0));
  if exists (select 1 from cron.job where jobname = 'seller-os-ebay-commercial-monitor-staging-v1') then
    perform cron.unschedule('seller-os-ebay-commercial-monitor-staging-v1');
  end if;
  if exists (select 1 from cron.job where jobname = 'seller-os-commercial-alert-dispatcher-staging-v1') then
    perform cron.unschedule('seller-os-commercial-alert-dispatcher-staging-v1');
  end if;
  if exists (select 1 from cron.job where jobname = 'seller-os-ebay-luna-monitor-staging-v1') then
    perform cron.unschedule('seller-os-ebay-luna-monitor-staging-v1');
  end if;

  v_commercial_job_id := cron.schedule(
    'seller-os-ebay-commercial-monitor-staging-v1',
    '*/5 * * * *',
    $command$select public.dispatch_ebay_monitoring_staging_worker('COMMERCIAL_MONITOR');$command$
  );
  v_dispatcher_job_id := cron.schedule(
    'seller-os-commercial-alert-dispatcher-staging-v1',
    '*/5 * * * *',
    $command$select public.dispatch_ebay_monitoring_staging_worker('ALERT_DISPATCHER');$command$
  );
  v_luna_job_id := cron.schedule(
    'seller-os-ebay-luna-monitor-staging-v1',
    '*/15 * * * *',
    $command$select public.dispatch_ebay_monitoring_staging_worker('LUNA_MONITOR');$command$
  );

  update public.ebay_monitoring_scheduler_config
  set environment = 'STAGING',
      supabase_project_ref = 'vsfthqydfrdzulldbfbe',
      deployment_scope = 'PREVIEW',
      marketplace_account_key = p_marketplace_account_key,
      enabled = true,
      endpoint_url_secret_name = v_source.endpoint_url_secret_name,
      authorization_secret_name = v_source.authorization_secret_name,
      vercel_bypass_secret_name = v_source.vercel_bypass_secret_name,
      endpoint_reference_hash = v_endpoint_hash,
      commercial_monitor_job_id = v_commercial_job_id,
      alert_dispatcher_job_id = v_dispatcher_job_id,
      luna_monitor_job_id = v_luna_job_id,
      enabled_at = clock_timestamp(),
      disabled_at = null,
      updated_at = clock_timestamp()
  where singleton = true;

  return jsonb_build_object(
    'status', 'ENABLED_STAGING_PREVIEW',
    'projectRef', 'vsfthqydfrdzulldbfbe',
    'commercialMonitorSchedule', '*/5 * * * *',
    'alertDispatcherSchedule', '*/5 * * * *',
    'lunaMonitorSchedule', '*/15 * * * *',
    'vaultReferencesReused', true,
    'secretValuesDisplayed', false,
    'productionChanged', false
  );
end;
$$;

create or replace function public.disable_ebay_monitoring_staging_scheduler(
  p_confirm_project_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if trim(coalesce(p_confirm_project_ref, '')) <> 'vsfthqydfrdzulldbfbe' then
    raise exception 'EBAY_MONITORING_STAGING_PROJECT_CONFIRMATION_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ebay-monitoring-staging-scheduler', 0));
  if exists (select 1 from cron.job where jobname = 'seller-os-ebay-commercial-monitor-staging-v1') then
    perform cron.unschedule('seller-os-ebay-commercial-monitor-staging-v1');
  end if;
  if exists (select 1 from cron.job where jobname = 'seller-os-commercial-alert-dispatcher-staging-v1') then
    perform cron.unschedule('seller-os-commercial-alert-dispatcher-staging-v1');
  end if;
  if exists (select 1 from cron.job where jobname = 'seller-os-ebay-luna-monitor-staging-v1') then
    perform cron.unschedule('seller-os-ebay-luna-monitor-staging-v1');
  end if;
  update public.ebay_monitoring_scheduler_config
  set enabled = false,
      commercial_monitor_job_id = null,
      alert_dispatcher_job_id = null,
      luna_monitor_job_id = null,
      disabled_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where singleton = true;
  return jsonb_build_object(
    'status', 'DISABLED_STAGING_PREVIEW',
    'productionChanged', false,
    'secretValuesDisplayed', false
  );
end;
$$;

revoke all on function public.dispatch_ebay_monitoring_staging_worker(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.enable_ebay_monitoring_staging_scheduler(text, text)
  from public, anon, authenticated;
revoke all on function public.disable_ebay_monitoring_staging_scheduler(text)
  from public, anon, authenticated;
grant execute on function public.dispatch_ebay_monitoring_staging_worker(text, timestamptz)
  to service_role;
grant execute on function public.enable_ebay_monitoring_staging_scheduler(text, text)
  to service_role;
grant execute on function public.disable_ebay_monitoring_staging_scheduler(text)
  to service_role;

-- Deliberately no cron.schedule or dispatcher invocation here.
notify pgrst, 'reload schema';
