-- Canonical listing <-> product authority and immutable lifecycle audit.
-- This migration intentionally does not read, alter, recreate, or depend on
-- ebay_published_acquisition_identities: its authoritative DDL is not part of
-- this source tree. Marketplace observations remain facts even when identity
-- authority is quarantined.

create table if not exists public.seller_os_listing_product_link_authorities_v1 (
  authority_id text primary key,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  ebay_sku text not null,
  seller_os_product_id uuid not null,
  luna_product_id text not null,
  luna_variant_id text not null,
  luna_sku text not null,
  supplier_quantity_required integer not null,
  evidence_maximum_age_seconds integer not null,
  components jsonb not null,
  identity_key text not null,
  linkage_id text not null,
  source_decision_id text not null,
  lifecycle_state text not null,
  previous_authority_id text null references
    public.seller_os_listing_product_link_authorities_v1(authority_id)
    on delete restrict,
  transition_reason_code text not null,
  actor_type text not null,
  actor_reference text not null,
  identity_preflight_status text not null,
  source_fingerprint text null,
  identity_engine_version text null,
  preflight_contract_version text null,
  activated_at timestamptz not null,
  ended_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_listing_link_authority_id_check check (
    authority_id ~ '^listing-link-authority-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_link_account_check check (
    char_length(account_key) between 8 and 160 and account_key !~ '[[:cntrl:]]'),
  constraint seller_os_listing_link_marketplace_check check (
    marketplace_id = 'EBAY_US'),
  constraint seller_os_listing_link_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'),
  constraint seller_os_listing_link_skus_check check (
    char_length(ebay_sku) between 1 and 160 and ebay_sku !~ '[[:cntrl:]]'
    and char_length(luna_sku) between 1 and 160 and luna_sku !~ '[[:cntrl:]]'),
  constraint seller_os_listing_link_luna_ids_check check (
    luna_product_id ~ '^[0-9]{1,30}$'
    and luna_variant_id ~ '^[0-9]{1,30}$'),
  constraint seller_os_listing_link_quantity_check check (
    supplier_quantity_required between 1 and 1000),
  constraint seller_os_listing_link_freshness_check check (
    evidence_maximum_age_seconds between 300 and 604800),
  constraint seller_os_listing_link_components_check check (
    jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0),
  constraint seller_os_listing_link_identity_key_check check (
    identity_key ~ '^listing-product-identity-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_link_linkage_check check (
    linkage_id ~ '^luna-linkage-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_link_decision_check check (
    source_decision_id ~ '^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_link_lifecycle_check check (
    lifecycle_state in ('ACTIVE','SUPERSEDED','UNLINKED','INVALIDATED')),
  constraint seller_os_listing_link_actor_check check (
    actor_type in ('OWNER','SYSTEM')
    and char_length(actor_reference) between 8 and 160
    and actor_reference !~ '[[:cntrl:]]'),
  constraint seller_os_listing_link_reason_check check (
    transition_reason_code ~ '^[A-Z][A-Z0-9_]{2,119}$'),
  constraint seller_os_listing_link_preflight_check check (
    identity_preflight_status in ('PREFLIGHT_PASS','HISTORICAL_CERTIFIED_EXACT')),
  constraint seller_os_listing_link_end_state_check check (
    (lifecycle_state = 'ACTIVE' and ended_at is null)
    or (lifecycle_state <> 'ACTIVE' and ended_at is not null))
);

create unique index if not exists
  seller_os_listing_link_one_active_item_v1
  on public.seller_os_listing_product_link_authorities_v1(
    account_key, marketplace_id, ebay_item_id)
  where lifecycle_state = 'ACTIVE';
create unique index if not exists
  seller_os_listing_link_one_active_ebay_sku_v1
  on public.seller_os_listing_product_link_authorities_v1(
    account_key, marketplace_id, upper(trim(ebay_sku)))
  where lifecycle_state = 'ACTIVE';
create unique index if not exists
  seller_os_listing_link_one_active_reverse_identity_v1
  on public.seller_os_listing_product_link_authorities_v1(
    account_key, marketplace_id, identity_key)
  where lifecycle_state = 'ACTIVE';
create index if not exists seller_os_listing_link_item_history_v1
  on public.seller_os_listing_product_link_authorities_v1(
    account_key, marketplace_id, ebay_item_id, updated_at desc);
create index if not exists seller_os_listing_link_reverse_history_v1
  on public.seller_os_listing_product_link_authorities_v1(
    account_key, marketplace_id, identity_key, updated_at desc);

create table if not exists public.seller_os_listing_product_link_events_v1 (
  event_id text primary key,
  authority_id text not null references
    public.seller_os_listing_product_link_authorities_v1(authority_id)
    on delete restrict,
  account_key text not null,
  marketplace_id text not null,
  ebay_item_id text not null,
  ebay_sku text not null,
  identity_key text not null,
  from_state text null,
  to_state text not null,
  reason_code text not null,
  actor_type text not null,
  actor_reference text not null,
  previous_authority_id text null,
  authority_snapshot jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint seller_os_listing_link_event_id_check check (
    event_id ~ '^listing-link-event-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_link_event_states_check check (
    (from_state is null or from_state in
      ('ACTIVE','SUPERSEDED','UNLINKED','INVALIDATED'))
    and to_state in ('ACTIVE','SUPERSEDED','UNLINKED','INVALIDATED')),
  constraint seller_os_listing_link_event_snapshot_check check (
    jsonb_typeof(authority_snapshot) = 'object')
);
create index if not exists seller_os_listing_link_events_authority_v1
  on public.seller_os_listing_product_link_events_v1(
    authority_id, occurred_at desc);

