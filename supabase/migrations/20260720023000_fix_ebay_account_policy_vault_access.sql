-- The migration role cannot read vault.secrets directly. Resolve the secret id
-- through Vault's supported decrypted view, while keeping RPC execution limited
-- to service_role and never returning the token.

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
  from vault.decrypted_secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;

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

revoke all on function public.store_ebay_account_policy_readonly_refresh_token_v1(
  text, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.store_ebay_account_policy_readonly_refresh_token_v1(
  text, uuid, text, text, timestamptz
) to service_role;

comment on function public.store_ebay_account_policy_readonly_refresh_token_v1(
  text, uuid, text, text, timestamptz
) is 'Stores a verified account-policy read-only refresh token only in Vault; resolves rotation through vault.decrypted_secrets.';

notify pgrst, 'reload schema';
