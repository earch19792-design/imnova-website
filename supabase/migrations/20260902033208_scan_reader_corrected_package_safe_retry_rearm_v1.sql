-- Preserve a rejected publish attempt as immutable history while allowing one
-- corrected package digest to reuse the same exact Inventory SKU and
-- UNPUBLISHED Offer. This migration performs no eBay operation and introduces
-- no table, scheduler, or lifecycle state.

drop index if exists public.ebay_authorized_publication_offer_uidx;
create unique index ebay_authorized_publication_offer_uidx
  on public.ebay_authorized_listing_publications(
    target,
    account_fingerprint,
    offer_id
  )
  where phase <> 'terminal_failure';

comment on index public.ebay_authorized_publication_offer_uidx is
  'At most one current publication lifecycle per exact Offer. Terminal failures remain immutable audit history and do not block a corrected successor package.';

create or replace function public.claim_ebay_corrected_package_retry_execution_v1(
  p_approval_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_sku text,
  p_claim_token uuid,
  p_target text,
  p_account_fingerprint text,
  p_prior_publication_id uuid,
  p_offer_id text,
  p_expected_upc text
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_existing public.ebay_draft_only_execution_ledger%rowtype;
  v_prior_publication public.ebay_authorized_listing_publications%rowtype;
  v_prior_execution public.ebay_draft_only_execution_ledger%rowtype;
  v_prior_approval public.ebay_draft_only_approvals%rowtype;
  v_error jsonb;
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
begin
  if p_actor_user_id is null
    or p_approval_id is null
    or p_prior_publication_id is null
    or p_claim_token is null
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$'
    or p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_sku is null
    or p_sku !~ '^IMNOVA[A-Z0-9]{16,32}$'
    or p_target is null
    or upper(trim(coalesce(p_target, ''))) <> 'PRODUCTION'
    or p_account_fingerprint is null
    or lower(trim(coalesce(p_account_fingerprint, ''))) !~ '^[0-9a-f]{64}$'
    or p_offer_id is null
    or p_offer_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_expected_upc is null
    or p_expected_upc !~ '^[0-9]{12}$' then
    raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_INPUT_INVALID';
  end if;

  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = p_approval_id
  for update;
  if not found
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_approval.status <> 'approved'
    or v_approval.consumed_at is not null
    or v_approval.revoked_at is not null
    or v_approval.expires_at <= v_now
    or v_approval.payload_hash is distinct from p_request_hash
    or v_approval.target <> 'PRODUCTION'
    or v_approval.account_fingerprint is distinct from
      lower(trim(p_account_fingerprint))
    or v_approval.approved_payload->>'sku' is distinct from p_sku
    or v_approval.approved_payload#>>'{offerPayload,sku}' is distinct from p_sku
    or v_approval.approved_payload#>>'{offerPayload,categoryId}'
      is distinct from '94861'
    or v_approval.approved_payload#>'{inventoryItemPayload,product,upc}'
      is distinct from jsonb_build_array(p_expected_upc) then
    raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_APPROVAL_INVALID';
  end if;

  select * into v_existing
  from public.ebay_draft_only_execution_ledger
  where approval_id = p_approval_id
  for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.idempotency_key is distinct from p_idempotency_key
      or v_existing.request_hash is distinct from p_request_hash
      or v_existing.listing_package_id is distinct from
        v_approval.listing_package_id
      or v_existing.opportunity_id is distinct from v_approval.opportunity_id
      or v_existing.target <> 'PRODUCTION'
      or v_existing.account_fingerprint is distinct from
        lower(trim(p_account_fingerprint))
      or v_existing.sku is distinct from p_sku
      or v_existing.offer_id is distinct from p_offer_id
      or v_existing.permitted_operations is distinct from
        array['createOrReplaceInventoryItem']::text[]
      or v_existing.sanitized_result->>'correctedPackageSafeRetryVersion'
        is distinct from 'EBAY_CORRECTED_PACKAGE_SAFE_RETRY_V1'
      or v_existing.sanitized_result->>'priorPublicationId'
        is distinct from p_prior_publication_id::text then
      raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_IDEMPOTENCY_MISMATCH';
    end if;
    if v_existing.phase = 'completed' then
      return next v_existing;
      return;
    end if;
    if v_existing.phase not in (
      'claimed', 'inventory_confirmed', 'retryable_inventory_failure'
    ) then
      raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_NOT_CLAIMABLE';
    end if;
    if v_existing.lease_expires_at is not null
      and v_existing.lease_expires_at > v_now then
      raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_BUSY';
    end if;
    update public.ebay_draft_only_execution_ledger
    set lease_token = p_claim_token,
        lease_expires_at = v_now + interval '5 minutes',
        attempt_count = attempt_count + 1,
        updated_at = v_now
    where id = v_existing.id
    returning * into v_existing;
    return next v_existing;
    return;
  end if;

  select * into v_prior_publication
  from public.ebay_authorized_listing_publications
  where id = p_prior_publication_id
  for update;
  if not found then
    raise exception 'EBAY_CORRECTED_PACKAGE_PRIOR_PUBLICATION_NOT_FOUND';
  end if;

  select * into v_prior_execution
  from public.ebay_draft_only_execution_ledger
  where id = v_prior_publication.draft_execution_id
  for update;
  select * into v_prior_approval
  from public.ebay_draft_only_approvals
  where id = v_prior_publication.draft_approval_id
  for key share;
  v_error := v_prior_publication.sanitized_result
    #> '{details,errors,0}';

  if v_prior_execution.id is null
    or v_prior_approval.id is null
    or v_prior_publication.actor_user_id is distinct from p_actor_user_id
    or v_prior_execution.actor_user_id is distinct from p_actor_user_id
    or v_prior_approval.actor_user_id is distinct from p_actor_user_id
    or v_prior_approval.approved_payload#>>'{offerPayload,categoryId}'
      is distinct from '94861'
    or v_prior_publication.listing_package_id is distinct from
      v_approval.listing_package_id
    or v_prior_publication.opportunity_id is distinct from
      v_approval.opportunity_id
    or v_prior_execution.listing_package_id is distinct from
      v_approval.listing_package_id
    or v_prior_execution.opportunity_id is distinct from
      v_approval.opportunity_id
    or v_prior_execution.phase <> 'completed'
    or v_prior_publication.phase <> 'terminal_failure'
    or v_prior_publication.publish_http_status <> 400
    or v_prior_publication.publish_attempt_count <> 1
    or v_prior_publication.last_error_code <> 'EBAY_PUBLISH_WRITE_REJECTED'
    or v_prior_publication.listing_id is not null
    or v_prior_publication.offer_id is distinct from p_offer_id
    or v_prior_execution.offer_id is distinct from p_offer_id
    or v_prior_publication.sku is distinct from p_sku
    or v_prior_execution.sku is distinct from p_sku
    or v_prior_publication.target <> 'PRODUCTION'
    or v_prior_execution.target <> 'PRODUCTION'
    or v_prior_publication.account_fingerprint is distinct from
      lower(trim(p_account_fingerprint))
    or v_prior_execution.account_fingerprint is distinct from
      lower(trim(p_account_fingerprint))
    or v_error->>'errorId' <> '25002'
    or v_error->>'domain' <> 'API_INVENTORY'
    or v_error->>'category' <> 'Request'
    or (case
      when v_prior_approval.approved_payload
        #> '{inventoryItemPayload,product,upc}' is null then false
      when jsonb_typeof(
        v_prior_approval.approved_payload
          #> '{inventoryItemPayload,product,upc}'
      ) <> 'array' then true
      else jsonb_array_length(
        v_prior_approval.approved_payload
          #> '{inventoryItemPayload,product,upc}'
      ) <> 0
    end) then
    raise exception 'EBAY_CORRECTED_PACKAGE_PRIOR_UPC_FAILURE_NOT_PROVEN';
  end if;

  if v_prior_approval.payload_hash = v_approval.payload_hash then
    raise exception 'EBAY_CORRECTED_PACKAGE_DIGEST_NOT_CHANGED';
  end if;
  if exists (
    select 1
    from public.ebay_authorized_listing_publications publication
    where publication.target = 'PRODUCTION'
      and publication.account_fingerprint =
        lower(trim(p_account_fingerprint))
      and publication.offer_id = p_offer_id
      and publication.id <> p_prior_publication_id
      and publication.phase <> 'terminal_failure'
  ) then
    raise exception 'EBAY_CORRECTED_PACKAGE_CURRENT_OFFER_LIFECYCLE_EXISTS';
  end if;

  update public.ebay_draft_only_execution_ledger
  set phase = 'terminal_failure',
      last_error_code =
        'EBAY_DRAFT_ONLY_SUPERSEDED_BY_CORRECTED_PACKAGE',
      sanitized_result = coalesce(sanitized_result, '{}'::jsonb)
        || jsonb_build_object(
          'historicalAttemptStatus', 'FAILED_RESOLVED',
          'historicalAttemptReason',
            'CATEGORY_94861_REQUIRED_UPC_MISSING',
          'successorApprovalId', p_approval_id,
          'successorRequestHash', p_request_hash,
          'resolvedAt', v_now
        ),
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where id = v_prior_execution.id
    and phase = 'completed';
  if not found then
    raise exception 'EBAY_CORRECTED_PACKAGE_PRIOR_EXECUTION_RELEASE_FAILED';
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
    lease_token,
    lease_expires_at,
    offer_id,
    permitted_operations,
    sanitized_result
  ) values (
    p_approval_id,
    p_actor_user_id,
    v_approval.listing_package_id,
    v_approval.opportunity_id,
    p_idempotency_key,
    p_request_hash,
    'PRODUCTION',
    lower(trim(p_account_fingerprint)),
    p_sku,
    'claimed',
    p_claim_token,
    v_now + interval '5 minutes',
    p_offer_id,
    array['createOrReplaceInventoryItem']::text[],
    jsonb_build_object(
      'correctedPackageSafeRetryVersion',
        'EBAY_CORRECTED_PACKAGE_SAFE_RETRY_V1',
      'priorPublicationId', p_prior_publication_id,
      'priorExecutionId', v_prior_execution.id,
      'priorApprovalId', v_prior_approval.id,
      'reusesExistingOffer', true,
      'expectedUpc', p_expected_upc,
      'marketplaceWritesAtClaim', 0
    )
  )
  returning * into v_ledger;

  return next v_ledger;
