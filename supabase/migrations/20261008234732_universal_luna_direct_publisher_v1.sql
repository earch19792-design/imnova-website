-- Persist an owner-selected Luna product set on the existing CURRENT batch.
-- Product/variant identities are resolved from canonical Luna Product Truth by
-- the server before this service-role-only function is called. The worker then
-- revalidates stock, freshness and every existing publication gate.

alter table public.seller_os_autonomous_stocking_batches_v1
  add column if not exists requested_luna_products jsonb null;

alter table public.seller_os_autonomous_stocking_batches_v1
  add constraint autonomous_stocking_batch_requested_luna_products_check
  check (
    requested_luna_products is null
    or (
      jsonb_typeof(requested_luna_products) = 'array'
      and jsonb_array_length(requested_luna_products) between 1 and 4
      and target_published_count = jsonb_array_length(requested_luna_products)
      and authorization_mode = 'OWNER_FAST_LUNA_TEST_BATCH_V1'
    )
  ) not valid;

alter table public.seller_os_autonomous_stocking_batches_v1
  validate constraint autonomous_stocking_batch_requested_luna_products_check;

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
      or p_target_published_count not between 1 and 4
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
          is distinct from p_requested_luna_products then
      raise exception 'UNIVERSAL_LUNA_DIRECT_IDEMPOTENCY_CONFLICT';
    end if;
    return to_jsonb(v_batch);
  end if;

  if exists (
    select 1
    from public.seller_os_autonomous_stocking_batches_v1
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
  text,uuid,text,integer,bigint,text,text,jsonb)
  to service_role;

comment on column
  public.seller_os_autonomous_stocking_batches_v1.requested_luna_products is
  'Ordered canonical Luna product/variant/SKU identities resolved server-side for UNIVERSAL_LUNA_DIRECT_PUBLISHER_V1; null preserves automatic catalog selection.';

comment on function public.start_universal_luna_direct_batch_v1(
  text,uuid,text,integer,bigint,text,text,jsonb) is
  'Starts or idempotently replays one owner-bound exact Luna batch in the existing CURRENT publication lane. Service-role only; marketplace gates remain fail-closed.';

notify pgrst, 'reload schema';