create table if not exists public.seller_os_listing_identity_quarantines_v1 (
  quarantine_id text primary key,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  ebay_sku text not null,
  quarantine_state text not null,
  reason_code text not null,
  conflicting_item_ids text[] not null,
  authority_id text null references
    public.seller_os_listing_product_link_authorities_v1(authority_id)
    on delete restrict,
  observed_at timestamptz not null,
  resolved_at timestamptz null,
  resolution_reason_code text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint seller_os_listing_quarantine_id_check check (
    quarantine_id ~ '^listing-link-quarantine-v1:sha256:[0-9a-f]{64}$'),
  constraint seller_os_listing_quarantine_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'),
  constraint seller_os_listing_quarantine_state_check check (
    quarantine_state in ('ACTIVE','RESOLVED')),
  constraint seller_os_listing_quarantine_conflict_check check (
    cardinality(conflicting_item_ids) > 0
    and array_position(conflicting_item_ids, null) is null),
  constraint seller_os_listing_quarantine_resolution_check check (
    (quarantine_state = 'ACTIVE' and resolved_at is null)
    or (quarantine_state = 'RESOLVED' and resolved_at is not null))
);
create unique index if not exists seller_os_listing_quarantine_item_v1
  on public.seller_os_listing_identity_quarantines_v1(
    account_key, marketplace_id, ebay_item_id);
create index if not exists seller_os_listing_quarantine_active_sku_v1
  on public.seller_os_listing_identity_quarantines_v1(
    account_key, marketplace_id, upper(trim(ebay_sku)))
  where quarantine_state = 'ACTIVE';

alter table public.seller_os_listing_product_link_authorities_v1
  enable row level security;
alter table public.seller_os_listing_product_link_authorities_v1
  force row level security;
alter table public.seller_os_listing_product_link_events_v1
  enable row level security;
alter table public.seller_os_listing_product_link_events_v1
  force row level security;
alter table public.seller_os_listing_identity_quarantines_v1
  enable row level security;
alter table public.seller_os_listing_identity_quarantines_v1
  force row level security;

revoke all on table public.seller_os_listing_product_link_authorities_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_listing_product_link_events_v1
  from public, anon, authenticated, service_role;
revoke all on table public.seller_os_listing_identity_quarantines_v1
  from public, anon, authenticated, service_role;
grant select on table
  public.seller_os_listing_product_link_authorities_v1 to service_role;
grant select on table
  public.seller_os_listing_product_link_events_v1 to service_role;
grant select on table
  public.seller_os_listing_identity_quarantines_v1 to service_role;

create policy seller_os_listing_link_authorities_service_role_v1
  on public.seller_os_listing_product_link_authorities_v1
  for select to service_role using (true);
create policy seller_os_listing_link_events_service_role_v1
  on public.seller_os_listing_product_link_events_v1
  for select to service_role using (true);
create policy seller_os_listing_link_quarantines_service_role_v1
  on public.seller_os_listing_identity_quarantines_v1
  for select to service_role using (true);

create or replace function public.prevent_seller_os_listing_link_event_mutation_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public, pg_temp as $function$
begin
  raise exception 'SELLER_OS_LISTING_LINK_EVENT_IMMUTABLE';
end;
$function$;
drop trigger if exists seller_os_listing_link_event_immutable_v1
  on public.seller_os_listing_product_link_events_v1;
create trigger seller_os_listing_link_event_immutable_v1
before update or delete on public.seller_os_listing_product_link_events_v1
for each row execute function
  public.prevent_seller_os_listing_link_event_mutation_v1();

create or replace function public.reconcile_seller_os_listing_identity_quarantines_v1(
  p_account_key text,
  p_observed_at timestamptz default clock_timestamp()
)
returns integer language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp as $function$
declare
  v_count integer := 0;
