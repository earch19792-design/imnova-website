-- Governed supplier-to-market visual observations are candidate-bound evidence.
-- They may support CLOSE or expose a contradiction, but never authorize EXACT.
alter table public.seller_os_golden_path_receipts_v1
  drop constraint if exists seller_os_golden_path_receipts_v1_kind_check;
alter table public.seller_os_golden_path_receipts_v1
  add constraint seller_os_golden_path_receipts_v1_kind_check
  check (kind in (
    'OPPORTUNITIES','EVALUATION','MANUAL_INTAKE','PRODUCT_TRUTH_INTAKE',
    'VISUAL_COMPARISON_INTAKE','DRAFT','RECONCILIATION','MONITORING','SHIPPING'
  ));

create table public.seller_os_golden_visual_comparison_v1 (
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
  market_evidence_id text not null check (length(market_evidence_id) between 1 and 160),
  marketplace_source_role text not null
    check (marketplace_source_role in ('MARKETPLACE_SOLD_IMAGE','MARKETPLACE_ACTIVE_IMAGE')),
  supplier_source_digest text not null
    check (supplier_source_digest ~ '^sha256:[0-9a-f]{64}$'),
  marketplace_source_digest text not null
    check (marketplace_source_digest ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null
    check (outcome in ('SUPPORTS_CLOSE','CONTRADICTS','INCONCLUSIVE')),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 65536
    and payload->>'schemaVersion' = 'SELLER_OS_VISUAL_COMPARISON_EVIDENCE_V1'
    and payload->>'policyVersion' = 'SELLER_OS_VISUAL_CLOSE_ONLY_POLICY_V1'
    and payload->>'authorityClass' = 'OWNER_ATTESTED_VISUAL_COMPARISON'
    and payload->>'accountKey' = account_key
    and payload->>'ownerUserId' = owner_user_id::text
    and payload#>>'{candidate,productId}' = product_id
    and payload#>>'{candidate,variantId}' = variant_id
    and payload#>>'{candidate,supplierSku}' = supplier_sku
    and (payload#>>'{candidate,supplierQuantity}')::integer = supplier_quantity
    and payload->>'sourceFingerprint' = source_fingerprint
    and payload->>'marketEvidenceId' = market_evidence_id
    and payload->>'outcome' = outcome
    and payload#>>'{supplierObservation,sourceRole}' = 'SUPPLIER_IMAGE'
    and payload#>>'{marketplaceObservation,sourceRole}' = marketplace_source_role
    and payload#>>'{supplierObservation,sourceDigest}' = supplier_source_digest
    and payload#>>'{marketplaceObservation,sourceDigest}' = marketplace_source_digest
    and payload->>'canonicalUrl' ~ '^https://lunaportex[.]com/products/[A-Za-z0-9][A-Za-z0-9._~%+-]*$'
    and payload#>>'{supplierObservation,sourceLocator}' = payload->>'canonicalUrl'
    and payload->>'evidenceId' = evidence_id
    and payload->>'evidenceDigest' = evidence_id
    and payload->>'operatorAttested' = 'true'
    and payload->>'exactAuthority' = 'false'
    and payload->>'manufacturerBrandInferred' = 'false'
    and payload->>'offerDifferenceHidden' = 'false'
    and payload->>'supplierTruthModified' = 'false'
    and payload->>'marketplaceWrites' = '0'
    and payload->>'supplierPurchases' = '0'
    and payload->>'draftIsLive' = 'false'
  ),
  created_at timestamptz not null default now()
);

create index seller_os_golden_visual_comparison_candidate_v1
  on public.seller_os_golden_visual_comparison_v1(
    account_key, owner_user_id, product_id, variant_id, supplier_sku,
    supplier_quantity, source_fingerprint, market_evidence_id, created_at
  );

create trigger golden_visual_comparison_immutable
  before update or delete on public.seller_os_golden_visual_comparison_v1
  for each row execute function public.seller_os_golden_evidence_immutable_v1();

alter table public.seller_os_golden_visual_comparison_v1 enable row level security;
alter table public.seller_os_golden_visual_comparison_v1 force row level security;
revoke all on table public.seller_os_golden_visual_comparison_v1
  from public, anon, authenticated;
grant select, insert on table public.seller_os_golden_visual_comparison_v1
  to service_role;
create policy golden_visual_comparison_select_v1
  on public.seller_os_golden_visual_comparison_v1 for select to service_role
  using (true);
create policy golden_visual_comparison_insert_v1
  on public.seller_os_golden_visual_comparison_v1 for insert to service_role
  with check (true);

notify pgrst, 'reload schema';
