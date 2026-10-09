-- Certification boundary for the owner-authorized Sunshine eBay order.
-- Historical 1..4 batches remain immutable, while every new Control/RPC
-- authorization is capped at two listings and bound to the explicit order.

create table if not exists public.seller_os_ebay_official_read_failure_receipts_v1 (
  receipt_id uuid primary key,
  account_key text not null,
  recovery_run_id uuid not null,
  error_code text not null check (error_code ~ '^[A-Z0-9_]{3,160}$'),
  observed_at timestamptz not null,
  operation text not null,
  http_status integer null check (http_status between 100 and 599),
  evidence jsonb not null,
  evidence_digest text not null unique
    check (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (evidence->>'contractVersion' =
    'SELLER_OS_EBAY_OFFICIAL_READ_FAILURE_RECEIPT_V1'),
  check (evidence->>'source' = 'ORIGINAL_PROVIDER_RESPONSE_REDACTED'),
  check (evidence->>'rawXmlStored' = 'false'),
  check (evidence->>'credentialsIncluded' = 'false')
);

alter table public.seller_os_ebay_official_read_failure_receipts_v1
  enable row level security;
alter table public.seller_os_ebay_official_read_failure_receipts_v1
  force row level security;

revoke all on public.seller_os_ebay_official_read_failure_receipts_v1
  from public, anon, authenticated;
grant select, insert on
  public.seller_os_ebay_official_read_failure_receipts_v1 to service_role;

create index if not exists
  seller_os_ebay_official_failure_account_observed_idx on
  public.seller_os_ebay_official_read_failure_receipts_v1(
    account_key, observed_at desc);

comment on table
  public.seller_os_ebay_official_read_failure_receipts_v1 is
  'Append-only service-role receipts for bounded redacted original eBay Trading failure metadata. Raw XML, credentials and PII are never stored.';

create or replace function public.start_fast_luna_test_batch_v1(
  p_account_key text,
  p_owner_user_id uuid,
  p_command_client_id text,
  p_target_published_count integer,
  p_baseline_active_count bigint,
  p_idempotency_key text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.seller_os_autonomous_stocking_batches_v1%rowtype;
  v_expected_confirmation text;
begin
  v_expected_confirmation := format(
    'PUBLICAR %s LISTINGS DE LUNA', p_target_published_count);
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null
      or p_owner_user_id is null
      or coalesce(p_command_client_id, '') !~ '^[A-Za-z0-9._:-]{1,200}$'
      or p_target_published_count not between 1 and 2
      or p_baseline_active_count < 0
      or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9._:-]{8,160}$'
      or p_confirmation is distinct from v_expected_confirmation then
    raise exception 'FAST_LUNA_TEST_BATCH_START_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-stocking-batch:' || trim(p_account_key), 0));

  select * into v_batch
  from public.seller_os_autonomous_stocking_batches_v1
  where account_key = trim(p_account_key)
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_batch.authorization_mode <> 'OWNER_FAST_LUNA_TEST_BATCH_V1'
        or v_batch.owner_user_id <> p_owner_user_id
        or v_batch.command_client_id <> p_command_client_id
        or v_batch.target_published_count <> p_target_published_count
        or v_batch.baseline_active_count <> p_baseline_active_count
        or v_batch.evidence->>'authorizationReference' <>
          'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2' then
      raise exception 'FAST_LUNA_TEST_BATCH_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_batch);
  end if;

  if exists (
    select 1 from public.seller_os_autonomous_stocking_batches_v1
    where evidence->>'authorizationReference' =
      'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2'
  ) then
    raise exception 'SUNSHINE_EBAY_PUBLISHER_AUTHORIZATION_ALREADY_CONSUMED';
  end if;

  if exists (
    select 1 from public.seller_os_autonomous_stocking_batches_v1
    where account_key = trim(p_account_key) and status = 'ACTIVE'
  ) then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_ALREADY_ACTIVE';
  end if;

  insert into public.seller_os_autonomous_stocking_batches_v1 (
    account_key, owner_user_id, command_client_id, authorization_mode,
    idempotency_key, target_published_count, baseline_active_count, evidence
  ) values (
    trim(p_account_key), p_owner_user_id, p_command_client_id,
    'OWNER_FAST_LUNA_TEST_BATCH_V1', p_idempotency_key,
    p_target_published_count, p_baseline_active_count,
    jsonb_build_object(
      'authorizationMode', 'OWNER_FAST_LUNA_TEST_BATCH_V1',
      'authorizationReference',
        'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2',
      'authorizedMaximumCount', 2,
      'ownerUserId', p_owner_user_id,
      'commandClientId', p_command_client_id,
      'selectionMode', 'LUNA_CATALOG_CONTROLLED_TEST',
      'marketLookupPerformed', false,
      'marketDemandGateRequired', false,
      'exactProductDemandClaimed', false,
      'unknownCostEqualsZero', false,
      'completeTraceableCostsRequired', true,
      'canonicalEconomicsPolicyRequired', true,
      'economicPolicyVersion', 'SELLER_OS_ROI_MARGIN_POLICY_V2',
      'minimumEstimatedRoiPercent', 30,
      'minimumContributionMarginPercent', 15,
      'minimumMonetaryProfitUsd', null,
      'manualProductSelection', false,
      'manualProductIdInjection', false,
      'codexRuntimeDependency', false,
      'ownerRoutineApprovalRequired', false,
      'ownerActionRequired', false,
      'legacyDependencyCount', 0,
      'concurrency', 1,
      'adsWriteCount', 0,
      'confirmation', p_confirmation)
  ) returning * into v_batch;

  return to_jsonb(v_batch);
