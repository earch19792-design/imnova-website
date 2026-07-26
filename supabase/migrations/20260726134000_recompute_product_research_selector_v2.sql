-- Product Research -> Selector V2 canonical bridge.
-- Additive, service-role only, no marketplace side effects.

begin;

alter table if exists public.marketplace_product_research_capture_observations
  add column if not exists seller_reference_fingerprint text;

alter table if exists public.ebay_luna_opportunity_queue
  add column if not exists demand_evidence_class text,
  add column if not exists sold_exact_units integer not null default 0,
  add column if not exists sold_exact_seller_count integer not null default 0,
  add column if not exists sold_exact_comparable_count integer not null default 0,
  add column if not exists sold_evidence_reviewed boolean not null default false,
  add column if not exists exact_identity boolean not null default false,
  add column if not exists same_pack boolean not null default false,
  add column if not exists same_size boolean not null default false,
  add column if not exists same_variant boolean not null default false,
  add column if not exists same_condition boolean not null default false,
  add column if not exists sold_evidence_observed_at timestamptz,
  add column if not exists sold_evidence_expires_at timestamptz,
  add column if not exists demand_evidence_hash text,
  add column if not exists demand_policy_version text,
  add column if not exists demand_evaluated_at timestamptz,
  add column if not exists demand_validation_passed boolean not null default false;

