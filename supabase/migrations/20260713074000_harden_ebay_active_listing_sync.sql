-- Serialize Inventory API snapshots by monotonically increasing account-scoped
-- generations and close direct browser writes to Seller OS operational state.

alter table public.ebay_active_listings
  add column if not exists sync_generation bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_active_listings_sync_generation_check'
      and conrelid = 'public.ebay_active_listings'::regclass
  ) then
    alter table public.ebay_active_listings
      add constraint ebay_active_listings_sync_generation_check
      check (sync_generation >= 0) not valid;
  end if;
end;
$$;

create table if not exists public.ebay_active_listing_sync_state (
  account_key text primary key,
  latest_generation bigint not null default 0,
  latest_started_run_id uuid null,
  latest_started_at timestamptz null,
  latest_committed_generation bigint not null default 0,
  latest_committed_at timestamptz null,
  constraint ebay_active_listing_sync_state_account_check check (
    account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
  ),
  constraint ebay_active_listing_sync_state_generation_check check (
    latest_generation >= 0
    and latest_committed_generation >= 0
    and latest_committed_generation <= latest_generation
  )
);

alter table public.ebay_active_listing_sync_state enable row level security;
revoke all on table public.ebay_active_listing_sync_state
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.ebay_active_listing_sync_state to service_role;

