-- Additive Preview/staging persistence for the Loop 2 Top 20 Luna-to-eBay opportunity pool.
-- Product/commercial evidence only: no buyer PII, credentials or competitor content.

create table if not exists public.marketplace_listing_approval_queue_runs (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  status text not null default 'RUNNING',
  checkpoint_offset integer not null default 0,
  catalog_total integer not null default 0,
  catalog_examined integer not null default 0,
  candidates_analyzed integer not null default 0,
  ready_count integer not null default 0,
  needs_data_count integer not null default 0,
  rejected_count integer not null default 0,
  retry_count integer not null default 0,
  lease_owner text null,
  lease_expires_at timestamptz null,
  lock_version integer not null default 0,
  last_error_code text null,
  scheduling_enabled boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_approval_queue_runs_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_approval_queue_runs_status_check
    check (status in ('RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED')),
  constraint marketplace_listing_approval_queue_runs_counts_check
    check (least(checkpoint_offset,catalog_total,catalog_examined,candidates_analyzed,
      ready_count,needs_data_count,rejected_count,retry_count,lock_version) >= 0),
  constraint marketplace_listing_approval_queue_runs_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_listing_approval_queue_runs_schedule_off_check
    check (scheduling_enabled = false)
);

create unique index if not exists marketplace_listing_approval_queue_runs_active_unique
  on public.marketplace_listing_approval_queue_runs(marketplace_account_key, marketplace)
  where status = 'RUNNING';

create index if not exists marketplace_listing_approval_queue_runs_account_idx
  on public.marketplace_listing_approval_queue_runs(
    marketplace_account_key, marketplace, created_at desc
  );

