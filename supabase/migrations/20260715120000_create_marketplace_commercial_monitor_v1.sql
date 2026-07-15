-- Marketplace-neutral commercial monitoring. This schema stores only the
-- operational fields required for sales detection and deliberately excludes
-- buyer identity, addresses, email, phone and checkout notes.

create extension if not exists pgcrypto;

create table if not exists public.marketplace_order_snapshots (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  marketplace_order_id text not null,
  order_created_at timestamptz not null,
  order_modified_at timestamptz not null,
  payment_status text not null,
  fulfillment_status text not null,
  total_amount numeric(14,2) null,
  currency text null,
  source text not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_order_snapshots_account_check check (
    char_length(marketplace_account_key) between 1 and 160
    and marketplace_account_key !~ '[[:cntrl:]]'
  ),
  constraint marketplace_order_snapshots_marketplace_check check (
    marketplace ~ '^[A-Z0-9_]{2,40}$'
  ),
  constraint marketplace_order_snapshots_idempotency unique (
    marketplace_account_key, marketplace, marketplace_order_id
  )
);

create table if not exists public.marketplace_order_line_items (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  marketplace_order_id text not null,
  marketplace_line_item_id text not null,
  listing_id text not null,
  sku text null,
  product_title text not null,
  pack_quantity integer not null default 1,
  quantity integer not null,
  line_item_amount numeric(14,2) null,
  currency text null,
  ship_by_at timestamptz null,
  source text not null,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_order_line_items_identity unique (
    marketplace_account_key, marketplace, marketplace_order_id,
    marketplace_line_item_id
  ),
  constraint marketplace_order_line_items_quantity_check check (
    quantity between 1 and 100000 and pack_quantity between 1 and 100
  )
);

create table if not exists public.listing_commercial_snapshots (
  id uuid primary key default gen_random_uuid(),
  monitor_run_id uuid null,
  marketplace_account_key text not null,
  marketplace text not null,
  listing_id text not null,
  sku text null,
  listing_status text not null,
  impressions bigint null,
  views bigint null,
  ctr numeric(10,4) null,
  transactions bigint null,
  sales_conversion_rate numeric(10,4) null,
  revenue numeric(14,2) null,
  current_watchers integer null,
  previous_watchers integer null,
  delta_watchers integer null,
  stock_available integer null,
  supplier_cost numeric(14,2) null,
  estimated_margin_percent numeric(10,4) null,
  observed_at timestamptz not null,
  window_start date null,
  window_end date null,
  source jsonb not null default '{}'::jsonb,
  completeness_status text not null,
  created_at timestamptz not null default now(),
  constraint listing_commercial_snapshots_completeness_check check (
    completeness_status in ('complete', 'incomplete', 'unavailable')
  ),
  constraint listing_commercial_snapshots_nonnegative_check check (
    (impressions is null or impressions >= 0)
    and (views is null or views >= 0)
    and (transactions is null or transactions >= 0)
    and (current_watchers is null or current_watchers >= 0)
    and (stock_available is null or stock_available >= 0)
  ),
  constraint listing_commercial_snapshots_window_check check (
    window_start is null or window_end is null or window_start <= window_end
  )
);

create table if not exists public.commercial_threshold_configs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  version text not null,
  active boolean not null default true,
  thresholds jsonb not null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_threshold_configs_version_unique unique (
    marketplace_account_key, marketplace, version
  ),
  constraint commercial_threshold_configs_payload_check check (
    jsonb_typeof(thresholds) = 'object'
  )
);

create unique index if not exists commercial_threshold_configs_one_active_uidx
  on public.commercial_threshold_configs(marketplace_account_key, marketplace)
  where active;

create table if not exists public.commercial_alert_events (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  event_type text not null,
  severity text not null,
  evidence jsonb not null default '{}'::jsonb,
  threshold_config_version text not null,
  detected_at timestamptz not null,
  listing_id text not null,
  sku text null,
  marketplace_order_id text null,
  marketplace_line_item_id text null,
  deduplication_key text not null unique,
  recommended_action text not null,
  created_at timestamptz not null default now(),
  constraint commercial_alert_events_severity_check check (
    severity in ('critical', 'high', 'medium', 'low')
  )
);

