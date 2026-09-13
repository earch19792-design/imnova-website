-- Durable, operator-visible commercial analysis trace. This is an
-- observability/control-plane contract only: it cannot authorize publication
-- or perform marketplace writes.

create table public.seller_os_live_commercial_traces_v1 (
  trace_id uuid primary key default gen_random_uuid(),
  contract_version text not null default 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1',
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  product_url text not null,
  state text not null default 'RUNNING',
  current_stage text not null default 'INITIALIZING',
  event_count integer not null default 0,
  result jsonb not null default '{}'::jsonb,
  safety jsonb not null default jsonb_build_object(
    'publicationWrites', 0,
    'ebayWrites', 0,
    'purchaseCompleted', false,
    'rawAddressPersisted', false,
    'credentialsPersisted', false
  ),
  started_by uuid null,
  started_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  updated_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  completed_at timestamptz null,
  constraint seller_os_live_commercial_trace_contract_check check (
    contract_version = 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1'
    and marketplace_id = 'EBAY_US'
    and account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    and product_url ~ '^https://(www\.)?lunaportex\.com/products/'
  ),
  constraint seller_os_live_commercial_trace_state_check check (
    state in ('RUNNING', 'COMPLETED', 'FAILED')
    and event_count >= 0
    and jsonb_typeof(result) = 'object'
    and jsonb_typeof(safety) = 'object'
  ),
  constraint seller_os_live_commercial_trace_safety_check check (
    safety -> 'publicationWrites' = '0'::jsonb
    and safety -> 'ebayWrites' = '0'::jsonb
    and safety -> 'purchaseCompleted' = 'false'::jsonb
    and safety -> 'rawAddressPersisted' = 'false'::jsonb
    and safety -> 'credentialsPersisted' = 'false'::jsonb
  )
);

create table public.seller_os_live_commercial_trace_events_v1 (
  id bigint generated always as identity primary key,
  trace_id uuid not null references public.seller_os_live_commercial_traces_v1(trace_id),
  sequence integer not null,
  stage text not null,
  status text not null,
  narrative text not null,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  contract_version text not null default 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1',
  constraint seller_os_live_commercial_trace_event_unique unique (trace_id, sequence),
  constraint seller_os_live_commercial_trace_event_contract_check check (
    contract_version = 'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1'
    and sequence > 0
    and status in ('RUNNING', 'PASS', 'BLOCKED', 'INFO', 'FAIL')
    and char_length(stage) between 2 and 80
    and char_length(narrative) between 1 and 2000
    and jsonb_typeof(evidence) = 'object'
  )
);

create index seller_os_live_commercial_traces_latest_idx
  on public.seller_os_live_commercial_traces_v1 (started_at desc, trace_id);

create index seller_os_live_commercial_trace_events_read_idx
  on public.seller_os_live_commercial_trace_events_v1 (trace_id, sequence);

create or replace function public.reject_seller_os_live_commercial_trace_event_mutation_v1()
returns trigger
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception 'SELLER_OS_LIVE_COMMERCIAL_TRACE_EVENTS_APPEND_ONLY';
end;
$function$;

create trigger seller_os_live_commercial_trace_events_append_only
before update or delete on public.seller_os_live_commercial_trace_events_v1
for each row execute function
  public.reject_seller_os_live_commercial_trace_event_mutation_v1();

alter table public.seller_os_live_commercial_traces_v1 enable row level security;
alter table public.seller_os_live_commercial_traces_v1 force row level security;
alter table public.seller_os_live_commercial_trace_events_v1 enable row level security;
alter table public.seller_os_live_commercial_trace_events_v1 force row level security;

revoke all on table public.seller_os_live_commercial_traces_v1
  from anon, authenticated;
revoke all on table public.seller_os_live_commercial_trace_events_v1
  from anon, authenticated;
grant select, insert, update on table public.seller_os_live_commercial_traces_v1
  to service_role;
grant select, insert on table public.seller_os_live_commercial_trace_events_v1
  to service_role;
grant usage, select on sequence
  public.seller_os_live_commercial_trace_events_v1_id_seq to service_role;

create policy seller_os_live_commercial_traces_service_role
  on public.seller_os_live_commercial_traces_v1 for all to service_role
  using (true) with check (true);
create policy seller_os_live_commercial_trace_events_service_role_read
  on public.seller_os_live_commercial_trace_events_v1 for select to service_role
  using (true);
create policy seller_os_live_commercial_trace_events_service_role_insert
  on public.seller_os_live_commercial_trace_events_v1 for insert to service_role
  with check (true);

revoke all on function
  public.reject_seller_os_live_commercial_trace_event_mutation_v1()
  from public, anon, authenticated, service_role;

comment on table public.seller_os_live_commercial_traces_v1 is
  'SELLER_OS_LIVE_COMMERCIAL_TRACE_V1 materialized trace state; never publication authority.';
comment on table public.seller_os_live_commercial_trace_events_v1 is
  'Append-only human-readable commercial analysis evidence; no marketplace write capability.';
