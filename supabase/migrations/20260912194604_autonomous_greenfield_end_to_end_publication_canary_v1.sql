-- Durable singleton for the physical autonomous GREENFIELD certification.
-- Product identity is written only by the runtime after normal Radar/Factory
-- ranking; callers cannot supply an identity to the lane.
create table public.seller_os_autonomous_greenfield_canary_v1 (
  account_key text primary key,
  contract_version text not null default
    'AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1',
  status text not null default 'SELECTING',
  candidate_id text null,
  opportunity_id uuid null references public.ebay_luna_opportunity_queue(id),
  candidate_key text null,
  listing_package_id uuid null references public.ebay_listing_packages(id),
  product_id text null,
  variant_id text null,
  supplier_sku text null,
  publication_id uuid null references
    public.ebay_authorized_listing_publications(id),
  listing_id text null,
  active_listing_count_before bigint null,
  active_listing_count_after bigint null,
  evidence jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  selected_at timestamptz null,
  published_confirmed_at timestamptz null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint autonomous_greenfield_canary_version_check check (
    contract_version =
      'AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY_V1'),
  constraint autonomous_greenfield_canary_status_check check (status in (
    'SELECTING', 'SELECTED', 'PREPUBLICATION_READY',
    'PUBLISHING', 'PUBLISHED_CONFIRMED', 'BLOCKED')),
  constraint autonomous_greenfield_canary_identity_check check (
    (candidate_id is null and opportunity_id is null and candidate_key is null
      and listing_package_id is null and product_id is null
      and variant_id is null and supplier_sku is null)
    or
    (candidate_id is not null and opportunity_id is not null
      and candidate_key is not null and listing_package_id is not null
      and product_id is not null and variant_id is not null
      and supplier_sku is not null)),
  constraint autonomous_greenfield_canary_listing_check check (
    listing_id is null or listing_id ~ '^[0-9]{9,20}$'),
  constraint autonomous_greenfield_canary_confirmation_check check (
    status <> 'PUBLISHED_CONFIRMED' or (
      publication_id is not null and listing_id is not null
      and published_confirmed_at is not null
      and active_listing_count_before is not null
      and active_listing_count_after = active_listing_count_before + 1))
);

alter table public.seller_os_autonomous_greenfield_canary_v1
  enable row level security;
revoke all on table public.seller_os_autonomous_greenfield_canary_v1
  from public, anon, authenticated;
grant select, insert, update on table
  public.seller_os_autonomous_greenfield_canary_v1 to service_role;

create or replace function public.claim_autonomous_greenfield_canary_v1(
  p_account_key text,
  p_candidate_id text,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_listing_package_id uuid,
  p_product_id text,
  p_variant_id text,
  p_supplier_sku text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_row public.seller_os_autonomous_greenfield_canary_v1%rowtype;
begin
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null
      or nullif(trim(coalesce(p_candidate_id, '')), '') is null
      or p_opportunity_id is null or p_listing_package_id is null
      or nullif(trim(coalesce(p_candidate_key, '')), '') is null
      or nullif(trim(coalesce(p_product_id, '')), '') is null
      or nullif(trim(coalesce(p_variant_id, '')), '') is null
      or nullif(trim(coalesce(p_supplier_sku, '')), '') is null then
    raise exception 'AUTONOMOUS_GREENFIELD_CLAIM_INVALID';
  end if;
  insert into public.seller_os_autonomous_greenfield_canary_v1 (
    account_key, evidence
  ) values (trim(p_account_key), coalesce(p_evidence, '{}'::jsonb))
  on conflict (account_key) do nothing;
  select * into v_row
  from public.seller_os_autonomous_greenfield_canary_v1
  where account_key = trim(p_account_key)
  for update;
  if v_row.candidate_id is null then
    update public.seller_os_autonomous_greenfield_canary_v1 set
      status = 'SELECTED', candidate_id = trim(p_candidate_id),
      opportunity_id = p_opportunity_id,
      candidate_key = trim(p_candidate_key),
      listing_package_id = p_listing_package_id,
      product_id = trim(p_product_id), variant_id = trim(p_variant_id),
      supplier_sku = trim(p_supplier_sku),
      evidence = evidence || coalesce(p_evidence, '{}'::jsonb),
      selected_at = clock_timestamp(), updated_at = clock_timestamp()
    where account_key = trim(p_account_key)
    returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.claim_autonomous_greenfield_canary_v1(
  text,text,uuid,text,uuid,text,text,text,jsonb) from public, anon,
  authenticated;
grant execute on function public.claim_autonomous_greenfield_canary_v1(
  text,text,uuid,text,uuid,text,text,text,jsonb) to service_role;

alter table public.seller_os_post_runtime_scheduler_v1
  drop constraint seller_os_post_runtime_lane_check;
alter table public.seller_os_post_runtime_scheduler_v1
  add constraint seller_os_post_runtime_lane_check check (lane in (
    'QUICK_PICK_RUNTIME_RECOVERY', 'MARKET_RADAR_LUNA_SYNC',
    'EBAY_LUNA_OPPORTUNITY_SCAN', 'DAILY_DOLLAR_RADAR_AUTOPILOT',
    'OPERATIONAL_INTEGRITY_AUDITOR', 'PUBLISHER_BATCH_RUNTIME',
    'PUBLISHER_PREAUTHORIZATION_RECOVERY', 'RUNTIME_CAPABILITY_ASSURANCE',
    'CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT',
    'AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select 'AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY',
  '/api/cron/quick-pick-runtime-recovery', '0 0 1 1 *', 900,
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
  updated_at = case when
    public.seller_os_post_runtime_scheduler_v1.endpoint_path is distinct from
      excluded.endpoint_path
    or public.seller_os_post_runtime_scheduler_v1.enabled is distinct from
      excluded.enabled
    then clock_timestamp()
    else public.seller_os_post_runtime_scheduler_v1.updated_at end;

comment on table public.seller_os_autonomous_greenfield_canary_v1 is
  'Fail-closed singleton evidence ledger. Candidate identity is claimed only by the normal CURRENT Radar/Factory runtime; it grants at most one physical publication.';
