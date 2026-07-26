begin;

create extension if not exists pgcrypto;

alter table public.market_radar_snapshots
  add column if not exists snapshot_ingestion_key text null;

do $block$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.market_radar_snapshots'::regclass
      and conname = 'market_radar_snapshot_ingestion_key_check'
  ) then
    alter table public.market_radar_snapshots
      add constraint market_radar_snapshot_ingestion_key_check
      check (
        snapshot_ingestion_key is null
        or snapshot_ingestion_key ~ '^[0-9a-f]{64}$'
      );
  end if;
end;
$block$;

with ranked as (
  select
    id,
    row_number() over (
      partition by catalog_scan_run_id, product_id, supplier_variant_id
      order by captured_at, id
    ) as canonical_rank
  from public.market_radar_snapshots
  where catalog_scan_run_id is not null
    and snapshot_ingestion_key is null
)
update public.market_radar_snapshots snapshot
set snapshot_ingestion_key = encode(
  digest(
    snapshot.catalog_scan_run_id::text || '|' ||
    snapshot.product_id::text || '|' ||
    snapshot.supplier_variant_id || '|' ||
    'LUNA_SNAPSHOT_INGESTION_V1',
    'sha256'
  ),
  'hex'
)
from ranked
where ranked.id = snapshot.id
  and ranked.canonical_rank = 1
  and snapshot.snapshot_ingestion_key is null;

create unique index if not exists market_radar_snapshot_ingestion_key_unique
  on public.market_radar_snapshots(snapshot_ingestion_key);

