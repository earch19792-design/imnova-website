-- Commercial Monitor schedule authorization is durable, Preview-scoped by the
-- application, and can only be issued from a fresh strict dry run. This
-- migration does not create a scheduler, enable a flag or dispatch a message.

create table if not exists public.commercial_monitor_scheduler_authorizations (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  dry_run_id uuid not null references public.commercial_monitor_runs(id) on delete restrict,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null references auth.users(id) on delete set null,
  last_used_at timestamptz null,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint commercial_monitor_scheduler_authorization_window_check check (
    expires_at > authorized_at
    and expires_at <= authorized_at + interval '24 hours'
  ),
  constraint commercial_monitor_scheduler_authorization_use_count_check check (
    use_count >= 0
  )
);

create unique index if not exists commercial_monitor_scheduler_one_active_uidx
  on public.commercial_monitor_scheduler_authorizations(
    marketplace_account_key, marketplace
  ) where revoked_at is null;

create index if not exists commercial_monitor_scheduler_gate_lookup_idx
  on public.commercial_monitor_scheduler_authorizations(
    marketplace_account_key, marketplace, expires_at desc
  );

alter table public.commercial_monitor_scheduler_authorizations enable row level security;
alter table public.commercial_monitor_scheduler_authorizations force row level security;
revoke all on table public.commercial_monitor_scheduler_authorizations from public, anon, authenticated;
grant select on table public.commercial_monitor_scheduler_authorizations to service_role;

create or replace function public.authorize_commercial_monitor_scheduler(
  p_marketplace_account_key text,
  p_marketplace text,
  p_dry_run_id uuid,
  p_authorized_by uuid default null,
  p_authorization_seconds integer default 3600,
  p_max_dry_run_age_seconds integer default 1800
)
returns public.commercial_monitor_scheduler_authorizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_dry_run public.commercial_monitor_runs%rowtype;
  v_authorization public.commercial_monitor_scheduler_authorizations%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_marketplace), '') is null
    or p_dry_run_id is null
    or p_authorized_by is null then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_DRY_RUN_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  );

  select * into v_dry_run
  from public.commercial_monitor_runs
  where id = p_dry_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and trigger_source = 'dry_run'
  for update;

  if not found
    or v_dry_run.status <> 'completed'
    or v_dry_run.dry_run_satisfactory is not true
    or v_dry_run.completed_at is null
    or v_dry_run.completed_at < v_now - make_interval(
      secs => greatest(60, least(coalesce(p_max_dry_run_age_seconds, 1800), 3600))
    )
    or v_dry_run.completed_at > v_now + interval '1 minute'
    or jsonb_typeof(v_dry_run.readers) is distinct from 'object'
    or jsonb_typeof(v_dry_run.metrics) is distinct from 'object'
    or jsonb_typeof(v_dry_run.errors) is distinct from 'array'
    or v_dry_run.errors <> '[]'::jsonb
    or jsonb_typeof(v_dry_run.readers -> 'orders') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'messages') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'analytics') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'watchers') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'listing_identity') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'luna_supply') is distinct from 'object'
    or v_dry_run.readers #>> '{orders,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{messages,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{analytics,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{watchers,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{listing_identity,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{luna_supply,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{orders,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{messages,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{analytics,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{watchers,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #> '{orders,auth,scopeConfirmed}' is distinct from 'true'::jsonb
    or v_dry_run.readers #> '{orders,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{messages,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{analytics,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{watchers,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{listing_identity,metrics,itemIdAndCustomLabelExact}' is distinct from 'true'::jsonb
    or v_dry_run.readers #> '{listing_identity,metrics,supplierSkuLinked}' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'dryRun' is distinct from 'true'::jsonb
    or v_dry_run.metrics #> '{authentication,officialIdentityMatch}' is distinct from 'true'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'activeListings') = 'number'
        then (v_dry_run.metrics ->> 'activeListings')::numeric > 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'officialOrdersRead') = 'number'
        then (v_dry_run.metrics ->> 'officialOrdersRead')::numeric >= 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'analyticsListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'analyticsListingsRead')::numeric > 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'watcherListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'watcherListingsRead')::numeric > 0
      else false
    end) is not true
    or v_dry_run.metrics -> 'listingIdentityVerified' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'lunaExactSupplyLinked' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'lunaSupplyFresh' is distinct from 'true'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'sellerHubMessageHeadersRead') = 'number'
        then (v_dry_run.metrics ->> 'sellerHubMessageHeadersRead')::numeric >= 0
      else false
    end) is not true
    or v_dry_run.metrics -> 'sellerHubMessageContentReturned' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'sellerHubMessageRawXmlPersisted' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'commercialDataPersistencePerformed' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'persistenceWrites' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'eventsCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'alertsEnqueued' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'outboxRowsCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'fulfillmentTasksCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'whatsappMetaAccepted' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'whatsappDelivered' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'buyerPiiFieldsReturned' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'buyerPiiReturned' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'ebayWrites' is distinct from '0'::jsonb then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_DRY_RUN_NOT_SATISFIED';
  end if;

  update public.commercial_monitor_scheduler_authorizations
  set revoked_at = v_now
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and revoked_at is null;

  insert into public.commercial_monitor_scheduler_authorizations (
    marketplace_account_key,
    marketplace,
    dry_run_id,
    authorized_by,
    authorized_at,
    expires_at
  ) values (
    p_marketplace_account_key,
    p_marketplace,
    v_dry_run.id,
    p_authorized_by,
    v_now,
    v_now + make_interval(
      secs => greatest(300, least(coalesce(p_authorization_seconds, 3600), 86400))
    )
  ) returning * into v_authorization;

  return v_authorization;
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
  v_authorization public.commercial_monitor_scheduler_authorizations%rowtype;
  v_run public.commercial_monitor_runs%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_worker_id), '') is null then
    raise exception 'COMMERCIAL_MONITOR_SCOPE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  );

  select authz.* into v_authorization
  from public.commercial_monitor_scheduler_authorizations authz
  join public.commercial_monitor_runs dry_run
    on dry_run.id = authz.dry_run_id
  where authz.marketplace_account_key = p_marketplace_account_key
    and authz.marketplace = p_marketplace
    and authz.revoked_at is null
    and authz.expires_at > v_now
    and dry_run.trigger_source = 'dry_run'
    and dry_run.status = 'completed'
    and dry_run.dry_run_satisfactory is true
    and dry_run.errors = '[]'::jsonb
  order by authz.authorized_at desc
  limit 1
  for update of authz;

  if not found then
    raise exception 'COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED';
  end if;

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
  where id = v_authorization.id;

  return next v_run;
