-- Learn conservatively from official performance of verified, seller-owned
-- listings. Predictions are frozen when the manual listing is linked so later
-- rescans cannot rewrite the baseline used to evaluate the ranking model.

alter table public.ebay_manual_listing_links
  add column predicted_opportunity_score numeric(6,2) null,
  add column predicted_engine_version text null,
  add column predicted_category_id text null,
  add column prediction_recorded_at timestamptz null,
  add column prediction_source text null;

create or replace function public.capture_ebay_manual_listing_prediction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.ebay_luna_opportunity_queue%rowtype;
  v_category_id text;
begin
  select * into v_opportunity
  from public.ebay_luna_opportunity_queue
  where id = new.opportunity_id
    and candidate_key = new.candidate_key
  for key share;

  if not found then
    raise exception 'MANUAL_LISTING_PREDICTION_OPPORTUNITY_MISMATCH';
  end if;

  v_category_id := coalesce(
    nullif(trim(
      v_opportunity.assessment #>>
        '{listingIntelligencePackage,categoryRecommendation,categoryId}'
    ), ''),
    nullif(trim(v_opportunity.assessment #>> '{candidate,categoryId}'), '')
  );

  if v_category_id is not null
    and v_category_id !~ '^[0-9]{1,20}$' then
    v_category_id := null;
  end if;

  -- Always overwrite caller-supplied values with the queue snapshot.
  new.predicted_opportunity_score := v_opportunity.opportunity_score;
  new.predicted_engine_version := coalesce(
    nullif(trim(v_opportunity.assessment->>'engineVersion'), ''),
    'LEGACY_UNVERSIONED'
  );
  new.predicted_category_id := v_category_id;
  new.prediction_recorded_at := now();
  new.prediction_source := 'LINK_TIME_OPPORTUNITY_QUEUE';
  return new;
end;
$$;

revoke all on function public.capture_ebay_manual_listing_prediction()
  from public, anon, authenticated;
grant execute on function public.capture_ebay_manual_listing_prediction()
  to service_role;

create trigger ebay_manual_listing_capture_prediction_before_insert
before insert on public.ebay_manual_listing_links
for each row execute function public.capture_ebay_manual_listing_prediction();

-- Existing links cannot be reconstructed as link-time predictions. Backfill
-- them from the current queue, but label that weaker provenance explicitly.
update public.ebay_manual_listing_links as link
set
  predicted_opportunity_score = opportunity.opportunity_score,
  predicted_engine_version = coalesce(
    nullif(trim(opportunity.assessment->>'engineVersion'), ''),
    'LEGACY_UNVERSIONED'
  ),
  predicted_category_id = case
    when coalesce(
      nullif(trim(
        opportunity.assessment #>>
          '{listingIntelligencePackage,categoryRecommendation,categoryId}'
      ), ''),
      nullif(trim(opportunity.assessment #>> '{candidate,categoryId}'), '')
    ) ~ '^[0-9]{1,20}$'
      then coalesce(
        nullif(trim(
          opportunity.assessment #>>
            '{listingIntelligencePackage,categoryRecommendation,categoryId}'
        ), ''),
        nullif(trim(opportunity.assessment #>> '{candidate,categoryId}'), '')
      )
    else null
  end,
  prediction_recorded_at = now(),
  prediction_source = 'BACKFILLED_CURRENT_QUEUE'
from public.ebay_luna_opportunity_queue as opportunity
where link.opportunity_id = opportunity.id
  and link.candidate_key = opportunity.candidate_key
  and link.prediction_source is null;

alter table public.ebay_manual_listing_links
  alter column predicted_opportunity_score set not null,
  alter column predicted_engine_version set not null,
  alter column prediction_recorded_at set not null,
  alter column prediction_source set not null,
  add constraint ebay_manual_listing_predicted_score_check check (
    predicted_opportunity_score between 0 and 100
  ),
  add constraint ebay_manual_listing_predicted_engine_check check (
    char_length(predicted_engine_version) between 1 and 120
    and predicted_engine_version !~ '[[:cntrl:]]'
  ),
  add constraint ebay_manual_listing_predicted_category_check check (
    predicted_category_id is null
    or predicted_category_id ~ '^[0-9]{1,20}$'
  ),
  add constraint ebay_manual_listing_prediction_source_check check (
    prediction_source in (
      'LINK_TIME_OPPORTUNITY_QUEUE',
      'BACKFILLED_CURRENT_QUEUE'
    )
  );

create or replace function public.protect_ebay_manual_listing_prediction()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if row(
    new.predicted_opportunity_score,
    new.predicted_engine_version,
    new.predicted_category_id,
    new.prediction_recorded_at,
    new.prediction_source
  ) is distinct from row(
    old.predicted_opportunity_score,
    old.predicted_engine_version,
    old.predicted_category_id,
    old.prediction_recorded_at,
    old.prediction_source
  ) then
    raise exception 'MANUAL_LISTING_PREDICTION_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_ebay_manual_listing_prediction()
  from public, anon, authenticated;
grant execute on function public.protect_ebay_manual_listing_prediction()
  to service_role;

create trigger ebay_manual_listing_protect_prediction_before_update
before update on public.ebay_manual_listing_links
for each row execute function public.protect_ebay_manual_listing_prediction();

comment on column public.ebay_manual_listing_links.predicted_opportunity_score is
  'Immutable opportunity score captured when the seller-owned listing link is first inserted.';
comment on column public.ebay_manual_listing_links.prediction_source is
  'LINK_TIME_OPPORTUNITY_QUEUE is causal evidence; BACKFILLED_CURRENT_QUEUE is explicitly weaker historical provenance.';

create table public.ebay_listing_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  manual_listing_link_id uuid not null
    references public.ebay_manual_listing_links(id) on delete restrict,
  opportunity_id uuid not null
    references public.ebay_luna_opportunity_queue(id) on delete restrict,
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  ebay_item_id text not null,
  candidate_key text not null,
  category_id text null,
  predicted_opportunity_score numeric(6,2) not null,
  predicted_engine_version text not null,
  prediction_source text not null,
  report_dimension text not null default 'LISTING',
  report_date_from date not null,
  report_date_to date not null,
  window_days smallint not null,
  link_verified_at timestamptz not null,
  listing_age_days integer not null,
  total_impressions bigint not null,
  search_impressions bigint null,
  total_views bigint null,
  search_views bigint null,
  transactions bigint null,
  reported_click_through_rate numeric(8,4) null,
  reported_sales_conversion_rate numeric(8,4) null,
  ebay_last_updated_at timestamptz null,
  observed_at timestamptz not null default now(),
  source text not null default 'EBAY_SELL_ANALYTICS_READONLY',
  snapshot_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint ebay_listing_performance_account_check check (
    char_length(account_key) between 1 and 160
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_listing_performance_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint ebay_listing_performance_item_check check (
    ebay_item_id ~ '^[0-9]{9,20}$'
  ),
  constraint ebay_listing_performance_candidate_check check (
    char_length(candidate_key) between 1 and 300
    and candidate_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_listing_performance_category_check check (
    category_id is null or category_id ~ '^[0-9]{1,20}$'
  ),
  constraint ebay_listing_performance_prediction_check check (
    predicted_opportunity_score between 0 and 100
    and char_length(predicted_engine_version) between 1 and 120
    and predicted_engine_version !~ '[[:cntrl:]]'
    and prediction_source in (
      'LINK_TIME_OPPORTUNITY_QUEUE',
      'BACKFILLED_CURRENT_QUEUE'
    )
  ),
  constraint ebay_listing_performance_dimension_check check (
    report_dimension = 'LISTING'
  ),
  constraint ebay_listing_performance_window_check check (
    report_date_to >= report_date_from
    and report_date_to - report_date_from <= 89
    and window_days = (report_date_to - report_date_from) + 1
  ),
  constraint ebay_listing_performance_age_check check (
    observed_at >= link_verified_at
    and listing_age_days = floor(
      extract(epoch from (observed_at - link_verified_at)) / 86400
    )::integer
  ),
  constraint ebay_listing_performance_counts_check check (
    total_impressions >= 0
    and (search_impressions is null or search_impressions >= 0)
    and (total_views is null or total_views >= 0)
    and (search_views is null or search_views >= 0)
    and (transactions is null or transactions >= 0)
  ),
  constraint ebay_listing_performance_rates_check check (
    reported_click_through_rate is null
      or reported_click_through_rate between 0 and 100
  ),
  constraint ebay_listing_performance_conversion_check check (
    reported_sales_conversion_rate is null
      or reported_sales_conversion_rate between 0 and 100
  ),
  constraint ebay_listing_performance_source_check check (
    source = 'EBAY_SELL_ANALYTICS_READONLY'
  ),
  constraint ebay_listing_performance_fingerprint_check check (
    snapshot_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint ebay_listing_performance_fingerprint_unique
    unique (snapshot_fingerprint)
);

create or replace function public.assert_ebay_own_listing_performance_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.ebay_manual_listing_links%rowtype;
begin
  if new.source is distinct from 'EBAY_SELL_ANALYTICS_READONLY'
    or new.report_dimension is distinct from 'LISTING' then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_OFFICIAL_LISTING_SOURCE_REQUIRED';
  end if;

  if new.observed_at is null
    or new.report_date_from is null
    or new.report_date_to is null then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_WINDOW_REQUIRED';
  end if;

  select * into v_link
  from public.ebay_manual_listing_links
  where id = new.manual_listing_link_id
    and verification_status = 'verified'
    and verification_method in (
      'EBAY_TRADING_GET_ITEM_READONLY',
      'EBAY_SELL_INVENTORY_READONLY'
    )
    and connector_listing_id is not null
    and verified_at is not null
    and last_verification_at >= new.observed_at - interval '36 hours'
    and last_verification_at <= new.observed_at + interval '5 minutes'
  for key share;

  if not found then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_VERIFIED_OWN_LINK_REQUIRED';
  end if;

  -- The LISTING dimension returned by Analytics must identify the same eBay
  -- item proven by the Inventory connector. Do not silently remap a metric row.
  if new.ebay_item_id is distinct from v_link.ebay_item_id then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_LISTING_DIMENSION_MISMATCH';
  end if;

  if new.observed_at < v_link.verified_at then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_PRECEDES_LINK_VERIFICATION';
  end if;

  -- Aggregate reports are causally valid only when every instant in the
  -- requested window follows the immutable ownership/prediction link. A
  -- snapshot observed after verification may still contain earlier metrics.
  if (new.report_date_from::timestamp at time zone 'UTC') < v_link.verified_at then
    raise exception 'EBAY_PERFORMANCE_SNAPSHOT_WINDOW_PRECEDES_LINK_VERIFICATION';
  end if;

  -- Identity and prediction fields always come from the immutable verified
  -- link, never from an API caller or from competitor observations.
  new.opportunity_id := v_link.opportunity_id;
  new.account_key := v_link.account_key;
  new.marketplace_id := v_link.marketplace_id;
  new.ebay_item_id := v_link.ebay_item_id;
  new.candidate_key := v_link.candidate_key;
  new.category_id := case
    when v_link.verification_method = 'EBAY_TRADING_GET_ITEM_READONLY'
      and v_link.safe_defaults->>'categoryId' ~ '^[0-9]{1,20}$'
      then v_link.safe_defaults->>'categoryId'
    else v_link.predicted_category_id
  end;
  new.predicted_opportunity_score := v_link.predicted_opportunity_score;
  new.predicted_engine_version := v_link.predicted_engine_version;
  new.prediction_source := v_link.prediction_source;
  new.link_verified_at := v_link.verified_at;
  new.window_days := (new.report_date_to - new.report_date_from) + 1;
  new.listing_age_days := floor(
    extract(epoch from (new.observed_at - v_link.verified_at)) / 86400
  )::integer;
  return new;
end;
$$;

revoke all on function public.assert_ebay_own_listing_performance_snapshot()
  from public, anon, authenticated;
grant execute on function public.assert_ebay_own_listing_performance_snapshot()
  to service_role;

create trigger ebay_listing_performance_verify_own_source_before_write
before insert or update on public.ebay_listing_performance_snapshots
for each row execute function public.assert_ebay_own_listing_performance_snapshot();

create index ebay_listing_performance_link_observed_idx
  on public.ebay_listing_performance_snapshots(
    manual_listing_link_id, observed_at desc
  );
create index ebay_listing_performance_learning_cohort_idx
  on public.ebay_listing_performance_snapshots(
    account_key, marketplace_id, category_id,
    predicted_engine_version, observed_at desc
  ) where category_id is not null;

comment on table public.ebay_listing_performance_snapshots is
  'Append-oriented snapshots from official eBay Sell Analytics for listings proven to belong to the authenticated seller account; never competitor performance.';
comment on column public.ebay_listing_performance_snapshots.category_id is
  'Uses the seller listing category learned from verified read-only listing details when available, otherwise the immutable predicted category.';
comment on column public.ebay_listing_performance_snapshots.listing_age_days is
  'Conservative age since the seller-owned manual link was verified, derived by the database.';
comment on column public.ebay_listing_performance_snapshots.snapshot_fingerprint is
  'Lowercase SHA-256 fingerprint used to make official report ingestion idempotent.';

create table public.ebay_category_learning_adjustments (
  id uuid primary key default gen_random_uuid(),
  account_key text not null,
  marketplace_id text not null default 'EBAY_US',
  category_id text not null,
  model_version text not null,
  prediction_engine_version text not null,
  status text not null default 'COLLECTING',
  eligible boolean not null default false,
  adjustment_points numeric(5,2) not null default 0,
  sample_listing_count integer not null default 0,
  total_impressions bigint not null default 0,
  minimum_observation_days integer not null default 0,
  weighted_predicted_score numeric(6,2) null,
  observed_performance_score numeric(6,2) null,
  reliability_factor numeric(8,6) null,
  evidence jsonb not null default '{}'::jsonb,
  source text not null default 'EBAY_SELL_ANALYTICS_READONLY',
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_category_learning_account_check check (
    char_length(account_key) between 1 and 160
    and account_key !~ '[[:cntrl:]]'
  ),
  constraint ebay_category_learning_marketplace_check check (
    marketplace_id = 'EBAY_US'
  ),
  constraint ebay_category_learning_category_check check (
    category_id ~ '^[0-9]{1,20}$'
  ),
  constraint ebay_category_learning_versions_check check (
    char_length(model_version) between 1 and 120
    and model_version !~ '[[:cntrl:]]'
    and char_length(prediction_engine_version) between 1 and 120
    and prediction_engine_version !~ '[[:cntrl:]]'
  ),
  constraint ebay_category_learning_status_check check (
    status in ('COLLECTING', 'ELIGIBLE_APPLIED')
  ),
  constraint ebay_category_learning_adjustment_check check (
    adjustment_points between -5 and 5
  ),
  constraint ebay_category_learning_counts_check check (
    sample_listing_count >= 0
    and total_impressions >= 0
    and minimum_observation_days >= 0
  ),
  constraint ebay_category_learning_score_check check (
    (weighted_predicted_score is null
      or weighted_predicted_score between 0 and 100)
    and (observed_performance_score is null
      or observed_performance_score between 0 and 100)
    and (reliability_factor is null
      or reliability_factor between 0 and 1)
  ),
  constraint ebay_category_learning_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  ),
  constraint ebay_category_learning_source_check check (
    source = 'EBAY_SELL_ANALYTICS_READONLY'
  ),
  constraint ebay_category_learning_eligibility_check check (
    (
      status = 'COLLECTING'
      and eligible = false
      and adjustment_points = 0
    ) or (
      status = 'ELIGIBLE_APPLIED'
      and eligible = true
      and sample_listing_count >= 10
      and total_impressions >= 500
      and minimum_observation_days >= 14
      and weighted_predicted_score is not null
      and observed_performance_score is not null
      and reliability_factor is not null
    )
  ),
  constraint ebay_category_learning_cohort_unique unique (
    account_key, marketplace_id, category_id, model_version,
    prediction_engine_version
  )
);

create index ebay_category_learning_eligible_lookup_idx
  on public.ebay_category_learning_adjustments(
    account_key, marketplace_id, category_id,
    prediction_engine_version, model_version, computed_at desc
  ) where eligible = true and status = 'ELIGIBLE_APPLIED';

comment on table public.ebay_category_learning_adjustments is
  'Auditable category-level calibration from verified own-listing cohorts. COLLECTING must remain zero; application requires at least 10 linked listings, 14 days, and 500 official impressions.';
comment on column public.ebay_category_learning_adjustments.evidence is
  'Aggregate thresholds, formula inputs, and missing requirements only; no raw reports, listing copy, account tokens, or competitor data.';
comment on column public.ebay_category_learning_adjustments.adjustment_points is
  'Category ranking adjustment capped by database constraint to the inclusive range [-5, 5].';

alter table public.ebay_listing_performance_snapshots enable row level security;
alter table public.ebay_category_learning_adjustments enable row level security;

revoke all on table public.ebay_listing_performance_snapshots
  from public, anon, authenticated;
revoke all on table public.ebay_category_learning_adjustments
  from public, anon, authenticated;
grant select, insert, update on table public.ebay_listing_performance_snapshots
  to service_role;
grant select, insert, update on table public.ebay_category_learning_adjustments
  to service_role;

notify pgrst, 'reload schema';
