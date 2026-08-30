create or replace function public.store_seller_os_luna_protected_session_v1(
  p_actor uuid,
  p_session_payload text,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_payload jsonb;
  v_secret_id uuid;
  v_secret_name constant text := 'imnova_seller_os_luna_session_v1';
  v_captured_at timestamptz;
  v_validated_at timestamptz;
  v_expires_at timestamptz;
  v_cookie jsonb;
  v_cookie_expires_at timestamptz;
begin
  if auth.role() <> 'service_role'
    or p_actor is null
    or length(coalesce(p_session_payload, '')) not between 80 and 12000
    or p_session_payload ~ '[[:cntrl:]]'
    or p_now is null then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;
  begin
    v_payload := p_session_payload::jsonb;
  exception when others then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end;
  if jsonb_typeof(v_payload) <> 'object'
    or (select count(*) from jsonb_object_keys(v_payload)) <> 5
    or not (v_payload ?& array[
      'contractVersion', 'capturedAt', 'validatedAt', 'expiresAt'
    ]) then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;
  begin
    v_captured_at := (v_payload->>'capturedAt')::timestamptz;
    v_validated_at := (v_payload->>'validatedAt')::timestamptz;
    v_expires_at := (v_payload->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end;
  if v_captured_at > v_validated_at
    or v_validated_at > p_now + interval '5 minutes'
    or v_expires_at <= v_validated_at
    or v_expires_at - v_captured_at > interval '45 days' then
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;

  if v_payload->>'contractVersion' = 'SELLER_OS_LUNA_PROTECTED_SESSION_V1' then
    if not (v_payload ? 'cookieHeader')
      or length(coalesce(v_payload->>'cookieHeader', '')) not between 8 and 8192
      or v_payload->>'cookieHeader' !~
        '^[^=;[:space:]]+=[^;[:cntrl:]]*(;[[:space:]]*[^=;[:space:]]+=[^;[:cntrl:]]*)*$'
      or v_payload->>'cookieHeader' ~*
        '(authorization|bearer|password|cookie[[:space:]]*:)' then
      raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
    end if;
  elsif v_payload->>'contractVersion' =
      'SELLER_OS_LUNA_PROTECTED_SESSION_V2' then
    if not (v_payload ? 'cookieJar')
      or jsonb_typeof(v_payload->'cookieJar') <> 'array'
      or jsonb_array_length(v_payload->'cookieJar') not between 1 and 24 then
      raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
    end if;
    for v_cookie in
      select value from jsonb_array_elements(v_payload->'cookieJar')
    loop
      if jsonb_typeof(v_cookie) <> 'object'
        or (select count(*) from jsonb_object_keys(v_cookie)) <> 7
        or not (v_cookie ?& array[
          'name', 'value', 'domain', 'path', 'secure', 'hostOnly', 'expiresAt'
        ])
        or coalesce(v_cookie->>'domain', '') not in (
          'lunaportex.com', 'www.lunaportex.com', 'account.lunaportex.com'
        )
        or jsonb_typeof(v_cookie->'hostOnly') <> 'boolean'
        or ((v_cookie->>'hostOnly')::boolean
          and v_cookie->>'domain' = 'lunaportex.com')
        or v_cookie->'secure' <> 'true'::jsonb
        or coalesce(v_cookie->>'name', '') !~
          '^[!#$%&''*+.^_`|~0-9A-Za-z-]{1,128}$'
        or coalesce(v_cookie->>'name', '') !~*
          '^(__Host-|__Secure-)?(_shopify_essential|_secure_customer_sig|customer_auth_provider|customer_auth_session_created_at|customer_account_session|shopify_customer_account_session|_shopify_customer_account_session|account_session|accounts_session|identity_session)$'
        or length(coalesce(v_cookie->>'value', '')) > 4096
        or coalesce(v_cookie->>'value', '') ~ '[;[:cntrl:]]'
        or length(coalesce(v_cookie->>'path', '')) not between 1 and 512
        or left(v_cookie->>'path', 1) <> '/'
        or v_cookie->>'path' ~ '[[:cntrl:]]' then
        raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
      end if;
      if v_cookie->'expiresAt' <> 'null'::jsonb then
        begin
          v_cookie_expires_at := (v_cookie->>'expiresAt')::timestamptz;
        exception when others then
          raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
        end;
        if v_cookie_expires_at < v_expires_at then
          raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
        end if;
      end if;
    end loop;
    if (select count(*) from (
      select distinct
        value->>'name' as name,
        value->>'domain' as domain,
        value->>'path' as path
      from jsonb_array_elements(v_payload->'cookieJar')
    ) identities) <> jsonb_array_length(v_payload->'cookieJar') then
      raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
    end if;
  else
    raise exception 'SELLER_OS_LUNA_PROTECTED_SESSION_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('seller_os_luna_protected_session_v1', 0)
  );
  select secret.id into v_secret_id
  from vault.decrypted_secrets secret
  where secret.name = v_secret_name
  order by secret.updated_at desc nulls last, secret.created_at desc
  limit 1;
  if v_secret_id is null then
    perform vault.create_secret(
      p_session_payload,
      v_secret_name,
      'Seller OS server-owned Luna read-only web session'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      p_session_payload,
      v_secret_name,
      'Seller OS server-owned Luna read-only web session'
    );
  end if;
  return true;
end;
$$;

comment on function public.store_seller_os_luna_protected_session_v1(
  uuid, text, timestamptz
) is
  'Stores either the legacy V1 cookie header or the bounded V2 two-host cookie jar in the existing Vault secret; service-role only.';
