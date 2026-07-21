-- Read-only, privacy-minimized competitor monitoring for owned eBay listings.
-- Only irreversible listing/seller fingerprints and aggregate commercial
-- metadata are persisted. Raw competitor titles, usernames, URLs and images
-- are deliberately excluded from the schema.

create extension if not exists pgcrypto;

create table if not exists public.ebay_listing_competitor_watch_profiles (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  listing_id text not null,
  sku text null,
  supplier_variant_id text null,
  search_query_hash text not null,
  status text not null default 'ACTIVE',
  baseline_completed_at timestamptz null,
  last_scanned_at timestamptz null,
  last_research_refresh_recommended_at timestamptz null,
  latest_active_offer_count integer not null default 0,
  latest_active_seller_count integer not null default 0,
  latest_estimated_activity_seller_count integer not null default 0,
  latest_confirmed_sold_seller_count integer not null default 0,
  latest_median_landed_price numeric(14,2) null,
  latest_free_shipping_ratio numeric(7,4) null,
  latest_returns_accepted_ratio numeric(7,4) null,
  latest_multi_image_ratio numeric(7,4) null,
  latest_evidence_class text not null default 'NO_COMPARABLE_EVIDENCE',
  latest_suggestion_codes text[] not null default '{}'::text[],
  latest_suggested_terms text[] not null default '{}'::text[],
  research_refresh_recommended boolean not null default false,
  research_refresh_reason_codes text[] not null default '{}'::text[],
  source text not null default 'EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY',
  raw_competitor_titles_stored boolean not null default false,
  raw_seller_usernames_stored boolean not null default false,
  competitor_urls_stored boolean not null default false,
  competitor_images_downloaded boolean not null default false,
  buyer_pii_stored boolean not null default false,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_listing_competitor_watch_profiles_identity_unique
    unique (marketplace_account_key, marketplace, listing_id),
  constraint ebay_listing_competitor_watch_profiles_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint ebay_listing_competitor_watch_profiles_listing_check check (
    listing_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_listing_competitor_watch_profiles_hash_check check (
    search_query_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_listing_competitor_watch_profiles_status_check
    check (status in ('ACTIVE','PAUSED')),
  constraint ebay_listing_competitor_watch_profiles_counts_check check (
    latest_active_offer_count >= 0
    and latest_active_seller_count >= 0
    and latest_estimated_activity_seller_count >= 0
    and latest_confirmed_sold_seller_count >= 0
  ),
  constraint ebay_listing_competitor_watch_profiles_ratios_check check (
    (latest_free_shipping_ratio is null or latest_free_shipping_ratio between 0 and 1)
    and (latest_returns_accepted_ratio is null or latest_returns_accepted_ratio between 0 and 1)
    and (latest_multi_image_ratio is null or latest_multi_image_ratio between 0 and 1)
  ),
  constraint ebay_listing_competitor_watch_profiles_evidence_check check (
    latest_evidence_class in (
      'NO_COMPARABLE_EVIDENCE','ACTIVE_ONLY','ESTIMATED_ACTIVITY','CONFIRMED_SOLD_HISTORY'
    )
  ),
  constraint ebay_listing_competitor_watch_profiles_source_check
    check (source = 'EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY'),
  constraint ebay_listing_competitor_watch_profiles_safety_check check (
    raw_competitor_titles_stored = false
    and raw_seller_usernames_stored = false
    and competitor_urls_stored = false
    and competitor_images_downloaded = false
    and buyer_pii_stored = false
    and ebay_writes = 0
  )
);

create table if not exists public.ebay_listing_competitor_scans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ebay_listing_competitor_watch_profiles(id)
    on delete restrict,
  monitor_run_id uuid null references public.commercial_monitor_runs(id)
    on delete set null,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  listing_id text not null,
  scan_status text not null,
  observed_at timestamptz not null,
  baseline_established boolean not null default false,
  candidate_found_count integer not null default 0,
  returned_candidate_count integer not null default 0,
  eligible_offer_count integer not null default 0,
  active_seller_count integer not null default 0,
  new_offer_count integer not null default 0,
  new_seller_count integer not null default 0,
  potential_seller_count integer not null default 0,
  estimated_activity_seller_count integer not null default 0,
  confirmed_sold_seller_count integer not null default 0,
  median_landed_price numeric(14,2) null,
  free_shipping_ratio numeric(7,4) null,
  returns_accepted_ratio numeric(7,4) null,
  multi_image_ratio numeric(7,4) null,
  evidence_class text not null,
  suggestion_codes text[] not null default '{}'::text[],
  suggested_terms text[] not null default '{}'::text[],
  research_refresh_recommended boolean not null default false,
  research_refresh_reason_codes text[] not null default '{}'::text[],
  raw_competitor_content_stored boolean not null default false,
  seller_identity_reversible boolean not null default false,
  active_offer_treated_as_sale boolean not null default false,
  automatic_product_research_import boolean not null default false,
  automatic_ebay_mutation boolean not null default false,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint ebay_listing_competitor_scans_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint ebay_listing_competitor_scans_status_check
    check (scan_status in ('AVAILABLE','NO_MATCH')),
  constraint ebay_listing_competitor_scans_counts_check check (
    candidate_found_count >= 0 and returned_candidate_count >= 0
    and eligible_offer_count >= 0 and active_seller_count >= 0
    and new_offer_count >= 0 and new_seller_count >= 0
    and potential_seller_count >= 0
    and estimated_activity_seller_count >= 0
    and confirmed_sold_seller_count >= 0
  ),
  constraint ebay_listing_competitor_scans_ratios_check check (
    (free_shipping_ratio is null or free_shipping_ratio between 0 and 1)
    and (returns_accepted_ratio is null or returns_accepted_ratio between 0 and 1)
    and (multi_image_ratio is null or multi_image_ratio between 0 and 1)
  ),
  constraint ebay_listing_competitor_scans_evidence_check check (
    evidence_class in (
      'NO_COMPARABLE_EVIDENCE','ACTIVE_ONLY','ESTIMATED_ACTIVITY','CONFIRMED_SOLD_HISTORY'
    )
  ),
  constraint ebay_listing_competitor_scans_safety_check check (
    raw_competitor_content_stored = false
    and seller_identity_reversible = false
    and active_offer_treated_as_sale = false
    and automatic_product_research_import = false
    and automatic_ebay_mutation = false
    and ebay_writes = 0
  )
);

create table if not exists public.ebay_listing_competitor_offers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.ebay_listing_competitor_watch_profiles(id)
    on delete restrict,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  listing_id text not null,
  item_reference_hash text not null,
  seller_reference_hash text not null,
  identity_match_quality text not null,
  evidence_class text not null,
  price numeric(14,2) not null,
  shipping_cost numeric(14,2) not null,
  landed_price numeric(14,2) not null,
  returns_accepted boolean null,
  image_count integer null,
  pack_quantity integer null,
  seller_feedback_band text not null,
  estimated_sold_quantity integer not null default 0,
  confirmed_sold_quantity integer not null default 0,
  confirmed_sold_last_date timestamptz null,
  first_seen_as_baseline boolean not null default false,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  consecutive_scan_count integer not null default 1,
  potential_notified_at timestamptz null,
  active boolean not null default true,
  source text not null default 'EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY',
  raw_title_stored boolean not null default false,
  raw_seller_username_stored boolean not null default false,
  item_id_stored boolean not null default false,
  url_stored boolean not null default false,
  image_downloaded boolean not null default false,
  ebay_writes integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ebay_listing_competitor_offers_identity_unique
    unique (profile_id, item_reference_hash),
  constraint ebay_listing_competitor_offers_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint ebay_listing_competitor_offers_hashes_check check (
    item_reference_hash ~ '^sha256:[0-9a-f]{64}$'
    and seller_reference_hash ~ '^hmac-sha256:[0-9a-f]{64}$'
  ),
  constraint ebay_listing_competitor_offers_identity_check
    check (identity_match_quality in ('EXACT_IDENTIFIER','EXACT','STRONG')),
  constraint ebay_listing_competitor_offers_evidence_check check (
    evidence_class in ('ACTIVE_ONLY','ESTIMATED_ACTIVITY','CONFIRMED_SOLD_HISTORY')
  ),
  constraint ebay_listing_competitor_offers_values_check check (
    price >= 0 and shipping_cost >= 0 and landed_price >= 0
    and (image_count is null or image_count >= 0)
    and (pack_quantity is null or pack_quantity > 0)
    and estimated_sold_quantity >= 0 and confirmed_sold_quantity >= 0
    and consecutive_scan_count > 0
  ),
  constraint ebay_listing_competitor_offers_feedback_check
    check (seller_feedback_band in ('NEW','ESTABLISHED','MATURE','UNKNOWN')),
  constraint ebay_listing_competitor_offers_source_check
    check (source = 'EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY'),
  constraint ebay_listing_competitor_offers_safety_check check (
    raw_title_stored = false and raw_seller_username_stored = false
    and item_id_stored = false and url_stored = false
    and image_downloaded = false and ebay_writes = 0
  )
);