begin
  if not public.is_seller_os_service_role_request_v1()
    or char_length(coalesce(p_account_key,'')) not between 8 and 160
    or p_observed_at is null then
    raise exception 'LISTING_IDENTITY_QUARANTINE_INPUT_INVALID';
  end if;
  -- Shared serialization contract (always acquire the account lock first):
  -- account -> item -> normalized SKU -> reverse identity.
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:account:' || p_account_key, 0));

  -- Resolve any stale quarantine only after holding the same account lock used
  -- by lifecycle transitions and current-live ingestion. This makes ACTIVE
  -- authority + ACTIVE quarantine impossible after reconciliation commits.
  update public.seller_os_listing_identity_quarantines_v1 quarantine
  set quarantine_state='RESOLVED',
      authority_id=authority.authority_id,
      resolved_at=p_observed_at,
      resolution_reason_code='CANONICAL_ACTIVE_AUTHORITY_PRESENT',
      updated_at=p_observed_at
  from public.seller_os_listing_product_link_authorities_v1 authority
  where quarantine.account_key=p_account_key
    and quarantine.marketplace_id='EBAY_US'
    and quarantine.quarantine_state='ACTIVE'
    and authority.account_key=quarantine.account_key
    and authority.marketplace_id=quarantine.marketplace_id
    and authority.ebay_item_id=quarantine.ebay_item_id
    and upper(trim(authority.ebay_sku))=upper(trim(quarantine.ebay_sku))
    and authority.lifecycle_state='ACTIVE';

  with duplicated as (
    select a.account_key,a.ebay_item_id,a.ebay_sku,
      array_agg(other.ebay_item_id order by other.ebay_item_id)
        filter (where other.ebay_item_id <> a.ebay_item_id) conflicts
    from public.ebay_active_listings a
    join public.ebay_active_listings other
      on other.account_key=a.account_key
      and other.listing_status='active'
      and upper(trim(other.ebay_sku))=upper(trim(a.ebay_sku))
    where a.account_key=p_account_key and a.listing_status='active'
      and nullif(trim(a.ebay_sku),'') is not null
    group by a.account_key,a.ebay_item_id,a.ebay_sku
    having count(*) > 1
  ), unresolved as (
    select d.* from duplicated d
    where not exists (
      select 1 from public.seller_os_listing_product_link_authorities_v1 authority
      where authority.account_key=d.account_key
        and authority.marketplace_id='EBAY_US'
        and authority.ebay_item_id=d.ebay_item_id
        and authority.lifecycle_state='ACTIVE'
        and upper(trim(authority.ebay_sku))=upper(trim(d.ebay_sku)))
  )
  insert into public.seller_os_listing_identity_quarantines_v1 as target (
    quarantine_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
    quarantine_state,reason_code,conflicting_item_ids,authority_id,
    observed_at,resolved_at,resolution_reason_code,updated_at)
  select 'listing-link-quarantine-v1:sha256:' || encode(digest(convert_to(
      jsonb_build_array(account_key,'EBAY_US',ebay_item_id,
        upper(trim(ebay_sku)))::text,'UTF8'),'sha256'),'hex'),
    account_key,'EBAY_US',ebay_item_id,ebay_sku,'ACTIVE',
    'DUPLICATE_LIVE_EBAY_SKU',conflicts,null,p_observed_at,null,null,p_observed_at
  from unresolved
  on conflict (account_key,marketplace_id,ebay_item_id) do update set
    ebay_sku=excluded.ebay_sku,quarantine_state='ACTIVE',
    reason_code='DUPLICATE_LIVE_EBAY_SKU',
    conflicting_item_ids=excluded.conflicting_item_ids,authority_id=null,
    observed_at=excluded.observed_at,resolved_at=null,
    resolution_reason_code=null,updated_at=excluded.updated_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.transition_seller_os_listing_product_link_authority_v1(
  p_action text,
  p_account_key text,
  p_ebay_item_id text,
  p_source_decision_id text,
  p_expected_authority_id text,
  p_actor_type text,
  p_actor_reference text,
  p_reason_code text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, extensions, pg_temp as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_active public.ebay_active_listings%rowtype;
  v_decision public.seller_os_luna_linkage_decisions%rowtype;
  v_current public.seller_os_listing_product_link_authorities_v1%rowtype;
  v_previous public.seller_os_listing_product_link_authorities_v1%rowtype;
  v_product public.market_radar_products%rowtype;
  v_snapshot record;
  v_identity_key text;
  v_authority_id text;
  v_event_id text;
  v_quantity integer;
  v_preflight text;
begin
  if not public.is_seller_os_service_role_request_v1()
    or p_action not in ('CREATE','REPLACE','UNLINK','INVALIDATE')
    or char_length(coalesce(p_account_key,'')) not between 8 and 160
    or coalesce(p_ebay_item_id,'') !~ '^[0-9]{9,20}$'
    or p_actor_type not in ('OWNER','SYSTEM')
    or char_length(coalesce(p_actor_reference,'')) not between 8 and 160
    or coalesce(p_reason_code,'') !~ '^[A-Z][A-Z0-9_]{2,119}$' then
    raise exception 'LISTING_LINK_AUTHORITY_INPUT_INVALID';
  end if;
  -- Canonical lock ordering is shared with quarantine reconciliation and
  -- current-live ingestion: account -> item -> normalized SKU -> identity.
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:account:'||p_account_key,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:item:'||p_account_key||':'||p_ebay_item_id,0));

  select * into v_current
  from public.seller_os_listing_product_link_authorities_v1 authority
  where authority.account_key=p_account_key
    and authority.marketplace_id='EBAY_US'
    and authority.ebay_item_id=p_ebay_item_id
    and authority.lifecycle_state='ACTIVE'
  for update;
  if not found then
    select * into v_previous
    from public.seller_os_listing_product_link_authorities_v1 authority
    where authority.account_key=p_account_key
      and authority.marketplace_id='EBAY_US'
      and authority.ebay_item_id=p_ebay_item_id
    order by authority.updated_at desc,authority.created_at desc limit 1
    for update;
  else
    v_previous := v_current;
  end if;

  if p_action in ('UNLINK','INVALIDATE') then
    if v_current.authority_id is null
      or p_expected_authority_id is distinct from v_current.authority_id then
      raise exception 'LISTING_LINK_AUTHORITY_EXPECTED_ACTIVE_REQUIRED';
    end if;
    update public.seller_os_listing_product_link_authorities_v1 authority set
      lifecycle_state=case p_action when 'UNLINK' then 'UNLINKED'
        else 'INVALIDATED' end,
      transition_reason_code=p_reason_code,actor_type=p_actor_type,
      actor_reference=p_actor_reference,ended_at=v_now,updated_at=v_now
    where authority.authority_id=v_current.authority_id
    returning * into v_current;
    v_event_id := 'listing-link-event-v1:sha256:' || encode(digest(convert_to(
      jsonb_build_array(v_current.authority_id,v_current.lifecycle_state,
        p_reason_code,p_actor_reference,v_now)::text,'UTF8'),'sha256'),'hex');
    insert into public.seller_os_listing_product_link_events_v1 (
      event_id,authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
      identity_key,from_state,to_state,reason_code,actor_type,actor_reference,
      previous_authority_id,authority_snapshot,occurred_at)
    values (v_event_id,v_current.authority_id,v_current.account_key,
      v_current.marketplace_id,v_current.ebay_item_id,v_current.ebay_sku,
      v_current.identity_key,'ACTIVE',v_current.lifecycle_state,p_reason_code,
      p_actor_type,p_actor_reference,v_current.previous_authority_id,
      to_jsonb(v_current),v_now);
    update public.ebay_active_listings listing
      set raw_payload=coalesce(listing.raw_payload,'{}'::jsonb)
        - 'canonicalSupplierLineage',updated_at=v_now
      where listing.account_key=p_account_key
        and listing.ebay_item_id=p_ebay_item_id;
    return jsonb_build_object('outcome','TRANSITIONED','action',p_action,
      'authorityId',v_current.authority_id,'lifecycleState',
      v_current.lifecycle_state,'stockguardEligible',false,
      'forwardReadback',to_jsonb(v_current));
  end if;

  if coalesce(p_source_decision_id,'') !~
      '^luna-linkage-decision-v1:sha256:[0-9a-f]{64}$' then
    raise exception 'LISTING_LINK_AUTHORITY_SOURCE_DECISION_REQUIRED';
  end if;
  select d.* into v_decision
  from public.seller_os_luna_linkage_decisions d
  where d.decision_id=p_source_decision_id and d.account_key=p_account_key
    and d.marketplace_id='EBAY_US' and d.ebay_item_id=p_ebay_item_id
    and d.decision='APPROVE_EXACT_LINKAGE'
    and d.decision_version=(select max(x.decision_version)
      from public.seller_os_luna_linkage_decisions x
      where x.account_key=d.account_key and x.marketplace_id=d.marketplace_id
        and x.ebay_item_id=d.ebay_item_id)
  for key share;
  if not found or jsonb_typeof(v_decision.components) is distinct from 'array'
    or not public.are_seller_os_luna_linkage_components_approvable_v1(
      v_decision.components) then
    raise exception 'LISTING_LINK_AUTHORITY_EXACT_DECISION_REQUIRED';
  end if;
  select * into v_active from public.ebay_active_listings listing
  where listing.account_key=p_account_key
    and listing.ebay_item_id=p_ebay_item_id
    and listing.listing_status='active'
    and listing.ebay_sku=v_decision.ebay_sku
  for key share;
  if not found or v_active.market_radar_product_id is null then
    raise exception 'LISTING_LINK_AUTHORITY_CURRENT_LIVE_IDENTITY_REQUIRED';
  end if;
  select * into v_product from public.market_radar_products product
  where product.id=v_active.market_radar_product_id
    and product.supplier_product_id=v_decision.luna_product_id
  for key share;
  if not found then
    raise exception 'LISTING_LINK_AUTHORITY_SELLER_PRODUCT_MISMATCH';
  end if;
  if to_regclass('public.luna_catalog_snapshots_v1') is null
    or to_regclass('public.luna_catalog_snapshot_variants_v1') is null then
    raise exception 'LISTING_LINK_AUTHORITY_PREFLIGHT_SOURCE_UNAVAILABLE';
  end if;
  select variant.preflight_status,variant.source_fingerprint,
    snapshot.identity_engine_version,snapshot.preflight_contract_version,
    snapshot.snapshot_id into v_snapshot
  from public.luna_catalog_snapshots_v1 snapshot
  join public.luna_catalog_snapshot_variants_v1 variant
    on variant.snapshot_id=snapshot.snapshot_id
  where snapshot.snapshot_status='COMPLETE'
    and variant.product_id=v_decision.luna_product_id
    and variant.variant_id=v_decision.luna_variant_id
    and variant.sku=v_decision.luna_sku
    and not exists(select 1 from public.luna_catalog_snapshots_v1 newer
      where newer.snapshot_status='COMPLETE'
        and newer.snapshot_completed_at>snapshot.snapshot_completed_at)
  limit 1;
  if not found or v_snapshot.preflight_status is distinct from 'PREFLIGHT_PASS' then
    raise exception 'LISTING_LINK_AUTHORITY_PREFLIGHT_PASS_REQUIRED';
  end if;
  select sum((component->>'supplierQuantityRequired')::integer)
    into v_quantity from jsonb_array_elements(v_decision.components) component;
  if v_quantity is null or v_quantity < 1 then
    raise exception 'LISTING_LINK_AUTHORITY_PACK_IDENTITY_INVALID';
  end if;
  v_identity_key := 'listing-product-identity-v1:sha256:' || encode(digest(
    convert_to(jsonb_build_array(v_active.market_radar_product_id,
      v_decision.components)::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:sku:'||p_account_key||':'||
      upper(trim(v_active.ebay_sku)),0));
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:identity:'||p_account_key||':'||
      v_identity_key,0));

  if p_action in ('CREATE','REPLACE') and v_current.authority_id is not null
    and v_current.source_decision_id=p_source_decision_id
    and v_current.identity_key=v_identity_key then
    return jsonb_build_object('outcome','IDEMPOTENT_SUCCESS','action',p_action,
      'authorityId',v_current.authority_id,'lifecycleState','ACTIVE',
      'stockguardEligible',true,'forwardReadback',to_jsonb(v_current),
      'reverseReadback',jsonb_build_object('identityKey',v_identity_key,
        'authorityId',v_current.authority_id,'itemId',p_ebay_item_id));
  end if;
  if p_action='CREATE' and v_current.authority_id is not null then
    raise exception 'LISTING_LINK_AUTHORITY_ACTIVE_ITEM_CONFLICT';
  end if;
  if p_action='CREATE' and v_previous.authority_id is not null then
    raise exception 'LISTING_LINK_AUTHORITY_TOMBSTONE_REQUIRES_REPLACE';
  end if;
  if p_action='REPLACE' and (v_previous.authority_id is null
      or p_expected_authority_id is distinct from v_previous.authority_id) then
    raise exception 'LISTING_LINK_AUTHORITY_EXPECTED_PREVIOUS_REQUIRED';
  end if;
  if exists(select 1 from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
      and a.lifecycle_state='ACTIVE' and a.ebay_item_id<>p_ebay_item_id
      and upper(trim(a.ebay_sku))=upper(trim(v_active.ebay_sku))) then
    raise exception 'LISTING_LINK_AUTHORITY_ACTIVE_SKU_COLLISION';
  end if;
  if exists(select 1 from public.seller_os_listing_product_link_authorities_v1 a
    where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
      and a.lifecycle_state='ACTIVE' and a.ebay_item_id<>p_ebay_item_id
      and a.identity_key=v_identity_key) then
    raise exception 'LISTING_LINK_AUTHORITY_ACTIVE_REVERSE_COLLISION';
  end if;

  if p_action='REPLACE' and v_current.authority_id is not null then
    update public.seller_os_listing_product_link_authorities_v1 authority set
      lifecycle_state='SUPERSEDED',transition_reason_code=p_reason_code,
      actor_type=p_actor_type,actor_reference=p_actor_reference,
      ended_at=v_now,updated_at=v_now
      where authority.authority_id=v_current.authority_id returning * into v_current;
    v_event_id := 'listing-link-event-v1:sha256:' || encode(digest(convert_to(
      jsonb_build_array(v_current.authority_id,'SUPERSEDED',p_reason_code,
        p_actor_reference,v_now)::text,'UTF8'),'sha256'),'hex');
    insert into public.seller_os_listing_product_link_events_v1 (
      event_id,authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
      identity_key,from_state,to_state,reason_code,actor_type,actor_reference,
      previous_authority_id,authority_snapshot,occurred_at)
    values (v_event_id,v_current.authority_id,v_current.account_key,
      v_current.marketplace_id,v_current.ebay_item_id,v_current.ebay_sku,
      v_current.identity_key,'ACTIVE','SUPERSEDED',p_reason_code,p_actor_type,
      p_actor_reference,v_current.previous_authority_id,to_jsonb(v_current),v_now);
  end if;

  v_authority_id := 'listing-link-authority-v1:sha256:' || encode(digest(
    convert_to(jsonb_build_array(p_account_key,'EBAY_US',p_ebay_item_id,
      p_source_decision_id,v_identity_key,
      coalesce(v_previous.authority_id,''))::text,'UTF8'),'sha256'),'hex');
  insert into public.seller_os_listing_product_link_authorities_v1 (
    authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
    seller_os_product_id,luna_product_id,luna_variant_id,luna_sku,
    supplier_quantity_required,evidence_maximum_age_seconds,components,
    identity_key,linkage_id,
    source_decision_id,lifecycle_state,previous_authority_id,
    transition_reason_code,actor_type,actor_reference,
    identity_preflight_status,source_fingerprint,identity_engine_version,
    preflight_contract_version,activated_at)
  values (v_authority_id,p_account_key,'EBAY_US',p_ebay_item_id,
    v_active.ebay_sku,v_active.market_radar_product_id,v_decision.luna_product_id,
    v_decision.luna_variant_id,v_decision.luna_sku,v_quantity,
    v_decision.evidence_maximum_age_seconds,v_decision.components,
    v_identity_key,v_decision.linkage_id,
    v_decision.decision_id,'ACTIVE',v_previous.authority_id,p_reason_code,
    p_actor_type,p_actor_reference,'PREFLIGHT_PASS',v_snapshot.source_fingerprint,
    v_snapshot.identity_engine_version,v_snapshot.preflight_contract_version,v_now)
  returning * into v_current;
  v_event_id := 'listing-link-event-v1:sha256:' || encode(digest(convert_to(
    jsonb_build_array(v_current.authority_id,'ACTIVE',p_reason_code,
      p_actor_reference,v_now)::text,'UTF8'),'sha256'),'hex');
  insert into public.seller_os_listing_product_link_events_v1 (
    event_id,authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
    identity_key,from_state,to_state,reason_code,actor_type,actor_reference,
    previous_authority_id,authority_snapshot,occurred_at)
  values (v_event_id,v_current.authority_id,v_current.account_key,
    v_current.marketplace_id,v_current.ebay_item_id,v_current.ebay_sku,
    v_current.identity_key,null,'ACTIVE',p_reason_code,p_actor_type,
    p_actor_reference,v_current.previous_authority_id,to_jsonb(v_current),v_now);
  update public.seller_os_listing_identity_quarantines_v1 quarantine set
    quarantine_state='RESOLVED',authority_id=v_current.authority_id,
    resolved_at=v_now,resolution_reason_code=p_reason_code,updated_at=v_now
    where quarantine.account_key=p_account_key
      and quarantine.marketplace_id='EBAY_US'
      and quarantine.ebay_item_id=p_ebay_item_id
      and quarantine.quarantine_state='ACTIVE';
  return jsonb_build_object('outcome','CREATED','action',p_action,
    'authorityId',v_current.authority_id,'lifecycleState','ACTIVE',
    'stockguardEligible',true,'forwardReadback',to_jsonb(v_current),
    'reverseReadback',jsonb_build_object('identityKey',v_identity_key,
      'authorityId',v_current.authority_id,'itemId',p_ebay_item_id));
