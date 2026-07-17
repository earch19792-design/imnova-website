-- One-time human approvals and an idempotent ledger for eBay unpublished
-- draft creation. This migration performs no external eBay operation.

create table if not exists public.ebay_draft_only_approvals (
  id uuid primary key default gen_random_uuid(),
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete cascade,
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete cascade,
  candidate_key text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target text not null default 'SANDBOX',
  status text not null default 'approved',
  payload_hash text not null,
  approved_payload jsonb not null,
  approval_phrase_version text not null default 'draft_only_es_v1',
  approval_idempotency_key text not null unique,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_draft_only_approvals_target_check check (target = 'SANDBOX'),
  constraint ebay_draft_only_approvals_status_check check (status in ('approved', 'consumed', 'revoked', 'expired')),
  constraint ebay_draft_only_approvals_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint ebay_draft_only_approvals_ttl_check check (expires_at > approved_at and expires_at <= approved_at + interval '60 minutes'),
  constraint ebay_draft_only_approvals_consumed_check check ((status = 'consumed') = (consumed_at is not null))
);

create unique index if not exists ebay_draft_only_one_active_approval_uidx
  on public.ebay_draft_only_approvals(listing_package_id)
  where status = 'approved';
create index if not exists ebay_draft_only_approvals_actor_idx
  on public.ebay_draft_only_approvals(actor_user_id, approved_at desc);

