-- Owner-authorized 1..4 listing test batches reuse the existing autonomous
-- CURRENT publication lane. No candidate identity or market claim is accepted
-- from the caller; the service-role runtime selects fresh exact Luna Product
-- Truth and retains every existing publication safety gate.

alter table public.seller_os_autonomous_stocking_batches_v1
  add column if not exists owner_user_id uuid null
    references auth.users(id) on delete restrict,
  add column if not exists command_client_id text null,
  add column if not exists authorization_mode text not null
    default 'LEGACY_AUTONOMOUS';

-- The legacy queue originally forced unavailable commercial signals to zero.
-- Controlled tests have intentionally unqueried market facts, so preserve
-- UNKNOWN as null instead of manufacturing negative evidence.
alter table public.ebay_luna_opportunity_queue
  alter column opportunity_score drop not null,
  alter column demand_score drop not null,
  alter column economics_score drop not null,
  alter column competition_score drop not null,
  alter column active_comparables drop not null,
  alter column sellers_with_movement drop not null;

alter table public.seller_os_autonomous_stocking_batches_v1
  add constraint autonomous_stocking_batch_authorization_mode_check
  check (authorization_mode in (
    'LEGACY_AUTONOMOUS', 'OWNER_FAST_LUNA_TEST_BATCH_V1')) not valid;

alter table public.seller_os_autonomous_stocking_batches_v1
  add constraint autonomous_stocking_batch_owner_authority_check
  check (
    authorization_mode = 'LEGACY_AUTONOMOUS'
    or (
      authorization_mode = 'OWNER_FAST_LUNA_TEST_BATCH_V1'
      and owner_user_id is not null
      and command_client_id ~ '^[A-Za-z0-9._:-]{1,200}$'
      and target_published_count between 1 and 4
    )
  ) not valid;

alter table public.seller_os_autonomous_stocking_batches_v1
  validate constraint autonomous_stocking_batch_authorization_mode_check;
alter table public.seller_os_autonomous_stocking_batches_v1
  validate constraint autonomous_stocking_batch_owner_authority_check;

create index if not exists autonomous_stocking_batch_owner_started_idx on
  public.seller_os_autonomous_stocking_batches_v1(
    owner_user_id, account_key, started_at desc)
  where owner_user_id is not null;

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
      or p_target_published_count not between 1 and 4
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
        or v_batch.baseline_active_count <> p_baseline_active_count then
      raise exception 'FAST_LUNA_TEST_BATCH_IDEMPOTENCY_CONFLICT';
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
    idempotency_key, target_published_count, baseline_active_count, evidence
  ) values (
    trim(p_account_key), p_owner_user_id, p_command_client_id,
    'OWNER_FAST_LUNA_TEST_BATCH_V1', p_idempotency_key,
    p_target_published_count, p_baseline_active_count,
    jsonb_build_object(
      'authorizationMode', 'OWNER_FAST_LUNA_TEST_BATCH_V1',
      'ownerUserId', p_owner_user_id,
      'commandClientId', p_command_client_id,
      'selectionMode', 'LUNA_CATALOG_CONTROLLED_TEST',
      'marketLookupPerformed', false,
      'marketDemandGateRequired', false,
      'exactProductDemandClaimed', false,
      'unknownCostEqualsZero', false,
      'completeTraceableCostsRequired', true,
      'canonicalEconomicsPolicyRequired', true,
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
  text,uuid,text,integer,bigint,text,text)
  to service_role;

comment on function public.start_fast_luna_test_batch_v1(
  text,uuid,text,integer,bigint,text,text) is
  'Starts or replays one owner-bound 1..4 listing Luna controlled-test batch in the existing CURRENT publication lane; no eBay market evidence is queried or inferred.';

notify pgrst, 'reload schema';
