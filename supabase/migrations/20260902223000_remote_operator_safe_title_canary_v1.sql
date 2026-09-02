-- Extend the existing one-shot ACTIVE-title execution ledger for one
-- owner-authorized Remote Operator canary. This is an execution authority,
-- not a second recommendation store. The recommendation must still come from
-- the canonical Commercial Exception Queue and exact Product Truth lineage.

alter table public.ebay_active_listing_title_revision_executions
  alter column candidate_id drop not null;

alter table public.ebay_active_listing_title_revision_executions
  add column if not exists execution_authority text not null
    default 'SAME_DAY_VERIFIED_TITLE',
  add column if not exists source_authority text null,
  add column if not exists source_signal_id text null,
  add column if not exists source_observed_at timestamptz null,
  add column if not exists authorized_current_title text null,
  add column if not exists authorized_current_title_hash text null,
  add column if not exists product_truth_reference text null,
  add column if not exists owner_approved_by uuid null
    references auth.users(id) on delete restrict,
  add column if not exists owner_approved_at timestamptz null,
  add column if not exists operator_idempotency_key_hash text null;

alter table public.ebay_active_listing_title_revision_executions
  drop constraint if exists ebay_active_title_execution_authority_check;
alter table public.ebay_active_listing_title_revision_executions
  add constraint ebay_active_title_execution_authority_check check (
    (
      execution_authority = 'SAME_DAY_VERIFIED_TITLE'
      and candidate_id is not null
      and source_authority is null
      and source_signal_id is null
      and source_observed_at is null
      and authorized_current_title is null
      and authorized_current_title_hash is null
      and product_truth_reference is null
      and owner_approved_by is null
      and owner_approved_at is null
      and operator_idempotency_key_hash is null
    )
    or
    (
      execution_authority = 'REMOTE_OPERATOR_SAFE_TITLE_CANARY'
      and candidate_id is null
      and source_authority = 'COMMERCIAL_EXCEPTION_QUEUE'
      and source_signal_id ~ '^[A-Za-z0-9._:-]{3,160}$'
      and source_observed_at is not null
      and char_length(authorized_current_title) between 1 and 80
      and authorized_current_title = btrim(authorized_current_title)
      and authorized_current_title !~ '[[:cntrl:]]'
      and authorized_current_title !~ '[[:space:]]{2,}'
      and authorized_current_title_hash ~ '^[0-9a-f]{64}$'
      and authorized_current_title_hash = encode(
        digest(authorized_current_title, 'sha256'), 'hex')
      and target_title <> authorized_current_title
      and product_truth_reference ~ '^sha256:[0-9a-f]{64}$'
      and owner_approved_by is not null
      and owner_approved_by <> actor_user_id
      and owner_approved_at is not null
      and title_strategy_version =
        'REMOTE_OPERATOR_VERIFIED_COLOR_TITLE_ENRICHMENT_V1'
      and (
        operator_idempotency_key_hash is null
        or operator_idempotency_key_hash ~ '^[0-9a-f]{64}$'
      )
    )
  );

create unique index if not exists
  ebay_active_title_remote_source_once_idx
on public.ebay_active_listing_title_revision_executions (
  marketplace_account_key, source_authority, source_signal_id
)
where execution_authority = 'REMOTE_OPERATOR_SAFE_TITLE_CANARY';

create unique index if not exists
  ebay_active_title_remote_operator_idempotency_idx
on public.ebay_active_listing_title_revision_executions (
  operator_idempotency_key_hash
)
where operator_idempotency_key_hash is not null;

create or replace function public.enforce_ebay_active_title_revision_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_DELETE_FORBIDDEN';
  end if;
  if new.listing_package_id is distinct from old.listing_package_id
    or new.candidate_id is distinct from old.candidate_id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.manual_listing_link_id is distinct from old.manual_listing_link_id
    or new.active_listing_id is distinct from old.active_listing_id
    or new.actor_user_id is distinct from old.actor_user_id
    or new.marketplace_account_key is distinct from old.marketplace_account_key
    or new.account_fingerprint is distinct from old.account_fingerprint
    or new.ebay_item_id is distinct from old.ebay_item_id
    or new.ebay_sku is distinct from old.ebay_sku
    or new.target_title is distinct from old.target_title
    or new.target_title_hash is distinct from old.target_title_hash
    or new.title_strategy_version is distinct from old.title_strategy_version
    or new.request_hash is distinct from old.request_hash
    or new.idempotency_key_hash is distinct from old.idempotency_key_hash
    or new.execution_authority is distinct from old.execution_authority
    or new.source_authority is distinct from old.source_authority
    or new.source_signal_id is distinct from old.source_signal_id
    or new.source_observed_at is distinct from old.source_observed_at
    or new.authorized_current_title is distinct from old.authorized_current_title
    or new.authorized_current_title_hash is distinct from old.authorized_current_title_hash
    or new.product_truth_reference is distinct from old.product_truth_reference
    or new.owner_approved_by is distinct from old.owner_approved_by
    or new.owner_approved_at is distinct from old.owner_approved_at
    or new.created_at is distinct from old.created_at then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_SCOPE_IMMUTABLE';
  end if;
  if new.operator_idempotency_key_hash is distinct from
      old.operator_idempotency_key_hash then
    if old.operator_idempotency_key_hash is not null
      or new.operator_idempotency_key_hash is null
      or new.operator_idempotency_key_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'EBAY_ACTIVE_TITLE_REVISION_IDEMPOTENCY_IMMUTABLE';
    end if;
  end if;
  if new.ebay_write_attempt_count < old.ebay_write_attempt_count
    or new.ebay_write_attempt_count > 1 then
    raise exception 'EBAY_ACTIVE_TITLE_REVISION_WRITE_LIMIT_REACHED';
  end if;
  return new;
end;
$$;

alter table public.ebay_active_listing_title_revision_executions
  enable row level security;
alter table public.ebay_active_listing_title_revision_executions
  force row level security;
revoke all on table public.ebay_active_listing_title_revision_executions
  from public, anon, authenticated;

comment on column
  public.ebay_active_listing_title_revision_executions.execution_authority is
  'Separates the legacy same-day title path from the owner-authorized Remote Operator canary; it never creates recommendation authority.';
