-- OWNER-attested visual observations are a separate Product Truth overlay.
-- They never rewrite Luna/Supplier Truth and never become marketplace writes.
alter table public.seller_os_golden_path_receipts_v1
  drop constraint if exists seller_os_golden_path_receipts_v1_kind_check;
alter table public.seller_os_golden_path_receipts_v1
  add constraint seller_os_golden_path_receipts_v1_kind_check
  check (kind in (
    'OPPORTUNITIES','EVALUATION','MANUAL_INTAKE','PRODUCT_TRUTH_INTAKE',
    'DRAFT','RECONCILIATION','MONITORING','SHIPPING'
  ));

create table public.seller_os_golden_owner_product_truth_v1 (
  evidence_id text primary key
    check (evidence_id ~ '^sha256:[0-9a-f]{64}$'),
  account_key text not null check (length(account_key) between 8 and 240),
  owner_user_id uuid not null,
  product_id text not null check (product_id ~ '^[0-9]{1,30}$'),
  variant_id text not null check (variant_id ~ '^[0-9]{1,30}$'),
  supplier_sku text not null check (length(supplier_sku) between 1 and 160),
  supplier_quantity integer not null check (supplier_quantity between 1 and 20),
  source_fingerprint text not null
    check (source_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  fact_class text not null
    check (fact_class in ('VISIBLE_BRAND_MARKING','OBSERVED_MARKING')),
  normalized_value text not null check (length(normalized_value) between 2 and 160),
  source_digest text not null check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_captured_at timestamptz not null,
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 32768
    and payload->>'schemaVersion' = 'SELLER_OS_OWNER_PRODUCT_TRUTH_EVIDENCE_V1'
    and payload->>'authorityClass' = 'OWNER_ATTESTED_SUPPLIER_VISUAL_OBSERVATION'
    and payload->>'accountKey' = account_key
    and payload->>'ownerUserId' = owner_user_id::text
    and payload#>>'{candidate,productId}' = product_id
    and payload#>>'{candidate,variantId}' = variant_id
    and payload#>>'{candidate,supplierSku}' = supplier_sku
    and (payload#>>'{candidate,supplierQuantity}')::integer = supplier_quantity
    and payload->>'factClass' = fact_class
    and payload->>'normalizedValue' = normalized_value
    and payload->>'sourceDigest' = source_digest
    and payload->>'sourceFingerprint' = source_fingerprint
    and payload->>'canonicalUrl' ~ '^https://lunaportex[.]com/products/[A-Za-z0-9][A-Za-z0-9._~%+-]*$'
    and payload->>'sourceLocator' = payload->>'canonicalUrl'
    and payload->>'sourceMediaType' = 'IMAGE'
    and (payload->>'capturedAt')::timestamptz = source_captured_at
    and length(payload->>'evidenceStatement') between 12 and 1000
    and payload->>'evidenceId' = evidence_id
    and payload->>'evidenceDigest' = evidence_id
    and payload->>'operatorAttested' = 'true'
    and payload->>'manufacturerBrandPromoted' = 'false'
    and payload->>'supplierTruthModified' = 'false'
    and payload->>'unknownFieldsPromoted' = 'false'
    and payload->>'marketplaceWrites' = '0'
    and payload->>'supplierPurchases' = '0'
    and payload->>'draftIsLive' = 'false'
  ),
  created_at timestamptz not null default now()
);

create index seller_os_golden_owner_truth_candidate_v1
  on public.seller_os_golden_owner_product_truth_v1(
    account_key, owner_user_id, product_id, variant_id, supplier_sku,
    supplier_quantity, source_fingerprint, created_at
  );

create trigger golden_owner_product_truth_immutable
  before update or delete on public.seller_os_golden_owner_product_truth_v1
  for each row execute function public.seller_os_golden_evidence_immutable_v1();

alter table public.seller_os_golden_owner_product_truth_v1 enable row level security;
alter table public.seller_os_golden_owner_product_truth_v1 force row level security;
revoke all on table public.seller_os_golden_owner_product_truth_v1
  from public, anon, authenticated;
grant select, insert on table public.seller_os_golden_owner_product_truth_v1
  to service_role;
create policy golden_owner_product_truth_select_v1
  on public.seller_os_golden_owner_product_truth_v1 for select to service_role
  using (true);
create policy golden_owner_product_truth_insert_v1
  on public.seller_os_golden_owner_product_truth_v1 for insert to service_role
  with check (true);

notify pgrst, 'reload schema';