end;
$function$;

-- Uniform signatures keep the server adapter bounded and auditable. Unused
-- parameters must be null and are rejected by the core transition rules.
create or replace function public.create_seller_os_listing_product_link_authority_v1(
  p_account_key text,p_ebay_item_id text,p_source_decision_id text,
  p_expected_authority_id text,p_actor_type text,p_actor_reference text,
  p_reason_code text) returns jsonb language sql security definer
set search_path=pg_catalog,public,pg_temp as $function$
  select public.transition_seller_os_listing_product_link_authority_v1(
    'CREATE',$1,$2,$3,$4,$5,$6,$7);
$function$;
create or replace function public.replace_seller_os_listing_product_link_authority_v1(
  p_account_key text,p_ebay_item_id text,p_source_decision_id text,
  p_expected_authority_id text,p_actor_type text,p_actor_reference text,
  p_reason_code text) returns jsonb language sql security definer
set search_path=pg_catalog,public,pg_temp as $function$
  select public.transition_seller_os_listing_product_link_authority_v1(
    'REPLACE',$1,$2,$3,$4,$5,$6,$7);
$function$;
create or replace function public.unlink_seller_os_listing_product_link_authority_v1(
  p_account_key text,p_ebay_item_id text,p_source_decision_id text,
  p_expected_authority_id text,p_actor_type text,p_actor_reference text,
  p_reason_code text) returns jsonb language sql security definer
