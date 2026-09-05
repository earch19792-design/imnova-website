-- Seller OS runtime execution is POST-only. Vercel Cron only emits GET, so
-- scheduled commercial runtimes are owned by pg_cron + pg_net and reuse the
-- already configured staging endpoint/authorization *references*. Secret
-- values are never copied into application tables or receipts.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Preserve the mature same-day and monitoring scheduler mechanisms while
-- changing only their transport verb. Named arguments remain compatible with
-- net.http_post; body defaults to an empty JSON object.
do $migration$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    'public.dispatch_same_day_pilot_staging_worker(text,timestamp with time zone)'::regprocedure,
    'public.dispatch_ebay_monitoring_staging_worker(text,timestamp with time zone)'::regprocedure
  ] loop
    select pg_get_functiondef(v_signature) into v_definition;
    if position('net.http_get' in v_definition) > 0 then
      execute replace(v_definition, 'net.http_get', 'net.http_post');
    end if;
  end loop;
end;
$migration$;

create table public.seller_os_post_runtime_scheduler_v1 (
  lane text primary key,
  endpoint_path text not null,
  schedule text not null,
  dispatch_window_seconds integer not null,
  enabled boolean not null default false,
  endpoint_url_secret_name text null,
  authorization_secret_name text null,
  vercel_bypass_secret_name text null,
  source_authority text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_post_runtime_lane_check check (lane in (
    'QUICK_PICK_RUNTIME_RECOVERY',
    'MARKET_RADAR_LUNA_SYNC',
    'EBAY_LUNA_OPPORTUNITY_SCAN',
    'DAILY_DOLLAR_RADAR_AUTOPILOT',
    'OPERATIONAL_INTEGRITY_AUDITOR'
  )),
  constraint seller_os_post_runtime_path_check check (
    endpoint_path ~ '^/api/(cron|runtime)/[a-z0-9-]{3,100}$'
  ),
  constraint seller_os_post_runtime_schedule_check check (
    char_length(schedule) between 9 and 40
    and schedule !~ '[[:cntrl:]]'
  ),
  constraint seller_os_post_runtime_window_check check (
    dispatch_window_seconds in (900, 86400)
  ),
  constraint seller_os_post_runtime_secret_reference_check check (
    (not enabled) or (
      endpoint_url_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$'
      and authorization_secret_name ~ '^[A-Za-z0-9_.:-]{3,200}$'
      and endpoint_url_secret_name <> authorization_secret_name
    )
  ),
  constraint seller_os_post_runtime_source_check check (
    source_authority =
      'EBAY_SAME_DAY_PILOT_SCHEDULER_CONFIG_SECRET_REFERENCES'
  )
);