create table if not exists public.marketplace_product_research_canonical_demand_v2 (
  id uuid primary key default gen_random_uuid(),
  evaluation_key text not null unique,
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  supplier_variant_id text not null,
  policy_version text not null,
  evidence_class text not null,
  evidence_observed_at timestamptz,
  evidence_expires_at timestamptz,
  evaluation_timepoint timestamptz not null,
  sold_exact_units integer not null default 0 check (sold_exact_units >= 0),
  sold_exact_seller_count integer not null default 0 check (sold_exact_seller_count >= 0),
  sold_exact_comparable_count integer not null default 0 check (sold_exact_comparable_count >= 0),
  evidence_reviewed boolean not null default false,
  exact_identity boolean not null default false,
  same_pack boolean not null default false,
  same_size boolean not null default false,
  same_variant boolean not null default false,
  same_condition boolean not null default false,
  demand_validation_passed boolean not null default false,
  evidence_hash text not null,
  source_observation_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists marketplace_product_research_canonical_demand_v2_lookup_idx
  on public.marketplace_product_research_canonical_demand_v2
  (marketplace_account_key, marketplace, supplier_variant_id, evaluation_timepoint desc);

create table if not exists public.marketplace_product_research_deferred_query_groups_v2 (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null default 'EBAY_US',
  run_id uuid,
  input_hash text not null,
  query_hash text not null,
  cluster_key_hash text not null,
  search_query text not null,
  category_id text,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  candidate_variant_hashes text[] not null default '{}'::text[],
  priority_score numeric not null default 0,
  status text not null default 'DEFERRED'
    check (status in ('DEFERRED', 'PROMOTED', 'CANCELLED')),
  deferral_count integer not null default 0 check (deferral_count >= 0),
  first_deferred_at timestamptz not null default clock_timestamp(),
  next_eligible_at timestamptz not null default clock_timestamp(),
  last_promoted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (marketplace_account_key, marketplace, query_hash)
);

create index if not exists marketplace_product_research_deferred_query_groups_v2_fair_idx
  on public.marketplace_product_research_deferred_query_groups_v2
  (marketplace_account_key, marketplace, status, next_eligible_at, last_promoted_at, deferral_count desc);

alter table public.marketplace_product_research_canonical_demand_v2 enable row level security;
alter table public.marketplace_product_research_canonical_demand_v2 force row level security;
alter table public.marketplace_product_research_deferred_query_groups_v2 enable row level security;
alter table public.marketplace_product_research_deferred_query_groups_v2 force row level security;

revoke all on table public.marketplace_product_research_canonical_demand_v2
  from public, anon, authenticated, service_role;
revoke all on table public.marketplace_product_research_deferred_query_groups_v2
  from public, anon, authenticated, service_role;
grant select, insert on table public.marketplace_product_research_canonical_demand_v2 to service_role;
grant select, insert, update on table public.marketplace_product_research_deferred_query_groups_v2 to service_role;

create or replace function public.import_product_research_browser_capture_v3(
  p_batch_id uuid,
  p_marketplace_account_key text,
  p_capture_hash text,
  p_capture_window_hash text,
  p_listing_site text,
  p_search_query_hash text,
  p_search_keyword_patterns text[],
  p_date_range jsonb,
  p_captured_at timestamptz,
  p_source_row_count integer,
  p_valid_count integer,
  p_duplicate_count integer,
  p_rejected_count integer,
  p_exact_luna_match_count integer,
  p_different_pack_count integer,
  p_different_size_count integer,
  p_different_variant_count integer,
  p_ambiguous_count integer,
  p_no_luna_match_count integer,
  p_candidates_enriched_count integer,
  p_error_counts jsonb,
  p_captured_by uuid,
  p_observations jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_requested_count integer := jsonb_array_length(coalesce(p_observations, '[]'::jsonb));
  v_collision_count integer := 0;
  v_imported_count integer := 0;
  v_duplicate_count integer := 0;
  v_inserted_count integer := 0;
  v_existing_batch_id uuid;
begin
  if jsonb_typeof(coalesce(p_observations, '[]'::jsonb)) <> 'array' then
    raise exception 'PRODUCT_RESEARCH_CAPTURE_OBSERVATIONS_ARRAY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-capture:' || p_marketplace_account_key,
    0
  ));

  select id into v_existing_batch_id
  from public.marketplace_product_research_capture_batches
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = 'EBAY_US'
    and capture_hash = p_capture_hash;
  if v_existing_batch_id is not null then
    return v_existing_batch_id;
  end if;

  select count(*) into v_collision_count
  from public.marketplace_product_research_capture_observations observation
  join jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as requested(
    evidence_deduplication_key text
  ) on requested.evidence_deduplication_key = observation.evidence_deduplication_key
  where observation.marketplace_account_key = p_marketplace_account_key
    and observation.marketplace = 'EBAY_US';

  v_imported_count := greatest(0, v_requested_count - v_collision_count);
  v_duplicate_count := p_duplicate_count + v_collision_count;

  insert into public.marketplace_product_research_capture_batches(
    id, marketplace_account_key, marketplace, source, capture_hash, capture_window_hash,
    listing_site, search_query_hash, search_keyword_patterns, date_range, captured_at,
    source_row_count, valid_count, imported_count, duplicate_count, rejected_count,
    exact_luna_match_count, different_pack_count, different_size_count,
    different_variant_count, ambiguous_count, no_luna_match_count,
    candidates_enriched_count, error_counts, captured_by
  ) values (
    p_batch_id, p_marketplace_account_key, 'EBAY_US',
    'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE', p_capture_hash, p_capture_window_hash,
    p_listing_site, p_search_query_hash, coalesce(p_search_keyword_patterns, '{}'::text[]),
    coalesce(p_date_range, '{}'::jsonb), p_captured_at, p_source_row_count,
    p_valid_count, v_imported_count, v_duplicate_count, p_rejected_count,
    p_exact_luna_match_count, p_different_pack_count, p_different_size_count,
    p_different_variant_count, p_ambiguous_count, p_no_luna_match_count,
    p_candidates_enriched_count, coalesce(p_error_counts, '{}'::jsonb), p_captured_by
  );

  insert into public.marketplace_product_research_capture_observations(
    capture_batch_id, marketplace_account_key, marketplace, source, evidence_scope,
    source_listing_id, source_listing_reference_hash, seller_reference_fingerprint,
    title_fingerprint, identity_hash, evidence_deduplication_key, normalized_identity,
    detected_offer_pack_count, detected_unit_count, detected_size, detected_variant,
    average_sold_price, average_shipping, confirmed_sold_quantity, item_sales,
    last_sold_date, listing_format, free_shipping_percent, bids, visible_image_count,
    keyword_signals, match_classification, match_reasons, matched_queue_item_id,
    matched_supplier_variant_id, evidence_reviewed
  )
  select
    p_batch_id, p_marketplace_account_key, 'EBAY_US',
    'EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE', 'MARKET_WIDE_SOLD_EVIDENCE',
    row.source_listing_id, row.source_listing_reference_hash,
    case
      when row.seller_reference_fingerprint ~ '^(sha256:)?[0-9a-f]{64}$'
        then row.seller_reference_fingerprint
      else null
    end,
    row.title_fingerprint, row.identity_hash, row.evidence_deduplication_key,
    row.normalized_identity, row.detected_offer_pack_count, row.detected_unit_count,
    row.detected_size, row.detected_variant, row.average_sold_price,
    row.average_shipping, row.confirmed_sold_quantity, row.item_sales,
    row.last_sold_date, row.listing_format, row.free_shipping_percent, row.bids,
    row.visible_image_count, row.keyword_signals, row.match_classification,
    row.match_reasons, row.matched_queue_item_id, row.matched_supplier_variant_id, true
  from jsonb_to_recordset(coalesce(p_observations, '[]'::jsonb)) as row(
    source_listing_id text,
    source_listing_reference_hash text,
    seller_reference_fingerprint text,
    title_fingerprint text,
    identity_hash text,
    evidence_deduplication_key text,
    normalized_identity jsonb,
    detected_offer_pack_count integer,
    detected_unit_count integer,
    detected_size text,
    detected_variant text,
    average_sold_price numeric,
    average_shipping numeric,
    confirmed_sold_quantity integer,
    item_sales numeric,
    last_sold_date timestamptz,
    listing_format text,
    free_shipping_percent numeric,
    bids integer,
    visible_image_count integer,
    keyword_signals text[],
    match_classification text,
    match_reasons text[],
    matched_queue_item_id uuid,
    matched_supplier_variant_id text
  )
  on conflict (marketplace_account_key, marketplace, evidence_deduplication_key)
    do nothing;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_imported_count then
    raise exception 'PRODUCT_RESEARCH_CAPTURE_IDEMPOTENCY_COUNT_MISMATCH';
  end if;

  return p_batch_id;