set search_path=pg_catalog,public,pg_temp as $function$
  select public.transition_seller_os_listing_product_link_authority_v1(
    'UNLINK',$1,$2,$3,$4,$5,$6,$7);
$function$;
create or replace function public.invalidate_seller_os_listing_product_link_authority_v1(
  p_account_key text,p_ebay_item_id text,p_source_decision_id text,
  p_expected_authority_id text,p_actor_type text,p_actor_reference text,
  p_reason_code text) returns jsonb language sql security definer
set search_path=pg_catalog,public,pg_temp as $function$
  select public.transition_seller_os_listing_product_link_authority_v1(
    'INVALIDATE',$1,$2,$3,$4,$5,$6,$7);
$function$;

create or replace function public.read_seller_os_listing_product_link_authority_v1(
  p_account_key text,p_ebay_item_id text default null,p_identity_key text default null)
returns jsonb language sql stable security definer
set search_path=pg_catalog,public,pg_temp as $function$
  select case when public.is_seller_os_service_role_request_v1() then
    jsonb_build_object(
    'forward',coalesce((select jsonb_agg(to_jsonb(a) order by a.updated_at desc)
      from public.seller_os_listing_product_link_authorities_v1 a
      where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
        and (p_ebay_item_id is null or a.ebay_item_id=p_ebay_item_id)),'[]'::jsonb),
    'reverse',coalesce((select jsonb_agg(to_jsonb(a) order by
        (a.lifecycle_state='ACTIVE') desc,a.updated_at desc)
      from public.seller_os_listing_product_link_authorities_v1 a
      where a.account_key=p_account_key and a.marketplace_id='EBAY_US'
        and (p_identity_key is null or a.identity_key=p_identity_key)),'[]'::jsonb),
    'quarantines',coalesce((select jsonb_agg(to_jsonb(q) order by q.observed_at desc)
      from public.seller_os_listing_identity_quarantines_v1 q
      where q.account_key=p_account_key and q.marketplace_id='EBAY_US'
        and (p_ebay_item_id is null or q.ebay_item_id=p_ebay_item_id)),'[]'::jsonb))
    else jsonb_build_object('error','SERVICE_ROLE_REQUIRED') end;