create table if not exists public.market_radar_snapshot_ingestion_batches (
  scan_run_id uuid not null
    references public.market_radar_catalog_scan_runs(id) on delete cascade,
  policy_version text not null,
  batch_ordinal integer not null,
  batch_key text not null,
  payload_fingerprint text not null,
  status text not null default 'RUNNING',
  row_count integer not null,
  snapshot_inserted_count integer not null default 0,
  event_inserted_count integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  primary key (scan_run_id, policy_version, batch_ordinal),
  constraint market_radar_snapshot_batch_key_unique unique (batch_key),
  constraint market_radar_snapshot_batch_hashes_check check (
    batch_key ~ '^[0-9a-f]{64}$'
    and payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint market_radar_snapshot_batch_status_check check (
    status in ('RUNNING', 'COMPLETE', 'FAILED', 'CANCELLED')
  ),
  constraint market_radar_snapshot_batch_counts_check check (
    batch_ordinal >= 0
    and row_count >= 1
    and snapshot_inserted_count >= 0
    and event_inserted_count >= 0
  )
);

create index if not exists market_radar_snapshot_batch_run_status_idx
  on public.market_radar_snapshot_ingestion_batches(
    scan_run_id,
    policy_version,
    status,
    batch_ordinal
  );

create or replace function public.sync_market_radar_current_variant_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.market_radar_current_variant_snapshots (
    product_id,
    supplier_variant_id,
    snapshot_id,
    captured_at
  )
  select distinct on (
    inserted.product_id,
    inserted.supplier_variant_id
  )
    inserted.product_id,
    inserted.supplier_variant_id,
    inserted.id,
    inserted.captured_at
  from inserted_market_radar_snapshots inserted
  order by
    inserted.product_id,
    inserted.supplier_variant_id,
    inserted.captured_at desc,
    inserted.id desc
  on conflict (product_id, supplier_variant_id) do update set
    snapshot_id = excluded.snapshot_id,
    captured_at = excluded.captured_at
  where (excluded.captured_at, excluded.snapshot_id) > (
    market_radar_current_variant_snapshots.captured_at,
    market_radar_current_variant_snapshots.snapshot_id
  );

  update public.market_radar_products product
  set last_snapshot_at = greatest(
    product.last_snapshot_at,
    inserted.latest_captured_at
  )
  from (
    select
      product_id,
      max(captured_at) as latest_captured_at
    from inserted_market_radar_snapshots
    group by product_id
  ) inserted
  where product.id = inserted.product_id
    and (
      product.last_snapshot_at is null
      or product.last_snapshot_at < inserted.latest_captured_at
    );

  return null;
end;
$function$;

revoke all on function public.sync_market_radar_current_variant_snapshot()
  from public, anon, authenticated;

drop trigger if exists sync_market_radar_current_variant_snapshot
  on public.market_radar_snapshots;
create trigger sync_market_radar_current_variant_snapshot
  after insert on public.market_radar_snapshots
  referencing new table as inserted_market_radar_snapshots
  for each statement
  execute function public.sync_market_radar_current_variant_snapshot();

update public.market_radar_products product
set last_snapshot_at = latest.latest_captured_at
from (
  select
    product_id,
    max(captured_at) as latest_captured_at
  from public.market_radar_current_variant_snapshots
  group by product_id
) latest
where product.id = latest.product_id
  and product.last_snapshot_at is distinct from latest.latest_captured_at;

update public.market_radar_products product
set last_snapshot_at = null
where product.last_snapshot_at is not null
  and not exists (
    select 1
    from public.market_radar_current_variant_snapshots current_snapshot
    where current_snapshot.product_id = product.id
  );

create or replace function public.persist_market_radar_snapshot_batch_v1(
  p_scan_run_id uuid,
  p_policy_version text,
  p_batch_ordinal integer,
  p_batch_key text,
  p_payload_fingerprint text,
  p_snapshot_rows jsonb,
  p_event_rows jsonb
)
returns table(
  expected_count integer,
  snapshot_inserted_count integer,
  snapshot_replayed_count integer,
  event_inserted_count integer,
  batch_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_run_source_id uuid;
  v_run_status text;
  v_existing public.market_radar_snapshot_ingestion_batches%rowtype;
  v_expected integer;
  v_snapshot_inserted integer := 0;
  v_event_inserted integer := 0;
begin
  if p_scan_run_id is null
    or nullif(trim(p_policy_version), '') is null
    or p_batch_ordinal < 0
    or p_batch_key !~ '^[0-9a-f]{64}$'
    or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_snapshot_rows) is distinct from 'array'
    or jsonb_typeof(p_event_rows) is distinct from 'array' then
    raise exception 'MARKET_RADAR_SNAPSHOT_BATCH_INPUT_INVALID';
  end if;

  v_expected := jsonb_array_length(p_snapshot_rows);
  if v_expected < 1 or v_expected > 100 then
    raise exception 'MARKET_RADAR_SNAPSHOT_BATCH_SIZE_INVALID';
  end if;

  if p_batch_key is distinct from encode(
    digest(
      p_scan_run_id::text || '|' ||
      trim(p_policy_version) || '|' ||
      p_batch_ordinal::text,
      'sha256'
    ),
    'hex'
  ) then
    raise exception 'MARKET_RADAR_SNAPSHOT_BATCH_KEY_INVALID';
  end if;

  select source_id, status
  into v_run_source_id, v_run_status
  from public.market_radar_catalog_scan_runs
  where id = p_scan_run_id
  for update;

  if v_run_source_id is null then
    raise exception 'MARKET_RADAR_SNAPSHOT_RUN_NOT_FOUND';
  end if;
  if v_run_status <> 'RUNNING' then
    raise exception 'MARKET_RADAR_SNAPSHOT_RUN_NOT_RUNNING';
  end if;

  select *
  into v_existing
  from public.market_radar_snapshot_ingestion_batches
  where scan_run_id = p_scan_run_id
    and policy_version = trim(p_policy_version)
    and batch_ordinal = p_batch_ordinal
  for update;

  if found then
    if v_existing.batch_key is distinct from p_batch_key
      or v_existing.payload_fingerprint is distinct from p_payload_fingerprint
      or v_existing.row_count <> v_expected then
      raise exception 'SNAPSHOT_BATCH_REPLAY_PAYLOAD_MISMATCH';
    end if;
    if v_existing.status = 'COMPLETE' then
      return query select
        v_existing.row_count,
        0,
        v_existing.row_count,
        0,
        v_existing.status;
      return;
    end if;
  else
    insert into public.market_radar_snapshot_ingestion_batches (
      scan_run_id,
      policy_version,
      batch_ordinal,
      batch_key,
      payload_fingerprint,
      status,
      row_count
    ) values (
      p_scan_run_id,
      trim(p_policy_version),
      p_batch_ordinal,
      p_batch_key,
      p_payload_fingerprint,
      'RUNNING',
      v_expected
    );
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_snapshot_rows) as input_row(
      source_id uuid,
      product_id uuid,
      supplier_variant_id text,
      catalog_scan_run_id uuid,
      snapshot_fingerprint text,
      snapshot_ingestion_key text
    )
    where input_row.source_id is distinct from v_run_source_id
      or input_row.catalog_scan_run_id is distinct from p_scan_run_id
      or input_row.snapshot_fingerprint !~ '^[0-9a-f]{64}$'
      or input_row.snapshot_ingestion_key is distinct from encode(
        digest(
          p_scan_run_id::text || '|' ||
          input_row.product_id::text || '|' ||
          input_row.supplier_variant_id || '|' ||
          trim(p_policy_version),
          'sha256'
        ),
        'hex'
      )
  ) then
    raise exception 'MARKET_RADAR_SNAPSHOT_ROW_SCOPE_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_snapshot_rows) as input_row(
      snapshot_ingestion_key text,
      snapshot_fingerprint text
    )
    join public.market_radar_snapshots existing
      on existing.snapshot_ingestion_key = input_row.snapshot_ingestion_key
    where existing.snapshot_fingerprint is distinct from input_row.snapshot_fingerprint
  ) then
    raise exception 'SNAPSHOT_REPLAY_PAYLOAD_MISMATCH';
  end if;

  insert into public.market_radar_snapshots (
    source_id,
    product_id,
    supplier_variant_id,
    variant_title,
    sku,
    barcode,
    weight,
    weight_unit,
    price,
    compare_at_price,
    available,
    inventory_quantity,
    collections,
    discount_percent,
    raw,
    captured_at,
    catalog_scan_run_id,
    source_observed_at,
    fetched_at,
    snapshot_fingerprint,
    snapshot_ingestion_key
  )
  select
    input_row.source_id,
    input_row.product_id,
    input_row.supplier_variant_id,
    input_row.variant_title,
    input_row.sku,
    input_row.barcode,
    input_row.weight,
    input_row.weight_unit,
    input_row.price,
    input_row.compare_at_price,
    input_row.available,
    input_row.inventory_quantity,
    input_row.collections,
    input_row.discount_percent,
    input_row.raw,
    input_row.captured_at,
    input_row.catalog_scan_run_id,
    input_row.source_observed_at,
    input_row.fetched_at,
    input_row.snapshot_fingerprint,
    input_row.snapshot_ingestion_key
  from jsonb_to_recordset(p_snapshot_rows) as input_row(
    source_id uuid,
    product_id uuid,
    supplier_variant_id text,
    variant_title text,
    sku text,
    barcode text,
    weight numeric,
    weight_unit text,
    price numeric,
    compare_at_price numeric,
    available boolean,
    inventory_quantity integer,
    collections text[],
    discount_percent numeric,
    raw jsonb,
    captured_at timestamptz,
    catalog_scan_run_id uuid,
    source_observed_at timestamptz,
    fetched_at timestamptz,
    snapshot_fingerprint text,
    snapshot_ingestion_key text
  )
  on conflict (snapshot_ingestion_key) do nothing;
  get diagnostics v_snapshot_inserted = row_count;

  insert into public.market_radar_events (
    source_id,
    product_id,
    supplier_variant_id,
    event_type,
    old_value,
    new_value,
    event_strength,
    idempotency_key,
    created_at
  )
  select
    input_event.source_id,
    input_event.product_id,
    input_event.supplier_variant_id,
    input_event.event_type,
    input_event.old_value,
    input_event.new_value,
    input_event.event_strength,
    input_event.idempotency_key,
    input_event.created_at
  from jsonb_to_recordset(p_event_rows) as input_event(
    source_id uuid,
    product_id uuid,
    supplier_variant_id text,
    event_type public.market_radar_event_type,
    old_value jsonb,
    new_value jsonb,
    event_strength integer,
    idempotency_key text,
    created_at timestamptz
  )
  on conflict (idempotency_key) do nothing;
  get diagnostics v_event_inserted = row_count;

  update public.market_radar_snapshot_ingestion_batches
  set status = 'COMPLETE',
      snapshot_inserted_count = v_snapshot_inserted,
      event_inserted_count = v_event_inserted,
      completed_at = now(),
      updated_at = now()
  where scan_run_id = p_scan_run_id
    and policy_version = trim(p_policy_version)
    and batch_ordinal = p_batch_ordinal;

  return query select
    v_expected,
    v_snapshot_inserted,
    v_expected - v_snapshot_inserted,
    v_event_inserted,
    'COMPLETE'::text;
end;
$function$;

alter table public.market_radar_snapshot_ingestion_batches
  enable row level security;
alter table public.market_radar_snapshot_ingestion_batches
  force row level security;

revoke all on table public.market_radar_snapshot_ingestion_batches
  from public, anon, authenticated;
revoke all on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) from public, anon, authenticated;

grant select, insert, update
  on table public.market_radar_snapshot_ingestion_batches
  to service_role;
grant execute on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) to service_role;

comment on table public.market_radar_snapshot_ingestion_batches is
  'Durable service-role checkpoints for idempotent Luna snapshot and event batches.';
comment on column public.market_radar_snapshots.snapshot_ingestion_key is
  'Stable run/product/variant/policy identity. NULL is retained for legacy audit rows.';

notify pgrst, 'reload schema';
commit;
