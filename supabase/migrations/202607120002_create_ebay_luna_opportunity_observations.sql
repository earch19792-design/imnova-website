create table if not exists public.ebay_market_listing_observations (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null,
  market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
  ebay_item_id text not null,
  seller_reference text not null,
  observed_at timestamptz not null,
  estimated_sold_quantity integer null,
  total_buyer_price numeric(12, 2) null,
  identity_match_score numeric(5, 2) not null default 0,
  identity_match_type text not null,
  evidence_source text not null,
  created_at timestamptz not null default now(),
  constraint ebay_market_observation_quantity_check check (
    estimated_sold_quantity is null or estimated_sold_quantity >= 0
  ),
  constraint ebay_market_observation_price_check check (
    total_buyer_price is null or total_buyer_price >= 0
  ),
  constraint ebay_market_observation_identity_score_check check (
    identity_match_score between 0 and 100
  ),
  constraint ebay_market_observation_unique unique (
    candidate_key,
    ebay_item_id,
    observed_at
  )
);

create table if not exists public.ebay_luna_opportunity_assessments (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null,
  market_radar_product_id uuid null references public.market_radar_products(id) on delete set null,
  engine_version text not null,
  decision text not null,
  opportunity_score numeric(5, 2) not null default 0,
  demand_score numeric(5, 2) not null default 0,
  economics_score numeric(5, 2) not null default 0,
  identity_score numeric(5, 2) not null default 0,
  evidence_basis text not null,
  hard_gates text[] not null default '{}'::text[],
  evidence_guards text[] not null default '{}'::text[],
  assessment_summary jsonb not null default '{}'::jsonb,
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ebay_luna_opportunity_scores_check check (
    opportunity_score between 0 and 100 and
    demand_score between 0 and 100 and
    economics_score between 0 and 100 and
    identity_score between 0 and 100
  )
);

create index if not exists ebay_market_observation_candidate_time_idx
  on public.ebay_market_listing_observations(candidate_key, observed_at desc);

create index if not exists ebay_market_observation_item_time_idx
  on public.ebay_market_listing_observations(ebay_item_id, observed_at desc);

create index if not exists ebay_luna_opportunity_score_time_idx
  on public.ebay_luna_opportunity_assessments(opportunity_score desc, assessed_at desc);

create index if not exists ebay_luna_opportunity_candidate_time_idx
  on public.ebay_luna_opportunity_assessments(candidate_key, assessed_at desc);

alter table public.ebay_market_listing_observations enable row level security;
alter table public.ebay_luna_opportunity_assessments enable row level security;

drop policy if exists "admin manage ebay market listing observations"
  on public.ebay_market_listing_observations;
create policy "admin manage ebay market listing observations"
  on public.ebay_market_listing_observations
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage ebay luna opportunity assessments"
  on public.ebay_luna_opportunity_assessments;
create policy "admin manage ebay luna opportunity assessments"
  on public.ebay_luna_opportunity_assessments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert
  on public.ebay_market_listing_observations,
     public.ebay_luna_opportunity_assessments
  to authenticated;

notify pgrst, 'reload schema';
