-- Professional WhatsApp alert delivery for Seller Command Center.
-- Delivery is still controlled by server-side environment configuration; this
-- migration stores no recipient, access token, phone number ID, or template secret.

create extension if not exists pgcrypto;

alter table public.ebay_seller_alert_outbox
  add column if not exists delivery_class text not null default 'immediate',
  add column if not exists dedupe_key text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ebay_seller_alert_outbox_delivery_class_check'
      and conrelid = 'public.ebay_seller_alert_outbox'::regclass
  ) then
    alter table public.ebay_seller_alert_outbox
      add constraint ebay_seller_alert_outbox_delivery_class_check
      check (delivery_class in ('immediate', 'digest'));
  end if;
end $$;

create table if not exists public.ebay_seller_whatsapp_alert_state (
  dedupe_key text primary key,
  alert_type text not null,
  entity_type text not null,
  entity_id text not null,
  priority text not null,
  active boolean not null default true,
  occurrence_count integer not null default 0,
  suppressed_count integer not null default 0,
  last_alert_id uuid null references public.ebay_seller_alert_outbox(id) on delete set null,
  last_enqueued_at timestamptz null,
  last_delivered_at timestamptz null,
  next_allowed_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ebay_seller_whatsapp_alert_state_priority_check
    check (priority in ('critical', 'high', 'medium', 'low')),
  constraint ebay_seller_whatsapp_alert_state_counts_check
    check (occurrence_count >= 0 and suppressed_count >= 0)
);

create index if not exists ebay_seller_whatsapp_alert_state_active_idx
  on public.ebay_seller_whatsapp_alert_state(active, next_allowed_at);
create index if not exists ebay_seller_whatsapp_outbox_claim_idx
  on public.ebay_seller_alert_outbox(delivery_class, priority, due_at)
  where channel = 'whatsapp' and status in ('pending', 'failed', 'leased');

