-- Seller OS unit-first policy support:
-- 1. OWNER may attest the exact included-unit count of one Luna base offer.
-- 2. The attestation stays separate from Supplier Truth and is immutable.
-- 3. Category evaluation uses it only for exact offer-count multiplication.
alter table public.seller_os_golden_owner_product_truth_v1
  drop constraint if exists seller_os_golden_owner_product_truth_v1_fact_class_check;
alter table public.seller_os_golden_owner_product_truth_v1
  add constraint seller_os_golden_owner_product_truth_v1_fact_class_check
  check (fact_class in (
    'VISIBLE_BRAND_MARKING',
    'OBSERVED_MARKING',
    'SUPPLIER_BASE_INCLUDED_UNIT_COUNT'
  ));

alter table public.seller_os_golden_owner_product_truth_v1
  drop constraint if exists seller_os_golden_owner_product_truth_v1_normalized_value_check;
alter table public.seller_os_golden_owner_product_truth_v1
  add constraint seller_os_golden_owner_product_truth_v1_normalized_value_check
  check (length(normalized_value) between 1 and 160);

alter table public.seller_os_golden_owner_product_truth_v1
  drop constraint if exists seller_os_golden_owner_product_truth_v1_payload_check;
alter table public.seller_os_golden_owner_product_truth_v1
  drop constraint if exists seller_os_golden_owner_product_truth_v1_check;
alter table public.seller_os_golden_owner_product_truth_v1
  add constraint seller_os_golden_owner_product_truth_v1_payload_check check (
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
    and payload->>'sourceMediaType' in ('IMAGE','VIDEO')
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
    and (
      fact_class <> 'SUPPLIER_BASE_INCLUDED_UNIT_COUNT'
      or normalized_value ~ '^([1-9]|[1-9][0-9]{1,2}|1000)$'
    )
    and (
      fact_class = 'SUPPLIER_BASE_INCLUDED_UNIT_COUNT'
      or length(normalized_value) between 2 and 160
    )
  );

comment on constraint seller_os_golden_owner_product_truth_v1_fact_class_check
  on public.seller_os_golden_owner_product_truth_v1 is
  'OWNER base included-unit count supports exact unit-first and market-evidenced pack math without modifying Supplier Truth.';

notify pgrst, 'reload schema';
