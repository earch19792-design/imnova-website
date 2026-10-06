-- SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_MONITOR_V1
-- Adds contributor attribution and append-only observations to the existing
-- supplier Radar. It does not create a second opportunity engine and has no
-- Amazon mutation, supplier purchase, repricing or publication capability.

create table if not exists public.seller_os_sourcing_collaborators_v1 (
  id uuid primary key default gen_random_uuid(),
  collaborator_key text not null unique,
  display_name text not null,
  operating_role text not null,
  status text not null default 'ACTIVE',
  marketplaces text[] not null default '{}'::text[],
  declared_capabilities jsonb not null default '{}'::jsonb,
  evidence_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_os_sourcing_collaborator_key_check check (
    collaborator_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'
  ),
  constraint seller_os_sourcing_collaborator_name_check check (
    length(display_name) between 1 and 160 and
    display_name !~ '[[:cntrl:]]'
  ),
  constraint seller_os_sourcing_collaborator_role_check check (
    operating_role in ('AMAZON_STORE_OPERATOR')
  ),
  constraint seller_os_sourcing_collaborator_status_check check (
    status in ('ACTIVE', 'PAUSED', 'REVOKED')
  ),
  constraint seller_os_sourcing_collaborator_marketplace_check check (
    marketplaces <@ array['AMAZON_US', 'EBAY_US']::text[]
  ),
  constraint seller_os_sourcing_collaborator_capabilities_check check (
    jsonb_typeof(declared_capabilities) = 'object'
  ),
  constraint seller_os_sourcing_collaborator_evidence_policy_check check (
    jsonb_typeof(evidence_policy) = 'object'
  )
);

insert into public.seller_os_sourcing_collaborators_v1 (
  collaborator_key,
  display_name,
  operating_role,
  status,
  marketplaces,
  declared_capabilities,
  evidence_policy
) values (
  'connie-g-yape',
  'Connie G. Yape',
  'AMAZON_STORE_OPERATOR',
  'ACTIVE',
  array['AMAZON_US']::text[],
  jsonb_build_object(
    'sellerCentralProductUploadAccessDeclaredByOwner', true,
    'supplierNetworkDeclaredByOwner', true,
    'winningProductResearchSkillDeclaredByOwner', true,
    'declaredAt', '2026-10-06T00:00:00.000Z'
  ),
  jsonb_build_object(
    'contributorAssertionsAreEvidence', true,
    'contributorAssertionsAreMarketplaceProof', false,
    'amazonAuthorityRequiredForConfirmedDemand', true,
    'minimumNetProfitUsd', 4,
    'automaticPurchaseAllowed', false,
    'automaticMarketplaceWriteAllowed', false,
    'personalContactDataStored', false
  )
)
on conflict (collaborator_key) do update set
  display_name = excluded.display_name,
  operating_role = excluded.operating_role,
  marketplaces = excluded.marketplaces,
  declared_capabilities = excluded.declared_capabilities,
  evidence_policy = excluded.evidence_policy,
  updated_at = now();

alter table public.market_radar_sources
  add column if not exists submitted_by_collaborator_id uuid null
    references public.seller_os_sourcing_collaborators_v1(id)
    on delete set null,
  add column if not exists sourcing_metadata jsonb not null
    default '{}'::jsonb;

alter table public.market_radar_products
  add column if not exists sourcing_collaborator_id uuid null
    references public.seller_os_sourcing_collaborators_v1(id)
    on delete set null;

alter table public.market_radar_snapshots
  add column if not exists sourcing_collaborator_id uuid null
    references public.seller_os_sourcing_collaborators_v1(id)
    on delete set null;

alter table public.market_radar_events
  add column if not exists sourcing_collaborator_id uuid null
    references public.seller_os_sourcing_collaborators_v1(id)
    on delete set null,
  add column if not exists recorded_by_user_id uuid null
    references auth.users(id) on delete set null;

alter table public.market_radar_events
  drop constraint if exists market_radar_events_type_check;
alter table public.market_radar_events
  add constraint market_radar_events_type_check check (
    event_type in (
      'new_product',
      'restocked',
      'out_of_stock',
      'price_up',
      'price_down',
      'entered_collection',
      'exited_collection',
      'discount_started',
      'discount_ended',
      'collaborator_product_submitted',
      'amazon_listing_observed',
      'amazon_result_observed',
      'amazon_reorder_review_ready'
    )
  );