create table if not exists public.fulfillment_tasks (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  marketplace_order_id text not null,
  marketplace_line_item_id text not null,
  listing_id text not null,
  sku text not null,
  product_title text not null,
  pack_quantity integer not null default 1,
  quantity integer not null,
  status text not null,
  status_history jsonb not null default '[]'::jsonb,
  source_product_url text null,
  seller_order_url text null,
  supplier_unit_cost numeric(14,2) null,
  estimated_supplier_cost numeric(14,2) null,
  estimated_profit numeric(14,2) null,
  stock_available integer null,
  ship_by_at timestamptz null,
  tracking_number text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fulfillment_tasks_identity unique (
    marketplace_account_key, marketplace, marketplace_order_id,
    marketplace_line_item_id
  ),
  constraint fulfillment_tasks_status_check check (
    status in (
      'SALE_DETECTED', 'VALIDATING_ORDER', 'PENDING_MANUAL_PURCHASE',
      'PURCHASED_AWAITING_TRACKING', 'TRACKING_READY', 'COMPLETED',
      'CANCELLED'
    )
  ),
  constraint fulfillment_tasks_status_history_check check (
    jsonb_typeof(status_history) = 'array'
  )
);

create table if not exists public.alert_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  commercial_event_id uuid null references public.commercial_alert_events(id) on delete set null,
  channel text not null,
  delivery_class text not null default 'immediate',
  severity text not null,
  deduplication_key text not null unique,
  status text not null default 'pending',
  payload jsonb not null,
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  lease_owner text null,
  lease_expires_at timestamptz null,
  provider_message_id text null,
  delivered_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_delivery_outbox_channel_check check (
    channel in ('whatsapp', 'in_app', 'email')
  ),
  constraint alert_delivery_outbox_delivery_class_check check (
    delivery_class in ('immediate', 'digest')
  ),
  constraint alert_delivery_outbox_severity_check check (
    severity in ('critical', 'high', 'medium', 'low')
  ),
  constraint alert_delivery_outbox_status_check check (
    status in ('pending', 'leased', 'delivered', 'failed', 'dead_letter', 'cancelled')
  )
);

create table if not exists public.alert_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.alert_delivery_outbox(id) on delete cascade,
  attempt_number integer not null,
  channel text not null,
  status text not null,
  provider_message_id text null,
  response_code text null,
  error_code text null,
  attempted_at timestamptz not null default now(),
  completed_at timestamptz null,
  constraint alert_delivery_attempts_identity unique (
    outbox_id, attempt_number, channel
  ),
  constraint alert_delivery_attempts_status_check check (
    status in ('started', 'delivered', 'failed')
  )
);

create table if not exists public.commercial_monitor_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  trigger_source text not null,
  requested_lanes text[] not null default '{}'::text[],
  status text not null default 'running',
  worker_id text not null,
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz not null default now(),
  readers jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  next_action text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint commercial_monitor_runs_trigger_check check (
    trigger_source in ('manual', 'schedule', 'recovery', 'dry_run')
  ),
  constraint commercial_monitor_runs_status_check check (
    status in ('running', 'completed', 'partial', 'failed', 'cancelled')
  ),
  constraint commercial_monitor_runs_json_check check (
    jsonb_typeof(readers) = 'object'
    and jsonb_typeof(metrics) = 'object'
    and jsonb_typeof(errors) = 'array'
  )
);

create unique index if not exists commercial_monitor_runs_one_active_uidx
  on public.commercial_monitor_runs(marketplace_account_key, marketplace)
  where status = 'running';

alter table public.listing_commercial_snapshots
  drop constraint if exists listing_commercial_snapshots_monitor_run_id_fkey;
alter table public.listing_commercial_snapshots
  add constraint listing_commercial_snapshots_monitor_run_id_fkey
  foreign key (monitor_run_id) references public.commercial_monitor_runs(id)
  on delete set null;

create table if not exists public.commercial_daily_summaries (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  summary_day date not null,
  window_complete boolean not null default false,
  comparable_to_previous_day boolean not null default false,
  metrics jsonb not null,
  rendered_summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_daily_summaries_identity unique (
    marketplace_account_key, marketplace, summary_day
  )
);

create index if not exists marketplace_order_snapshots_account_order_idx
  on public.marketplace_order_snapshots(
    marketplace_account_key, marketplace_order_id, observed_at desc
  );
create index if not exists marketplace_order_line_items_account_order_idx
  on public.marketplace_order_line_items(
    marketplace_account_key, marketplace_order_id, marketplace_line_item_id
  );
create index if not exists marketplace_order_line_items_listing_sku_time_idx
  on public.marketplace_order_line_items(
    marketplace_account_key, listing_id, sku, first_observed_at desc
  );
create index if not exists listing_commercial_snapshots_account_listing_time_idx
  on public.listing_commercial_snapshots(
    marketplace_account_key, listing_id, observed_at desc
  );
create index if not exists listing_commercial_snapshots_account_sku_time_idx
  on public.listing_commercial_snapshots(
    marketplace_account_key, sku, observed_at desc
  );