create table if not exists public.marketplace_listing_approval_queue_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marketplace_listing_approval_queue_runs(id) on delete cascade,
  marketplace_account_key text not null,
  marketplace text not null,
  market_radar_product_id uuid not null references public.market_radar_products(id) on delete restrict,
  supplier_product_id text not null,
  supplier_variant_id text not null,
  supplier_sku text not null,
  product_identity_fingerprint text null,
  base_product_fingerprint text null,
  offer_pack_fingerprint text null,
  decision_package_id uuid null references public.marketplace_listing_decision_packages(id) on delete set null,
  package_hash text null,
  cohort text not null,
  internal_status text not null default 'NEEDS_DATA',
  pool_rank integer null,
  rank integer null,
  ranking_score numeric(7,3) not null default 0,
  reason_codes text[] not null default '{}'::text[],
  evidence_snapshot jsonb not null default '{}'::jsonb,
  retry_count integer not null default 0,
  next_retry_at timestamptz null,
  last_error_code text null,
  stale_after timestamptz not null,
  operator_action text null,
  supplier_price_observed numeric(14,2) null,
  supplier_availability_confirmation text null,
  supplier_unit_quantity integer null,
  stock_confidence text null,
  recommended_pack_count integer null,
  available_offer_pack_capacity integer null,
  ebay_listing_quantity integer null,
  supplier_shipping_cost_status text not null default 'ESTIMATED',
  supplier_shipping_reserve_usd numeric(14,2) null,
  supplier_confirmed_at timestamptz null,
  approved_at timestamptz null,
  discarded_at timestamptz null,
  analyzed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_approval_queue_items_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_approval_queue_items_cohort_check
    check (cohort in ('READY_FOR_OPERATOR_APPROVAL', 'NEEDS_DATA', 'REJECTED')),
  constraint marketplace_listing_approval_queue_items_internal_status_check
    check (internal_status in (
      'READY_FOR_OPERATOR_APPROVAL', 'NEEDS_DATA', 'REJECTED', 'STALE',
      'REANALYSIS_REQUIRED', 'READY_FOR_OPENAI_APPROVAL', 'REJECTED_AFTER_CONFIRMATION'
    )),
  constraint marketplace_listing_approval_queue_items_rank_check
    check (rank is null or rank between 1 and 20),
  constraint marketplace_listing_approval_queue_items_pool_rank_check
    check (pool_rank is null or pool_rank between 1 and 20),
  constraint marketplace_listing_approval_queue_items_score_check
    check (ranking_score between 0 and 100),
  constraint marketplace_listing_approval_queue_items_fingerprint_check
    check (
      (product_identity_fingerprint is null or product_identity_fingerprint ~ '^sha256:[0-9a-f]{64}$')
      and (base_product_fingerprint is null or base_product_fingerprint ~ '^sha256:[0-9a-f]{64}$')
      and (offer_pack_fingerprint is null or offer_pack_fingerprint ~ '^sha256:[0-9a-f]{64}$')
      and (package_hash is null or package_hash ~ '^sha256:[0-9a-f]{64}$')
    ),
  constraint marketplace_listing_approval_queue_items_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]+$'),
  constraint marketplace_listing_approval_queue_items_action_check
    check (operator_action is null or operator_action in ('APPROVED', 'DISCARDED')),
  constraint marketplace_listing_approval_queue_items_supplier_confirmation_check check (
    supplier_availability_confirmation is null
    or supplier_availability_confirmation in (
      'EXACT_QUANTITY_VISIBLE', 'AVAILABLE_QUANTITY_NOT_SHOWN', 'OUT_OF_STOCK'
    )
  ),
  constraint marketplace_listing_approval_queue_items_stock_confidence_check check (
    stock_confidence is null or stock_confidence in ('EXACT_QUANTITY', 'UNKNOWN_QUANTITY', 'OUT_OF_STOCK')
  ),
  constraint marketplace_listing_approval_queue_items_quantity_check check (
    supplier_price_observed is null or supplier_price_observed >= 0
  ),
  constraint marketplace_listing_approval_queue_items_capacity_check check (
    supplier_unit_quantity is null or supplier_unit_quantity >= 0
  ),
  constraint marketplace_listing_approval_queue_items_offer_capacity_check check (
    available_offer_pack_capacity is null or available_offer_pack_capacity >= 0
  ),
  constraint marketplace_listing_approval_queue_items_listing_quantity_check check (
    ebay_listing_quantity is null or ebay_listing_quantity between 0 and 1
  ),
  constraint marketplace_listing_approval_queue_items_pack_count_check check (
    recommended_pack_count is null or recommended_pack_count > 0
  ),
  constraint marketplace_listing_approval_queue_items_shipping_status_check check (
    supplier_shipping_cost_status in ('ESTIMATED', 'CONFIRMED')
  ),
  constraint marketplace_listing_approval_queue_items_shipping_reserve_check check (
    supplier_shipping_reserve_usd is null or supplier_shipping_reserve_usd >= 0
  ),
  constraint marketplace_listing_approval_queue_items_evidence_object_check
    check (jsonb_typeof(evidence_snapshot) = 'object'),
  constraint marketplace_listing_approval_queue_items_unique
    unique (run_id, market_radar_product_id, supplier_variant_id)
);

create index if not exists marketplace_listing_approval_queue_items_cohort_idx
  on public.marketplace_listing_approval_queue_items(
    marketplace_account_key, marketplace, run_id, cohort, pool_rank, rank, ranking_score desc
  );

create index if not exists marketplace_listing_approval_queue_items_sku_idx
  on public.marketplace_listing_approval_queue_items(
    marketplace_account_key, marketplace, supplier_sku, analyzed_at desc
  );

create index if not exists marketplace_listing_approval_queue_items_package_idx
  on public.marketplace_listing_approval_queue_items(
    marketplace_account_key, marketplace, package_hash
  ) where package_hash is not null;

create index if not exists marketplace_listing_approval_queue_items_retry_idx
  on public.marketplace_listing_approval_queue_items(
    marketplace_account_key, marketplace, next_retry_at
  ) where next_retry_at is not null;

