-- Reuse an already-created UNPUBLISHED Offer across distinct, exact owner
-- approvals without repeating either Inventory API write. Completed ledgers
-- remain immutable history and no longer monopolize the in-flight SKU slot.

drop index if exists public.ebay_draft_only_target_sku_uidx;
create unique index ebay_draft_only_target_sku_uidx
  on public.ebay_draft_only_execution_ledger(
    target,
    coalesce(account_fingerprint, 'LEGACY'),
    sku
  )
  where phase not in ('completed', 'terminal_failure');

create or replace function public.reconcile_ebay_cross_approval_unpublished_offer_v1(
  p_current_approval_id uuid,
  p_prior_execution_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_sku text,
  p_offer_id text,
  p_inventory_http_status integer,
  p_offer_http_status integer,
  p_offer_status text,
  p_official_readback_digest text,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_approval public.ebay_draft_only_approvals%rowtype;
  v_prior_approval public.ebay_draft_only_approvals%rowtype;
  v_prior_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_existing public.ebay_draft_only_execution_ledger%rowtype;
  v_created public.ebay_draft_only_execution_ledger%rowtype;
  v_now timestamptz := now();
begin
  if p_current_approval_id is null
    or p_prior_execution_id is null
    or p_actor_user_id is null
    or p_idempotency_key is null
    or length(trim(p_idempotency_key)) < 8
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_sku !~ '^IMNOVA[A-Z0-9]{16,32}$'
    or p_offer_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or upper(trim(coalesce(p_offer_status, ''))) <> 'UNPUBLISHED'
    or p_inventory_http_status <> 200
    or p_offer_http_status <> 200
    or p_official_readback_digest !~ '^sha256:[0-9a-f]{64}$'
    or upper(trim(coalesce(p_target, ''))) <> 'PRODUCTION'
    or lower(trim(coalesce(p_account_fingerprint, ''))) !~ '^[0-9a-f]{64}$' then
    raise exception 'CROSS_APPROVAL_RESUME_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', upper(trim(p_target)),
      lower(trim(p_account_fingerprint)), p_sku),
    0
  ));

  select * into v_current_approval
  from public.ebay_draft_only_approvals
  where id = p_current_approval_id
  for update;
  select * into v_prior_execution
  from public.ebay_draft_only_execution_ledger
  where id = p_prior_execution_id
  for update;
  if v_prior_execution.id is not null then
    select * into v_prior_approval
    from public.ebay_draft_only_approvals
    where id = v_prior_execution.approval_id
    for update;
  end if;

  select * into v_existing
  from public.ebay_draft_only_execution_ledger
  where approval_id = p_current_approval_id
  for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.idempotency_key is distinct from p_idempotency_key
      or v_existing.request_hash is distinct from p_request_hash
      or v_existing.sku is distinct from p_sku
      or v_existing.target is distinct from 'PRODUCTION'
      or v_existing.account_fingerprint is distinct from
        lower(trim(p_account_fingerprint))
      or v_existing.phase is distinct from 'completed'
      or v_existing.offer_id is distinct from p_offer_id
      or v_existing.sanitized_result #>>
        '{crossApprovalSameLineageResumeV1,officialReadbackDigest}'
        is distinct from p_official_readback_digest then
      raise exception 'CROSS_APPROVAL_RESUME_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_existing;
    return;
  end if;

  if v_current_approval.id is null
    or v_current_approval.actor_user_id is distinct from p_actor_user_id
    or v_current_approval.status is distinct from 'approved'
    or v_current_approval.consumed_at is not null
    or v_current_approval.revoked_at is not null
    or v_current_approval.expires_at <= v_now
    or v_current_approval.payload_hash is distinct from p_request_hash
    or v_current_approval.target is distinct from 'PRODUCTION'
    or v_current_approval.account_fingerprint is distinct from
      lower(trim(p_account_fingerprint))
    or v_current_approval.approved_payload->>'sku' is distinct from p_sku
    or v_current_approval.approved_payload #>> '{offerPayload,sku}'
      is distinct from p_sku
    or v_current_approval.approved_payload #>> '{offerPayload,marketplaceId}'
      is distinct from 'EBAY_US' then
    raise exception 'CURRENT_OWNER_AUTHORIZATION_NOT_CLAIMABLE';
  end if;

  if v_prior_execution.id is null
    or v_prior_approval.id is null
    or v_prior_execution.approval_id is distinct from v_prior_approval.id
    or v_prior_execution.actor_user_id is distinct from p_actor_user_id
    or v_prior_execution.phase is distinct from 'completed'
    or v_prior_execution.offer_id is distinct from p_offer_id
    or v_prior_execution.request_hash is distinct from
      v_prior_approval.payload_hash
    or v_prior_approval.status is distinct from 'consumed'
    or v_prior_approval.consumed_at is null
    or v_prior_approval.revoked_at is not null
    or v_prior_approval.id = v_current_approval.id
    or v_prior_execution.listing_package_id is distinct from
      v_current_approval.listing_package_id
    or v_prior_execution.opportunity_id is distinct from
      v_current_approval.opportunity_id
    or v_prior_execution.target is distinct from v_current_approval.target
    or v_prior_execution.account_fingerprint is distinct from
      v_current_approval.account_fingerprint
    or v_prior_execution.sku is distinct from p_sku
    or v_prior_approval.candidate_key is distinct from
      v_current_approval.candidate_key
    or v_prior_approval.listing_package_id is distinct from
      v_current_approval.listing_package_id
    or v_prior_approval.opportunity_id is distinct from
      v_current_approval.opportunity_id
    or v_prior_approval.actor_user_id is distinct from p_actor_user_id
    or v_prior_approval.target is distinct from v_current_approval.target
    or v_prior_approval.account_fingerprint is distinct from
      v_current_approval.account_fingerprint
    or v_prior_approval.approved_payload->>'sku' is distinct from p_sku
    or v_prior_approval.approved_payload #>> '{offerPayload,sku}'
      is distinct from p_sku
    or v_prior_approval.approved_payload #>> '{offerPayload,marketplaceId}'
      is distinct from 'EBAY_US' then
    raise exception 'CROSS_APPROVAL_IDENTITY_MISMATCH';
  end if;

  if v_prior_approval.approved_payload->'inventoryItemPayload'
      is distinct from
      v_current_approval.approved_payload->'inventoryItemPayload'
    or v_prior_approval.approved_payload->'offerPayload'
      is distinct from
      v_current_approval.approved_payload->'offerPayload' then
    raise exception 'CROSS_APPROVAL_MARKETPLACE_PAYLOAD_CHANGED';
  end if;

  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger ledger
    join public.ebay_draft_only_approvals approval
      on approval.id = ledger.approval_id
    where ledger.target = 'PRODUCTION'
      and ledger.account_fingerprint = lower(trim(p_account_fingerprint))
      and ledger.sku = p_sku
      and ledger.phase not in ('completed', 'terminal_failure')
      and (
        approval.listing_package_id is distinct from
          v_current_approval.listing_package_id
        or approval.opportunity_id is distinct from
          v_current_approval.opportunity_id
        or approval.candidate_key is distinct from
          v_current_approval.candidate_key
      )
  ) then
    raise exception 'FOREIGN_SKU_COLLISION';
  end if;

  insert into public.ebay_draft_only_execution_ledger (
    approval_id,
    actor_user_id,
    listing_package_id,
    opportunity_id,
    idempotency_key,
    request_hash,
    target,
    account_fingerprint,
    sku,
    phase,
    attempt_count,
    inventory_http_status,
    inventory_confirmed_at,
    offer_http_status,
    offer_id,
    completed_at,
    last_error_code,
    sanitized_result,
    permitted_operations,
    created_at,
    updated_at
  ) values (
    v_current_approval.id,
    p_actor_user_id,
    v_current_approval.listing_package_id,
    v_current_approval.opportunity_id,
    p_idempotency_key,
    p_request_hash,
    'PRODUCTION',
    lower(trim(p_account_fingerprint)),
    p_sku,
    'completed',
    1,
    p_inventory_http_status,
    v_now,
    p_offer_http_status,
    p_offer_id,
    v_now,
    null,
    jsonb_build_object(
      'status', 'UNPUBLISHED',
      'verified', true,
      'crossApprovalSameLineageResumeV1', jsonb_build_object(
        'currentApprovalId', v_current_approval.id,
        'currentExecutionId', null,
        'priorApprovalId', v_prior_approval.id,
        'priorExecutionId', v_prior_execution.id,
        'existingOfferId', p_offer_id,
        'officialReadbackVerified', true,
        'officialReadbackDigest', p_official_readback_digest,
        'marketplacePayloadsEqual', true,
        'inventoryItemCreated', false,
        'offerCreated', false,
        'publishOfferCalled', false,
        'marketplaceWrites', 0,
        'reconciledAt', v_now
      )
    ),
    array[]::text[],
    v_now,
    v_now
  ) returning * into v_created;

  update public.ebay_draft_only_execution_ledger
  set sanitized_result = jsonb_set(
      sanitized_result,
      '{crossApprovalSameLineageResumeV1,currentExecutionId}',
      to_jsonb(v_created.id),
      true
    ),
    updated_at = v_now
  where id = v_created.id
  returning * into v_created;

  update public.ebay_draft_only_approvals
  set status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
  where id = v_current_approval.id
    and status = 'approved'
    and consumed_at is null
    and revoked_at is null;
  if not found then
    raise exception 'CURRENT_OWNER_AUTHORIZATION_CONSUME_FAILED';
  end if;

  return next v_created;
end;
$$;

revoke all on function public.reconcile_ebay_cross_approval_unpublished_offer_v1(
  uuid, uuid, uuid, text, text, text, text, integer, integer, text, text,
  text, text
) from public, anon, authenticated;
grant execute on function public.reconcile_ebay_cross_approval_unpublished_offer_v1(
  uuid, uuid, uuid, text, text, text, text, integer, integer, text, text,
  text, text
) to service_role;

comment on function public.reconcile_ebay_cross_approval_unpublished_offer_v1(
  uuid, uuid, uuid, text, text, text, text, integer, integer, text, text,
  text, text
) is
  'Consumes only the current exact owner approval and binds it to a fresh-read, materially identical existing UNPUBLISHED Offer; performs zero marketplace writes.';
