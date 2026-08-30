-- One-time owner-workstation handoff for the existing Seller OS Luna session.
-- Session plaintext is never stored in this ledger. The ephemeral RSA private
-- key lives in Supabase Vault only until the challenge is atomically claimed.

create table if not exists public.seller_os_luna_owner_handoff_challenges_v1 (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  nonce_hash text not null unique,
  public_key_pem text not null,
  private_key_secret_id uuid not null unique,
  environment_binding text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null,
  expires_at timestamptz not null,
  claimed_at timestamptz null,
  completed_at timestamptz null,
  result_code text null,
  constraint seller_os_luna_owner_handoff_nonce_hash_check check (
    nonce_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint seller_os_luna_owner_handoff_public_key_check check (
    char_length(public_key_pem) between 700 and 1600
    and public_key_pem like '-----BEGIN PUBLIC KEY-----%'
  ),
  constraint seller_os_luna_owner_handoff_environment_check check (
    environment_binding =
      'SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222'
  ),
  constraint seller_os_luna_owner_handoff_status_check check (
    status in ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'EXPIRED')
  ),
  constraint seller_os_luna_owner_handoff_result_check check (
    result_code is null or result_code ~ '^[A-Z0-9_]{3,160}$'
  ),
  constraint seller_os_luna_owner_handoff_ttl_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '10 minutes'
  ),
  constraint seller_os_luna_owner_handoff_state_check check (
    (status = 'PENDING' and claimed_at is null and completed_at is null)
    or (status = 'CLAIMED' and claimed_at is not null and completed_at is null)
    or (status in ('COMPLETED', 'FAILED') and claimed_at is not null
      and completed_at is not null)
    or (status = 'EXPIRED' and completed_at is not null)
  )
);

create index if not exists seller_os_luna_owner_handoff_retention_idx
  on public.seller_os_luna_owner_handoff_challenges_v1
  (status, expires_at);

create unique index if not exists seller_os_luna_owner_handoff_actor_pending_idx
  on public.seller_os_luna_owner_handoff_challenges_v1 (actor_user_id)
  where status = 'PENDING';

alter table public.seller_os_luna_owner_handoff_challenges_v1
  enable row level security;
alter table public.seller_os_luna_owner_handoff_challenges_v1
  force row level security;

revoke all on table public.seller_os_luna_owner_handoff_challenges_v1
  from public, anon, authenticated, service_role;

create or replace function public.create_seller_os_luna_owner_handoff_v1(
  p_actor uuid,
  p_nonce_hash text,
  p_public_key_pem text,
  p_private_key_pem text,
  p_environment_binding text,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_id uuid := gen_random_uuid();
  v_secret_id uuid;
  v_stale record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'LUNA_OWNER_HANDOFF_SERVICE_ROLE_REQUIRED';
  end if;
  if p_actor is null or not exists (
    select 1 from auth.users actor
    where actor.id = p_actor and (
      actor.raw_app_meta_data ->> 'is_admin' = 'true'
      or actor.raw_app_meta_data ->> 'role' = 'admin'
    )
  ) then
    raise exception 'LUNA_OWNER_HANDOFF_OWNER_ADMIN_REQUIRED';
  end if;
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or char_length(coalesce(p_public_key_pem, '')) not between 700 and 1600
    or p_public_key_pem not like '-----BEGIN PUBLIC KEY-----%'
    or char_length(coalesce(p_private_key_pem, '')) not between 3000 and 3600
    or p_private_key_pem not like '-----BEGIN PRIVATE KEY-----%'
    or p_environment_binding <>
      'SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222'
    or p_now > statement_timestamp() + interval '5 minutes'
    or p_now < statement_timestamp() - interval '5 minutes'
    or p_expires_at <= p_now + interval '2 minutes'
    or p_expires_at > p_now + interval '10 minutes'
  then
    raise exception 'LUNA_OWNER_HANDOFF_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('seller_os_luna_owner_handoff_v1:' || p_actor::text, 0)
  );

  for v_stale in
    select id, private_key_secret_id
    from public.seller_os_luna_owner_handoff_challenges_v1
    where status = 'PENDING'
      and (actor_user_id = p_actor or expires_at <= p_now)
    for update
  loop
    delete from vault.secrets where id = v_stale.private_key_secret_id;
    update public.seller_os_luna_owner_handoff_challenges_v1
    set status = 'EXPIRED', completed_at = p_now,
        result_code = case when expires_at <= p_now
          then 'LUNA_OWNER_HANDOFF_EXPIRED'
          else 'LUNA_OWNER_HANDOFF_SUPERSEDED' end
    where id = v_stale.id;
  end loop;

  v_secret_id := vault.create_secret(
    p_private_key_pem,
    'seller_os_luna_owner_handoff_private_v1_' || v_id::text,
    'Ephemeral private key for one-time Luna owner reauth handoff'
  );

  insert into public.seller_os_luna_owner_handoff_challenges_v1 (
    id, actor_user_id, nonce_hash, public_key_pem, private_key_secret_id,
    environment_binding, status, created_at, expires_at
  ) values (
    v_id, p_actor, p_nonce_hash, p_public_key_pem, v_secret_id,
    p_environment_binding, 'PENDING', p_now, p_expires_at
  );
  return v_id;