create or replace function public.enqueue_ebay_seller_whatsapp_alert(
  p_dedupe_key text,
  p_alert_type text,
  p_priority text,
  p_entity_type text,
  p_entity_id text,
  p_candidate_key text,
  p_delivery_class text,
  p_payload jsonb,
  p_due_at timestamptz,
  p_cooldown_seconds integer
)
returns table(
  alert_id uuid,
  enqueued boolean,
  reason text,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next_allowed_at timestamptz;
  v_alert_id uuid;
  v_fingerprint text;
  v_due_at timestamptz := greatest(coalesce(p_due_at, v_now), v_now);
  v_cooldown integer := greatest(300, least(coalesce(p_cooldown_seconds, 3600), 604800));
begin
  if nullif(trim(p_dedupe_key), '') is null
    or nullif(trim(p_alert_type), '') is null
    or nullif(trim(p_entity_type), '') is null
    or nullif(trim(p_entity_id), '') is null then
    raise exception 'SELLER_WHATSAPP_ALERT_IDENTITY_REQUIRED';
  end if;
  if p_priority not in ('critical', 'high', 'medium', 'low') then
    raise exception 'SELLER_WHATSAPP_ALERT_PRIORITY_INVALID';
  end if;
  if p_delivery_class not in ('immediate', 'digest') then
    raise exception 'SELLER_WHATSAPP_DELIVERY_CLASS_INVALID';
  end if;

  insert into public.ebay_seller_whatsapp_alert_state (
    dedupe_key, alert_type, entity_type, entity_id, priority
  ) values (
    left(p_dedupe_key, 500), left(p_alert_type, 120),
    left(p_entity_type, 80), left(p_entity_id, 200), p_priority
  ) on conflict (dedupe_key) do nothing;

  select state.next_allowed_at
    into v_next_allowed_at
  from public.ebay_seller_whatsapp_alert_state as state
  where state.dedupe_key = left(p_dedupe_key, 500)
  for update;

  if v_next_allowed_at is not null and v_next_allowed_at > v_now then
    update public.ebay_seller_whatsapp_alert_state as state
    set occurrence_count = state.occurrence_count + 1,
        suppressed_count = state.suppressed_count + 1,
        updated_at = v_now
    where state.dedupe_key = left(p_dedupe_key, 500);
    return query select null::uuid, false, 'cooldown', v_next_allowed_at;
    return;
  end if;

  v_fingerprint := 'whatsapp:v1:' || encode(
    digest(left(p_dedupe_key, 500) || ':' || v_now::text || ':' || gen_random_uuid()::text, 'sha256'),
    'hex'
  );

  insert into public.ebay_seller_alert_outbox (
    alert_fingerprint,
    alert_type,
    priority,
    entity_type,
    entity_id,
    candidate_key,
    channel,
    status,
    payload,
    due_at,
    attempts,
    max_attempts,
    delivery_class,
    dedupe_key,
    created_at,
    updated_at
  ) values (
    v_fingerprint,
    left(p_alert_type, 120),
    p_priority,
    left(p_entity_type, 80),
    left(p_entity_id, 200),
    nullif(left(coalesce(p_candidate_key, ''), 300), ''),
    'whatsapp',
    'pending',
    coalesce(p_payload, '{}'::jsonb),
    v_due_at,
    0,
    5,
    p_delivery_class,
    left(p_dedupe_key, 500),
    v_now,
    v_now
  ) returning id into v_alert_id;

  update public.ebay_seller_whatsapp_alert_state as state
  set alert_type = left(p_alert_type, 120),
      entity_type = left(p_entity_type, 80),
      entity_id = left(p_entity_id, 200),
      priority = p_priority,
      active = true,
      occurrence_count = state.occurrence_count + 1,
      last_alert_id = v_alert_id,
      last_enqueued_at = v_now,
      next_allowed_at = v_now + make_interval(secs => v_cooldown),
      resolved_at = null,
      updated_at = v_now
  where state.dedupe_key = left(p_dedupe_key, 500);

  return query select v_alert_id, true, 'enqueued', v_due_at;
end;
$$;

create or replace function public.resolve_ebay_seller_whatsapp_alert(
  p_dedupe_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := left(coalesce(p_dedupe_key, ''), 500);
  v_now timestamptz := clock_timestamp();
begin
  update public.ebay_seller_whatsapp_alert_state as state
  set active = false,
      next_allowed_at = v_now,
      resolved_at = v_now,
      updated_at = v_now
  where state.dedupe_key = v_key;

  if not found then return false; end if;

  -- A leased delivery may already have reached Meta outside this transaction.
  -- Pending/retry rows are safe to cancel; in-flight rows retain honest state.
  update public.ebay_seller_alert_outbox as alert
  set status = 'cancelled',
      last_error_code = 'CONDITION_RESOLVED',
      lease_owner = null,
      lease_expires_at = null,
      updated_at = v_now
  where alert.channel = 'whatsapp'
    and alert.dedupe_key = v_key
    and alert.status in ('pending', 'failed');
  return true;
end;
$$;

create or replace function public.claim_ebay_seller_whatsapp_alerts(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns setof public.ebay_seller_alert_outbox
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'SELLER_WHATSAPP_WORKER_REQUIRED';
  end if;

  update public.ebay_seller_alert_outbox as expired
  set status = 'failed',
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = 'DELIVERY_LEASE_EXPIRED',
      due_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where expired.channel = 'whatsapp'
    and expired.status = 'leased'
    and expired.lease_expires_at < clock_timestamp();

  return query
  with picked as (
    select candidate.id
    from public.ebay_seller_alert_outbox as candidate
    where candidate.channel = 'whatsapp'
      and candidate.status in ('pending', 'failed')
      and candidate.due_at <= clock_timestamp()
      and candidate.attempts < candidate.max_attempts
    order by
      case candidate.delivery_class when 'immediate' then 0 else 1 end,
      case candidate.priority
        when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3
      end,
      candidate.due_at,
      candidate.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.ebay_seller_alert_outbox as alert
    set status = 'leased',
        attempts = alert.attempts + 1,
        lease_owner = left(p_worker_id, 120),
        lease_expires_at = clock_timestamp() + make_interval(
          secs => greatest(30, least(coalesce(p_lease_seconds, 120), 300))
        ),
        updated_at = clock_timestamp()
    where alert.id in (select picked.id from picked)
    returning alert.*
  ), attempt_audit as (
    insert into public.ebay_seller_alert_delivery_attempts (
      alert_id, attempt_number, channel, status, attempted_at
    )
    select claimed.id, claimed.attempts, 'whatsapp', 'started', clock_timestamp()
    from claimed
    on conflict (alert_id, attempt_number, channel) do update
      set status = 'started', attempted_at = excluded.attempted_at,
          completed_at = null, provider_message_id = null,
          response_code = null, error_code = null
    returning alert_id
  )
  select claimed.* from claimed
  where exists (
    select 1 from attempt_audit where attempt_audit.alert_id = claimed.id
  );
end;
$$;

create or replace function public.complete_ebay_seller_whatsapp_alert(
  p_alert_id uuid,
  p_attempt_number integer,
  p_provider_message_id text,
  p_response_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dedupe_key text;
  v_now timestamptz := clock_timestamp();
begin
  update public.ebay_seller_alert_outbox as alert
  set status = 'delivered',
      delivered_at = v_now,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = null,
      updated_at = v_now
  where alert.id = p_alert_id
    and alert.channel = 'whatsapp'
    and alert.status = 'leased'
    and alert.attempts = p_attempt_number
  returning alert.dedupe_key into v_dedupe_key;

  if not found then return false; end if;

  update public.ebay_seller_alert_delivery_attempts as attempt
  set status = 'delivered',
      provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 300), ''),
      response_code = nullif(left(coalesce(p_response_code, ''), 40), ''),
      error_code = null,
      completed_at = v_now
  where attempt.alert_id = p_alert_id
    and attempt.attempt_number = p_attempt_number
    and attempt.channel = 'whatsapp';

  update public.ebay_seller_whatsapp_alert_state as state
  set last_delivered_at = v_now, updated_at = v_now
  where state.dedupe_key = v_dedupe_key;
  return true;
end;
$$;

create or replace function public.fail_ebay_seller_whatsapp_alert(
  p_alert_id uuid,
  p_attempt_number integer,
  p_error_code text,
  p_response_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update public.ebay_seller_alert_outbox as alert
  set status = case
        when alert.attempts >= alert.max_attempts then 'dead_letter'
        else 'failed'
      end,
      due_at = case
        when alert.attempts >= alert.max_attempts then alert.due_at
        else v_now + make_interval(
          secs => least(3600, (30 * power(2, greatest(0, alert.attempts - 1)))::integer)
        )
      end,
      lease_owner = null,
      lease_expires_at = null,
      last_error_code = left(coalesce(nullif(p_error_code, ''), 'SELLER_WHATSAPP_DELIVERY_FAILED'), 120),
      updated_at = v_now
  where alert.id = p_alert_id
    and alert.channel = 'whatsapp'
    and alert.status = 'leased'
    and alert.attempts = p_attempt_number;

  if not found then return false; end if;

  update public.ebay_seller_alert_delivery_attempts as attempt
  set status = 'failed',
      response_code = nullif(left(coalesce(p_response_code, ''), 40), ''),
      error_code = left(coalesce(nullif(p_error_code, ''), 'SELLER_WHATSAPP_DELIVERY_FAILED'), 120),
      completed_at = v_now
  where attempt.alert_id = p_alert_id
    and attempt.attempt_number = p_attempt_number
    and attempt.channel = 'whatsapp';
  return true;
end;
$$;

alter table public.ebay_seller_whatsapp_alert_state enable row level security;

drop policy if exists "admin manage ebay seller whatsapp alert state"
  on public.ebay_seller_whatsapp_alert_state;
create policy "admin manage ebay seller whatsapp alert state"
  on public.ebay_seller_whatsapp_alert_state
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete
  on public.ebay_seller_whatsapp_alert_state
  to authenticated;

revoke all on function public.enqueue_ebay_seller_whatsapp_alert(
  text, text, text, text, text, text, text, jsonb, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.resolve_ebay_seller_whatsapp_alert(text)
  from public, anon, authenticated;
revoke all on function public.claim_ebay_seller_whatsapp_alerts(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_ebay_seller_whatsapp_alert(uuid, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_ebay_seller_whatsapp_alert(uuid, integer, text, text)
  from public, anon, authenticated;

grant execute on function public.enqueue_ebay_seller_whatsapp_alert(
  text, text, text, text, text, text, text, jsonb, timestamptz, integer
) to service_role;
grant execute on function public.resolve_ebay_seller_whatsapp_alert(text)
  to service_role;
grant execute on function public.claim_ebay_seller_whatsapp_alerts(text, integer, integer)
  to service_role;
grant execute on function public.complete_ebay_seller_whatsapp_alert(uuid, integer, text, text)
  to service_role;
grant execute on function public.fail_ebay_seller_whatsapp_alert(uuid, integer, text, text)
  to service_role;

notify pgrst, 'reload schema';
