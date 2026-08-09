-- Temporary, non-secret serialization ledger for the canonical seller OAuth
-- reauthorization helper. It never stores OAuth state, codes, tokens, cookies,
-- credentials, account identities, user identities, or business data.

create table if not exists public.ebay_seller_oauth_reauth_state_ledger (
  state_hash text primary key,
  status text not null default 'PENDING',
  flow_version text not null default 'EBAY_SELLER_OAUTH_REAUTH_V1',
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  constraint ebay_seller_oauth_reauth_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_seller_oauth_reauth_status_check check (
    status in ('PENDING', 'CLAIMED')
  ),
  constraint ebay_seller_oauth_reauth_flow_version_check check (
    flow_version = 'EBAY_SELLER_OAUTH_REAUTH_V1'
  ),
  constraint ebay_seller_oauth_reauth_expiry_check check (
    expires_at > created_at
  ),
  constraint ebay_seller_oauth_reauth_claim_check check (
    (status = 'PENDING' and claimed_at is null)
    or (status = 'CLAIMED' and claimed_at is not null)
  )
);

create index if not exists ebay_seller_oauth_reauth_retention_idx
  on public.ebay_seller_oauth_reauth_state_ledger (created_at);

alter table public.ebay_seller_oauth_reauth_state_ledger
  enable row level security;
alter table public.ebay_seller_oauth_reauth_state_ledger
  force row level security;

revoke all on table public.ebay_seller_oauth_reauth_state_ledger from public;
revoke all on table public.ebay_seller_oauth_reauth_state_ledger
  from anon, authenticated;
revoke all on table public.ebay_seller_oauth_reauth_state_ledger
  from service_role;

create or replace function public.create_ebay_seller_oauth_reauth_state_v1(
  p_state_hash text,
  p_expires_at timestamptz,
  p_flow_version text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EBAY_SELLER_OAUTH_REAUTH_SERVICE_ROLE_REQUIRED';
  end if;

  if p_state_hash is null
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_flow_version <> 'EBAY_SELLER_OAUTH_REAUTH_V1'
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '10 minutes'
  then
    raise exception 'EBAY_SELLER_OAUTH_REAUTH_STATE_INVALID';
  end if;

  -- Bounded, opportunistic retention. Cleanup only deletes non-secret ledger
  -- metadata and never transitions a retained CLAIMED row back to PENDING.
  delete from public.ebay_seller_oauth_reauth_state_ledger
  where created_at < statement_timestamp() - interval '7 days';

  insert into public.ebay_seller_oauth_reauth_state_ledger (
    state_hash,
    status,
    flow_version,
    expires_at
  ) values (
    p_state_hash,
    'PENDING',
    p_flow_version,
    p_expires_at
  )
  on conflict (state_hash) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

create or replace function public.claim_ebay_seller_oauth_reauth_state_v1(
  p_state_hash text,
  p_flow_version text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'EBAY_SELLER_OAUTH_REAUTH_SERVICE_ROLE_REQUIRED';
  end if;

  if p_state_hash is null
    or p_state_hash !~ '^[0-9a-f]{64}$'
    or p_flow_version <> 'EBAY_SELLER_OAUTH_REAUTH_V1'
  then
    raise exception 'EBAY_SELLER_OAUTH_REAUTH_STATE_INVALID';
  end if;

  update public.ebay_seller_oauth_reauth_state_ledger
  set status = 'CLAIMED',
      claimed_at = statement_timestamp()
  where state_hash = p_state_hash
    and status = 'PENDING'
    and flow_version = p_flow_version
    and expires_at > statement_timestamp()
  returning state_hash into v_claimed_hash;

  return v_claimed_hash is not null;
end;
$$;

revoke all on function public.create_ebay_seller_oauth_reauth_state_v1(
  text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.claim_ebay_seller_oauth_reauth_state_v1(
  text, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_ebay_seller_oauth_reauth_state_v1(
  text, timestamptz, text
) to service_role;
grant execute on function public.claim_ebay_seller_oauth_reauth_state_v1(
  text, text
) to service_role;

comment on table public.ebay_seller_oauth_reauth_state_ledger is
  'Temporary non-secret state-hash ledger for at-most-once canonical seller OAuth handoff; stores no OAuth or account credentials.';
comment on function public.claim_ebay_seller_oauth_reauth_state_v1(text, text) is
  'Atomically claims one unexpired PENDING state exactly once before any eBay authorization-code exchange.';

notify pgrst, 'reload schema';