create table if not exists public.ebay_draft_only_execution_ledger (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.ebay_draft_only_approvals(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  listing_package_id uuid not null references public.ebay_listing_packages(id) on delete restrict,
  opportunity_id uuid not null references public.ebay_luna_opportunity_queue(id) on delete restrict,
  idempotency_key text not null unique,
  request_hash text not null,
  target text not null default 'SANDBOX',
  sku text not null,
  phase text not null default 'claimed',
  attempt_count integer not null default 1,
  lease_token uuid null,
  lease_expires_at timestamptz null,
  inventory_http_status integer null,
  inventory_confirmed_at timestamptz null,
  offer_create_started_at timestamptz null,
  offer_http_status integer null,
  offer_id text null,
  completed_at timestamptz null,
  last_error_code text null,
  sanitized_result jsonb not null default '{}'::jsonb,
  permitted_operations text[] not null default array['createOrReplaceInventoryItem', 'createOffer']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_draft_only_ledger_target_check check (target = 'SANDBOX'),
  constraint ebay_draft_only_ledger_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint ebay_draft_only_ledger_sku_check check (sku ~ '^[A-Za-z0-9._-]{1,50}$'),
  constraint ebay_draft_only_ledger_phase_check check (phase in (
    'claimed', 'inventory_confirmed', 'offer_create_in_flight', 'completed',
    'retryable_inventory_failure', 'terminal_failure', 'offer_outcome_unknown'
  )),
  constraint ebay_draft_only_ledger_offer_check check (offer_id is null or offer_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint ebay_draft_only_ledger_operations_check check (
    permitted_operations <@ array['createOrReplaceInventoryItem', 'createOffer']::text[]
    and not ('publishOffer' = any(permitted_operations))
  )
);

create unique index if not exists ebay_draft_only_target_sku_uidx
  on public.ebay_draft_only_execution_ledger(target, sku)
  where phase not in ('terminal_failure');
create index if not exists ebay_draft_only_ledger_actor_idx
  on public.ebay_draft_only_execution_ledger(actor_user_id, created_at desc);

alter table public.ebay_draft_only_approvals enable row level security;
alter table public.ebay_draft_only_execution_ledger enable row level security;

revoke all on table public.ebay_draft_only_approvals from anon, authenticated;
revoke all on table public.ebay_draft_only_execution_ledger from anon, authenticated;
grant select, insert, update on table public.ebay_draft_only_approvals to service_role;
grant select, insert, update on table public.ebay_draft_only_execution_ledger to service_role;

create or replace function public.approve_ebay_draft_only_package(
  p_listing_package_id uuid,
  p_opportunity_id uuid,
  p_candidate_key text,
  p_actor_user_id uuid,
  p_payload_hash text,
  p_approved_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz
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
begin
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
      or v_existing.payload_hash is distinct from p_payload_hash then
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
    where listing_package_id = p_listing_package_id and status = 'approved'
  ) then
    raise exception 'DRAFT_ONLY_ACTIVE_APPROVAL_EXISTS';
  end if;

  insert into public.ebay_draft_only_approvals (
    listing_package_id, opportunity_id, candidate_key, actor_user_id,
    target, payload_hash, approved_payload, approval_idempotency_key,
    approved_at, expires_at
  ) values (
    p_listing_package_id, p_opportunity_id, p_candidate_key, p_actor_user_id,
    'SANDBOX', p_payload_hash, p_approved_payload, p_idempotency_key,
    now(), least(p_expires_at, now() + interval '60 minutes')
  ) returning * into v_approval;

  update public.ebay_listing_packages
  set status = 'approved', updated_at = now()
  where id = p_listing_package_id;

  return next v_approval;
end;
$$;

create or replace function public.claim_ebay_draft_only_execution(
  p_approval_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_sku text,
  p_claim_token uuid
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
  select * into v_existing
  from public.ebay_draft_only_execution_ledger
  where approval_id = p_approval_id
  for update;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.idempotency_key is distinct from p_idempotency_key
      or v_existing.request_hash is distinct from p_request_hash
      or v_existing.sku is distinct from p_sku then
      raise exception 'DRAFT_ONLY_EXECUTION_IDEMPOTENCY_MISMATCH';
    end if;
    if v_existing.phase in ('claimed', 'inventory_confirmed', 'retryable_inventory_failure') then
      if v_existing.lease_expires_at is not null and v_existing.lease_expires_at > now() then
        raise exception 'DRAFT_ONLY_EXECUTION_BUSY';
      end if;
      update public.ebay_draft_only_execution_ledger
      set lease_token = p_claim_token, lease_expires_at = now() + interval '2 minutes',
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
    or v_approval.payload_hash is distinct from p_request_hash then
    raise exception 'DRAFT_ONLY_APPROVAL_NOT_CLAIMABLE';
  end if;

  insert into public.ebay_draft_only_execution_ledger (
    approval_id, actor_user_id, listing_package_id, opportunity_id,
    idempotency_key, request_hash, target, sku, lease_token, lease_expires_at
  ) values (
    p_approval_id, p_actor_user_id, v_approval.listing_package_id, v_approval.opportunity_id,
    p_idempotency_key, p_request_hash, 'SANDBOX', p_sku, p_claim_token, now() + interval '2 minutes'
  ) returning * into v_ledger;
  return next v_ledger;
end;
$$;

create or replace function public.complete_ebay_draft_only_execution(
  p_ledger_id uuid,
  p_actor_user_id uuid,
  p_offer_id text,
  p_offer_http_status integer
)
returns setof public.ebay_draft_only_execution_ledger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger public.ebay_draft_only_execution_ledger%rowtype;
begin
  select * into v_ledger
  from public.ebay_draft_only_execution_ledger
  where id = p_ledger_id
  for update;
  if not found
    or v_ledger.actor_user_id is distinct from p_actor_user_id
    or v_ledger.phase <> 'offer_create_in_flight'
    or p_offer_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'DRAFT_ONLY_EXECUTION_NOT_COMPLETABLE';
  end if;

  update public.ebay_draft_only_execution_ledger
  set phase = 'completed', offer_http_status = p_offer_http_status,
      offer_id = p_offer_id, completed_at = now(), last_error_code = null,
      sanitized_result = '{"status":"UNPUBLISHED"}'::jsonb,
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

revoke all on function public.approve_ebay_draft_only_package(uuid, uuid, text, uuid, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_ebay_draft_only_execution(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_ebay_draft_only_execution(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.approve_ebay_draft_only_package(uuid, uuid, text, uuid, text, jsonb, text, timestamptz) to service_role;
grant execute on function public.claim_ebay_draft_only_execution(uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.complete_ebay_draft_only_execution(uuid, uuid, text, integer) to service_role;

comment on table public.ebay_draft_only_approvals is
  'Short-lived, one-time human approval bound to the exact hash of an unpublished SANDBOX draft payload.';
comment on table public.ebay_draft_only_execution_ledger is
  'Retry-safe ledger. offer_create_in_flight without offer_id is never retried automatically.';