create table if not exists public.marketplace_listing_operator_approvals (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  decision_package_id uuid not null references public.marketplace_listing_decision_packages(id) on delete restrict,
  package_hash text not null,
  offer_pack_fingerprint text not null,
  economics_hash text not null,
  action text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null,
  created_at timestamptz not null default now(),
  constraint marketplace_listing_operator_approvals_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_operator_approvals_hash_check check (
    package_hash ~ '^sha256:[0-9a-f]{64}$'
    and offer_pack_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    and economics_hash ~ '^sha256:[0-9a-f]{64}$'
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_listing_operator_approvals_action_check
    check (action in ('APPROVED_FOR_OPENAI', 'DISCARDED')),
  constraint marketplace_listing_operator_approvals_idempotency_unique
    unique (marketplace_account_key, marketplace, idempotency_key_hash)
);

create table if not exists public.marketplace_listing_supplier_confirmations (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  queue_item_id uuid not null references public.marketplace_listing_approval_queue_items(id) on delete restrict,
  decision_package_id uuid null references public.marketplace_listing_decision_packages(id) on delete restrict,
  package_hash text null,
  supplier_price_observed numeric(14,2) not null,
  availability_confirmation text not null,
  supplier_unit_quantity integer null,
  stock_confidence text not null,
  recommended_pack_count integer not null,
  available_offer_pack_capacity integer not null,
  ebay_listing_quantity integer not null,
  supplier_shipping_cost_status text not null,
  supplier_shipping_reserve_usd numeric(14,2) not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key_hash text not null,
  created_at timestamptz not null default now(),
  constraint marketplace_listing_supplier_confirmations_marketplace_check
    check (marketplace = 'EBAY_US'),
  constraint marketplace_listing_supplier_confirmations_availability_check
    check (availability_confirmation in (
      'EXACT_QUANTITY_VISIBLE', 'AVAILABLE_QUANTITY_NOT_SHOWN', 'OUT_OF_STOCK'
    )),
  constraint marketplace_listing_supplier_confirmations_stock_confidence_check
    check (stock_confidence in ('EXACT_QUANTITY', 'UNKNOWN_QUANTITY', 'OUT_OF_STOCK')),
  constraint marketplace_listing_supplier_confirmations_values_check check (
    supplier_price_observed >= 0
    and (supplier_unit_quantity is null or supplier_unit_quantity >= 0)
    and recommended_pack_count > 0
    and available_offer_pack_capacity >= 0
    and ebay_listing_quantity between 0 and 1
    and supplier_shipping_cost_status in ('ESTIMATED', 'CONFIRMED')
    and supplier_shipping_reserve_usd >= 0
  ),
  constraint marketplace_listing_supplier_confirmations_hash_check check (
    (package_hash is null or package_hash ~ '^sha256:[0-9a-f]{64}$')
    and idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_listing_supplier_confirmations_idempotency_unique
    unique (marketplace_account_key, marketplace, idempotency_key_hash)
);

create unique index if not exists marketplace_listing_operator_approvals_package_unique
  on public.marketplace_listing_operator_approvals(
    marketplace_account_key, marketplace, decision_package_id, package_hash
  ) where action = 'APPROVED_FOR_OPENAI';

create index if not exists marketplace_listing_operator_approvals_item_idx
  on public.marketplace_listing_operator_approvals(
    marketplace_account_key, marketplace, queue_item_id, created_at desc
  );

create index if not exists marketplace_listing_supplier_confirmations_item_idx
  on public.marketplace_listing_supplier_confirmations(
    marketplace_account_key, marketplace, queue_item_id, created_at desc
  );

alter table public.marketplace_listing_approval_queue_runs enable row level security;
alter table public.marketplace_listing_approval_queue_items enable row level security;
alter table public.marketplace_listing_operator_approvals enable row level security;
alter table public.marketplace_listing_supplier_confirmations enable row level security;

revoke all on table public.marketplace_listing_approval_queue_runs from anon, authenticated, service_role;
revoke all on table public.marketplace_listing_approval_queue_items from anon, authenticated, service_role;
revoke all on table public.marketplace_listing_operator_approvals from anon, authenticated, service_role;
revoke all on table public.marketplace_listing_supplier_confirmations from anon, authenticated, service_role;

grant select, insert, update on table public.marketplace_listing_approval_queue_runs to service_role;
grant select, insert, update on table public.marketplace_listing_approval_queue_items to service_role;
grant select, insert on table public.marketplace_listing_operator_approvals to service_role;
grant select, insert on table public.marketplace_listing_supplier_confirmations to service_role;

notify pgrst, 'reload schema';
