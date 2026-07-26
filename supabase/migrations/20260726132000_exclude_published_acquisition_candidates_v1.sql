begin;

-- Canonical, account and marketplace scoped identity registry for products that
-- already crossed publication. It is evidence for acquisition exclusion only;
-- it grants no eBay write, relist or publication capability.
create table if not exists public.ebay_published_acquisition_identities (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace text not null,
  identity_status text not null,
  market_radar_product_id text null,
  supplier_variant_id text null,
  supplier_sku text null,
  ebay_sku text null,
  offer_id text null,
  ebay_item_id text null,
  commercial_generation integer not null default 1,
  source text not null,
  source_table text not null,
  source_row_id uuid not null,
  observed_at timestamptz null,
  evidence_hash text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default clock_timestamp(),
  last_observed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_published_acquisition_identity_scope_check check (
    length(trim(account_key)) between 3 and 145
    and marketplace ~ '^[A-Z0-9_-]{3,32}$'
  ),
  constraint ebay_published_acquisition_identity_status_check check (
    identity_status in (
      'ACTIVE',
      'PUBLISHED_PENDING_VERIFICATION',
      'MONITOR_REGISTERED',
      'PUBLISHED_VERIFIED',
      'ENDED'
    )
  ),
  constraint ebay_published_acquisition_identity_source_check check (
    source_table in (
      'ebay_active_listings',
      'ebay_authorized_listing_publications'
    )
  ),
  constraint ebay_published_acquisition_identity_generation_check check (
    commercial_generation between 1 and 1000000
  ),
  constraint ebay_published_acquisition_identity_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_published_acquisition_identity_has_key_check check (
    nullif(trim(coalesce(supplier_sku, '')), '') is not null
    or nullif(trim(coalesce(ebay_sku, '')), '') is not null
    or (
      nullif(trim(coalesce(market_radar_product_id, '')), '') is not null
      and nullif(trim(coalesce(supplier_variant_id, '')), '') is not null
    )
    or nullif(trim(coalesce(offer_id, '')), '') is not null
    or nullif(trim(coalesce(ebay_item_id, '')), '') is not null
  ),
  unique (source_table, source_row_id)
);

create index if not exists ebay_published_acquisition_supplier_sku_idx
  on public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    upper(trim(supplier_sku))
  )
  where identity_status <> 'ENDED' and supplier_sku is not null;

create index if not exists ebay_published_acquisition_ebay_sku_idx
  on public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    upper(trim(ebay_sku))
  )
  where identity_status <> 'ENDED' and ebay_sku is not null;

create index if not exists ebay_published_acquisition_product_variant_idx
  on public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    market_radar_product_id,
    supplier_variant_id
  )
  where identity_status <> 'ENDED'
    and market_radar_product_id is not null
    and supplier_variant_id is not null;

create index if not exists ebay_published_acquisition_offer_idx
  on public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    offer_id
  )
  where identity_status <> 'ENDED' and offer_id is not null;

create index if not exists ebay_published_acquisition_item_idx
  on public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    ebay_item_id
  )
  where identity_status <> 'ENDED' and ebay_item_id is not null;

-- A relist/new generation is impossible without one explicit, expiring,
-- server-side authorization. This migration creates no authorization rows.
create table if not exists public.ebay_published_acquisition_authorizations (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null
    references public.ebay_published_acquisition_identities(id)
    on delete restrict,
  account_key text not null,
  marketplace text not null,
  action text not null,
  commercial_generation integer not null,
  status text not null default 'APPROVED',
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  revoked_at timestamptz null,
  authorization_hash text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  constraint ebay_published_acquisition_authorization_action_check check (
    action in ('EXPLICIT_RELIST', 'NEW_GENERATION')
  ),
  constraint ebay_published_acquisition_authorization_status_check check (
    status in ('APPROVED', 'CONSUMED', 'REVOKED', 'EXPIRED')
  ),
  constraint ebay_published_acquisition_authorization_generation_check check (
    commercial_generation between 2 and 1000000
  ),
  constraint ebay_published_acquisition_authorization_expiry_check check (
    expires_at > approved_at
  ),
  constraint ebay_published_acquisition_authorization_hash_check check (
    authorization_hash ~ '^[0-9a-f]{64}$'
  )
);

