-- Allow the same unpublished-offer control plane to target a real eBay seller
-- account. Runtime defaults remain SANDBOX and publication remains impossible.
-- This migration performs no external eBay operation.

alter table public.ebay_draft_only_approvals
  drop constraint if exists ebay_draft_only_approvals_target_check;
alter table public.ebay_draft_only_approvals
  add constraint ebay_draft_only_approvals_target_check
  check (target in ('SANDBOX', 'PRODUCTION'));
alter table public.ebay_draft_only_approvals
  drop constraint if exists ebay_draft_only_approvals_ttl_check;
update public.ebay_draft_only_approvals
set expires_at = least(expires_at, approved_at + interval '15 minutes'),
    updated_at = now()
where expires_at > approved_at + interval '15 minutes';
alter table public.ebay_draft_only_approvals
  add constraint ebay_draft_only_approvals_ttl_check
  check (expires_at > approved_at and expires_at <= approved_at + interval '15 minutes');

alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_target_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_target_check
  check (target in ('SANDBOX', 'PRODUCTION'));

alter table public.ebay_draft_only_approvals
  add column if not exists account_fingerprint text null;
alter table public.ebay_draft_only_approvals
  drop constraint if exists ebay_draft_only_approvals_account_fingerprint_check;
alter table public.ebay_draft_only_approvals
  add constraint ebay_draft_only_approvals_account_fingerprint_check
  check (account_fingerprint is null or account_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.ebay_draft_only_execution_ledger
  add column if not exists account_fingerprint text null;
alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_account_fingerprint_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_account_fingerprint_check
  check (account_fingerprint is null or account_fingerprint ~ '^[0-9a-f]{64}$');
alter table public.ebay_draft_only_approvals
  drop constraint if exists ebay_draft_only_approvals_production_fingerprint_check;
alter table public.ebay_draft_only_approvals
  add constraint ebay_draft_only_approvals_production_fingerprint_check
  check (target <> 'PRODUCTION' or account_fingerprint is not null);
alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_production_fingerprint_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_production_fingerprint_check
  check (target <> 'PRODUCTION' or account_fingerprint is not null);

alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_phase_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_phase_check check (phase in (
    'claimed', 'inventory_confirmed', 'inventory_outcome_unknown',
    'offer_create_in_flight', 'completed', 'retryable_inventory_failure',
    'terminal_failure', 'offer_outcome_unknown'
  ));
alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_lease_pair_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_lease_pair_check
  check ((lease_token is null) = (lease_expires_at is null));
alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_attempt_count_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_attempt_count_check
  check (attempt_count >= 1);
alter table public.ebay_draft_only_execution_ledger
  drop constraint if exists ebay_draft_only_ledger_completed_shape_check;
alter table public.ebay_draft_only_execution_ledger
  add constraint ebay_draft_only_ledger_completed_shape_check
  check (phase <> 'completed' or (offer_id is not null and completed_at is not null));

do $$
begin
  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger
    where account_fingerprint is null
      and phase not in ('completed', 'terminal_failure')
  ) then
    raise exception 'DRAFT_ONLY_LEGACY_LEDGER_RECONCILIATION_REQUIRED';
  end if;
end;
$$;

drop index if exists public.ebay_draft_only_one_active_approval_uidx;
create unique index ebay_draft_only_one_active_approval_uidx
  on public.ebay_draft_only_approvals(listing_package_id)
  where status = 'approved';
create index if not exists ebay_draft_only_approval_lookup_idx
  on public.ebay_draft_only_approvals(
    listing_package_id,
    actor_user_id,
    target,
    account_fingerprint,
    created_at desc
  );

drop index if exists public.ebay_draft_only_target_sku_uidx;
create unique index ebay_draft_only_target_sku_uidx
  on public.ebay_draft_only_execution_ledger(
    target,
    coalesce(account_fingerprint, 'LEGACY'),
    sku
  ) where phase not in ('terminal_failure');

drop function if exists public.approve_ebay_draft_only_package(uuid, uuid, text, uuid, text, jsonb, text, timestamptz);
drop function if exists public.claim_ebay_draft_only_execution(uuid, uuid, text, text, text, uuid);
drop function if exists public.complete_ebay_draft_only_execution(uuid, uuid, text, integer);
drop function if exists public.complete_ebay_draft_only_execution(uuid, uuid, text, integer, text, boolean, text, text, text, text);

