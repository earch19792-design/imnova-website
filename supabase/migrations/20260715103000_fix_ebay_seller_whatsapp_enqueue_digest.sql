-- pgcrypto is installed in Supabase's extensions schema. The original
-- SECURITY DEFINER function intentionally restricts search_path to public and
-- pg_temp, so an unqualified digest() cannot be resolved at runtime.

do $$
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'EBAY_SELLER_WHATSAPP_PGCRYPTO_DIGEST_MISSING';
  end if;
end
$$;

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
    extensions.digest(
      left(p_dedupe_key, 500) || ':' || v_now::text || ':' || gen_random_uuid()::text,
      'sha256'
    ),
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

revoke all on function public.enqueue_ebay_seller_whatsapp_alert(
  text, text, text, text, text, text, text, jsonb, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.enqueue_ebay_seller_whatsapp_alert(
  text, text, text, text, text, text, text, jsonb, timestamptz, integer
) to service_role;

notify pgrst, 'reload schema';
