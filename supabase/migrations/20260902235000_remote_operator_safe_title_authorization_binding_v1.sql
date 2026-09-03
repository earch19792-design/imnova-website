-- Make the owner authorization contract directly auditable on the existing
-- one-shot title execution ledger. This does not create a recommendation or
-- task store; it only binds the durable approval to its exact contract digest.

alter table public.ebay_active_listing_title_revision_executions
  add column if not exists authorization_contract_version text null,
  add column if not exists authorization_digest text null;

alter table public.ebay_active_listing_title_revision_executions
  drop constraint if exists ebay_active_title_remote_authorization_binding_check;
alter table public.ebay_active_listing_title_revision_executions
  add constraint ebay_active_title_remote_authorization_binding_check check (
    (
      execution_authority = 'REMOTE_OPERATOR_SAFE_TITLE_CANARY'
      and authorization_contract_version =
        'REMOTE_OPERATOR_SAFE_TITLE_CANARY_AUTHORIZATION_V1'
      and authorization_digest ~ '^sha256:[0-9a-f]{64}$'
      and authorization_digest = 'sha256:' || idempotency_key_hash
    )
    or
    (
      execution_authority <> 'REMOTE_OPERATOR_SAFE_TITLE_CANARY'
      and authorization_contract_version is null
      and authorization_digest is null
    )
  );

create or replace function
  public.enforce_ebay_active_title_authorization_binding_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.authorization_contract_version is distinct from
      old.authorization_contract_version
    or new.authorization_digest is distinct from old.authorization_digest then
    raise exception 'EBAY_ACTIVE_TITLE_AUTHORIZATION_BINDING_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists
  ebay_active_title_authorization_binding_immutable_trigger
on public.ebay_active_listing_title_revision_executions;
create trigger ebay_active_title_authorization_binding_immutable_trigger
before update of authorization_contract_version, authorization_digest
on public.ebay_active_listing_title_revision_executions
for each row execute function
  public.enforce_ebay_active_title_authorization_binding_immutable();

revoke all on function
  public.enforce_ebay_active_title_authorization_binding_immutable()
from public, anon, authenticated;

comment on column
  public.ebay_active_listing_title_revision_executions.authorization_contract_version
is 'Exact owner-approval contract version for the Remote Operator title action.';
comment on column
  public.ebay_active_listing_title_revision_executions.authorization_digest
is 'SHA-256 binding of item, current/proposed values, lineage, operator, and authorization version.';

alter table public.ebay_active_listing_title_revision_executions
  enable row level security;
alter table public.ebay_active_listing_title_revision_executions
  force row level security;
revoke all on table public.ebay_active_listing_title_revision_executions
  from public, anon, authenticated;