$function$;

-- The legacy exact-identity resolver previously treated every different
-- already-linked identity as a terminal conflict. Patch only that bounded
-- Owner-confirmed path so it emits a new immutable decision version; the
-- authority REPLACE primitive below remains the sole mapping transition.
do $migration$
declare
  d text;
  existing_anchor text := $anchor$
  if v_existing.decision_id is not null then
    if v_existing.decision = 'APPROVE_EXACT_LINKAGE'
      and ('CERTIFIED_IDENTITY_SOURCE:' || p_source_decision_id) = any(
        v_existing.evidence_references
      ) then
      return jsonb_build_object(
        'status', 'CERTIFIED', 'idempotent', true,
        'decisionId', v_existing.decision_id,
        'linkageId', v_existing.linkage_id,
        'productId', v_existing.luna_product_id,
        'variantId', v_existing.luna_variant_id,
        'supplierSku', v_existing.luna_sku,
        'titleInferenceUsed', false, 'marketplaceWrites', 0
      );
    end if;
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_CONFLICT';
  end if;
$anchor$;
  existing_replacement text := $replacement$
  if v_existing.decision_id is not null
    and v_existing.decision = 'APPROVE_EXACT_LINKAGE'
    and ('CERTIFIED_IDENTITY_SOURCE:' || p_source_decision_id) = any(
      v_existing.evidence_references
    ) then
    return jsonb_build_object(
      'status', 'CERTIFIED', 'idempotent', true,
      'decisionId', v_existing.decision_id,
      'linkageId', v_existing.linkage_id,
      'productId', v_existing.luna_product_id,
      'variantId', v_existing.luna_variant_id,
      'supplierSku', v_existing.luna_sku,
      'titleInferenceUsed', false, 'marketplaceWrites', 0
    );
  end if;
$replacement$;
  candidate_anchor text := $anchor$
  if exists (
    select 1 from public.seller_os_luna_linkage_review_candidates candidate
    where candidate.account_key = p_account_key
      and candidate.marketplace_id = 'EBAY_US'
      and candidate.ebay_item_id = p_item_id and candidate.is_current
  ) then
    raise exception 'MANUAL_LISTING_CERTIFIED_IDENTITY_TARGET_CONFLICT';
  end if;
$anchor$;
  candidate_replacement text := $replacement$
  update public.seller_os_luna_linkage_review_candidates candidate
  set is_current = false, retired_at = v_now
  where candidate.account_key = p_account_key
    and candidate.marketplace_id = 'EBAY_US'
    and candidate.ebay_item_id = p_item_id and candidate.is_current;