create index if not exists ebay_listing_competitor_profiles_scan_idx
  on public.ebay_listing_competitor_watch_profiles(
    marketplace_account_key, marketplace, status, last_scanned_at nulls first
  );
create index if not exists ebay_listing_competitor_scans_listing_time_idx
  on public.ebay_listing_competitor_scans(
    marketplace_account_key, listing_id, observed_at desc
  );
create index if not exists ebay_listing_competitor_offers_seller_idx
  on public.ebay_listing_competitor_offers(
    profile_id, seller_reference_hash, active, last_seen_at desc
  );
create index if not exists ebay_listing_competitor_offers_product_research_idx
  on public.ebay_listing_competitor_offers(
    marketplace_account_key, item_reference_hash
  );

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ebay_listing_competitor_watch_profiles',
    'ebay_listing_competitor_scans',
    'ebay_listing_competitor_offers'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, update on table public.%I to service_role', table_name);
  end loop;
end $$;

revoke all on table public.ebay_listing_competitor_watch_profiles
  from anon, authenticated;
revoke all on table public.ebay_listing_competitor_scans
  from anon, authenticated;
revoke all on table public.ebay_listing_competitor_offers
  from anon, authenticated;

create or replace function public.enforce_competitor_watch_dry_run_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dry_run_id uuid;
  v_dry_run public.commercial_monitor_runs%rowtype;