create index if not exists market_radar_sources_contributor_idx
  on public.market_radar_sources(submitted_by_collaborator_id, updated_at desc)
  where submitted_by_collaborator_id is not null;

create index if not exists market_radar_products_contributor_idx
  on public.market_radar_products(sourcing_collaborator_id, last_snapshot_at desc)
  where sourcing_collaborator_id is not null;

create index if not exists market_radar_snapshots_contributor_idx
  on public.market_radar_snapshots(sourcing_collaborator_id, captured_at desc)
  where sourcing_collaborator_id is not null;

create index if not exists market_radar_events_contributor_idx
  on public.market_radar_events(sourcing_collaborator_id, created_at desc)
  where sourcing_collaborator_id is not null;

drop trigger if exists set_seller_os_sourcing_collaborators_v1_updated_at
  on public.seller_os_sourcing_collaborators_v1;
create trigger set_seller_os_sourcing_collaborators_v1_updated_at
  before update on public.seller_os_sourcing_collaborators_v1
  for each row execute function public.set_updated_at();

alter table public.seller_os_sourcing_collaborators_v1
  enable row level security;

drop policy if exists "admin manage sourcing collaborators"
  on public.seller_os_sourcing_collaborators_v1;
create policy "admin manage sourcing collaborators"
  on public.seller_os_sourcing_collaborators_v1
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.seller_os_sourcing_collaborators_v1
  from public, anon, authenticated;
grant select, insert, update, delete on
  public.seller_os_sourcing_collaborators_v1
  to service_role;

comment on table public.seller_os_sourcing_collaborators_v1 is
  'Identity and evidence policy for Seller OS sourcing contributors. No credentials or personal contact details.';
comment on column public.market_radar_products.sourcing_collaborator_id is
  'Attribution only. It does not prove marketplace demand, economics or publication authority.';
comment on column public.market_radar_events.recorded_by_user_id is
  'Seller OS user who durably recorded the observation; never an Amazon credential.';

create or replace function public.put_seller_os_amazon_contributor_observation_v1(
  p_observation jsonb,
  p_recorded_by_user_id uuid
)
returns jsonb
language plpgsql security invoker
set search_path = ''
as $function$
declare
  v_collaborator public.seller_os_sourcing_collaborators_v1%rowtype;
  v_source public.market_radar_sources%rowtype;
  v_product public.market_radar_products%rowtype;
  v_snapshot_id uuid;
  v_event_id uuid;
  v_existing_event public.market_radar_events%rowtype;
  v_digest text;
  v_idempotency_key text;
  v_source_key text;
  v_supplier_product_id text;
  v_supplier_variant_id text;
  v_supplier_sku text;
  v_handle text;
  v_title text;
  v_event_type text;
  v_observed_at timestamptz;
  v_inventory_quantity integer;
  v_unit_cost numeric(12,2);