end;
$$;

create or replace function public.reject_product_research_canonical_demand_mutation_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'PRODUCT_RESEARCH_CANONICAL_DEMAND_IMMUTABLE';
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'marketplace_product_research_canonical_demand_v2_immutable'
      and tgrelid = 'public.marketplace_product_research_canonical_demand_v2'::regclass
  ) then
    create trigger marketplace_product_research_canonical_demand_v2_immutable
      before update or delete on public.marketplace_product_research_canonical_demand_v2
      for each row execute function public.reject_product_research_canonical_demand_mutation_v2();
  end if;
end;
$$;

create or replace function public.create_product_research_query_plan_v3(
  p_plan_id uuid,
  p_marketplace_account_key text,
  p_run_id uuid,
  p_plan_version text,
  p_input_hash text,
  p_candidate_count integer,
  p_queries jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_existing_plan_id uuid;
  v_selected jsonb;
  v_plan_id uuid;
begin
  if jsonb_typeof(coalesce(p_queries, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_queries, '[]'::jsonb)) < 1 then
    raise exception 'PRODUCT_RESEARCH_QUERY_PLAN_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-query-plan-v3:' || p_marketplace_account_key, 0
  ));

  select id into v_existing_plan_id
  from public.marketplace_product_research_query_plans
  where marketplace_account_key = p_marketplace_account_key
    and marketplace = 'EBAY_US'
    and input_hash = p_input_hash;
  if v_existing_plan_id is not null then
    return v_existing_plan_id;
  end if;

  insert into public.marketplace_product_research_deferred_query_groups_v2(
    marketplace_account_key, marketplace, run_id, input_hash, query_hash,
    cluster_key_hash, search_query, category_id, candidate_count,
    candidate_variant_hashes, priority_score, status, next_eligible_at, updated_at
  )
  select p_marketplace_account_key, 'EBAY_US', p_run_id, p_input_hash,
    row.query_hash, row.cluster_key_hash, row.search_query, row.category_id,
    row.candidate_count, coalesce(row.candidate_variant_hashes, '{}'::text[]),
    coalesce(row.priority_score, 0), 'DEFERRED', clock_timestamp(), clock_timestamp()
  from jsonb_to_recordset(p_queries) as row(
    ordinal integer,
    search_query text,
    query_hash text,
    cluster_key_hash text,
    category_id text,
    candidate_count integer,
    candidate_variant_hashes text[],
    priority_score numeric
  )
  on conflict (marketplace_account_key, marketplace, query_hash) do update
    set run_id = excluded.run_id,
        input_hash = excluded.input_hash,
        search_query = excluded.search_query,
        category_id = excluded.category_id,
        candidate_count = excluded.candidate_count,
        candidate_variant_hashes = excluded.candidate_variant_hashes,
        priority_score = excluded.priority_score,
        status = case
          when marketplace_product_research_deferred_query_groups_v2.status = 'CANCELLED'
            then 'CANCELLED'
          else 'DEFERRED'
        end,
        updated_at = clock_timestamp();

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'ordinal', selected.ordinal,
      'search_query', selected.search_query,
      'query_hash', selected.query_hash,
      'cluster_key_hash', selected.cluster_key_hash,
      'category_id', selected.category_id,
      'candidate_count', selected.candidate_count,
      'candidate_variant_hashes', selected.candidate_variant_hashes
    ) order by selected.ordinal
  ), '[]'::jsonb)
  into v_selected
  from (
    select row_number() over (
      order by
        (next_eligible_at <= clock_timestamp()) desc,
        last_promoted_at asc nulls first,
        deferral_count desc,
        priority_score desc,
        query_hash
    )::integer as ordinal,
      search_query, query_hash, cluster_key_hash, category_id, candidate_count,
      candidate_variant_hashes
    from public.marketplace_product_research_deferred_query_groups_v2
    where marketplace_account_key = p_marketplace_account_key
      and marketplace = 'EBAY_US'
      and status <> 'CANCELLED'
    order by
      (next_eligible_at <= clock_timestamp()) desc,
      last_promoted_at asc nulls first,
      deferral_count desc,
      priority_score desc,
      query_hash
    limit 15
  ) selected;

  v_plan_id := public.create_product_research_query_plan_v1(
    p_plan_id, p_marketplace_account_key, p_run_id, p_plan_version,
    p_input_hash, p_candidate_count, v_selected
  );

  update public.marketplace_product_research_deferred_query_groups_v2 backlog
  set status = 'PROMOTED',
      last_promoted_at = clock_timestamp(),
      next_eligible_at = clock_timestamp() + interval '24 hours',
      updated_at = clock_timestamp()
  where backlog.marketplace_account_key = p_marketplace_account_key
    and backlog.marketplace = 'EBAY_US'
    and backlog.status <> 'CANCELLED'
    and exists (
      select 1
      from jsonb_array_elements(v_selected) selected(value)
      where selected.value ->> 'query_hash' = backlog.query_hash
        and selected.value ->> 'cluster_key_hash' = backlog.cluster_key_hash
        and selected.value -> 'candidate_variant_hashes'
          = to_jsonb(backlog.candidate_variant_hashes)
    );

  update public.marketplace_product_research_deferred_query_groups_v2 backlog
  set status = 'DEFERRED',
      deferral_count = backlog.deferral_count + 1,
      next_eligible_at = greatest(
        backlog.next_eligible_at,
        clock_timestamp() + interval '24 hours'
      ),
      updated_at = clock_timestamp()
  where backlog.marketplace_account_key = p_marketplace_account_key
    and backlog.marketplace = 'EBAY_US'
    and backlog.status <> 'CANCELLED'
    and not exists (
      select 1
      from jsonb_array_elements(v_selected) selected(value)
      where selected.value ->> 'query_hash' = backlog.query_hash
        and selected.value ->> 'cluster_key_hash' = backlog.cluster_key_hash
        and selected.value -> 'candidate_variant_hashes'
          = to_jsonb(backlog.candidate_variant_hashes)
    );

  return v_plan_id;