create or replace function public.approve_ebay_draft_only_package(
  p_listing_package_id uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_actor_user_id uuid,
  p_payload_hash text,
  p_approved_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_draft_only_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.ebay_listing_packages%rowtype;
  v_existing public.ebay_draft_only_approvals%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_target text := upper(trim(coalesce(p_target, '')));
  v_account_fingerprint text := lower(trim(coalesce(p_account_fingerprint, '')));
  v_operations jsonb := coalesce(p_approved_payload #> '{safety,permittedOperations}', '[]'::jsonb);
begin
  if v_target not in ('SANDBOX', 'PRODUCTION')
    or v_account_fingerprint !~ '^[0-9a-f]{64}$'
    or p_payload_hash is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or upper(coalesce(p_approved_payload #>> '{safety,target}', '')) <> v_target
    or lower(coalesce(p_approved_payload #>> '{safety,accountFingerprint}', '')) <> v_account_fingerprint
    or p_approved_payload #>> '{safety,unpublishedOnly}' is distinct from 'true'
    or p_approved_payload #>> '{safety,publishOfferPresent}' is distinct from 'false'
    or jsonb_typeof(v_operations) <> 'array'
    or v_operations <> '["createOrReplaceInventoryItem", "createOffer"]'::jsonb
    or p_approved_payload #>> '{listingPackage,id}' is distinct from p_listing_package_id::text
    or p_approved_payload #>> '{listingPackage,candidateKey}' is distinct from p_candidate_key
    or p_approved_payload #>> '{sourceEvidence,opportunityId}' is distinct from p_opportunity_id::text
    or p_approved_payload #>> '{sourceEvidence,candidateKey}' is distinct from p_candidate_key
    or p_approved_payload #>> '{sku}' is distinct from p_approved_payload #>> '{offerPayload,sku}'
    or coalesce(p_approved_payload #>> '{sku}', '') !~ '^IMNOVA-[A-Z0-9]{16,32}$'
    or p_approved_payload #>> '{offerPayload,marketplaceId}' is distinct from 'EBAY_US'
    or p_approved_payload #>> '{offerPayload,format}' is distinct from 'FIXED_PRICE'
    or coalesce(p_approved_payload #>> '{compliance,ebayPreflightSnapshot}', '') !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    or (
      v_target = 'PRODUCTION'
      and (
        p_approved_payload #>> '{inventoryItemPayload,availability,shipToLocationAvailability,quantity}' is distinct from '1'
        or p_approved_payload #>> '{offerPayload,availableQuantity}' is distinct from '1'
      )
    ) then
    raise exception 'DRAFT_ONLY_PAYLOAD_SAFETY_INVALID';
  end if;

  select * into v_package
  from public.ebay_listing_packages
  where id = p_listing_package_id
  for update;
  if not found
    or v_package.created_by is distinct from p_actor_user_id
    or v_package.opportunity_id is distinct from p_opportunity_id
    or v_package.candidate_key is distinct from p_candidate_key
    or v_package.status not in ('draft', 'ready_for_review', 'approved') then
    raise exception 'DRAFT_ONLY_PACKAGE_NOT_APPROVABLE';
  end if;

  select * into v_existing
  from public.ebay_draft_only_approvals
  where approval_idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.listing_package_id is distinct from p_listing_package_id
      or v_existing.payload_hash is distinct from p_payload_hash
      or v_existing.target is distinct from v_target
      or v_existing.account_fingerprint is distinct from v_account_fingerprint then
      raise exception 'DRAFT_ONLY_APPROVAL_IDEMPOTENCY_MISMATCH';
    end if;
    return next v_existing;
    return;
  end if;

  update public.ebay_draft_only_approvals
  set status = 'expired', updated_at = now()
  where listing_package_id = p_listing_package_id
    and status = 'approved'
    and expires_at <= now();

  if exists (
    select 1 from public.ebay_draft_only_approvals
    where listing_package_id = p_listing_package_id
      and status = 'approved'
  ) then
    raise exception 'DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS';
  end if;

  insert into public.ebay_draft_only_approvals (
    listing_package_id, opportunity_id, candidate_key, actor_user_id,
    target, account_fingerprint, payload_hash, approved_payload, approval_idempotency_key,
    approved_at, expires_at, approval_phrase_version
  ) values (
    p_listing_package_id, p_opportunity_id, p_candidate_key, p_actor_user_id,
    v_target, v_account_fingerprint, p_payload_hash, p_approved_payload, p_idempotency_key,
    now(), least(p_expires_at, now() + interval '15 minutes'),
    case when v_target = 'PRODUCTION' then 'draft_only_production_es_v1' else 'draft_only_es_v1' end
  ) returning * into v_approval;

  update public.ebay_listing_packages
  set status = 'approved', updated_at = now()
  where id = p_listing_package_id;

  return next v_approval;
end;
$$;

create or replace function public.complete_ebay_draft_only_execution(
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
  p_claim_token uuid
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
begin
  select * into v_ledger
  from public.ebay_draft_only_execution_ledger
  where id = p_ledger_id
  for update;
  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_ledger.approval_id
  for update;
  if v_ledger.id is null
    or v_approval.id is null
    or v_ledger.actor_user_id is distinct from p_actor_user_id
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_ledger.phase <> 'offer_create_in_flight'
    or p_claim_token is null
    or v_ledger.lease_token is distinct from p_claim_token
    or v_ledger.lease_expires_at is null
    or v_ledger.lease_expires_at <= now()
    or v_ledger.request_hash is distinct from v_approval.payload_hash
    or v_ledger.listing_package_id is distinct from v_approval.listing_package_id
    or v_ledger.opportunity_id is distinct from v_approval.opportunity_id
    or v_ledger.sku is distinct from coalesce(v_approval.approved_payload #>> '{sku}', '')
    or v_ledger.target is distinct from upper(trim(coalesce(p_target, '')))
    or v_ledger.account_fingerprint is distinct from lower(trim(coalesce(p_account_fingerprint, '')))
    or v_approval.target is distinct from upper(trim(coalesce(p_target, '')))
    or v_approval.account_fingerprint is distinct from lower(trim(coalesce(p_account_fingerprint, '')))
    or p_offer_id is null
    or p_offer_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or (v_ledger.offer_id is not null and v_ledger.offer_id is distinct from p_offer_id)
    or p_offer_http_status is null
    or p_offer_http_status < 200
    or p_offer_http_status > 299
    or upper(trim(coalesce(p_verified_status, ''))) <> 'UNPUBLISHED'
    or p_listing_present is distinct from false
    or trim(coalesce(p_verified_sku, '')) <> coalesce(v_approval.approved_payload #>> '{offerPayload,sku}', '')
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) <> 'EBAY_US'
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) <> upper(coalesce(v_approval.approved_payload #>> '{offerPayload,marketplaceId}', '')) then
    raise exception 'DRAFT_ONLY_EXECUTION_NOT_COMPLETABLE';
  end if;

  update public.ebay_draft_only_execution_ledger
  set phase = 'completed', offer_http_status = p_offer_http_status,
      offer_id = p_offer_id, completed_at = now(), last_error_code = null,
      sanitized_result = '{"status":"UNPUBLISHED","verified":true}'::jsonb,
      lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_ledger_id
  returning * into v_ledger;

  update public.ebay_draft_only_approvals
  set status = 'consumed', consumed_at = v_ledger.completed_at, updated_at = now()
  where id = v_ledger.approval_id and status = 'approved';
  if not found then
    raise exception 'DRAFT_ONLY_APPROVAL_CONSUME_FAILED';
  end if;

  return next v_ledger;
end;
$$;

create or replace function public.reconcile_ebay_draft_only_execution(
  p_ledger_id uuid,
  p_actor_user_id uuid,
  p_offer_id text,
  p_offer_http_status integer,
  p_verified_status text,
  p_listing_present boolean,
  p_verified_sku text,
  p_verified_marketplace_id text,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
  v_approval public.ebay_draft_only_approvals%rowtype;
begin
  select * into v_ledger
  from public.ebay_draft_only_execution_ledger
  where id = p_ledger_id
  for update;
  select * into v_approval
  from public.ebay_draft_only_approvals
  where id = v_ledger.approval_id
  for update;
  if v_ledger.id is null
    or v_approval.id is null
    or v_ledger.actor_user_id is distinct from p_actor_user_id
    or v_approval.actor_user_id is distinct from p_actor_user_id
    or v_ledger.phase <> 'offer_outcome_unknown'
    or v_ledger.request_hash is distinct from v_approval.payload_hash
    or v_ledger.listing_package_id is distinct from v_approval.listing_package_id
    or v_ledger.opportunity_id is distinct from v_approval.opportunity_id
    or v_ledger.sku is distinct from coalesce(v_approval.approved_payload #>> '{sku}', '')
    or (v_ledger.offer_id is not null and v_ledger.offer_id is distinct from p_offer_id)
    or v_ledger.target is distinct from upper(trim(coalesce(p_target, '')))
    or v_ledger.account_fingerprint is distinct from lower(trim(coalesce(p_account_fingerprint, '')))
    or v_approval.target is distinct from upper(trim(coalesce(p_target, '')))
    or v_approval.account_fingerprint is distinct from lower(trim(coalesce(p_account_fingerprint, '')))
    or p_offer_id is null
    or p_offer_id !~ '^[A-Za-z0-9_-]{1,80}$'
    or p_offer_http_status is null
    or p_offer_http_status < 200
    or p_offer_http_status > 299
    or upper(trim(coalesce(p_verified_status, ''))) <> 'UNPUBLISHED'
    or p_listing_present is distinct from false
    or trim(coalesce(p_verified_sku, '')) <> coalesce(v_approval.approved_payload #>> '{offerPayload,sku}', '')
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) <> 'EBAY_US'
    or upper(trim(coalesce(p_verified_marketplace_id, ''))) <> upper(coalesce(v_approval.approved_payload #>> '{offerPayload,marketplaceId}', '')) then
    raise exception 'DRAFT_ONLY_RECONCILIATION_NOT_COMPLETABLE';
  end if;

  update public.ebay_draft_only_execution_ledger
  set phase = 'completed', offer_http_status = p_offer_http_status,
      offer_id = p_offer_id, completed_at = now(), last_error_code = null,
      sanitized_result = '{"status":"UNPUBLISHED","reconciled":true}'::jsonb,
      lease_token = null, lease_expires_at = null, updated_at = now()
  where id = p_ledger_id
  returning * into v_ledger;

  update public.ebay_draft_only_approvals
  set status = 'consumed', consumed_at = v_ledger.completed_at, updated_at = now()
  where id = v_ledger.approval_id and status in ('approved', 'expired', 'revoked');
  if not found then
    raise exception 'DRAFT_ONLY_APPROVAL_RECONCILIATION_FAILED';
  end if;

  return next v_ledger;
end;
$$;

create or replace function public.claim_ebay_draft_only_execution(
  p_approval_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_sku text,
  p_claim_token uuid,
  p_target text,
  p_account_fingerprint text
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval public.ebay_draft_only_approvals%rowtype;
  v_existing public.ebay_draft_only_execution_ledger%rowtype;
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
begin
  if upper(trim(coalesce(p_target, ''))) not in ('SANDBOX', 'PRODUCTION') then
    raise exception 'DRAFT_ONLY_TARGET_INVALID';
  end if;
  if lower(trim(coalesce(p_account_fingerprint, ''))) !~ '^[0-9a-f]{64}$' then
    raise exception 'DRAFT_ONLY_ACCOUNT_FINGERPRINT_INVALID';
  end if;
  if p_claim_token is null then
    raise exception 'DRAFT_ONLY_CLAIM_TOKEN_INVALID';
  end if;
  if p_request_hash is null
    or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_sku is null
    or p_sku !~ '^IMNOVA-[A-Z0-9]{16,32}$' then
    raise exception 'DRAFT_ONLY_EXECUTION_INPUT_INVALID';
  end if;

  if exists (
    select 1
    from public.ebay_draft_only_execution_ledger
    where target = upper(trim(p_target))
      and sku = p_sku
      and account_fingerprint is null
      and phase not in ('completed', 'terminal_failure')
  ) then
    raise exception 'DRAFT_ONLY_LEGACY_LEDGER_RECONCILIATION_REQUIRED';
  end if;

  select * into v_existing
  from public.ebay_draft_only_execution_ledger
  where approval_id = p_approval_id
  for update;
  if found then
    select * into v_approval
    from public.ebay_draft_only_approvals
    where id = p_approval_id
    for update;
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.idempotency_key is distinct from p_idempotency_key
      or v_existing.request_hash is distinct from p_request_hash
      or v_existing.sku is distinct from p_sku
      or v_existing.target is distinct from upper(trim(p_target))
      or v_existing.account_fingerprint is distinct from lower(trim(p_account_fingerprint))
      or v_approval.id is null
      or v_approval.actor_user_id is distinct from p_actor_user_id
      or v_approval.payload_hash is distinct from p_request_hash
      or v_existing.listing_package_id is distinct from v_approval.listing_package_id
      or v_existing.opportunity_id is distinct from v_approval.opportunity_id
      or p_sku is distinct from coalesce(v_approval.approved_payload #>> '{sku}', '')
      or p_sku is distinct from coalesce(v_approval.approved_payload #>> '{offerPayload,sku}', '')
      or v_approval.target is distinct from upper(trim(p_target))
      or v_approval.account_fingerprint is distinct from lower(trim(p_account_fingerprint)) then
      raise exception 'DRAFT_ONLY_EXECUTION_IDEMPOTENCY_MISMATCH';
    end if;
    if v_existing.phase in ('claimed', 'inventory_confirmed', 'retryable_inventory_failure') then
      if v_approval.status <> 'approved'
        or v_approval.consumed_at is not null
        or v_approval.revoked_at is not null
        or v_approval.expires_at <= now() then
        raise exception 'DRAFT_ONLY_APPROVAL_NOT_CLAIMABLE';
      end if;
      if v_existing.lease_expires_at is not null and v_existing.lease_expires_at > now() then
        raise exception 'DRAFT_ONLY_EXECUTION_BUSY';
      end if;
      update public.ebay_draft_only_execution_ledger
      set lease_token = p_claim_token, lease_expires_at = now() + interval '5 minutes',
          attempt_count = attempt_count + 1, updated_at = now()
      where id = v_existing.id
      returning * into v_existing;
    end if;
    return next v_existing;
    return;
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
    or v_approval.expires_at <= now()
    or v_approval.payload_hash is distinct from p_request_hash
    or v_approval.listing_package_id is null
    or v_approval.opportunity_id is null
    or p_sku is distinct from coalesce(v_approval.approved_payload #>> '{sku}', '')
    or p_sku is distinct from coalesce(v_approval.approved_payload #>> '{offerPayload,sku}', '')
    or v_approval.target is distinct from upper(trim(p_target))
    or v_approval.account_fingerprint is distinct from lower(trim(p_account_fingerprint)) then
    raise exception 'DRAFT_ONLY_APPROVAL_NOT_CLAIMABLE';
  end if;

  insert into public.ebay_draft_only_execution_ledger (
    approval_id, actor_user_id, listing_package_id, opportunity_id,
    idempotency_key, request_hash, target, account_fingerprint, sku, lease_token, lease_expires_at
  ) values (
    p_approval_id, p_actor_user_id, v_approval.listing_package_id, v_approval.opportunity_id,
    p_idempotency_key, p_request_hash, upper(trim(p_target)), lower(trim(p_account_fingerprint)),
    p_sku, p_claim_token,
    now() + interval '5 minutes'
  ) returning * into v_ledger;
  return next v_ledger;
end;
$$;

revoke all on function public.approve_ebay_draft_only_package(uuid, uuid, text, uuid, text, jsonb, text, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.claim_ebay_draft_only_execution(uuid, uuid, text, text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_ebay_draft_only_execution(uuid, uuid, text, integer, text, boolean, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.reconcile_ebay_draft_only_execution(uuid, uuid, text, integer, text, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.approve_ebay_draft_only_package(uuid, uuid, text, uuid, text, jsonb, text, timestamptz, text, text) to service_role;
grant execute on function public.claim_ebay_draft_only_execution(uuid, uuid, text, text, text, uuid, text, text) to service_role;
grant execute on function public.complete_ebay_draft_only_execution(uuid, uuid, text, integer, text, boolean, text, text, text, text, uuid) to service_role;
grant execute on function public.reconcile_ebay_draft_only_execution(uuid, uuid, text, integer, text, boolean, text, text, text, text) to service_role;

revoke insert on table public.ebay_draft_only_approvals from service_role;
revoke insert on table public.ebay_draft_only_execution_ledger from service_role;

comment on table public.ebay_draft_only_approvals is
  'Short-lived, one-time human approval bound to the exact target and hash of an unpublished eBay offer payload.';
comment on table public.ebay_draft_only_execution_ledger is
  'Target-isolated retry ledger. offer_create_in_flight/outcome_unknown is never retried automatically; publishOffer is forbidden.';
