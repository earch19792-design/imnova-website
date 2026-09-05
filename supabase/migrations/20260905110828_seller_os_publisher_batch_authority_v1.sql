create table public.seller_os_publisher_batch_authorizations_v1 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  actor_user_id uuid not null,
  marketplace_id text not null default 'EBAY_US',
  status text not null default 'AUTHORIZED',
  exact_member_count integer not null,
  authorization_digest text not null,
  idempotency_key text not null,
  authorized_members jsonb not null,
  authorized_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_publisher_batch_account_check check (
    marketplace_account_key ~ '^[A-Za-z0-9._:-]{3,120}$'),
  constraint seller_os_publisher_batch_marketplace_check check (
    marketplace_id = 'EBAY_US'),
  constraint seller_os_publisher_batch_status_check check (status in (
    'AUTHORIZED', 'RUNNING', 'PARTIAL', 'COMPLETED', 'BLOCKED')),
  constraint seller_os_publisher_batch_member_count_check check (
    exact_member_count between 1 and 20
    and jsonb_typeof(authorized_members) = 'array'
    and jsonb_array_length(authorized_members) = exact_member_count),
  constraint seller_os_publisher_batch_digest_check check (
    authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_publisher_batch_idempotency_check check (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,160}$'),
  unique (marketplace_account_key, actor_user_id, idempotency_key)
);