end;
$$;

create or replace function public.claim_seller_os_luna_owner_handoff_v1(
  p_id uuid,
  p_nonce_hash text,
  p_environment_binding text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, vault
as $$
declare
  v_row public.seller_os_luna_owner_handoff_challenges_v1%rowtype;
  v_private_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'LUNA_OWNER_HANDOFF_SERVICE_ROLE_REQUIRED';
  end if;
  if p_id is null or p_nonce_hash is null
    or p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_environment_binding <>
      'SELLER_OS_DEDICATED_PREPROD:vsfthqydfrdzulldbfbe:prj_XvOpSg1jhmLLG1yOCFhAbiLEn222'
    or p_now > statement_timestamp() + interval '5 minutes'
    or p_now < statement_timestamp() - interval '5 minutes'
  then
    raise exception 'LUNA_OWNER_HANDOFF_INPUT_INVALID';
  end if;

  select * into v_row
  from public.seller_os_luna_owner_handoff_challenges_v1
  where id = p_id
  for update;

  if not found or v_row.status <> 'PENDING'
    or v_row.nonce_hash <> p_nonce_hash
    or v_row.environment_binding <> p_environment_binding
    or v_row.expires_at <= p_now
  then
    return null;
  end if;

  select decrypted_secret into v_private_key
  from vault.decrypted_secrets
  where id = v_row.private_key_secret_id;
  if v_private_key is null then
    raise exception 'LUNA_OWNER_HANDOFF_EPHEMERAL_KEY_UNAVAILABLE';
  end if;

  update public.seller_os_luna_owner_handoff_challenges_v1
  set status = 'CLAIMED', claimed_at = p_now
  where id = v_row.id;
  delete from vault.secrets where id = v_row.private_key_secret_id;

  return jsonb_build_object(
    'actorUserId', v_row.actor_user_id,
    'privateKeyPem', v_private_key,
    'expiresAt', v_row.expires_at,
    'environmentBinding', v_row.environment_binding
  );
end;
$$;

create or replace function public.complete_seller_os_luna_owner_handoff_v1(
  p_id uuid,
  p_success boolean,
  p_result_code text,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'LUNA_OWNER_HANDOFF_SERVICE_ROLE_REQUIRED';
  end if;
  if p_id is null or p_result_code is null
    or p_result_code !~ '^[A-Z0-9_]{3,160}$'
    or p_now > statement_timestamp() + interval '5 minutes'
    or p_now < statement_timestamp() - interval '5 minutes'
  then
    raise exception 'LUNA_OWNER_HANDOFF_INPUT_INVALID';
  end if;
  update public.seller_os_luna_owner_handoff_challenges_v1
  set status = case when p_success then 'COMPLETED' else 'FAILED' end,
      completed_at = p_now,
      result_code = p_result_code
  where id = p_id and status = 'CLAIMED';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.create_seller_os_luna_owner_handoff_v1(
  uuid, text, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.claim_seller_os_luna_owner_handoff_v1(
  uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.complete_seller_os_luna_owner_handoff_v1(
  uuid, boolean, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.create_seller_os_luna_owner_handoff_v1(
  uuid, text, text, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.claim_seller_os_luna_owner_handoff_v1(
  uuid, text, text, timestamptz
) to service_role;
grant execute on function public.complete_seller_os_luna_owner_handoff_v1(
  uuid, boolean, text, timestamptz
) to service_role;

comment on table public.seller_os_luna_owner_handoff_challenges_v1 is
  'One-time, short-lived Luna owner reauth challenges. Stores public metadata only; ephemeral private keys are held in Vault and deleted atomically at claim.';
comment on function public.claim_seller_os_luna_owner_handoff_v1(
  uuid, text, text, timestamptz
) is 'Atomically consumes one environment-bound challenge and destroys its Vault-held ephemeral private key before application-level decryption.';

notify pgrst, 'reload schema';