end;
$$;

revoke all on function public.start_fast_luna_test_batch_v1(
  text,uuid,text,integer,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.start_fast_luna_test_batch_v1(
  text,uuid,text,integer,bigint,text,text) to service_role;

comment on function public.start_fast_luna_test_batch_v1(
  text,uuid,text,integer,bigint,text,text) is
  'Starts or replays one owner-bound batch of at most two new Luna listings for SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2; all CURRENT gates remain fail-closed.';

create or replace function public.start_universal_luna_direct_batch_v1(
  p_account_key text,
  p_owner_user_id uuid,
  p_command_client_id text,
  p_target_published_count integer,
  p_baseline_active_count bigint,
  p_idempotency_key text,
  p_confirmation text,
  p_requested_luna_products jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.seller_os_autonomous_stocking_batches_v1%rowtype;
  v_expected_confirmation text;
  v_product jsonb;
  v_identity_count integer;
begin
  v_expected_confirmation := format(
    'PUBLICAR %s LISTINGS DE LUNA', p_target_published_count);
  if not public.is_seller_os_service_role_request_v1()
      or nullif(trim(coalesce(p_account_key, '')), '') is null
      or p_owner_user_id is null
      or coalesce(p_command_client_id, '') !~ '^[A-Za-z0-9._:-]{1,200}$'
      or p_target_published_count not between 1 and 2
      or p_baseline_active_count < 0
      or coalesce(p_idempotency_key, '') !~ '^[A-Za-z0-9._:-]{8,160}$'
      or p_confirmation is distinct from v_expected_confirmation
      or jsonb_typeof(p_requested_luna_products) <> 'array'
      or jsonb_array_length(p_requested_luna_products)
        <> p_target_published_count then
    raise exception 'UNIVERSAL_LUNA_DIRECT_START_INVALID';
  end if;

  for v_product in select value
    from jsonb_array_elements(p_requested_luna_products)
  loop
    if jsonb_typeof(v_product) <> 'object'
        or nullif(trim(coalesce(v_product->>'requestReference', '')), '') is null
        or length(v_product->>'requestReference') > 500
        or nullif(trim(coalesce(v_product->>'productId', '')), '') is null
        or length(v_product->>'productId') > 160
        or nullif(trim(coalesce(v_product->>'variantId', '')), '') is null
        or length(v_product->>'variantId') > 160
        or nullif(trim(coalesce(v_product->>'supplierSku', '')), '') is null
        or length(v_product->>'supplierSku') > 160
        or (v_product ? 'sourceUrl'
          and v_product->>'sourceUrl' is not null
          and length(v_product->>'sourceUrl') > 500) then
      raise exception 'UNIVERSAL_LUNA_DIRECT_PRODUCT_INVALID';
    end if;
  end loop;

  select count(distinct concat_ws(E'\n', value->>'productId',
    value->>'variantId', value->>'supplierSku')) into v_identity_count
  from jsonb_array_elements(p_requested_luna_products);
  if v_identity_count <> p_target_published_count then
    raise exception 'UNIVERSAL_LUNA_DIRECT_PRODUCT_DUPLICATE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'autonomous-stocking-batch:' || trim(p_account_key), 0));

  select * into v_batch
  from public.seller_os_autonomous_stocking_batches_v1
  where account_key = trim(p_account_key)
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_batch.authorization_mode <> 'OWNER_FAST_LUNA_TEST_BATCH_V1'
        or v_batch.owner_user_id <> p_owner_user_id
        or v_batch.command_client_id <> p_command_client_id
        or v_batch.target_published_count <> p_target_published_count
        or v_batch.baseline_active_count <> p_baseline_active_count
        or v_batch.requested_luna_products
          is distinct from p_requested_luna_products
        or v_batch.evidence->>'authorizationReference' <>
          'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2' then
      raise exception 'UNIVERSAL_LUNA_DIRECT_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_batch);
  end if;

  if exists (
    select 1 from public.seller_os_autonomous_stocking_batches_v1
    where evidence->>'authorizationReference' =
      'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2'
  ) then
    raise exception 'SUNSHINE_EBAY_PUBLISHER_AUTHORIZATION_ALREADY_CONSUMED';
  end if;

  if exists (
    select 1 from public.seller_os_autonomous_stocking_batches_v1
    where account_key = trim(p_account_key) and status = 'ACTIVE'
  ) then
    raise exception 'AUTONOMOUS_STOCKING_BATCH_ALREADY_ACTIVE';
  end if;

  insert into public.seller_os_autonomous_stocking_batches_v1 (
    account_key, owner_user_id, command_client_id, authorization_mode,
    idempotency_key, target_published_count, baseline_active_count,
    requested_luna_products, evidence
  ) values (
    trim(p_account_key), p_owner_user_id, p_command_client_id,
    'OWNER_FAST_LUNA_TEST_BATCH_V1', p_idempotency_key,
    p_target_published_count, p_baseline_active_count,
    p_requested_luna_products,
    jsonb_build_object(
      'contractVersion', 'UNIVERSAL_LUNA_DIRECT_PUBLISHER_V1',
      'authorizationMode', 'OWNER_FAST_LUNA_TEST_BATCH_V1',
      'authorizationReference',
        'SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2',
      'authorizedMaximumCount', 2,
      'ownerUserId', p_owner_user_id,
      'commandClientId', p_command_client_id,
      'selectionMode', 'LUNA_CATALOG_DIRECT_OWNER_SELECTION',
      'requestedProductCount', p_target_published_count,
      'serverResolvedCanonicalIdentities', true,
      'marketLookupPerformed', false,
      'marketDemandGateRequired', false,
      'exactProductDemandClaimed', false,
      'unknownCostEqualsZero', false,
      'completeTraceableCostsRequired', true,
      'canonicalEconomicsPolicyRequired', true,
      'economicPolicyVersion', 'SELLER_OS_ROI_MARGIN_POLICY_V2',
      'minimumEstimatedRoiPercent', 30,
      'minimumContributionMarginPercent', 15,
      'minimumMonetaryProfitUsd', null,
      'ownerSelectedExactProducts', true,
      'manualProductIdInjection', false,
      'untrustedProductIdInjection', false,
      'codexRuntimeDependency', false,
      'ownerRoutineApprovalRequired', false,
      'ownerActionRequired', false,
      'legacyDependencyCount', 0,
      'concurrency', 1,
      'adsWriteCount', 0,
      'confirmation', p_confirmation)
  ) returning * into v_batch;

  return to_jsonb(v_batch);
end;
$$;

revoke all on function public.start_universal_luna_direct_batch_v1(
  text,uuid,text,integer,bigint,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.start_universal_luna_direct_batch_v1(
  text,uuid,text,integer,bigint,text,text,jsonb) to service_role;

comment on function public.start_universal_luna_direct_batch_v1(
  text,uuid,text,integer,bigint,text,text,jsonb) is
  'Starts or idempotently replays at most two exact Luna products for SUNSHINE_EBAY_CONTROL_PARITY_AND_PUBLISHER_CERTIFICATION_V2; no existing listing mutation, END or supplier purchase is authorized.';

notify pgrst, 'reload schema';