create table public.seller_os_publisher_batch_children_v1 (
  id uuid primary key default gen_random_uuid(),
  batch_authorization_id uuid not null references
    public.seller_os_publisher_batch_authorizations_v1(id) on delete restrict,
  marketplace_account_key text not null,
  actor_user_id uuid not null,
  candidate_id text not null,
  package_id uuid not null references public.ebay_listing_packages(id)
    on delete restrict,
  package_digest text not null,
  authorization_binding jsonb not null,
  status text not null default 'AUTHORIZED',
  stage text not null default 'OWNER_AUTHORIZATION',
  result text,
  error_class text,
  ebay_error_codes jsonb not null default '[]'::jsonb,
  mismatch_fields jsonb not null default '[]'::jsonb,
  retry_safety text not null default 'NOT_STARTED',
  duplicate_risk text not null default 'UNPROVEN',
  official_readback_state text not null default 'NOT_STARTED',
  approval_id uuid,
  execution_id uuid,
  offer_id text,
  item_id text,
  marketplace_write_count integer not null default 0,
  receipt_digest text,
  lease_owner text,
  lease_expires_at timestamptz,
  retry_after_at timestamptz,
  attempt_count integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint seller_os_publisher_child_account_check check (
    marketplace_account_key ~ '^[A-Za-z0-9._:-]{3,120}$'),
  constraint seller_os_publisher_child_candidate_check check (
    candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_publisher_child_digest_check check (
    package_digest ~ '^sha256:[0-9a-f]{64}$'),
  constraint seller_os_publisher_child_binding_check check (
    jsonb_typeof(authorization_binding) = 'object'),
  constraint seller_os_publisher_child_status_check check (status in (
    'AUTHORIZED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED_RETRY_SAFE',
    'FAILED_BLOCKED', 'AMBIGUOUS_FAIL_CLOSED')),
  constraint seller_os_publisher_child_counts_check check (
    marketplace_write_count between 0 and 3 and attempt_count >= 0),
  constraint seller_os_publisher_child_receipt_check check (
    receipt_digest is null or receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  unique (batch_authorization_id, candidate_id),
  unique (batch_authorization_id, package_id)
);

create index seller_os_publisher_batch_children_claim_idx on
  public.seller_os_publisher_batch_children_v1(
    marketplace_account_key, status, retry_after_at, lease_expires_at,
    created_at);

create or replace function public.authorize_seller_os_publisher_batch_v1(
  p_marketplace_account_key text,
  p_actor_user_id uuid,
  p_marketplace_id text,
  p_exact_member_count integer,
  p_authorization_digest text,
  p_idempotency_key text,
  p_authorized_members jsonb
) returns setof public.seller_os_publisher_batch_authorizations_v1
language plpgsql security definer
set search_path = ''
as $$
declare
  v_batch public.seller_os_publisher_batch_authorizations_v1%rowtype;
  v_child_count integer;
begin
  insert into public.seller_os_publisher_batch_authorizations_v1 (
    marketplace_account_key, actor_user_id, marketplace_id,
    exact_member_count, authorization_digest, idempotency_key,
    authorized_members
  ) values (
    p_marketplace_account_key, p_actor_user_id, p_marketplace_id,
    p_exact_member_count, p_authorization_digest, p_idempotency_key,
    p_authorized_members
  ) on conflict (marketplace_account_key, actor_user_id, idempotency_key)
    do nothing;

  select * into v_batch
  from public.seller_os_publisher_batch_authorizations_v1
  where marketplace_account_key = p_marketplace_account_key
    and actor_user_id = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if not found
      or v_batch.authorization_digest <> p_authorization_digest
      or v_batch.exact_member_count <> p_exact_member_count
      or v_batch.authorized_members <> p_authorized_members then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.seller_os_publisher_batch_children_v1 (
    batch_authorization_id, marketplace_account_key, actor_user_id,
    candidate_id, package_id, package_digest, authorization_binding
  ) select v_batch.id, p_marketplace_account_key, p_actor_user_id,
      member->>'candidateId', (member->>'packageId')::uuid,
      member->>'packageDigest', member->'authorizationBinding'
    from jsonb_array_elements(p_authorized_members) member
  on conflict (batch_authorization_id, candidate_id) do nothing;

  select count(*) into v_child_count
  from public.seller_os_publisher_batch_children_v1
  where batch_authorization_id = v_batch.id;
  if v_child_count <> p_exact_member_count then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_CHILD_COUNT_DIVERGENCE';
  end if;
  return next v_batch;
end;
$$;

create or replace function public.claim_seller_os_publisher_batch_child_v1(
  p_marketplace_account_key text,
  p_batch_authorization_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 240
) returns setof public.seller_os_publisher_batch_children_v1
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_worker_id !~ '^[A-Za-z0-9._:-]{8,160}$'
     or p_lease_seconds not between 30 and 600 then
    raise exception 'SELLER_OS_PUBLISHER_BATCH_CLAIM_INPUT_INVALID';
  end if;
  select child.id into v_id
  from public.seller_os_publisher_batch_children_v1 child
  join public.seller_os_publisher_batch_authorizations_v1 batch
    on batch.id = child.batch_authorization_id
  where child.marketplace_account_key = p_marketplace_account_key
    and child.batch_authorization_id = p_batch_authorization_id
    and batch.status in ('AUTHORIZED', 'RUNNING', 'PARTIAL')
    and child.status in ('AUTHORIZED', 'FAILED_RETRY_SAFE', 'CLAIMED', 'RUNNING')
    and (child.retry_after_at is null
      or child.retry_after_at <= pg_catalog.clock_timestamp())
    and (child.lease_expires_at is null
      or child.lease_expires_at <= pg_catalog.clock_timestamp())
  order by child.created_at, child.id
  for update of child skip locked
  limit 1;
  if v_id is null then return; end if;
  return query update public.seller_os_publisher_batch_children_v1
    set status = 'CLAIMED', stage = 'PREFLIGHT',
      lease_owner = p_worker_id,
      lease_expires_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_lease_seconds),
      retry_after_at = null,
      attempt_count = attempt_count + 1,
      updated_at = pg_catalog.clock_timestamp()
    where id = v_id
    returning *;
end;
$$;

alter table public.seller_os_publisher_batch_authorizations_v1
  enable row level security;
alter table public.seller_os_publisher_batch_authorizations_v1
  force row level security;
alter table public.seller_os_publisher_batch_children_v1
  enable row level security;
alter table public.seller_os_publisher_batch_children_v1
  force row level security;
revoke all on table public.seller_os_publisher_batch_authorizations_v1
  from public, anon, authenticated;
revoke all on table public.seller_os_publisher_batch_children_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.seller_os_publisher_batch_authorizations_v1 to service_role;
grant select, insert, update on table
  public.seller_os_publisher_batch_children_v1 to service_role;
revoke all on function public.claim_seller_os_publisher_batch_child_v1(
  text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_seller_os_publisher_batch_child_v1(
  text, uuid, text, integer) to service_role;
revoke all on function public.authorize_seller_os_publisher_batch_v1(
  text, uuid, text, integer, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.authorize_seller_os_publisher_batch_v1(
  text, uuid, text, integer, text, text, jsonb) to service_role;

comment on table public.seller_os_publisher_batch_authorizations_v1 is
  'One owner commercial authorization bound to one exact current package cohort; no future or materially changed child is covered.';
comment on table public.seller_os_publisher_batch_children_v1 is
  'Independent idempotent Publisher child execution state with official readback and duplicate-risk truth.';

alter table public.seller_os_post_runtime_scheduler_v1
  drop constraint seller_os_post_runtime_lane_check;
alter table public.seller_os_post_runtime_scheduler_v1
  add constraint seller_os_post_runtime_lane_check check (lane in (
    'QUICK_PICK_RUNTIME_RECOVERY',
    'MARKET_RADAR_LUNA_SYNC',
    'EBAY_LUNA_OPPORTUNITY_SCAN',
    'DAILY_DOLLAR_RADAR_AUTOPILOT',
    'OPERATIONAL_INTEGRITY_AUDITOR',
    'PUBLISHER_BATCH_RUNTIME'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select 'PUBLISHER_BATCH_RUNTIME', '/api/runtime/publisher-batch',
  '*/5 * * * *', 900,
  source.enabled and source.endpoint_url_secret_name is not null
    and source.authorization_secret_name is not null,
  source.endpoint_url_secret_name, source.authorization_secret_name,
  source.vercel_bypass_secret_name,
  'EBAY_SAME_DAY_PILOT_SCHEDULER_CONFIG_SECRET_REFERENCES'
from public.ebay_same_day_pilot_scheduler_config source
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

select cron.schedule(
  'seller-os-post-publisher-batch-runtime-v1',
  '*/5 * * * *',
  $$select public.dispatch_seller_os_post_runtime_v1(
    'PUBLISHER_BATCH_RUNTIME');$$
);

notify pgrst, 'reload schema';
