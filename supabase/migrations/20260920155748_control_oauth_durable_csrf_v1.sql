create table public.seller_os_control_csrf_consumptions_v1 (
  token_digest text primary key,
  owner_user_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint seller_os_control_csrf_token_digest_v1_check
    check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint seller_os_control_csrf_expiry_v1_check
    check (expires_at > consumed_at)
);

create index seller_os_control_csrf_expiry_v1_idx
  on public.seller_os_control_csrf_consumptions_v1(expires_at);

alter table public.seller_os_control_csrf_consumptions_v1
  enable row level security;
alter table public.seller_os_control_csrf_consumptions_v1
  force row level security;

revoke all on table public.seller_os_control_csrf_consumptions_v1
  from public, anon, authenticated;

create or replace function public.consume_seller_os_control_csrf_v1(
  p_token_digest text,
  p_owner_user_id uuid,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
      or p_token_digest !~ '^[0-9a-f]{64}$'
      or p_owner_user_id is null
      or p_expires_at <= now()
      or p_expires_at > now() + interval '10 minutes 1 second' then
    return false;
  end if;

  delete from public.seller_os_control_csrf_consumptions_v1
  where expires_at <= now();

  insert into public.seller_os_control_csrf_consumptions_v1(
    token_digest,
    owner_user_id,
    expires_at
  ) values (
    p_token_digest,
    p_owner_user_id,
    p_expires_at
  ) on conflict (token_digest) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$$;

revoke all on function public.consume_seller_os_control_csrf_v1(
  text, uuid, timestamptz
) from public, anon, authenticated;

grant execute on function public.consume_seller_os_control_csrf_v1(
  text, uuid, timestamptz
) to service_role;

comment on table public.seller_os_control_csrf_consumptions_v1 is
  'Opaque digests of consumed Control OAuth CSRF tokens. Durable replay protection only; contains no token values and grants no Seller OS capability.';

comment on function public.consume_seller_os_control_csrf_v1(
  text, uuid, timestamptz
) is
  'Atomically records one service-role-validated Control OAuth CSRF digest. Returns false for invalid or replayed tokens and performs no OAuth approval, capability, batch, or marketplace action.';
*** Delete File: /home/earch/seller-os-teo-pre-research-control-v1/supabase/migrations/20260920155102_control_oauth_durable_csrf_v1.sql
