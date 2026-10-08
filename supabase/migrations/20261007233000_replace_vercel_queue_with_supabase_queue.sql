create schema if not exists pgmq;
create extension if not exists pgmq with schema pgmq;

do $$
begin
  if not exists (
    select 1 from pgmq.meta
    where queue_name = 'ebay_listing_top20_continuation'
  ) then
    perform pgmq.create('ebay_listing_top20_continuation');
  end if;
end
$$;

create table if not exists public.seller_os_queue_dispatch_dedup (
  idempotency_key text primary key,
  message_id bigint not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint seller_os_queue_dispatch_dedup_key_check
    check (idempotency_key ~ '^sha256:[0-9a-f]{16}$')
);

alter table public.seller_os_queue_dispatch_dedup enable row level security;
revoke all on table public.seller_os_queue_dispatch_dedup
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.seller_os_queue_dispatch_dedup to service_role;

create or replace function public.seller_os_top20_queue_send(
  p_message jsonb,
  p_idempotency_key text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_message_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_message is null or jsonb_typeof(p_message) <> 'object' then
    raise exception 'queue_message_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key !~ '^sha256:[0-9a-f]{16}$' then
    raise exception 'idempotency_key_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  delete from public.seller_os_queue_dispatch_dedup
  where expires_at <= now();

  select message_id into v_message_id
  from public.seller_os_queue_dispatch_dedup
  where idempotency_key = p_idempotency_key;
  if v_message_id is not null then
    return v_message_id;
  end if;

  v_message_id := pgmq.send(
    'ebay_listing_top20_continuation',
    p_message || jsonb_build_object(
      'idempotencyKey', p_idempotency_key,
      'deliveryCount', coalesce((p_message->>'deliveryCount')::integer, 0)
    )
  );
  insert into public.seller_os_queue_dispatch_dedup(
    idempotency_key, message_id, expires_at
  ) values (
    p_idempotency_key, v_message_id, now() + interval '24 hours'
  );
  return v_message_id;
end
$$;

create or replace function public.seller_os_top20_queue_claim()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_message jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  select to_jsonb(message) into v_message
  from pgmq.read('ebay_listing_top20_continuation', 300, 1) as message
  limit 1;
  return v_message;
end
$$;

create or replace function public.seller_os_top20_queue_delete(
  p_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return pgmq.delete('ebay_listing_top20_continuation', p_message_id);
end
$$;

create or replace function public.seller_os_top20_queue_retry(
  p_message_id bigint,
  p_message jsonb,
  p_delay_seconds integer
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
declare
  v_message_id bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_delay_seconds < 0 or p_delay_seconds > 3600 then
    raise exception 'queue_delay_invalid' using errcode = '22023';
  end if;
  perform pgmq.delete('ebay_listing_top20_continuation', p_message_id);
  v_message_id := pgmq.send(
    'ebay_listing_top20_continuation', p_message, p_delay_seconds
  );
  return v_message_id;
end
$$;

create or replace function public.seller_os_top20_queue_archive(
  p_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pgmq
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  return pgmq.archive('ebay_listing_top20_continuation', p_message_id);
end
$$;

revoke all on function public.seller_os_top20_queue_send(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.seller_os_top20_queue_claim()
  from public, anon, authenticated;
revoke all on function public.seller_os_top20_queue_delete(bigint)
  from public, anon, authenticated;
revoke all on function public.seller_os_top20_queue_retry(bigint, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.seller_os_top20_queue_archive(bigint)
  from public, anon, authenticated;
grant execute on function public.seller_os_top20_queue_send(jsonb, text)
  to service_role;
grant execute on function public.seller_os_top20_queue_claim()
  to service_role;
grant execute on function public.seller_os_top20_queue_delete(bigint)
  to service_role;
grant execute on function public.seller_os_top20_queue_retry(bigint, jsonb, integer)
  to service_role;
grant execute on function public.seller_os_top20_queue_archive(bigint)
  to service_role;

alter table public.marketplace_listing_approval_queue_dispatch_attempts
  drop constraint if exists
    marketplace_listing_approval_queue_dispatch_attempts_transport_check;
alter table public.marketplace_listing_approval_queue_dispatch_attempts
  add constraint marketplace_listing_approval_queue_dispatch_attempts_transport_check
  check (transport in ('VERCEL_QUEUE', 'SUPABASE_QUEUE', 'HTTP_FALLBACK'));