end;
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
  select authz.id into v_authorization_id
  from public.commercial_monitor_scheduler_authorizations authz
  join public.commercial_monitor_runs dry_run
    on dry_run.id = authz.dry_run_id
  where authz.marketplace_account_key = p_marketplace_account_key
    and authz.marketplace = p_marketplace
    and authz.revoked_at is null
    and authz.expires_at > clock_timestamp()
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

create or replace function public.revoke_commercial_monitor_scheduler_authorization(
  p_marketplace_account_key text,
  p_marketplace text,
  p_revoked_by uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_marketplace), '') is null then
    raise exception 'COMMERCIAL_MONITOR_SCOPE_REQUIRED';
  end if;
  update public.commercial_monitor_scheduler_authorizations
  set revoked_at = clock_timestamp(),
      revoked_by = p_revoked_by
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and revoked_at is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Harden the existing one-use manual gate without modifying its applied
-- migration: partial dry runs and missing strict safety evidence are rejected.
create or replace function public.start_authorized_commercial_monitor_run(
  p_marketplace_account_key text,
  p_marketplace text,
  p_requested_lanes text[],
  p_worker_id text,
  p_dry_run_id uuid,
  p_lease_seconds integer default 240,
  p_max_dry_run_age_seconds integer default 1800
)
returns setof public.commercial_monitor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_dry_run public.commercial_monitor_runs%rowtype;
  v_run public.commercial_monitor_runs%rowtype;