create index if not exists commercial_alert_events_account_listing_time_idx
  on public.commercial_alert_events(
    marketplace_account_key, listing_id, detected_at desc
  );
create index if not exists commercial_alert_events_account_order_idx
  on public.commercial_alert_events(
    marketplace_account_key, marketplace_order_id, marketplace_line_item_id
  );
create index if not exists fulfillment_tasks_account_status_time_idx
  on public.fulfillment_tasks(
    marketplace_account_key, status, updated_at desc
  );
create index if not exists fulfillment_tasks_listing_sku_idx
  on public.fulfillment_tasks(marketplace_account_key, listing_id, sku);
create index if not exists alert_delivery_outbox_claim_idx
  on public.alert_delivery_outbox(
    marketplace_account_key, channel, status, due_at, severity
  ) where status in ('pending', 'failed', 'leased');
create index if not exists commercial_monitor_runs_account_time_idx
  on public.commercial_monitor_runs(
    marketplace_account_key, marketplace, started_at desc
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'marketplace_order_snapshots', 'marketplace_order_line_items',
    'listing_commercial_snapshots', 'commercial_threshold_configs',
    'commercial_alert_events', 'fulfillment_tasks',
    'alert_delivery_outbox', 'alert_delivery_attempts',
    'commercial_monitor_runs', 'commercial_daily_summaries'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select, insert, update on table public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.start_commercial_monitor_run(
  p_marketplace_account_key text,
  p_marketplace text,
  p_trigger_source text,
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
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_worker_id), '') is null then
    raise exception 'COMMERCIAL_MONITOR_SCOPE_REQUIRED';
  end if;

  if not pg_try_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  ) then
    return;
  end if;

  update public.commercial_monitor_runs
  set status = 'failed',
      errors = errors || jsonb_build_array(jsonb_build_object(
        'code', 'COMMERCIAL_MONITOR_LEASE_EXPIRED', 'at', v_now
      )),
      completed_at = v_now,
      heartbeat_at = v_now
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and status = 'running'
    and lease_expires_at < v_now;

  if exists (
    select 1 from public.commercial_monitor_runs
    where marketplace_account_key = p_marketplace_account_key
      and marketplace = p_marketplace
      and status = 'running'
      and lease_expires_at >= v_now
  ) then
    return;
  end if;

  return query
  insert into public.commercial_monitor_runs (
    marketplace_account_key, marketplace, trigger_source, requested_lanes,
    worker_id, lease_expires_at, heartbeat_at
  ) values (
    p_marketplace_account_key,
    p_marketplace,
    p_trigger_source,
    coalesce(p_requested_lanes, '{}'::text[]),
    left(p_worker_id, 160),
    v_now + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 240), 900))),
    v_now
  ) returning *;
end;
$$;

create or replace function public.finish_commercial_monitor_run(
  p_run_id uuid,
  p_worker_id text,
  p_status text,
  p_readers jsonb,
  p_metrics jsonb,
  p_errors jsonb,
  p_next_action text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.commercial_monitor_runs
  set status = p_status,
      readers = coalesce(p_readers, '{}'::jsonb),
      metrics = coalesce(p_metrics, '{}'::jsonb),
      errors = coalesce(p_errors, '[]'::jsonb),
      next_action = left(coalesce(p_next_action, ''), 500),
      heartbeat_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where id = p_run_id
    and worker_id = p_worker_id
    and status = 'running'
    and p_status in ('completed', 'partial', 'failed', 'cancelled');
  return found;
end;
$$;

create or replace function public.claim_alert_delivery_outbox(
  p_marketplace_account_key text,
  p_channel text,
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 120
)
returns setof public.alert_delivery_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  with expired as (
    update public.alert_delivery_outbox alert
    set status = case when alert.attempts >= alert.max_attempts then 'dead_letter' else 'failed' end,
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = case when alert.attempts >= alert.max_attempts
          then 'DELIVERY_LEASE_EXPIRED_MAX_ATTEMPTS' else 'DELIVERY_LEASE_EXPIRED' end,
        due_at = case when alert.attempts >= alert.max_attempts then alert.due_at else v_now end,
        updated_at = v_now
    where alert.marketplace_account_key = p_marketplace_account_key
      and alert.channel = p_channel
      and alert.status = 'leased'
      and alert.lease_expires_at < v_now
    returning alert.id, alert.attempts, alert.last_error_code
  )
  update public.alert_delivery_attempts attempt
  set status = 'failed', error_code = expired.last_error_code, completed_at = v_now
  from expired
  where attempt.outbox_id = expired.id
    and attempt.attempt_number = expired.attempts
    and attempt.status = 'started';

  return query
  with picked as (
    select alert.id
    from public.alert_delivery_outbox alert
    where alert.marketplace_account_key = p_marketplace_account_key
      and alert.channel = p_channel
      and alert.status in ('pending', 'failed')
      and alert.due_at <= v_now
      and alert.attempts < alert.max_attempts
    order by
      case alert.delivery_class when 'immediate' then 0 else 1 end,
      case alert.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
      alert.due_at, alert.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  ), claimed as (
    update public.alert_delivery_outbox alert
    set status = 'leased',
        attempts = alert.attempts + 1,
        lease_owner = left(p_worker_id, 160),
        lease_expires_at = v_now + make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))
        ),
        updated_at = v_now
    where alert.id in (select picked.id from picked)
    returning alert.*
  ), attempts as (
    insert into public.alert_delivery_attempts (
      outbox_id, attempt_number, channel, status, attempted_at
    )
    select claimed.id, claimed.attempts, claimed.channel, 'started', v_now
    from claimed
    on conflict (outbox_id, attempt_number, channel) do update
      set status = 'started', attempted_at = excluded.attempted_at,
          completed_at = null, provider_message_id = null,
          response_code = null, error_code = null
    returning outbox_id
  )
  select claimed.* from claimed
  where exists (select 1 from attempts where attempts.outbox_id = claimed.id);