create or replace function public.begin_ebay_active_listing_sync_generation(
  p_account_key text,
  p_sync_run_id uuid
)
returns table(sync_generation bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_generation bigint;
begin
  if p_account_key is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_sync_run_id is null then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_SCOPE_INVALID';
  end if;

  insert into public.ebay_active_listing_sync_state as state (
    account_key, latest_generation, latest_started_run_id, latest_started_at
  ) values (
    p_account_key, 1, p_sync_run_id, clock_timestamp()
  )
  on conflict (account_key) do update set
    latest_generation = state.latest_generation + 1,
    latest_started_run_id = excluded.latest_started_run_id,
    latest_started_at = excluded.latest_started_at
  returning latest_generation into v_generation;

  return query select v_generation;
end;
$$;

create or replace function public.commit_ebay_active_listing_sync_generation(
  p_account_key text,
  p_sync_run_id uuid,
  p_sync_generation bigint,
  p_observed_at timestamptz,
  p_rows jsonb
)
returns table(
  applied boolean,
  listings_stored integer,
  active_listings_stored integer,
  listings_mapped_to_luna integer,
  stale_listings_ended integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state public.ebay_active_listing_sync_state%rowtype;
  v_input_count integer := 0;
  v_stored integer := 0;
  v_active integer := 0;
  v_mapped integer := 0;
  v_ended integer := 0;
begin
  if p_account_key is null
    or p_account_key !~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'
    or p_sync_run_id is null
    or p_sync_generation is null
    or p_sync_generation < 1
    or p_observed_at is null
    or p_observed_at > clock_timestamp() + interval '5 minutes'
    or p_observed_at < clock_timestamp() - interval '15 minutes'
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_COMMIT_INVALID';
  end if;

  select * into v_state
  from public.ebay_active_listing_sync_state state
  where state.account_key = p_account_key
  for update;
  if not found or p_sync_generation > v_state.latest_generation then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_GENERATION_INVALID';
  end if;
  -- First commit wins for a generation. A retry with the same generation is
  -- harmless even if its caller accidentally supplies a different snapshot.
  if p_sync_generation <= v_state.latest_committed_generation then
    return query select false, 0, 0, 0, 0;
    return;
  end if;

  v_input_count := jsonb_array_length(p_rows);
  if v_input_count > 5000
    or (
      select count(distinct item.value ->> 'sync_key')
      from jsonb_array_elements(p_rows) item(value)
    ) <> v_input_count
    or exists (
      select 1
      from jsonb_array_elements(p_rows) item(value)
      where item.value ->> 'source' is distinct from 'EBAY_SELL_INVENTORY_READONLY'
        or item.value ->> 'account_key' is distinct from p_account_key
        or item.value ->> 'sync_run_id' is distinct from p_sync_run_id::text
        or item.value ->> 'sync_generation' is distinct from p_sync_generation::text
        or coalesce(item.value ->> 'sync_key', '') !~ '^[^[:cntrl:]]{1,500}$'
        or coalesce(item.value ->> 'ebay_item_id', '') !~ '^[0-9]{9,20}$'
        or item.value ->> 'listing_status' not in (
          'active', 'paused', 'ended', 'draft', 'unknown'
        )
        or nullif(trim(item.value ->> 'title'), '') is null
    ) then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_ROWS_INVALID';
  end if;

  insert into public.ebay_active_listings as target (
    source, account_key, sync_key, sync_run_id, sync_generation,
    ebay_item_id, listing_status, title, ebay_sku, ebay_quantity,
    ebay_price, currency, market_radar_product_id, supplier_variant_id,
    supplier_sku, supplier_cost_at_linking, last_ebay_sync_at,
    raw_payload, updated_at
  )
  select
    row.source, row.account_key, row.sync_key, row.sync_run_id,
    row.sync_generation, row.ebay_item_id, row.listing_status, row.title,
    row.ebay_sku, row.ebay_quantity, row.ebay_price,
    coalesce(row.currency, 'USD'), row.market_radar_product_id,
    row.supplier_variant_id, row.supplier_sku,
    row.supplier_cost_at_linking, p_observed_at,
    coalesce(row.raw_payload, '{}'::jsonb), p_observed_at
  from jsonb_to_recordset(p_rows) as row(
    source text,
    account_key text,
    sync_key text,
    sync_run_id uuid,
    sync_generation bigint,
    ebay_item_id text,
    listing_status text,
    title text,
    ebay_sku text,
    ebay_quantity integer,
    ebay_price numeric,
    currency text,
    market_radar_product_id uuid,
    supplier_variant_id text,
    supplier_sku text,
    supplier_cost_at_linking numeric,
    raw_payload jsonb
  )
  on conflict (sync_key) do update set
    sync_run_id = excluded.sync_run_id,
    sync_generation = excluded.sync_generation,
    ebay_item_id = excluded.ebay_item_id,
    listing_status = excluded.listing_status,
    title = excluded.title,
    ebay_sku = excluded.ebay_sku,
    ebay_quantity = excluded.ebay_quantity,
    ebay_price = excluded.ebay_price,
    currency = excluded.currency,
    market_radar_product_id = excluded.market_radar_product_id,
    supplier_variant_id = excluded.supplier_variant_id,
    supplier_sku = excluded.supplier_sku,
    supplier_cost_at_linking = excluded.supplier_cost_at_linking,
    last_ebay_sync_at = excluded.last_ebay_sync_at,
    raw_payload = excluded.raw_payload,
    updated_at = excluded.updated_at
  where target.account_key = p_account_key
    and target.source = 'EBAY_SELL_INVENTORY_READONLY'
    and target.sync_generation <= excluded.sync_generation;
  get diagnostics v_stored = row_count;
  if v_stored <> v_input_count then
    raise exception 'EBAY_ACTIVE_LISTING_SYNC_KEY_SCOPE_CONFLICT';
  end if;

  update public.ebay_active_listings target
  set listing_status = 'ended',
      sync_run_id = p_sync_run_id,
      sync_generation = p_sync_generation,
      last_ebay_sync_at = p_observed_at,
      updated_at = p_observed_at,
      raw_payload = coalesce(target.raw_payload, '{}'::jsonb) ||
        jsonb_build_object(
          'reconciledMissingFromInventory', true,
          'reconciledAt', p_observed_at
        )
  where target.source = 'EBAY_SELL_INVENTORY_READONLY'
    and target.account_key = p_account_key
    and target.sync_generation <= p_sync_generation
    and not exists (
      select 1
      from jsonb_array_elements(p_rows) item(value)
      where item.value ->> 'sync_key' = target.sync_key
    );
  get diagnostics v_ended = row_count;

  select
    count(*) filter (where item.value ->> 'listing_status' = 'active'),
    count(*) filter (
      where nullif(item.value ->> 'market_radar_product_id', '') is not null
    )
  into v_active, v_mapped
  from jsonb_array_elements(p_rows) item(value);

  update public.ebay_active_listing_sync_state state
  set latest_committed_generation = p_sync_generation,
      latest_committed_at = p_observed_at
  where state.account_key = p_account_key;

  return query select true, v_stored, v_active, v_mapped, v_ended;
end;
$$;

revoke all on function public.begin_ebay_active_listing_sync_generation(
  text, uuid
) from public, anon, authenticated;
revoke all on function public.commit_ebay_active_listing_sync_generation(
  text, uuid, bigint, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_ebay_active_listing_sync_generation(
  text, uuid
) to service_role;
grant execute on function public.commit_ebay_active_listing_sync_generation(
  text, uuid, bigint, timestamptz, jsonb
) to service_role;

-- All browser/admin reads stay available, but operational writes cross the
-- protected server API and service-role RPCs only.
drop policy if exists "admin manage ebay_active_listings"
  on public.ebay_active_listings;
create policy "admin read ebay_active_listings"
  on public.ebay_active_listings for select to authenticated
  using (public.is_admin());

drop policy if exists "admin manage ebay_active_listing_risk_events"
  on public.ebay_active_listing_risk_events;
create policy "admin read ebay_active_listing_risk_events"
  on public.ebay_active_listing_risk_events for select to authenticated
  using (public.is_admin());

drop policy if exists "admin manage ebay luna scan runs"
  on public.ebay_luna_scan_runs;
create policy "admin read ebay luna scan runs"
  on public.ebay_luna_scan_runs for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay luna best selling signals"
  on public.ebay_luna_best_selling_signals;
create policy "admin read ebay luna best selling signals"
  on public.ebay_luna_best_selling_signals for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay luna opportunity queue"
  on public.ebay_luna_opportunity_queue;
create policy "admin read ebay luna opportunity queue"
  on public.ebay_luna_opportunity_queue for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay luna opportunity queue events"
  on public.ebay_luna_opportunity_queue_events;
create policy "admin read ebay luna opportunity queue events"
  on public.ebay_luna_opportunity_queue_events for select to authenticated
  using (public.is_admin());

drop policy if exists "admin manage ebay seller automation runs"
  on public.ebay_seller_automation_runs;
create policy "admin read ebay seller automation runs"
  on public.ebay_seller_automation_runs for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay seller scan tasks"
  on public.ebay_seller_scan_tasks;
create policy "admin read ebay seller scan tasks"
  on public.ebay_seller_scan_tasks for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay command center reviews"
  on public.ebay_command_center_reviews;
create policy "admin read ebay command center reviews"
  on public.ebay_command_center_reviews for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay seller alert outbox"
  on public.ebay_seller_alert_outbox;
create policy "admin read ebay seller alert outbox"
  on public.ebay_seller_alert_outbox for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay seller alert delivery attempts"
  on public.ebay_seller_alert_delivery_attempts;
create policy "admin read ebay seller alert delivery attempts"
  on public.ebay_seller_alert_delivery_attempts for select to authenticated
  using (public.is_admin());
drop policy if exists "admin manage ebay seller whatsapp alert state"
  on public.ebay_seller_whatsapp_alert_state;
create policy "admin read ebay seller whatsapp alert state"
  on public.ebay_seller_whatsapp_alert_state for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on
  public.ebay_active_listings,
  public.ebay_active_listing_risk_events,
  public.ebay_luna_scan_runs,
  public.ebay_luna_best_selling_signals,
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events,
  public.ebay_seller_automation_runs,
  public.ebay_seller_scan_tasks,
  public.ebay_command_center_reviews,
  public.ebay_seller_alert_outbox,
  public.ebay_seller_alert_delivery_attempts,
  public.ebay_seller_whatsapp_alert_state
from anon, authenticated;

grant select on
  public.ebay_active_listings,
  public.ebay_active_listing_risk_events,
  public.ebay_luna_scan_runs,
  public.ebay_luna_best_selling_signals,
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events,
  public.ebay_seller_automation_runs,
  public.ebay_seller_scan_tasks,
  public.ebay_command_center_reviews,
  public.ebay_seller_alert_outbox,
  public.ebay_seller_alert_delivery_attempts,
  public.ebay_seller_whatsapp_alert_state
to authenticated;

grant select, insert, update, delete on
  public.ebay_active_listings,
  public.ebay_active_listing_risk_events,
  public.ebay_luna_scan_runs,
  public.ebay_luna_best_selling_signals,
  public.ebay_luna_opportunity_queue,
  public.ebay_luna_opportunity_queue_events,
  public.ebay_seller_automation_runs,
  public.ebay_seller_scan_tasks,
  public.ebay_command_center_reviews,
  public.ebay_seller_alert_outbox,
  public.ebay_seller_alert_delivery_attempts,
  public.ebay_seller_whatsapp_alert_state
to service_role;

notify pgrst, 'reload schema';