begin
  if p_recorded_by_user_id is null
    or jsonb_typeof(p_observation) <> 'object'
    or octet_length(p_observation::text) > 250000
    or p_observation ->> 'contractVersion' <>
      'SELLER_OS_AMAZON_CONTRIBUTOR_PERFORMANCE_MONITOR_V1'
    or p_observation #>> '{contributor,key}' <> 'connie-g-yape'
    or jsonb_typeof(p_observation -> 'supplier') <> 'object'
    or jsonb_typeof(p_observation -> 'product') <> 'object'
    or jsonb_typeof(p_observation -> 'nextBestEvidence') <> 'object'
    or jsonb_typeof(p_observation -> 'safety') <> 'object'
    or coalesce((p_observation #>> '{safety,marketplaceWrites}')::integer, -1) <> 0
    or coalesce((p_observation #>> '{safety,supplierPurchases}')::integer, -1) <> 0
    or coalesce((p_observation #>> '{safety,publications}')::integer, -1) <> 0
    or coalesce((p_observation #>> '{safety,repricing}')::integer, -1) <> 0
    or p_observation ? 'contact'
    or p_observation ? 'phone'
    or p_observation ? 'email'
  then
    raise exception 'SELLER_OS_AMAZON_CONTRIBUTOR_OBSERVATION_INVALID';
  end if;

  v_digest := p_observation ->> 'observationDigest';
  v_idempotency_key := p_observation ->> 'idempotencyKey';
  v_source_key := p_observation #>> '{supplier,sourceKey}';
  v_supplier_product_id := p_observation #>> '{supplier,productId}';
  v_supplier_variant_id := p_observation #>> '{supplier,variantId}';
  v_supplier_sku := p_observation #>> '{supplier,sku}';
  v_handle := p_observation #>> '{product,handle}';
  v_title := p_observation #>> '{product,title}';
  v_event_type := p_observation ->> 'eventType';
  v_observed_at := (p_observation ->> 'observedAt')::timestamptz;
  v_inventory_quantity := (p_observation #>>
    '{supplier,inventoryQuantity}')::integer;
  v_unit_cost := (p_observation #>> '{economics,unitCostUsd}')::numeric;

  if coalesce(v_digest, '') !~ '^sha256:[0-9a-f]{64}$'
    or v_idempotency_key <> 'amazon-contributor-observation:' || v_digest
    or coalesce(v_source_key, '') !~ '^[a-z0-9][a-z0-9-]{1,79}$'
    or length(coalesce(v_supplier_product_id, '')) not between 1 and 240
    or length(coalesce(v_supplier_variant_id, '')) not between 1 and 240
    or length(coalesce(v_supplier_sku, '')) not between 1 and 240
    or coalesce(v_handle, '') !~ '^[a-z0-9][a-z0-9-]{1,199}$'
    or length(coalesce(v_title, '')) not between 1 and 500
    or v_event_type not in (
      'collaborator_product_submitted',
      'amazon_listing_observed',
      'amazon_result_observed',
      'amazon_reorder_review_ready'
    )
    or v_observed_at is null
    or v_observed_at > pg_catalog.now() + interval '5 minutes'
  then
    raise exception 'SELLER_OS_AMAZON_CONTRIBUTOR_AUTHORITY_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_idempotency_key, 0)
  );

  select * into v_existing_event
  from public.market_radar_events
  where idempotency_key = v_idempotency_key;
  if found then
    return pg_catalog.jsonb_build_object(
      'status', 'IDEMPOTENT_SUCCESS',
      'replay', true,
      'eventId', v_existing_event.id,
      'sourceId', v_existing_event.source_id,
      'productId', v_existing_event.product_id,
      'snapshotId', v_existing_event.new_value ->> 'snapshotId',
      'observationDigest', v_digest,
      'readbackVerified',
        v_existing_event.new_value ->> 'observationDigest' = v_digest
    );
  end if;

  select * into v_collaborator
  from public.seller_os_sourcing_collaborators_v1
  where collaborator_key = 'connie-g-yape'
    and status = 'ACTIVE';
  if not found then
    raise exception 'SELLER_OS_AMAZON_CONTRIBUTOR_NOT_ACTIVE';
  end if;

  insert into public.market_radar_sources (
    key, name, base_url, is_active, poll_interval_minutes,
    submitted_by_collaborator_id, sourcing_metadata
  ) values (
    v_source_key,
    p_observation #>> '{supplier,name}',
    p_observation #>> '{supplier,baseUrl}',
    true,
    1440,
    v_collaborator.id,
    pg_catalog.jsonb_build_object(
      'contractVersion', p_observation ->> 'contractVersion',
      'lastContributorObservationDigest', v_digest,
      'lastContributorObservedAt', v_observed_at,
      'contributorKey', v_collaborator.collaborator_key
    )
  )
  on conflict (key) do update set
    sourcing_metadata = public.market_radar_sources.sourcing_metadata ||
      excluded.sourcing_metadata,
    updated_at = pg_catalog.now()
  returning * into v_source;

  insert into public.market_radar_products (
    source_id, supplier_product_id, handle, title, vendor, product_type,
    tags, product_url, first_seen_at, last_seen_at, last_snapshot_at,
    is_active, metadata, sourcing_collaborator_id
  ) values (
    v_source.id,
    v_supplier_product_id,
    v_handle,
    v_title,
    p_observation #>> '{product,brand}',
    p_observation #>> '{product,category}',
    array['amazon', 'connie', 'collaborator-submission']::text[],
    p_observation #>> '{supplier,productUrl}',
    v_observed_at,
    v_observed_at,
    v_observed_at,
    coalesce(v_inventory_quantity, 1) > 0,
    pg_catalog.jsonb_build_object(
      'amazonContributorMonitor', pg_catalog.jsonb_build_object(
        'contractVersion', p_observation ->> 'contractVersion',
        'observationDigest', v_digest,
        'lifecycleStage', p_observation ->> 'lifecycleStage',
        'nextBestEvidence', p_observation #>> '{nextBestEvidence,action}',
        'skillOutcome', p_observation #>> '{outcome,skillOutcome}',
        'reorderDecision', p_observation #>> '{outcome,reorderDecision}',
        'observedAt', v_observed_at
      ),
      'asin', p_observation #>> '{product,asin}',
      'upc', p_observation #>> '{product,upc}'
    ),
    v_collaborator.id
  )
  on conflict (source_id, supplier_product_id) do update set
    title = excluded.title,
    vendor = coalesce(excluded.vendor, public.market_radar_products.vendor),
    product_type = coalesce(excluded.product_type,
      public.market_radar_products.product_type),
    tags = (
      select array_agg(distinct tag)
      from unnest(public.market_radar_products.tags || excluded.tags) tag
    ),
    product_url = coalesce(excluded.product_url,
      public.market_radar_products.product_url),
    last_seen_at = excluded.last_seen_at,
    last_snapshot_at = excluded.last_snapshot_at,
    is_active = excluded.is_active,
    metadata = public.market_radar_products.metadata || excluded.metadata,
    sourcing_collaborator_id = excluded.sourcing_collaborator_id
  returning * into v_product;

  insert into public.market_radar_snapshots (
    source_id, product_id, supplier_variant_id, variant_title, sku,
    barcode, price, available, inventory_quantity, collections, raw,
    captured_at, sourcing_collaborator_id
  ) values (
    v_source.id,
    v_product.id,
    v_supplier_variant_id,
    v_title,
    v_supplier_sku,
    coalesce(p_observation #>> '{product,upc}',
      p_observation #>> '{product,asin}'),
    v_unit_cost,
    case when v_inventory_quantity is null then null
      else v_inventory_quantity > 0 end,
    v_inventory_quantity,
    case when p_observation #>> '{product,category}' is null
      then '{}'::text[]
      else array[p_observation #>> '{product,category}']::text[] end,
    pg_catalog.jsonb_build_object(
      'contractVersion', p_observation ->> 'contractVersion',
      'observationDigest', v_digest,
      'contributorObservation', p_observation,
      'safety', p_observation -> 'safety'
    ),
    v_observed_at,
    v_collaborator.id
  ) returning id into v_snapshot_id;

  insert into public.market_radar_events (
    source_id, product_id, supplier_variant_id, event_type,
    old_value, new_value, event_strength, idempotency_key,
    sourcing_collaborator_id, recorded_by_user_id, created_at
  ) values (
    v_source.id,
    v_product.id,
    v_supplier_variant_id,
    v_event_type,
    null,
    p_observation || pg_catalog.jsonb_build_object(
      'snapshotId', v_snapshot_id,
      'observationDigest', v_digest
    ),
    case v_event_type
      when 'amazon_reorder_review_ready' then 5
      when 'amazon_result_observed' then 4
      when 'amazon_listing_observed' then 3
      else 2 end,
    v_idempotency_key,
    v_collaborator.id,
    p_recorded_by_user_id,
    v_observed_at
  ) returning id into v_event_id;

  if not exists (
    select 1
    from public.market_radar_snapshots snapshot
    join public.market_radar_events event
      on event.id = v_event_id
    where snapshot.id = v_snapshot_id
      and snapshot.raw ->> 'observationDigest' = v_digest
      and event.new_value ->> 'observationDigest' = v_digest
      and event.recorded_by_user_id = p_recorded_by_user_id
  ) then
    raise exception 'SELLER_OS_AMAZON_CONTRIBUTOR_READBACK_FAILED';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'STORED',
    'replay', false,
    'collaboratorId', v_collaborator.id,
    'sourceId', v_source.id,
    'productId', v_product.id,
    'snapshotId', v_snapshot_id,
    'eventId', v_event_id,
    'observationDigest', v_digest,
    'readbackVerified', true
  );
end;
$function$;

revoke all on function
  public.put_seller_os_amazon_contributor_observation_v1(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function
  public.put_seller_os_amazon_contributor_observation_v1(jsonb, uuid)
  to service_role;

comment on function
  public.put_seller_os_amazon_contributor_observation_v1(jsonb, uuid) is
  'Internal-only idempotent contributor observation writer. Reuses Market Radar and performs no Amazon or supplier mutation.';

notify pgrst, 'reload schema';