end;
$$;

create or replace function public.complete_ebay_corrected_package_retry_execution_v1(
  p_ledger_id uuid,
  p_actor_user_id uuid,
  p_offer_id text,
  p_offer_http_status integer,
  p_verified_status text,
  p_listing_present boolean,
  p_verified_sku text,
  p_verified_marketplace_id text,
  p_target text,
  p_account_fingerprint text,
  p_claim_token uuid,
  p_expected_upc text
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
begin
  select * into v_ledger
  from public.ebay_draft_only_execution_ledger
  where id = p_ledger_id
  for update;
  if not found then
    raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_LEDGER_NOT_FOUND';
  end if;
  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_ledger.approval_id
  for update;

  if v_approval.id is null
    or v_ledger.actor_user_id is distinct from p_actor_user_id
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_ledger.phase <> 'inventory_confirmed'
    or p_claim_token is null
    or v_ledger.lease_token is distinct from p_claim_token
    or v_ledger.lease_expires_at is null
    or v_ledger.lease_expires_at <= v_now
    or v_ledger.request_hash is distinct from v_approval.payload_hash
    or v_ledger.listing_package_id is distinct from
      v_approval.listing_package_id
    or v_ledger.opportunity_id is distinct from v_approval.opportunity_id
    or v_ledger.permitted_operations is distinct from
      array['createOrReplaceInventoryItem']::text[]
    or v_ledger.sanitized_result->>'correctedPackageSafeRetryVersion'
      is distinct from 'EBAY_CORRECTED_PACKAGE_SAFE_RETRY_V1'
    or v_ledger.offer_id is distinct from p_offer_id
    or v_ledger.sku is distinct from p_verified_sku
    or v_ledger.target is distinct from upper(trim(coalesce(p_target, '')))
    or v_ledger.account_fingerprint is distinct from
      lower(trim(coalesce(p_account_fingerprint, '')))
    or v_approval.target is distinct from
      upper(trim(coalesce(p_target, '')))
    or v_approval.account_fingerprint is distinct from
      lower(trim(coalesce(p_account_fingerprint, '')))
    or v_approval.approved_payload#>'{inventoryItemPayload,product,upc}'
      is distinct from jsonb_build_array(p_expected_upc)
    or p_offer_http_status <> 200
    or upper(trim(coalesce(p_verified_status, ''))) <> 'UNPUBLISHED'
    or p_listing_present is distinct from false
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) <> 'EBAY_US'
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) is distinct from
      upper(coalesce(
        v_approval.approved_payload#>>'{offerPayload,marketplaceId}',
        ''
      )) then
    raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_NOT_COMPLETABLE';
  end if;

  update public.ebay_draft_only_execution_ledger
  set phase = 'completed',
      offer_http_status = p_offer_http_status,
      completed_at = v_now,
      last_error_code = null,
      sanitized_result = coalesce(sanitized_result, '{}'::jsonb)
        || jsonb_build_object(
          'status', 'UNPUBLISHED',
          'verified', true,
          'correctedInventoryReadbackMatch', true,
          'existingOfferReadbackMatch', true,
          'upc', p_expected_upc,
          'createOfferCalled', false,
          'verifiedAt', v_now
        ),
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where id = p_ledger_id
  returning * into v_ledger;

  update public.ebay_draft_only_approvals
  set status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
  where id = v_ledger.approval_id
    and status = 'approved'
    and consumed_at is null
    and revoked_at is null;
  if not found then
    raise exception 'EBAY_CORRECTED_PACKAGE_RETRY_APPROVAL_CONSUME_FAILED';
  end if;

  return next v_ledger;
end;
$$;

revoke all on function public.claim_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, text, text, uuid, text, text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.complete_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, integer, text, boolean, text, text, text, text,
  uuid, text
) from public, anon, authenticated;

grant execute on function public.claim_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, text, text, uuid, text, text, uuid, text, text
) to service_role;
grant execute on function public.complete_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, integer, text, boolean, text, text, text, text,
  uuid, text
) to service_role;

comment on function public.claim_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, text, text, uuid, text, text, uuid, text, text
) is
  'Claims one corrected-package successor after the exact historical eBay UPC 25002 failure, preserving the failed publication and reusing its exact Offer.';
comment on function public.complete_ebay_corrected_package_retry_execution_v1(
  uuid, uuid, text, integer, text, boolean, text, text, text, text,
  uuid, text
) is
  'Completes the corrected Inventory Item readback against the same exact UNPUBLISHED Offer without createOffer or publishOffer.';