$replacement$;
  cohort_anchor text := $anchor$v_cohort_id := 'manual-existing-certified:' || v_target.id::text;$anchor$;
  cohort_replacement text := $replacement$v_cohort_id := 'manual-existing-certified:' || v_target.id::text || ':' || v_hash;$replacement$;
  review_version_anchor text := $anchor$v_identity_provenance, 'CURRENT', 1, true, false, v_now,$anchor$;
  review_version_replacement text := $replacement$v_identity_provenance, 'CURRENT', coalesce(v_existing.decision_version,0)+1, true, false, v_now,$replacement$;
  decision_version_anchor text := $anchor$), 'APPROVE_EXACT_LINKAGE', 1, v_now, v_decision_id,$anchor$;
  decision_version_replacement text := $replacement$), 'APPROVE_EXACT_LINKAGE', coalesce(v_existing.decision_version,0)+1, v_now, v_decision_id,$replacement$;
begin
  select pg_get_functiondef(
    'public.resolve_manual_existing_certified_identity_v1(text,text,text,uuid,text,timestamptz)'::regprocedure)
    into d;
  if strpos(d,existing_anchor)=0 or strpos(d,candidate_anchor)=0
    or strpos(d,cohort_anchor)=0 or strpos(d,review_version_anchor)=0
    or strpos(d,decision_version_anchor)=0 then
    raise exception 'LISTING_LINK_REPLACE_RESOLVER_PATCH_TARGET_UNPROVEN';
  end if;
  d:=replace(d,existing_anchor,existing_replacement);
  d:=replace(d,candidate_anchor,candidate_replacement);
  d:=replace(d,cohort_anchor,cohort_replacement);
  d:=replace(d,review_version_anchor,review_version_replacement);
  d:=replace(d,decision_version_anchor,decision_version_replacement);
  execute d;
end;
$migration$;

-- Backfill only unambiguous, already-approved exact identities. This preserves
-- the known certified authority without pretending that old evidence is a new
-- V1.3 preflight. Ambiguous groups remain without authority and fail closed.
-- Serialize the complete prepare snapshot with current-live ingestion and all
-- lifecycle transitions. Sorted account acquisition preserves lock ordering.
do $migration$
declare r record;
begin
  for r in
    select distinct account_key
    from public.ebay_active_listings
    order by account_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'listing-link-authority-v1:account:' || r.account_key, 0));
  end loop;
end;
$migration$;

with latest as (
  select distinct on (d.account_key,d.marketplace_id,d.ebay_item_id) d.*
  from public.seller_os_luna_linkage_decisions d
  order by d.account_key,d.marketplace_id,d.ebay_item_id,d.decision_version desc
), eligible as (
  select d.*,a.market_radar_product_id,a.ebay_sku active_ebay_sku,
    count(*) over(partition by d.account_key,d.marketplace_id,upper(trim(d.ebay_sku))) sku_count,
    count(*) over(partition by d.account_key,d.marketplace_id,d.luna_product_id,
      d.luna_variant_id,d.luna_sku,d.components) identity_count
  from latest d join public.ebay_active_listings a
    on a.account_key=d.account_key and a.ebay_item_id=d.ebay_item_id
    and a.ebay_sku=d.ebay_sku and a.listing_status='active'
  join public.market_radar_products p on p.id=a.market_radar_product_id
    and p.supplier_product_id=d.luna_product_id
  where d.marketplace_id='EBAY_US' and d.decision='APPROVE_EXACT_LINKAGE'
    and public.are_seller_os_luna_linkage_components_approvable_v1(d.components)
), inserted as (
  insert into public.seller_os_listing_product_link_authorities_v1 (
    authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
    seller_os_product_id,luna_product_id,luna_variant_id,luna_sku,
    supplier_quantity_required,evidence_maximum_age_seconds,components,
    identity_key,linkage_id,
    source_decision_id,lifecycle_state,previous_authority_id,
    transition_reason_code,actor_type,actor_reference,
    identity_preflight_status,activated_at)
  select 'listing-link-authority-v1:sha256:' || encode(digest(convert_to(
      jsonb_build_array(account_key,marketplace_id,ebay_item_id,decision_id,
        linkage_id)::text,'UTF8'),'sha256'),'hex'),
    account_key,marketplace_id,ebay_item_id,active_ebay_sku,
    market_radar_product_id,luna_product_id,luna_variant_id,luna_sku,
    (select sum((c->>'supplierQuantityRequired')::integer)
      from jsonb_array_elements(components) c),evidence_maximum_age_seconds,
    components,
    'listing-product-identity-v1:sha256:' || encode(digest(convert_to(
      jsonb_build_array(market_radar_product_id,components)::text,'UTF8'),
      'sha256'),'hex'),linkage_id,decision_id,'ACTIVE',null,
    'HISTORICAL_CERTIFIED_AUTHORITY_BACKFILL','SYSTEM',
    'SYSTEM:STOCKGUARD_P0_MIGRATION','HISTORICAL_CERTIFIED_EXACT',
    coalesce(decision_at,created_at)
  from eligible where sku_count=1 and identity_count=1
  on conflict (authority_id) do nothing returning *)
insert into public.seller_os_listing_product_link_events_v1 (
  event_id,authority_id,account_key,marketplace_id,ebay_item_id,ebay_sku,
  identity_key,from_state,to_state,reason_code,actor_type,actor_reference,
  previous_authority_id,authority_snapshot,occurred_at)
select 'listing-link-event-v1:sha256:' || encode(digest(convert_to(
    jsonb_build_array(authority_id,'ACTIVE',activated_at)::text,'UTF8'),
    'sha256'),'hex'),authority_id,account_key,marketplace_id,ebay_item_id,
  ebay_sku,identity_key,null,'ACTIVE','HISTORICAL_CERTIFIED_AUTHORITY_BACKFILL',
  'SYSTEM','SYSTEM:STOCKGUARD_P0_MIGRATION',null,to_jsonb(inserted),activated_at