create table public.seller_os_post_runtime_dispatch_receipts_v1 (
  id bigint generated always as identity primary key,
  dispatch_key text not null unique,
  lane text not null references
    public.seller_os_post_runtime_scheduler_v1(lane),
  dispatch_slot timestamptz not null,
  request_id bigint not null,
  status text not null,
  endpoint_reference_hash text not null,
  requested_at timestamptz not null,
  contract_version text not null default
    'SELLER_OS_POST_ONLY_RUNTIME_DISPATCH_V1',
  constraint seller_os_post_runtime_dispatch_key_check check (
    dispatch_key ~ '^[A-Z0-9_]+:[0-9]{10}$'
  ),
  constraint seller_os_post_runtime_dispatch_status_check check (
    status = 'POST_QUEUED'
  ),
  constraint seller_os_post_runtime_dispatch_endpoint_hash_check check (
    endpoint_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint seller_os_post_runtime_dispatch_contract_check check (
    contract_version = 'SELLER_OS_POST_ONLY_RUNTIME_DISPATCH_V1'
  )
);

create index seller_os_post_runtime_dispatch_latest_idx
  on public.seller_os_post_runtime_dispatch_receipts_v1(
    lane, requested_at desc
  );

create or replace function public.reject_seller_os_post_runtime_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'SELLER_OS_POST_RUNTIME_RECEIPT_APPEND_ONLY';
end;
$$;

create trigger seller_os_post_runtime_dispatch_append_only_v1
before update or delete
on public.seller_os_post_runtime_dispatch_receipts_v1
for each row execute function
  public.reject_seller_os_post_runtime_mutation_v1();

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select seed.lane, seed.endpoint_path, seed.schedule,
  seed.dispatch_window_seconds,
  source.enabled and source.endpoint_url_secret_name is not null
    and source.authorization_secret_name is not null,
  source.endpoint_url_secret_name, source.authorization_secret_name,
  source.vercel_bypass_secret_name,
  'EBAY_SAME_DAY_PILOT_SCHEDULER_CONFIG_SECRET_REFERENCES'
from public.ebay_same_day_pilot_scheduler_config source
cross join (values
  ('QUICK_PICK_RUNTIME_RECOVERY',
    '/api/cron/quick-pick-runtime-recovery', '20 7 * * *', 86400),
  ('MARKET_RADAR_LUNA_SYNC',
    '/api/cron/market-radar-luna-sync', '0 9 * * *', 86400),
  ('EBAY_LUNA_OPPORTUNITY_SCAN',
    '/api/cron/ebay-luna-opportunity-scan', '17 9 * * *', 86400),
  ('DAILY_DOLLAR_RADAR_AUTOPILOT',
    '/api/cron/daily-dollar-radar-autopilot', '0 9 * * *', 86400),
  ('OPERATIONAL_INTEGRITY_AUDITOR',
    '/api/runtime/operational-integrity', '*/15 * * * *', 900)
) as seed(lane, endpoint_path, schedule, dispatch_window_seconds)
where source.singleton
on conflict (lane) do update set
  endpoint_path = excluded.endpoint_path,
  schedule = excluded.schedule,
  dispatch_window_seconds = excluded.dispatch_window_seconds,
  enabled = excluded.enabled,
  endpoint_url_secret_name = excluded.endpoint_url_secret_name,
  authorization_secret_name = excluded.authorization_secret_name,
  vercel_bypass_secret_name = excluded.vercel_bypass_secret_name,
  source_authority = excluded.source_authority,
  updated_at = clock_timestamp();

create or replace function public.verify_seller_os_post_runtime_authorization_v1(
  p_authorization_sha256_values text[]
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, pg_temp
as $$
begin
  if not public.is_seller_os_service_role_request_v1()
      or coalesce(cardinality(p_authorization_sha256_values), 0)
        not between 1 and 8
      or exists (
        select 1 from unnest(p_authorization_sha256_values) value
        where value !~ '^[0-9a-f]{64}$'
      ) then
    return false;
  end if;
  return exists (
    select 1
    from public.seller_os_post_runtime_scheduler_v1 config
    join vault.decrypted_secrets secret
      on secret.name = config.authorization_secret_name
    where config.enabled
      and encode(extensions.digest(convert_to(
        'Bearer ' || secret.decrypted_secret, 'UTF8'), 'sha256'), 'hex')
        = any(p_authorization_sha256_values)
  );
exception when others then
  return false;
end;
$$;

create or replace function public.dispatch_seller_os_post_runtime_v1(
  p_lane text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, pg_temp
as $$
declare
  v_lane text := upper(trim(coalesce(p_lane, '')));
  v_config public.seller_os_post_runtime_scheduler_v1%rowtype;
  v_slot_epoch bigint;
  v_dispatch_slot timestamptz;
  v_dispatch_key text;
  v_endpoint_url text;
  v_authorization_secret text;
  v_vercel_bypass_secret text;
  v_headers jsonb;
  v_request_id bigint;
begin
  select * into v_config
  from public.seller_os_post_runtime_scheduler_v1
  where lane = v_lane;
  if not found or not v_config.enabled then
    return jsonb_build_object('status', 'DISABLED', 'lane', v_lane,
      'httpMethod', 'POST', 'secretValuesDisplayed', false);
  end if;

  v_slot_epoch := floor(extract(epoch from p_now) /
    v_config.dispatch_window_seconds)::bigint *
    v_config.dispatch_window_seconds;
  v_dispatch_slot := to_timestamp(v_slot_epoch);
  v_dispatch_key := v_lane || ':' || v_slot_epoch::text;
  perform pg_advisory_xact_lock(hashtextextended(v_dispatch_key, 0));
  if exists (
    select 1 from public.seller_os_post_runtime_dispatch_receipts_v1
    where dispatch_key = v_dispatch_key
  ) then
    return jsonb_build_object('status', 'IDEMPOTENT_ALREADY_QUEUED',
      'lane', v_lane, 'dispatchKey', v_dispatch_key,
      'httpMethod', 'POST', 'secretValuesDisplayed', false);
  end if;

  select secret.decrypted_secret into v_endpoint_url
  from vault.decrypted_secrets secret
  where secret.name = v_config.endpoint_url_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  select secret.decrypted_secret into v_authorization_secret
  from vault.decrypted_secrets secret
  where secret.name = v_config.authorization_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if v_config.vercel_bypass_secret_name is not null then
    select secret.decrypted_secret into v_vercel_bypass_secret
    from vault.decrypted_secrets secret
    where secret.name = v_config.vercel_bypass_secret_name
    order by secret.updated_at desc nulls last, secret.created_at desc
    limit 1;
  end if;

  v_endpoint_url := rtrim(trim(coalesce(v_endpoint_url, '')), '/');
  v_authorization_secret := trim(coalesce(v_authorization_secret, ''));
  v_vercel_bypass_secret := nullif(trim(coalesce(
    v_vercel_bypass_secret, '')), '');
  if v_endpoint_url !~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*[.]vercel[.]app$'
      or length(v_authorization_secret) < 32
      or (v_config.vercel_bypass_secret_name is not null
        and v_vercel_bypass_secret is null) then
    return jsonb_build_object('status', 'BLOCKED_CONFIGURATION',
      'lane', v_lane, 'reasonCode',
      'VAULT_REFERENCE_INVALID_OR_MISSING', 'httpMethod', 'POST',
      'secretValuesDisplayed', false);
  end if;

  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_authorization_secret,
    'Content-Type', 'application/json',
    'User-Agent', 'seller-os-post-runtime-scheduler/1',
    'X-Seller-OS-Runtime-Lane', v_lane
  );
  if v_vercel_bypass_secret is not null then
    v_headers := v_headers || jsonb_build_object(
      'x-vercel-protection-bypass', v_vercel_bypass_secret
    );
  end if;

  begin
    select net.http_post(
      url := v_endpoint_url || v_config.endpoint_path,
      body := jsonb_build_object(
        'triggerSource', 'SUPABASE_PG_CRON',
        'lane', v_lane,
        'dispatchSlot', v_dispatch_slot,
        'contractVersion', 'SELLER_OS_POST_ONLY_RUNTIME_DISPATCH_V1'
      ),
      headers := v_headers,
      timeout_milliseconds := 240000
    ) into v_request_id;
  exception when others then
    return jsonb_build_object('status', 'QUEUE_FAILED', 'lane', v_lane,
      'reasonCode', 'PG_NET_POST_QUEUE_FAILED', 'httpMethod', 'POST',
      'secretValuesDisplayed', false);
  end;

  insert into public.seller_os_post_runtime_dispatch_receipts_v1 (
    dispatch_key, lane, dispatch_slot, request_id, status,
    endpoint_reference_hash, requested_at
  ) values (
    v_dispatch_key, v_lane, v_dispatch_slot, v_request_id, 'POST_QUEUED',
    encode(extensions.digest(convert_to(v_endpoint_url ||
      v_config.endpoint_path, 'UTF8'), 'sha256'), 'hex'), p_now
  );
  return jsonb_build_object('status', 'POST_QUEUED', 'lane', v_lane,
    'requestId', v_request_id, 'dispatchKey', v_dispatch_key,
    'httpMethod', 'POST', 'secretValuesDisplayed', false);
end;
$$;

create or replace function public.get_seller_os_post_runtime_status_v1()
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select jsonb_build_object(
    'contractVersion', 'SELLER_OS_POST_ONLY_RUNTIME_STATUS_V1',
    'getBusinessMutations', 0,
    'lanes', coalesce(jsonb_agg(jsonb_build_object(
      'lane', config.lane,
      'endpointPath', config.endpoint_path,
      'schedule', config.schedule,
      'enabled', config.enabled,
      'lastPostQueuedAt', receipt.requested_at,
      'lastRequestId', receipt.request_id,
      'httpMethod', 'POST'
    ) order by config.lane), '[]'::jsonb),
    'secretValuesDisplayed', false
  )
  from public.seller_os_post_runtime_scheduler_v1 config
  left join lateral (
    select requested_at, request_id
    from public.seller_os_post_runtime_dispatch_receipts_v1 candidate
    where candidate.lane = config.lane
    order by requested_at desc limit 1
  ) receipt on true;
$$;

do $schedule$
declare
  v_lane record;
begin
  for v_lane in
    select lane, schedule
    from public.seller_os_post_runtime_scheduler_v1
    where enabled
  loop
    perform cron.schedule(
      'seller-os-post-' || lower(replace(v_lane.lane, '_', '-')) || '-v1',
      v_lane.schedule,
      format('select public.dispatch_seller_os_post_runtime_v1(%L);',
        v_lane.lane)
    );
  end loop;
end;
$schedule$;

alter table public.seller_os_post_runtime_scheduler_v1
  enable row level security;
alter table public.seller_os_post_runtime_scheduler_v1
  force row level security;
alter table public.seller_os_post_runtime_dispatch_receipts_v1
  enable row level security;
alter table public.seller_os_post_runtime_dispatch_receipts_v1
  force row level security;

revoke all on table public.seller_os_post_runtime_scheduler_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_post_runtime_dispatch_receipts_v1
  from public, anon, authenticated, service_role;
revoke all on function public.reject_seller_os_post_runtime_mutation_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.verify_seller_os_post_runtime_authorization_v1(
  text[]
) from public, anon, authenticated;
revoke all on function public.dispatch_seller_os_post_runtime_v1(
  text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.get_seller_os_post_runtime_status_v1()
  from public, anon, authenticated;
grant execute on function
  public.verify_seller_os_post_runtime_authorization_v1(text[])
  to service_role;
grant execute on function public.get_seller_os_post_runtime_status_v1()
  to service_role;

comment on table public.seller_os_post_runtime_scheduler_v1 is
  'POST-only Seller OS scheduler policy. Stores secret references only; never secret values.';
comment on table public.seller_os_post_runtime_dispatch_receipts_v1 is
  'Append-only pg_net POST queue receipts. A queued HTTP request is not business or marketplace success.';

notify pgrst, 'reload schema';
