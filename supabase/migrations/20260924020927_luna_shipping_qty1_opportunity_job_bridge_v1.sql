-- Pre-package opportunity jobs use the existing Luna Shipping extension,
-- browser leadership and same-day evidence ledger. No economic frontier is
-- created to obtain a supplier shipping fact.

create table public.seller_os_luna_shipping_qty1_jobs_v1 (
  job_id uuid primary key default gen_random_uuid(),
  job_type text not null default 'LUNA_SHIPPING_QTY1'
    check (job_type = 'LUNA_SHIPPING_QTY1'),
  account_key text not null
    check (account_key ~ '^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$'),
  marketplace text not null default 'EBAY_US'
    check (marketplace = 'EBAY_US'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id)
    on delete restrict,
  candidate_key text not null,
  candidate_id text not null check (candidate_id ~ '^sha256:[0-9a-f]{64}$'),
  sku text not null
    check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._:+/ -]{0,159}$'),
  product_id text not null check (product_id ~ '^[0-9]{8,24}$'),
  variant_id text not null check (variant_id ~ '^[0-9]{8,24}$'),
  source_snapshot_id uuid not null
    references public.luna_catalog_snapshots_v1(snapshot_id) on delete restrict,
  source_fingerprint text not null
    check (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  field_truth_evidence_digest text not null
    check (field_truth_evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  canonical_product_url text not null
    check (canonical_product_url ~ '^https://(www\.)?lunaportex\.com/products/[^?#]+$'),
  product_name text not null check (char_length(product_name) between 2 and 240),
  supplier_cost_usd numeric(12,2) not null check (supplier_cost_usd >= 0),
  quantity integer not null check (quantity = 1),
  destination_profile text not null check (destination_profile = 'LUNA_BOCA_RATON_US'),
  destination_profile_digest text not null
    check (destination_profile_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text not null unique
    check (idempotency_key ~ '^luna-shipping-qty1-job-v1:sha256:[0-9a-f]{64}$'),
  status text not null default 'PENDING'
    check (status in ('PENDING','CLAIMED','COMPLETED','FAILED','EXPIRED')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 2),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  next_attempt_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  claimed_worker_id text,
  claimed_leader_session_id uuid,
  capture_session_id uuid,
  completed_at timestamptz,
  receipt_event_id uuid references public.ebay_same_day_pilot_events(id)
    on delete restrict,
  last_reason_code text,
  constraint seller_os_luna_shipping_qty1_job_time_check check (
    expires_at > created_at and expires_at <= created_at + interval '30 minutes'
    and (lease_expires_at is null or lease_expires_at <= expires_at)
  ),
  constraint seller_os_luna_shipping_qty1_job_claim_check check (
    (status = 'CLAIMED' and claimed_at is not null
      and lease_expires_at is not null and claimed_worker_id is not null
      and claimed_leader_session_id is not null and capture_session_id is not null)
    or status <> 'CLAIMED'
  ),
  constraint seller_os_luna_shipping_qty1_job_result_check check (
    (status = 'COMPLETED') = (receipt_event_id is not null)
    and (status = 'COMPLETED') = (completed_at is not null)
  )
);

create index seller_os_luna_shipping_qty1_jobs_claim_idx
  on public.seller_os_luna_shipping_qty1_jobs_v1
  (account_key, owner_user_id, status, next_attempt_at, created_at)
  where status in ('PENDING','CLAIMED');

create unique index seller_os_luna_shipping_qty1_jobs_active_opp_idx
  on public.seller_os_luna_shipping_qty1_jobs_v1
  (account_key, opportunity_id)
  where status in ('PENDING','CLAIMED');

alter table public.seller_os_luna_shipping_qty1_jobs_v1 enable row level security;
alter table public.seller_os_luna_shipping_qty1_jobs_v1 force row level security;
revoke all on table public.seller_os_luna_shipping_qty1_jobs_v1
  from public, anon, authenticated;
grant select, insert, update on public.seller_os_luna_shipping_qty1_jobs_v1
  to service_role;
create policy seller_os_luna_shipping_qty1_jobs_service_role
  on public.seller_os_luna_shipping_qty1_jobs_v1 for all to service_role
  using (true) with check (true);

comment on table public.seller_os_luna_shipping_qty1_jobs_v1 is
  'Bounded pre-package opportunity jobs for the existing OWNER Luna Shipping extension. No credentials, address, economics or inventory authority.';

notify pgrst, 'reload schema';
