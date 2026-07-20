-- One-time, Preview-only account-policy OAuth handoff. Authorization codes and
-- plaintext tokens are never persisted in this table. A verified refresh token
-- is stored only in Supabase Vault and is readable only through service_role.

create table if not exists public.ebay_account_policy_oauth_handoffs (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  account_key text not null,
  actor_user_id uuid not null,
  status text not null default 'pending',
  identity_match boolean null,
  readonly_scopes_confirmed boolean null,
  error_code text null,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  ready_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_account_policy_oauth_handoffs_state_hash_check check (
    state_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint ebay_account_policy_oauth_handoffs_account_key_check check (
    account_key ~ '^[A-Za-z0-9._:-]{3,160}$'
  ),
  constraint ebay_account_policy_oauth_handoffs_status_check check (
    status in ('pending', 'claimed', 'ready', 'failed', 'expired')
  ),
  constraint ebay_account_policy_oauth_handoffs_error_code_check check (
    error_code is null or error_code ~ '^[A-Z0-9_]{3,160}$'
  ),
  constraint ebay_account_policy_oauth_handoffs_expiry_check check (
    expires_at > created_at
  )
);

create index if not exists ebay_account_policy_oauth_handoffs_expiry_idx
  on public.ebay_account_policy_oauth_handoffs (status, expires_at);

alter table public.ebay_account_policy_oauth_handoffs enable row level security;
alter table public.ebay_account_policy_oauth_handoffs force row level security;
revoke all on table public.ebay_account_policy_oauth_handoffs from public, anon, authenticated;
grant select, insert, update, delete
  on table public.ebay_account_policy_oauth_handoffs to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ebay_account_policy_oauth_handoffs'
      and policyname = 'ebay_account_policy_oauth_handoffs_service_role'
  ) then
    create policy ebay_account_policy_oauth_handoffs_service_role
      on public.ebay_account_policy_oauth_handoffs
      for all to service_role using (true) with check (true);
  end if;
end
$$;

create or replace function public.store_ebay_account_policy_readonly_refresh_token_v1(
  p_account_key text,
  p_actor uuid,
  p_identity_fingerprint text,
  p_refresh_token text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_secret_name text;
  v_secret_id uuid;
begin
  if auth.role() <> 'service_role'
    or coalesce(p_account_key, '') !~ '^[A-Za-z0-9._:-]{3,160}$'
    or p_actor is null
    or coalesce(p_identity_fingerprint, '') !~ '^[0-9a-f]{64}$'
    or right(p_account_key, 64) <> p_identity_fingerprint
    or length(coalesce(p_refresh_token, '')) not between 100 and 4096
    or p_refresh_token ~ '[[:cntrl:]]'
    or p_now is null then
    raise exception 'EBAY_ACCOUNT_POLICY_OAUTH_VAULT_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('ebay_account_policy_oauth_vault:' || p_account_key, 0)
  );
  v_secret_name := 'imnova_ebay_account_policy_readonly_' || substr(
    encode(extensions.digest(p_account_key, 'sha256'), 'hex'), 1, 32
  );
  select secret.id into v_secret_id
  from vault.secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1
  for update;

  if v_secret_id is null then
    perform vault.create_secret(
      p_refresh_token,
      v_secret_name,
      'IMNOVA eBay account/inventory read-only OAuth refresh token'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_refresh_token,
      v_secret_name,
      'IMNOVA eBay account/inventory read-only OAuth refresh token'
    );
  end if;
  return true;
end;
$$;

create or replace function public.get_ebay_account_policy_readonly_refresh_token_v1(
  p_account_key text
)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_secret_name text;
  v_refresh_token text;
begin
  if auth.role() <> 'service_role'
    or coalesce(p_account_key, '') !~ '^[A-Za-z0-9._:-]{3,160}$' then
    raise exception 'EBAY_ACCOUNT_POLICY_OAUTH_VAULT_ACCESS_INVALID';
  end if;
  v_secret_name := 'imnova_ebay_account_policy_readonly_' || substr(
    encode(extensions.digest(p_account_key, 'sha256'), 'hex'), 1, 32
  );
  select secret.decrypted_secret into v_refresh_token
  from vault.decrypted_secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  return nullif(trim(coalesce(v_refresh_token, '')), '');
end;
$$;

revoke all on function public.store_ebay_account_policy_readonly_refresh_token_v1(
  text, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.store_ebay_account_policy_readonly_refresh_token_v1(
  text, uuid, text, text, timestamptz
) to service_role;
revoke all on function public.get_ebay_account_policy_readonly_refresh_token_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_ebay_account_policy_readonly_refresh_token_v1(text)
  to service_role;

comment on table public.ebay_account_policy_oauth_handoffs is
  'Ephemeral state-only handoffs for Preview eBay account-policy read-only OAuth; never stores authorization codes or tokens.';
comment on function public.get_ebay_account_policy_readonly_refresh_token_v1(text) is
  'Returns the account-scoped read-only refresh token only to service_role; never callable by browser roles.';

notify pgrst, 'reload schema';