end;
$$;

create or replace function public.recompute_product_research_selector_v2(
  p_marketplace_account_key text,
  p_supplier_variant_ids text[],
  p_policy_version text,
  p_timepoint timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_supplier_variant_id text;
  v_metrics record;
  v_evidence_class text;
  v_validation_passed boolean;
  v_evidence_hash text;
  v_evaluation_key text;
  v_updated integer := 0;
  v_row_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'product-research-canonical-v2:' || p_marketplace_account_key, 0
  ));

  foreach v_supplier_variant_id in array coalesce(p_supplier_variant_ids, '{}'::text[])
  loop
    with latest_exact as (
      select distinct on (observation.source_listing_reference_hash)
        observation.id,
        observation.source_listing_reference_hash,
        observation.seller_reference_fingerprint,
        greatest(coalesce(observation.confirmed_sold_quantity, 0), 0) as confirmed_sold_quantity,
        observation.last_sold_date
      from public.marketplace_product_research_capture_observations observation
      join lateral (
        select reconciliation
        from public.marketplace_product_identity_reconciliation_events reconciliation
        where coalesce(to_jsonb(reconciliation) ->> 'observation_id', '') = observation.id::text
        order by coalesce(
          (to_jsonb(reconciliation) ->> 'created_at')::timestamptz,
          '-infinity'::timestamptz
        ) desc
        limit 1
      ) latest_reconciliation on true
      where observation.marketplace_account_key = p_marketplace_account_key
        and observation.marketplace = 'EBAY_US'
        and observation.matched_supplier_variant_id = v_supplier_variant_id
        and observation.evidence_reviewed is true
        and coalesce(
          (to_jsonb(latest_reconciliation.reconciliation) ->> 'affects_sold_exact_count')::boolean,
          false
        ) is true
      order by observation.source_listing_reference_hash,
        observation.last_sold_date desc nulls last,
        observation.id desc
    )
    select
      coalesce(sum(confirmed_sold_quantity), 0)::integer as sold_exact_units,
      count(distinct seller_reference_fingerprint)
        filter (where seller_reference_fingerprint is not null)::integer
        as sold_exact_seller_count,
      count(distinct source_listing_reference_hash)::integer
        as sold_exact_comparable_count,
      max(last_sold_date) as evidence_observed_at,
      array_agg(id order by id) as source_observation_ids
    into v_metrics
    from latest_exact;

    v_evidence_class := case
      when v_metrics.sold_exact_units > 0
        and v_metrics.sold_exact_seller_count > 0
        and v_metrics.sold_exact_comparable_count > 0
      then 'CONFIRMED_SOLD_EXACT'
      else 'INSUFFICIENT_EVIDENCE'
    end;
    v_validation_passed := v_evidence_class = 'CONFIRMED_SOLD_EXACT'
      and v_metrics.evidence_observed_at is not null
      and v_metrics.evidence_observed_at + interval '90 days' >= p_timepoint;
    v_evidence_hash := 'sha256:' || encode(digest(
      jsonb_build_object(
        'account', p_marketplace_account_key,
        'variant', v_supplier_variant_id,
        'policy', p_policy_version,
        'units', v_metrics.sold_exact_units,
        'sellers', v_metrics.sold_exact_seller_count,
        'comparables', v_metrics.sold_exact_comparable_count,
        'observedAt', v_metrics.evidence_observed_at,
        'observations', coalesce(to_jsonb(v_metrics.source_observation_ids), '[]'::jsonb)
      )::text, 'sha256'
    ), 'hex');
    v_evaluation_key := 'sha256:' || encode(digest(
      concat_ws(':', p_marketplace_account_key, v_supplier_variant_id,
        p_policy_version, v_evidence_hash, date_trunc('second', p_timepoint)::text),
      'sha256'
    ), 'hex');

    insert into public.marketplace_product_research_canonical_demand_v2(
      evaluation_key, marketplace_account_key, supplier_variant_id, policy_version,
      evidence_class, evidence_observed_at, evidence_expires_at, evaluation_timepoint,
      sold_exact_units, sold_exact_seller_count, sold_exact_comparable_count,
      evidence_reviewed, exact_identity, same_pack, same_size, same_variant,
      same_condition, demand_validation_passed, evidence_hash, source_observation_ids
    ) values (
      v_evaluation_key, p_marketplace_account_key, v_supplier_variant_id, p_policy_version,
      v_evidence_class, v_metrics.evidence_observed_at,
      v_metrics.evidence_observed_at + interval '90 days', p_timepoint,
      v_metrics.sold_exact_units, v_metrics.sold_exact_seller_count,
      v_metrics.sold_exact_comparable_count,
      v_metrics.sold_exact_comparable_count > 0,
      v_metrics.sold_exact_comparable_count > 0,
      v_metrics.sold_exact_comparable_count > 0,
      v_metrics.sold_exact_comparable_count > 0,
      v_metrics.sold_exact_comparable_count > 0,
      v_metrics.sold_exact_comparable_count > 0,
      v_validation_passed, v_evidence_hash,
      coalesce(v_metrics.source_observation_ids, '{}'::uuid[])
    )
    on conflict (evaluation_key) do nothing;

    update public.ebay_luna_opportunity_queue
    set demand_evidence_class = v_evidence_class,
        sold_exact_units = v_metrics.sold_exact_units,
        sold_exact_seller_count = v_metrics.sold_exact_seller_count,
        sold_exact_comparable_count = v_metrics.sold_exact_comparable_count,
        sold_evidence_reviewed = v_metrics.sold_exact_comparable_count > 0,
        exact_identity = v_metrics.sold_exact_comparable_count > 0,
        same_pack = v_metrics.sold_exact_comparable_count > 0,
        same_size = v_metrics.sold_exact_comparable_count > 0,
        same_variant = v_metrics.sold_exact_comparable_count > 0,
        same_condition = v_metrics.sold_exact_comparable_count > 0,
        sold_evidence_observed_at = v_metrics.evidence_observed_at,
        sold_evidence_expires_at = v_metrics.evidence_observed_at + interval '90 days',
        demand_evidence_hash = v_evidence_hash,
        demand_policy_version = p_policy_version,
        demand_evaluated_at = p_timepoint,
        demand_validation_passed = v_validation_passed,
        assessment = jsonb_set(
          coalesce(assessment, '{}'::jsonb),
          '{demand}',
          jsonb_build_object(
            'evidenceClass', v_evidence_class,
            'soldExactUnits', v_metrics.sold_exact_units,
            'soldExactSellerCount', v_metrics.sold_exact_seller_count,
            'soldExactComparableCount', v_metrics.sold_exact_comparable_count,
            'observedAt', v_metrics.evidence_observed_at,
            'expiresAt', v_metrics.evidence_observed_at + interval '90 days',
            'evidenceHash', v_evidence_hash,
            'policyVersion', p_policy_version,
            'validated', v_validation_passed
          ),
          true
        ),
        updated_at = clock_timestamp()
    where marketplace_account_key = p_marketplace_account_key
      and marketplace = 'EBAY_US'
      and supplier_variant_id = v_supplier_variant_id;
    get diagnostics v_row_count = row_count;
    v_updated := v_updated + v_row_count;
  end loop;

  return jsonb_build_object(
    'variantsEvaluated', cardinality(coalesce(p_supplier_variant_ids, '{}'::text[])),
    'queueRowsUpdated', v_updated,
    'policyVersion', p_policy_version,
    'timepoint', p_timepoint
  );
end;
$$;

revoke all on function public.reject_product_research_canonical_demand_mutation_v2()
  from public, anon, authenticated;
revoke all on function public.import_product_research_browser_capture_v3(
  uuid, text, text, text, text, text, text[], jsonb, timestamptz, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  jsonb, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.create_product_research_query_plan_v3(
  uuid, text, uuid, text, text, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.recompute_product_research_selector_v2(
  text, text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_product_research_query_plan_v3(
  uuid, text, uuid, text, text, integer, jsonb
) to service_role;
grant execute on function public.import_product_research_browser_capture_v3(
  uuid, text, text, text, text, text, text[], jsonb, timestamptz, integer, integer,
  integer, integer, integer, integer, integer, integer, integer, integer, integer,
  jsonb, uuid, jsonb
) to service_role;
grant execute on function public.recompute_product_research_selector_v2(
  text, text[], text, timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
