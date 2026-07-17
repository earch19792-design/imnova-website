-- Additive Preview/staging persistence for Winner Evidence & Product Decision V2.
-- Packages contain only product/commercial evidence; no buyer PII or secrets.

create table if not exists public.marketplace_listing_decision_packages (
  id uuid primary key default gen_random_uuid(),
  marketplace_account_key text not null,
  marketplace text not null,
  candidate_id uuid null references public.ebay_product_candidates(id) on delete set null,
  supplier_sku text not null,
  supplier_variant_id text null,
  product_identity_fingerprint text not null,
  identity_version text not null,
  package_version text not null,
  input_hash text not null,
  package_hash text not null,
  verdict text not null,
  status text not null default 'GENERATED',
  package_payload jsonb not null,
  generated_at timestamptz not null,
  approved_at timestamptz null,
  approved_by uuid null references auth.users(id) on delete set null,
  rejected_at timestamptz null,
  rejected_by uuid null references auth.users(id) on delete set null,
  rejection_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_decision_packages_marketplace_check check (
    marketplace = 'EBAY_US'
  ),
  constraint marketplace_listing_decision_packages_verdict_check check (
    verdict in ('GO', 'GO_WITH_CHANGES', 'NO_GO')
  ),
  constraint marketplace_listing_decision_packages_status_check check (
    status in ('GENERATED', 'APPROVED', 'REJECTED', 'SUPERSEDED')
  ),
  constraint marketplace_listing_decision_packages_fingerprint_check check (
    product_identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_listing_decision_packages_input_hash_check check (
    input_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_listing_decision_packages_package_hash_check check (
    package_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint marketplace_listing_decision_packages_payload_object_check check (
    jsonb_typeof(package_payload) = 'object'
  ),
  constraint marketplace_listing_decision_packages_identity unique (
    marketplace_account_key, marketplace, package_hash
  )
);

create index if not exists marketplace_listing_decision_packages_candidate_idx
  on public.marketplace_listing_decision_packages(
    marketplace_account_key, marketplace, candidate_id, created_at desc
  );

create index if not exists marketplace_listing_decision_packages_sku_idx
  on public.marketplace_listing_decision_packages(
    marketplace_account_key, marketplace, supplier_sku, created_at desc
  );

create index if not exists marketplace_listing_decision_packages_fingerprint_idx
  on public.marketplace_listing_decision_packages(
    marketplace_account_key, marketplace, product_identity_fingerprint, created_at desc
  );

create index if not exists marketplace_listing_decision_packages_status_idx
  on public.marketplace_listing_decision_packages(
    marketplace_account_key, marketplace, status, created_at desc
  );

alter table public.marketplace_listing_decision_packages enable row level security;
revoke all on table public.marketplace_listing_decision_packages from anon, authenticated;
grant select, insert, update on table public.marketplace_listing_decision_packages to service_role;

notify pgrst, 'reload schema';