begin
  if nullif(trim(p_marketplace_account_key), '') is null
    or nullif(trim(p_worker_id), '') is null
    or p_dry_run_id is null then
    raise exception 'COMMERCIAL_DRY_RUN_GATE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_marketplace_account_key || ':' || p_marketplace, 0)
  );

  select * into v_dry_run
  from public.commercial_monitor_runs
  where id = p_dry_run_id
    and marketplace_account_key = p_marketplace_account_key
    and marketplace = p_marketplace
    and trigger_source = 'dry_run'
  for update;

  if not found
    or v_dry_run.status <> 'completed'
    or v_dry_run.dry_run_satisfactory is not true
    or v_dry_run.dry_run_consumed_at is not null
    or v_dry_run.authorized_persistent_run_id is not null
    or v_dry_run.completed_at is null
    or v_dry_run.completed_at < v_now - make_interval(
      secs => greatest(60, least(coalesce(p_max_dry_run_age_seconds, 1800), 3600))
    )
    or v_dry_run.completed_at > v_now + interval '1 minute'
    or jsonb_typeof(v_dry_run.readers) is distinct from 'object'
    or jsonb_typeof(v_dry_run.metrics) is distinct from 'object'
    or jsonb_typeof(v_dry_run.errors) is distinct from 'array'
    or v_dry_run.errors <> '[]'::jsonb
    or jsonb_typeof(v_dry_run.readers -> 'orders') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'messages') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'analytics') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'watchers') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'listing_identity') is distinct from 'object'
    or jsonb_typeof(v_dry_run.readers -> 'luna_supply') is distinct from 'object'
    or v_dry_run.readers #>> '{orders,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{messages,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{analytics,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{watchers,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{listing_identity,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{luna_supply,status}' is distinct from 'available'
    or v_dry_run.readers #>> '{orders,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{messages,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{analytics,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #>> '{watchers,auth,status}' is distinct from 'READY'
    or v_dry_run.readers #> '{orders,auth,scopeConfirmed}' is distinct from 'true'::jsonb
    or v_dry_run.readers #> '{orders,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{messages,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{analytics,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{watchers,auth,rawOAuthDescriptionExposed}' is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{listing_identity,metrics,itemIdAndCustomLabelExact}' is distinct from 'true'::jsonb
    or v_dry_run.readers #> '{listing_identity,metrics,supplierSkuLinked}' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'dryRun' is distinct from 'true'::jsonb
    or v_dry_run.metrics #> '{authentication,officialIdentityMatch}' is distinct from 'true'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'activeListings') = 'number'
        then (v_dry_run.metrics ->> 'activeListings')::numeric > 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'officialOrdersRead') = 'number'
        then (v_dry_run.metrics ->> 'officialOrdersRead')::numeric >= 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'analyticsListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'analyticsListingsRead')::numeric > 0
      else false
    end) is not true
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'watcherListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'watcherListingsRead')::numeric > 0
      else false
    end) is not true
    or v_dry_run.metrics -> 'listingIdentityVerified' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'lunaExactSupplyLinked' is distinct from 'true'::jsonb
    or v_dry_run.metrics -> 'lunaSupplyFresh' is distinct from 'true'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'sellerHubMessageHeadersRead') = 'number'
        then (v_dry_run.metrics ->> 'sellerHubMessageHeadersRead')::numeric >= 0
      else false
    end) is not true
    or v_dry_run.metrics -> 'sellerHubMessageContentReturned' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'sellerHubMessageRawXmlPersisted' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'commercialDataPersistencePerformed' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'persistenceWrites' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'eventsCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'alertsEnqueued' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'outboxRowsCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'fulfillmentTasksCreated' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'whatsappMetaAccepted' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'whatsappDelivered' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'buyerPiiFieldsReturned' is distinct from '0'::jsonb
    or v_dry_run.metrics -> 'buyerPiiReturned' is distinct from 'false'::jsonb
    or v_dry_run.metrics -> 'ebayWrites' is distinct from '0'::jsonb then
    raise exception 'COMMERCIAL_DRY_RUN_GATE_NOT_SATISFIED';
  end if;

  select * into v_run
  from public.start_commercial_monitor_run(
    p_marketplace_account_key,
    p_marketplace,
    'manual',
    coalesce(p_requested_lanes, '{}'::text[]),
    p_worker_id,
    p_lease_seconds
  );

  if v_run.id is null then
    return;
  end if;

  update public.commercial_monitor_runs
  set authorized_by_dry_run_id = v_dry_run.id
  where id = v_run.id;

  update public.commercial_monitor_runs
  set dry_run_consumed_at = v_now,
      authorized_persistent_run_id = v_run.id
  where id = v_dry_run.id;

  select * into v_run
  from public.commercial_monitor_runs
  where id = v_run.id;
  return next v_run;
end;
$$;

revoke all on function public.authorize_commercial_monitor_scheduler(
  text, text, uuid, uuid, integer, integer
) from public, anon, authenticated;
revoke all on function public.start_authorized_commercial_monitor_scheduled_run(
  text, text, text[], text, integer
) from public, anon, authenticated;
revoke all on function public.require_active_commercial_monitor_scheduler_authorization(
  text, text
) from public, anon, authenticated;
revoke all on function public.revoke_commercial_monitor_scheduler_authorization(
  text, text, uuid
) from public, anon, authenticated;
revoke all on function public.start_authorized_commercial_monitor_run(
  text, text, text[], text, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.authorize_commercial_monitor_scheduler(
  text, text, uuid, uuid, integer, integer
) to service_role;
grant execute on function public.start_authorized_commercial_monitor_scheduled_run(
  text, text, text[], text, integer
) to service_role;
grant execute on function public.require_active_commercial_monitor_scheduler_authorization(
  text, text
) to service_role;
grant execute on function public.revoke_commercial_monitor_scheduler_authorization(
  text, text, uuid
) to service_role;
grant execute on function public.start_authorized_commercial_monitor_run(
  text, text, text[], text, uuid, integer, integer
) to service_role;

notify pgrst, 'reload schema';