begin
  v_dry_run_id := case
    when tg_table_name = 'commercial_monitor_scheduler_authorizations'
      then new.dry_run_id
    else new.authorized_by_dry_run_id
  end;
  if v_dry_run_id is null then return new; end if;

  select * into v_dry_run
  from public.commercial_monitor_runs
  where id = v_dry_run_id
    and trigger_source = 'dry_run';

  if not found
    or v_dry_run.status <> 'completed'
    or v_dry_run.dry_run_satisfactory is not true
    or jsonb_typeof(v_dry_run.readers -> 'competitors') is distinct from 'object'
    or v_dry_run.readers #>> '{competitors,status}' is distinct from 'available'
    or v_dry_run.readers #> '{competitors,metrics,activeOfferTreatedAsConfirmedSale}'
      is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{competitors,metrics,rawCompetitorContentStored}'
      is distinct from 'false'::jsonb
    or v_dry_run.readers #> '{competitors,metrics,ebayWrites}'
      is distinct from '0'::jsonb
    or (case
      when jsonb_typeof(v_dry_run.metrics -> 'competitorListingsRead') = 'number'
        then (v_dry_run.metrics ->> 'competitorListingsRead')::numeric > 0
      else false
    end) is not true then
    raise exception 'COMMERCIAL_MONITOR_COMPETITOR_DRY_RUN_NOT_SATISFIED';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_competitor_watch_scheduler_gate
  on public.commercial_monitor_scheduler_authorizations;
create trigger enforce_competitor_watch_scheduler_gate
before insert or update of dry_run_id
on public.commercial_monitor_scheduler_authorizations
for each row execute function public.enforce_competitor_watch_dry_run_gate();

drop trigger if exists enforce_competitor_watch_manual_gate
  on public.commercial_monitor_runs;
create trigger enforce_competitor_watch_manual_gate
before update of authorized_by_dry_run_id
on public.commercial_monitor_runs
for each row
when (new.authorized_by_dry_run_id is not null)
execute function public.enforce_competitor_watch_dry_run_gate();

revoke all on function public.enforce_competitor_watch_dry_run_gate()
  from public, anon, authenticated;
grant execute on function public.enforce_competitor_watch_dry_run_gate()
  to service_role;

comment on table public.ebay_listing_competitor_watch_profiles is
  'Per-owned-listing aggregate eBay competitor watch state; no raw competitor identity or content.';
comment on table public.ebay_listing_competitor_scans is
  'Auditable read-only active-offer scans. Active and estimated signals never become confirmed sales.';
comment on table public.ebay_listing_competitor_offers is
  'Irreversible active-offer fingerprints matched to optional official Product Research sold evidence.';

notify pgrst, 'reload schema';