create unique index if not exists
  ebay_published_acquisition_one_live_authorization_idx
  on public.ebay_published_acquisition_authorizations (
    identity_id,
    action,
    commercial_generation
  )
  where status = 'APPROVED';

-- Immutable audit of shadow matches and enforced exclusions.
create table if not exists public.ebay_published_acquisition_exclusions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.ebay_same_day_pilot_runs(id) on delete restrict,
  candidate_id uuid not null
    references public.ebay_same_day_pilot_candidates(id) on delete restrict,
  account_key text not null,
  marketplace text not null,
  policy_version text not null,
  blocker_code text not null,
  disposition text not null,
  previous_machine_state text not null,
  matched_identity_ids text[] not null default '{}',
  match_snapshot jsonb not null,
  evidence_hash text not null,
  idempotency_key text not null unique,
  ebay_writes integer not null default 0 check (ebay_writes = 0),
  production_changed boolean not null default false
    check (not production_changed),
  created_at timestamptz not null default clock_timestamp(),
  constraint ebay_published_acquisition_exclusion_disposition_check check (
    disposition in (
      'SHADOW_MATCH',
      'SUPERSEDED_ALREADY_PUBLISHED',
      'EXPLICIT_RELIST_AUTHORIZED'
    )
  ),
  constraint ebay_published_acquisition_exclusion_hash_check check (
    evidence_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_published_acquisition_exclusion_idempotency_check check (
    idempotency_key ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists ebay_published_acquisition_exclusion_candidate_idx
  on public.ebay_published_acquisition_exclusions(
    candidate_id,
    created_at desc
  );

alter table public.ebay_published_acquisition_identities
  enable row level security;
alter table public.ebay_published_acquisition_identities
  force row level security;
alter table public.ebay_published_acquisition_authorizations
  enable row level security;
alter table public.ebay_published_acquisition_authorizations
  force row level security;
alter table public.ebay_published_acquisition_exclusions
  enable row level security;
alter table public.ebay_published_acquisition_exclusions
  force row level security;

revoke all on table public.ebay_published_acquisition_identities
  from anon, authenticated;
revoke all on table public.ebay_published_acquisition_identities from public;
revoke all on table public.ebay_published_acquisition_authorizations
  from anon, authenticated;
revoke all on table public.ebay_published_acquisition_authorizations from public;
revoke all on table public.ebay_published_acquisition_exclusions
  from anon, authenticated;
revoke all on table public.ebay_published_acquisition_exclusions from public;
grant select, insert, update
  on table public.ebay_published_acquisition_identities to service_role;
grant select, insert, update
  on table public.ebay_published_acquisition_authorizations to service_role;
grant select, insert
  on table public.ebay_published_acquisition_exclusions to service_role;

create or replace function public.sync_published_acquisition_from_active_listing_v1()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_marketplace text;
  v_offer_id text;
  v_generation integer;
  v_snapshot jsonb;
  v_hash text;
begin
  v_marketplace := upper(coalesce(
    nullif(trim(new.raw_payload ->> 'marketplaceId'), ''),
    'EBAY_US'
  ));
  v_offer_id := nullif(trim(coalesce(
    new.raw_payload ->> 'offerId',
    new.raw_payload ->> 'offer_id'
  )), '');
  v_generation := greatest(
    1,
    case
      when coalesce(
        new.raw_payload ->> 'commercialGeneration',
        ''
      ) ~ '^[0-9]{1,7}$'
      then (new.raw_payload ->> 'commercialGeneration')::integer
      else 1
    end
  );
  v_snapshot := jsonb_build_object(
    'source', new.source,
    'listingStatus', new.listing_status,
    'lastEbaySyncAt', new.last_ebay_sync_at,
    'syncGeneration', new.sync_generation
  );
  v_hash := encode(
    extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    identity_status,
    market_radar_product_id,
    supplier_variant_id,
    supplier_sku,
    ebay_sku,
    offer_id,
    ebay_item_id,
    commercial_generation,
    source,
    source_table,
    source_row_id,
    observed_at,
    evidence_hash,
    source_snapshot,
    first_observed_at,
    last_observed_at,
    updated_at
  ) values (
    new.account_key,
    v_marketplace,
    case when lower(new.listing_status) = 'active'
      then 'ACTIVE' else 'ENDED' end,
    new.market_radar_product_id::text,
    nullif(trim(new.supplier_variant_id), ''),
    nullif(trim(new.supplier_sku), ''),
    nullif(trim(new.ebay_sku), ''),
    v_offer_id,
    nullif(trim(new.ebay_item_id), ''),
    v_generation,
    'EBAY_ACTIVE_LISTING',
    'ebay_active_listings',
    new.id,
    new.last_ebay_sync_at,
    v_hash,
    v_snapshot,
    coalesce(new.created_at, clock_timestamp()),
    coalesce(new.last_ebay_sync_at, new.updated_at, clock_timestamp()),
    clock_timestamp()
  )
  on conflict (source_table, source_row_id) do update set
    account_key = excluded.account_key,
    marketplace = excluded.marketplace,
    identity_status = excluded.identity_status,
    market_radar_product_id = excluded.market_radar_product_id,
    supplier_variant_id = excluded.supplier_variant_id,
    supplier_sku = excluded.supplier_sku,
    ebay_sku = excluded.ebay_sku,
    offer_id = excluded.offer_id,
    ebay_item_id = excluded.ebay_item_id,
    commercial_generation = excluded.commercial_generation,
    source = excluded.source,
    observed_at = excluded.observed_at,
    evidence_hash = excluded.evidence_hash,
    source_snapshot = excluded.source_snapshot,
    last_observed_at = excluded.last_observed_at,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

create or replace function
  public.sync_published_acquisition_from_authorized_publication_v1()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_marketplace text;
  v_status text;
  v_snapshot jsonb;
  v_hash text;
begin
  select *
  into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = new.opportunity_id;

  v_marketplace := upper(coalesce(
    nullif(trim(new.preview ->> 'marketplaceId'), ''),
    'EBAY_US'
  ));
  v_status := case new.phase
    when 'monitor_registered' then 'MONITOR_REGISTERED'
    when 'published_pending_verification' then
      'PUBLISHED_PENDING_VERIFICATION'
    else 'ENDED'
  end;
  v_snapshot := jsonb_build_object(
    'phase', new.phase,
    'previewHash', new.preview_hash,
    'verifiedActiveAt', new.verified_active_at,
    'monitorRegisteredAt', new.monitor_registered_at
  );
  v_hash := encode(
    extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.ebay_published_acquisition_identities (
    account_key,
    marketplace,
    identity_status,
    market_radar_product_id,
    supplier_variant_id,
    supplier_sku,
    ebay_sku,
    offer_id,
    ebay_item_id,
    commercial_generation,
    source,
    source_table,
    source_row_id,
    observed_at,
    evidence_hash,
    source_snapshot,
    first_observed_at,
    last_observed_at,
    updated_at
  ) values (
    new.marketplace_account_key,
    v_marketplace,
    v_status,
    v_opportunity.market_radar_product_id::text,
    nullif(trim(v_opportunity.supplier_variant_id), ''),
    nullif(trim(v_opportunity.supplier_sku), ''),
    nullif(trim(new.sku), ''),
    nullif(trim(new.offer_id), ''),
    nullif(trim(new.listing_id), ''),
    1,
    'EBAY_AUTHORIZED_PUBLICATION',
    'ebay_authorized_listing_publications',
    new.id,
    coalesce(
      new.verified_active_at,
      new.published_at,
      new.publish_started_at,
      new.created_at
    ),
    v_hash,
    v_snapshot,
    new.created_at,
    coalesce(
      new.monitor_registered_at,
      new.verified_active_at,
      new.published_at,
      new.updated_at
    ),
    clock_timestamp()
  )
  on conflict (source_table, source_row_id) do update set
    account_key = excluded.account_key,
    marketplace = excluded.marketplace,
    identity_status = excluded.identity_status,
    market_radar_product_id = excluded.market_radar_product_id,
    supplier_variant_id = excluded.supplier_variant_id,
    supplier_sku = excluded.supplier_sku,
    ebay_sku = excluded.ebay_sku,
    offer_id = excluded.offer_id,
    ebay_item_id = excluded.ebay_item_id,
    source = excluded.source,
    observed_at = excluded.observed_at,
    evidence_hash = excluded.evidence_hash,
    source_snapshot = excluded.source_snapshot,
    last_observed_at = excluded.last_observed_at,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists sync_published_acquisition_from_active_listing_v1
  on public.ebay_active_listings;
create trigger sync_published_acquisition_from_active_listing_v1
after insert or update of
  account_key,
  listing_status,
  ebay_item_id,
  ebay_sku,
  market_radar_product_id,
  supplier_variant_id,
  supplier_sku,
  last_ebay_sync_at,
  raw_payload
on public.ebay_active_listings
for each row execute function
  public.sync_published_acquisition_from_active_listing_v1();

drop trigger if exists
  sync_published_acquisition_from_authorized_publication_v1
  on public.ebay_authorized_listing_publications;
create trigger sync_published_acquisition_from_authorized_publication_v1
after insert or update of
  marketplace_account_key,
  phase,
  offer_id,
  sku,
  listing_id,
  verified_active_at,
  monitor_registered_at,
  preview
on public.ebay_authorized_listing_publications
for each row execute function
  public.sync_published_acquisition_from_authorized_publication_v1();

revoke all on function
  public.sync_published_acquisition_from_active_listing_v1()
  from public, anon, authenticated;
revoke all on function
  public.sync_published_acquisition_from_authorized_publication_v1()
  from public, anon, authenticated;

-- Atomic append-only disposition. The candidate and its operator surfaces are
-- closed together; no history is deleted and no external effect is dispatched.
create or replace function
  public.supersede_published_acquisition_candidate_v1(
    p_candidate_id uuid,
    p_expected_machine_state text,
    p_policy_version text,
    p_blocker_code text,
    p_match_snapshot jsonb,
    p_idempotency_key text,
    p_now timestamptz default clock_timestamp()
  )
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_candidate public.ebay_same_day_pilot_candidates%rowtype;
  v_run public.ebay_same_day_pilot_runs%rowtype;
  v_evidence_hash text;
  v_matched_identity_ids text[];
begin
  if p_candidate_id is null
    or length(trim(coalesce(p_expected_machine_state, ''))) = 0
    or length(trim(coalesce(p_policy_version, ''))) = 0
    or p_blocker_code <> 'ALREADY_PUBLISHED_AND_MONITORED'
    or jsonb_typeof(coalesce(p_match_snapshot, '{}'::jsonb)) <> 'object'
    or p_idempotency_key !~ '^[0-9a-f]{64}$' then
    raise exception 'PUBLISHED_ACQUISITION_SUPERSEDE_INPUT_INVALID';
  end if;

  select *
  into v_candidate
  from public.ebay_same_day_pilot_candidates
  where id = p_candidate_id
  for update;
  if not found then
    raise exception 'PUBLISHED_ACQUISITION_CANDIDATE_NOT_FOUND';
  end if;

  select *
  into v_run
  from public.ebay_same_day_pilot_runs
  where id = v_candidate.run_id
  for update;
  if not found then
    raise exception 'PUBLISHED_ACQUISITION_RUN_NOT_FOUND';
  end if;

  if v_candidate.machine_state in (
    'WAITING_ITEM_ID',
    'VERIFYING_PUBLISHED_LISTING',
    'REGISTERING_COMMERCIAL_MONITOR',
    'VERIFIED_ACTIVE',
    'COMPLETED'
  ) then
    return jsonb_build_object(
      'status', 'POST_PUBLICATION_RECONCILIATION_PRESERVED',
      'candidateId', v_candidate.id,
      'ebayWrites', 0
    );
  end if;

  if v_candidate.machine_state = 'REJECTED'
    and p_blocker_code = any(v_candidate.blockers) then
    return jsonb_build_object(
      'status', 'ALREADY_SUPERSEDED',
      'candidateId', v_candidate.id,
      'ebayWrites', 0
    );
  end if;

  if v_candidate.machine_state is distinct from p_expected_machine_state then
    return jsonb_build_object(
      'status', 'STALE_STATE',
      'candidateId', v_candidate.id,
      'actualMachineState', v_candidate.machine_state,
      'ebayWrites', 0
    );
  end if;

  v_evidence_hash := encode(
    extensions.digest(
      convert_to(coalesce(p_match_snapshot, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select coalesce(array_agg(matched.value order by matched.value), '{}'::text[])
  into v_matched_identity_ids
  from jsonb_array_elements_text(
    coalesce(p_match_snapshot -> 'matchedIdentityIds', '[]'::jsonb)
  ) as matched(value);

  insert into public.ebay_published_acquisition_exclusions (
    run_id,
    candidate_id,
    account_key,
    marketplace,
    policy_version,
    blocker_code,
    disposition,
    previous_machine_state,
    matched_identity_ids,
    match_snapshot,
    evidence_hash,
    idempotency_key,
    ebay_writes,
    production_changed
  ) values (
    v_candidate.run_id,
    v_candidate.id,
    v_run.marketplace_account_key,
    v_run.marketplace,
    p_policy_version,
    p_blocker_code,
    'SUPERSEDED_ALREADY_PUBLISHED',
    v_candidate.machine_state,
    v_matched_identity_ids,
    p_match_snapshot,
    v_evidence_hash,
    p_idempotency_key,
    0,
    false
  )
  on conflict (idempotency_key) do nothing;

  insert into public.ebay_same_day_pilot_transitions (
    run_id,
    candidate_id,
    previous_state,
    next_state,
    reason_code,
    triggered_by,
    started_at,
    completed_at,
    attempt,
    checkpoint,
    evidence_hash,
    idempotency_key,
    next_automatic_action,
    next_human_action
  ) values (
    v_candidate.run_id,
    v_candidate.id,
    v_candidate.machine_state,
    'REJECTED',
    p_blocker_code,
    'SCHEDULER',
    p_now,
    p_now,
    1,
    p_match_snapshot || jsonb_build_object(
      'evidenceRetained', true,
      'historyDeleted', false,
      'ebayWrites', 0
    ),
    v_evidence_hash,
    p_idempotency_key || ':transition',
    'Conservar el expediente publicado y continuar con otro candidato.',
    'Ninguna; el producto ya esta publicado y monitoreado.'
  )
  on conflict (idempotency_key) do nothing;

  update public.ebay_same_day_pilot_candidates
  set machine_state = 'REJECTED',
      state = 'REJECTED_TODAY',
      blockers = array(
        select distinct blocker
        from unnest(
          coalesce(blockers, '{}'::text[]) || array[p_blocker_code]
        ) blocker
      ),
      evidence_summary = coalesce(evidence_summary, '{}'::jsonb) ||
        jsonb_build_object(
          'publishedAcquisitionExclusion',
          p_match_snapshot || jsonb_build_object(
            'policyVersion', p_policy_version,
            'blockerCode', p_blocker_code,
            'disposition', 'SUPERSEDED_ALREADY_PUBLISHED',
            'reconciledAt', p_now,
            'evidenceRetained', true,
            'historyDeleted', false,
            'ebayWrites', 0
          )
        ),
      next_automated_action =
        'Continuar con otro producto elegible; no repetir el analisis.',
      next_human_action =
        'Ninguna; el listing existente continua en monitoreo.',
      updated_at = p_now
  where id = v_candidate.id
    and machine_state = p_expected_machine_state;

  update public.ebay_same_day_pilot_human_tasks
  set status = 'SUPERSEDED',
      completed_at = coalesce(completed_at, p_now),
      evidence_summary = coalesce(evidence_summary, '{}'::jsonb) ||
        jsonb_build_object(
          'resolutionCode', p_blocker_code,
          'policyVersion', p_policy_version,
          'evidenceRetained', true
        ),
      updated_at = p_now
  where candidate_id = v_candidate.id
    and status = 'OPEN';

  update public.ebay_same_day_pilot_jobs
  set status = 'CANCELLED',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = p_blocker_code,
      checkpoint = coalesce(checkpoint, '{}'::jsonb) ||
        jsonb_build_object(
          'policyVersion', p_policy_version,
          'resolutionCode', p_blocker_code,
          'evidenceRetained', true,
          'ebayWrites', 0
        ),
      updated_at = p_now
  where candidate_id = v_candidate.id
    and status in ('PENDING', 'WAITING_RETRY', 'LEASED', 'DEAD_LETTER');

  insert into public.ebay_same_day_pilot_events (
    run_id,
    candidate_id,
    event_type,
    event_payload,
    idempotency_key,
    ebay_read_calls,
    openai_calls,
    ebay_writes,
    production_changed
  ) values (
    v_candidate.run_id,
    v_candidate.id,
    'PUBLISHED_ACQUISITION_CANDIDATE_SUPERSEDED',
    p_match_snapshot || jsonb_build_object(
      'policyVersion', p_policy_version,
      'blockerCode', p_blocker_code,
      'previousMachineState', v_candidate.machine_state,
      'evidenceRetained', true,
      'historyDeleted', false,
      'ebayWrites', 0
    ),
    p_idempotency_key || ':event',
    0,
    0,
    0,
    false
  )
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'status', 'SUPERSEDED_ALREADY_PUBLISHED',
    'candidateId', v_candidate.id,
    'previousMachineState', v_candidate.machine_state,
    'ebayWrites', 0
  );
end;
$$;

revoke all on function
  public.supersede_published_acquisition_candidate_v1(
    uuid, text, text, text, jsonb, text, timestamptz
  )
  from public, anon, authenticated;
grant execute on function
  public.supersede_published_acquisition_candidate_v1(
    uuid, text, text, text, jsonb, text, timestamptz
  )
  to service_role;

-- Backfill source identities. Re-running the migration updates the same source
-- rows and never duplicates a canonical observation.
insert into public.ebay_published_acquisition_identities (
  account_key,
  marketplace,
  identity_status,
  market_radar_product_id,
  supplier_variant_id,
  supplier_sku,
  ebay_sku,
  offer_id,
  ebay_item_id,
  commercial_generation,
  source,
  source_table,
  source_row_id,
  observed_at,
  evidence_hash,
  source_snapshot,
  first_observed_at,
  last_observed_at,
  updated_at
)
select
  listing.account_key,
  upper(coalesce(
    nullif(trim(listing.raw_payload ->> 'marketplaceId'), ''),
    'EBAY_US'
  )),
  case when lower(listing.listing_status) = 'active'
    then 'ACTIVE' else 'ENDED' end,
  listing.market_radar_product_id::text,
  nullif(trim(listing.supplier_variant_id), ''),
  nullif(trim(listing.supplier_sku), ''),
  nullif(trim(listing.ebay_sku), ''),
  nullif(trim(coalesce(
    listing.raw_payload ->> 'offerId',
    listing.raw_payload ->> 'offer_id'
  )), ''),
  nullif(trim(listing.ebay_item_id), ''),
  1,
  'EBAY_ACTIVE_LISTING',
  'ebay_active_listings',
  listing.id,
  listing.last_ebay_sync_at,
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'source', listing.source,
          'listingStatus', listing.listing_status,
          'lastEbaySyncAt', listing.last_ebay_sync_at,
          'syncGeneration', listing.sync_generation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  jsonb_build_object(
    'source', listing.source,
    'listingStatus', listing.listing_status,
    'lastEbaySyncAt', listing.last_ebay_sync_at,
    'syncGeneration', listing.sync_generation
  ),
  listing.created_at,
  coalesce(
    listing.last_ebay_sync_at,
    listing.updated_at,
    clock_timestamp()
  ),
  clock_timestamp()
from public.ebay_active_listings listing
where nullif(trim(listing.account_key), '') is not null
  and (
    nullif(trim(coalesce(listing.supplier_sku, '')), '') is not null
    or nullif(trim(coalesce(listing.ebay_sku, '')), '') is not null
    or (
      listing.market_radar_product_id is not null
      and nullif(trim(coalesce(listing.supplier_variant_id, '')), '')
        is not null
    )
    or nullif(trim(coalesce(listing.ebay_item_id, '')), '') is not null
  )
on conflict (source_table, source_row_id) do update set
  account_key = excluded.account_key,
  marketplace = excluded.marketplace,
  identity_status = excluded.identity_status,
  market_radar_product_id = excluded.market_radar_product_id,
  supplier_variant_id = excluded.supplier_variant_id,
  supplier_sku = excluded.supplier_sku,
  ebay_sku = excluded.ebay_sku,
  offer_id = excluded.offer_id,
  ebay_item_id = excluded.ebay_item_id,
  observed_at = excluded.observed_at,
  evidence_hash = excluded.evidence_hash,
  source_snapshot = excluded.source_snapshot,
  last_observed_at = excluded.last_observed_at,
  updated_at = excluded.updated_at;

insert into public.ebay_published_acquisition_identities (
  account_key,
  marketplace,
  identity_status,
  market_radar_product_id,
  supplier_variant_id,
  supplier_sku,
  ebay_sku,
  offer_id,
  ebay_item_id,
  commercial_generation,
  source,
  source_table,
  source_row_id,
  observed_at,
  evidence_hash,
  source_snapshot,
  first_observed_at,
  last_observed_at,
  updated_at
)
select
  publication.marketplace_account_key,
  upper(coalesce(
    nullif(trim(publication.preview ->> 'marketplaceId'), ''),
    'EBAY_US'
  )),
  case publication.phase
    when 'monitor_registered' then 'MONITOR_REGISTERED'
    when 'published_pending_verification' then
      'PUBLISHED_PENDING_VERIFICATION'
    else 'ENDED'
  end,
  opportunity.market_radar_product_id::text,
  nullif(trim(opportunity.supplier_variant_id), ''),
  nullif(trim(opportunity.supplier_sku), ''),
  nullif(trim(publication.sku), ''),
  nullif(trim(publication.offer_id), ''),
  nullif(trim(publication.listing_id), ''),
  1,
  'EBAY_AUTHORIZED_PUBLICATION',
  'ebay_authorized_listing_publications',
  publication.id,
  coalesce(
    publication.verified_active_at,
    publication.published_at,
    publication.publish_started_at,
    publication.created_at
  ),
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'phase', publication.phase,
          'previewHash', publication.preview_hash,
          'verifiedActiveAt', publication.verified_active_at,
          'monitorRegisteredAt', publication.monitor_registered_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  jsonb_build_object(
    'phase', publication.phase,
    'previewHash', publication.preview_hash,
    'verifiedActiveAt', publication.verified_active_at,
    'monitorRegisteredAt', publication.monitor_registered_at
  ),
  publication.created_at,
  coalesce(
    publication.monitor_registered_at,
    publication.verified_active_at,
    publication.published_at,
    publication.updated_at
  ),
  clock_timestamp()
from public.ebay_authorized_listing_publications publication
join public.ebay_luna_opportunity_queue opportunity
  on opportunity.id = publication.opportunity_id
where publication.phase in (
  'published_pending_verification',
  'monitor_registered'
)
on conflict (source_table, source_row_id) do update set
  account_key = excluded.account_key,
  marketplace = excluded.marketplace,
  identity_status = excluded.identity_status,
  market_radar_product_id = excluded.market_radar_product_id,
  supplier_variant_id = excluded.supplier_variant_id,
  supplier_sku = excluded.supplier_sku,
  ebay_sku = excluded.ebay_sku,
  offer_id = excluded.offer_id,
  ebay_item_id = excluded.ebay_item_id,
  observed_at = excluded.observed_at,
  evidence_hash = excluded.evidence_hash,
  source_snapshot = excluded.source_snapshot,
  last_observed_at = excluded.last_observed_at,
  updated_at = excluded.updated_at;

-- Existing exact active matches are reconciled once, append-only. This is the
-- already-enforced active-listing protection, not activation of the expanded
-- Offer/Item policy. Published/readback states and explicit generations remain
-- untouched.
do $$
declare
  v_match record;
  v_snapshot jsonb;
  v_key text;
begin
  for v_match in
    select
      candidate.id as candidate_id,
      candidate.machine_state,
      jsonb_agg(
        jsonb_build_object(
          'id', identity.id,
          'source', identity.source,
          'supplierSku', identity.supplier_sku,
          'ebaySku', identity.ebay_sku,
          'marketRadarProductId', identity.market_radar_product_id,
          'supplierVariantId', identity.supplier_variant_id,
          'offerId', identity.offer_id,
          'ebayItemId', identity.ebay_item_id
        )
        order by identity.id
      ) as identities
    from public.ebay_same_day_pilot_candidates candidate
    join public.ebay_same_day_pilot_runs run
      on run.id = candidate.run_id
    join public.ebay_luna_opportunity_queue opportunity
      on opportunity.id = candidate.opportunity_id
    join public.ebay_published_acquisition_identities identity
      on identity.account_key = run.marketplace_account_key
      and identity.marketplace = run.marketplace
      and identity.identity_status in (
        'ACTIVE',
        'PUBLISHED_PENDING_VERIFICATION',
        'MONITOR_REGISTERED',
        'PUBLISHED_VERIFIED'
      )
      and (
        (
          nullif(trim(candidate.supplier_sku), '') is not null
          and upper(trim(candidate.supplier_sku)) in (
            upper(trim(identity.supplier_sku)),
            upper(trim(identity.ebay_sku))
          )
        )
        or (
          opportunity.market_radar_product_id::text =
            identity.market_radar_product_id
          and opportunity.supplier_variant_id =
            identity.supplier_variant_id
        )
      )
    where candidate.machine_state not in (
      'WAITING_ITEM_ID',
      'VERIFYING_PUBLISHED_LISTING',
      'REGISTERING_COMMERCIAL_MONITOR',
      'VERIFIED_ACTIVE',
      'COMPLETED',
      'REJECTED'
    )
    group by candidate.id, candidate.machine_state
  loop
    v_snapshot := jsonb_build_object(
      'policyVersion',
      'EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26',
      'matchedIdentityIds',
      (
        select coalesce(jsonb_agg(matched.value ->> 'id'), '[]'::jsonb)
        from jsonb_array_elements(v_match.identities) as matched(value)
      ),
      'matchedIdentities', v_match.identities,
      'migrationReconciliation', true,
      'evidenceRetained', true,
      'historyDeleted', false,
      'ebayWrites', 0
    );
    v_key := encode(
      extensions.digest(
        convert_to(
          v_match.candidate_id::text || ':' ||
          'EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    perform public.supersede_published_acquisition_candidate_v1(
      v_match.candidate_id,
      v_match.machine_state,
      'EBAY_PUBLISHED_ACQUISITION_POLICY_V1_2026_07_26',
      'ALREADY_PUBLISHED_AND_MONITORED',
      v_snapshot,
      v_key,
      clock_timestamp()
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