end;
$$;

create or replace function public.complete_alert_delivery(
  p_outbox_id uuid,
  p_worker_id text,
  p_provider_message_id text,
  p_response_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
begin
  update public.alert_delivery_outbox
  set status = 'delivered',
      provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 300), ''),
      delivered_at = clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = clock_timestamp()
  where id = p_outbox_id and status = 'leased' and lease_owner = p_worker_id
  returning attempts into v_attempt;
  if not found then return false; end if;

  update public.alert_delivery_attempts
  set status = 'delivered',
      provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 300), ''),
      response_code = nullif(left(coalesce(p_response_code, ''), 40), ''),
      completed_at = clock_timestamp()
  where outbox_id = p_outbox_id and attempt_number = v_attempt and status = 'started';
  return true;
end;
$$;

create or replace function public.fail_alert_delivery(
  p_outbox_id uuid,
  p_worker_id text,
  p_error_code text,
  p_response_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt integer;
  v_max_attempts integer;
  v_indeterminate boolean := upper(coalesce(p_error_code, '')) = 'META_REQUEST_TIMEOUT';
begin
  update public.alert_delivery_outbox
  set status = case when v_indeterminate or attempts >= max_attempts then 'dead_letter' else 'failed' end,
      due_at = case when v_indeterminate or attempts >= max_attempts then due_at
        else clock_timestamp() + make_interval(
          secs => least(3600, (30 * power(2, greatest(0, attempts - 1)))::integer)
        ) end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(case when v_indeterminate
        then 'META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW'
        else coalesce(nullif(p_error_code, ''), 'ALERT_DELIVERY_FAILED') end, 120),
      updated_at = clock_timestamp()
  where id = p_outbox_id and status = 'leased' and lease_owner = p_worker_id
  returning attempts, max_attempts into v_attempt, v_max_attempts;
  if not found then return false; end if;

  update public.alert_delivery_attempts
  set status = 'failed',
      response_code = nullif(left(coalesce(p_response_code, ''), 40), ''),
      error_code = left(case when v_indeterminate
        then 'META_DELIVERY_OUTCOME_UNKNOWN_MANUAL_REVIEW'
        else coalesce(nullif(p_error_code, ''), 'ALERT_DELIVERY_FAILED') end, 120),
      completed_at = clock_timestamp()
  where outbox_id = p_outbox_id and attempt_number = v_attempt and status = 'started';
  return true;
end;
$$;

revoke all on function public.start_commercial_monitor_run(
  text, text, text, text[], text, integer
) from public, anon, authenticated;
revoke all on function public.finish_commercial_monitor_run(
  uuid, text, text, jsonb, jsonb, jsonb, text
) from public, anon, authenticated;
revoke all on function public.claim_alert_delivery_outbox(
  text, text, text, integer, integer
) from public, anon, authenticated;
revoke all on function public.complete_alert_delivery(
  uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.fail_alert_delivery(
  uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.start_commercial_monitor_run(
  text, text, text, text[], text, integer
) to service_role;
grant execute on function public.finish_commercial_monitor_run(
  uuid, text, text, jsonb, jsonb, jsonb, text
) to service_role;
grant execute on function public.claim_alert_delivery_outbox(
  text, text, text, integer, integer
) to service_role;
grant execute on function public.complete_alert_delivery(
  uuid, text, text, text
) to service_role;
grant execute on function public.fail_alert_delivery(
  uuid, text, text, text
) to service_role;

notify pgrst, 'reload schema';