from inserted on conflict (event_id) do nothing;

do $migration$
declare r record;
begin
  for r in select distinct account_key from public.ebay_active_listings loop
    perform public.reconcile_seller_os_listing_identity_quarantines_v1(
      r.account_key,clock_timestamp());
  end loop;
end;
$migration$;

create or replace function public.guard_seller_os_luna_stock_job_authority_p0()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $function$
begin
  if not exists(select 1
    from public.seller_os_listing_product_link_authorities_v1 authority
    where authority.account_key=new.account_key
      and authority.marketplace_id='EBAY_US'
      and authority.ebay_item_id=new.ebay_item_id
      and authority.linkage_id=new.linkage_id
      and authority.lifecycle_state='ACTIVE')
    or exists(select 1 from public.seller_os_listing_identity_quarantines_v1 q
      where q.account_key=new.account_key and q.marketplace_id='EBAY_US'
        and q.ebay_item_id=new.ebay_item_id and q.quarantine_state='ACTIVE') then
    raise exception 'STOCKGUARD_CANONICAL_ACTIVE_LINK_AUTHORITY_REQUIRED';
  end if;
  return new;
end;
$function$;
drop trigger if exists seller_os_luna_stock_job_authority_p0
  on public.seller_os_luna_stock_check_jobs;
drop trigger if exists seller_os_luna_stock_observation_authority_p0
  on public.seller_os_luna_stock_observations;

-- PREPARE only: strict StockGuard enforcement is deliberately activated by
-- the ordered activation migration after authority-aware application code is
-- deployed. Keeping the triggers absent here preserves the current worker
-- claim/complete/ensure contract during the rollout boundary.

-- Patch current-live preservation: marketplace facts are always ingested, but
-- cached supplier lineage survives only while exact ACTIVE authority remains.
do $migration$
declare
  d text;
  preserve_anchor text := $anchor$
   and target.raw_payload#>>'{canonicalSupplierLineage,ebaySku}'=excluded.ebay_sku
  then jsonb_build_object('canonicalSupplierLineage',target.raw_payload->'canonicalSupplierLineage')
$anchor$;
  preserve_replacement text := $replacement$
   and target.raw_payload#>>'{canonicalSupplierLineage,ebaySku}'=excluded.ebay_sku
   and exists(select 1
     from public.seller_os_listing_product_link_authorities_v1 authority
     where authority.account_key=excluded.account_key
       and authority.marketplace_id='EBAY_US'
       and authority.ebay_item_id=excluded.ebay_item_id
       and authority.ebay_sku=excluded.ebay_sku
       and authority.lifecycle_state='ACTIVE')
   and not exists(select 1
     from public.seller_os_listing_identity_quarantines_v1 quarantine
     where quarantine.account_key=excluded.account_key
       and quarantine.marketplace_id='EBAY_US'
       and quarantine.ebay_item_id=excluded.ebay_item_id
       and quarantine.quarantine_state='ACTIVE')
  then jsonb_build_object('canonicalSupplierLineage',target.raw_payload->'canonicalSupplierLineage')
$replacement$;
  reconcile_anchor text := '  get diagnostics v_ended = row_count;';
  lock_anchor text :=
    '  perform pg_advisory_xact_lock(hashtextextended(p_account_key, 417));';
  lock_replacement text := $replacement$
  perform pg_advisory_xact_lock(hashtextextended(
    'listing-link-authority-v1:account:' || p_account_key, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_account_key, 417));
$replacement$;
begin
  select pg_get_functiondef(
    'public.record_ebay_current_live_authority_success_v1(text,uuid,text,timestamptz,timestamptz,jsonb,jsonb)'::regprocedure)
    into d;
  if strpos(d,preserve_anchor)=0 or strpos(d,reconcile_anchor)=0
    or strpos(d,lock_anchor)=0 then
    raise exception 'STOCKGUARD_CURRENT_LIVE_PATCH_TARGET_UNPROVEN';
  end if;
  d:=replace(d,lock_anchor,lock_replacement);
  d:=replace(d,preserve_anchor,preserve_replacement);
  d:=replace(d,reconcile_anchor,reconcile_anchor || E'\n  perform public.reconcile_seller_os_listing_identity_quarantines_v1(p_account_key,p_observed_at);');
  execute d;
end;
$migration$;

revoke all on function public.transition_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.reconcile_seller_os_listing_identity_quarantines_v1(
  text,timestamptz) from public,anon,authenticated;
revoke all on function public.create_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.replace_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.unlink_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.invalidate_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.read_seller_os_listing_product_link_authority_v1(
  text,text,text) from public,anon,authenticated;
grant execute on function public.create_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) to service_role;
grant execute on function public.replace_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) to service_role;
grant execute on function public.unlink_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) to service_role;
grant execute on function public.invalidate_seller_os_listing_product_link_authority_v1(
  text,text,text,text,text,text,text) to service_role;
grant execute on function public.read_seller_os_listing_product_link_authority_v1(
  text,text,text) to service_role;
grant execute on function public.reconcile_seller_os_listing_identity_quarantines_v1(
  text,timestamptz) to service_role;

comment on table public.seller_os_listing_product_link_authorities_v1 is
  'Current and historical canonical listing-to-product linkage authorities. Marketplace observations remain separate facts.';
comment on table public.seller_os_listing_product_link_events_v1 is
  'Immutable transition history for CREATE, REPLACE, UNLINK and INVALIDATE.';
comment on table public.seller_os_listing_identity_quarantines_v1 is
  'Durable identity quarantine; duplicate LIVE listings remain observable and cannot inherit linkage by SKU.';
