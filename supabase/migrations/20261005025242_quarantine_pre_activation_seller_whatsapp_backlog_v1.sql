-- Establish the seller WhatsApp activation boundary without replaying the
-- historical queue. The quarantined rows remain fully auditable and can be
-- identified (or restored deliberately) through their payload marker.

do $$
declare
  v_cutover_at constant timestamptz := '2026-10-05 02:51:39+00';
  v_quarantined_at timestamptz := clock_timestamp();
  v_account_key text;
  v_candidate_count integer;
  v_updated_count integer;
begin
  select grouped.account_key
    into strict v_account_key
  from (
    select alert.payload ->> 'accountKey' as account_key,
           count(*)::integer as pending_count
    from public.ebay_seller_alert_outbox as alert
    where alert.channel = 'whatsapp'
      and alert.status = 'pending'
      and alert.created_at < v_cutover_at
      and alert.attempts = 0
      and alert.delivered_at is null
      and alert.lease_owner is null
      and alert.lease_expires_at is null
      and alert.dedupe_key is not null
      and nullif(alert.payload ->> 'accountKey', '') is not null
    group by alert.payload ->> 'accountKey'
  ) as grouped
  where grouped.pending_count = 165;

  select count(*)::integer
    into v_candidate_count
  from public.ebay_seller_alert_outbox as alert
  where alert.channel = 'whatsapp'
    and alert.status = 'pending'
    and alert.payload ->> 'accountKey' = v_account_key
    and alert.created_at < v_cutover_at
    and alert.attempts = 0
    and alert.delivered_at is null
    and alert.lease_owner is null
    and alert.lease_expires_at is null
    and alert.dedupe_key is not null;

  if v_candidate_count <> 165 then
    raise exception
      'SELLER_WHATSAPP_CUTOVER_EXPECTED_165_FOUND_%',
      v_candidate_count;
  end if;

  update public.ebay_seller_alert_outbox as alert
  set status = 'cancelled',
      last_error_code = 'PRE_ACTIVATION_BACKLOG_QUARANTINED',
      lease_owner = null,
      lease_expires_at = null,
      payload = coalesce(alert.payload, '{}'::jsonb) || jsonb_build_object(
        'activationCutover', jsonb_build_object(
          'version', 'EBAY_SELLER_WHATSAPP_ACTIVATION_CUTOVER_V1',
          'status', 'QUARANTINED',
          'reason', 'PRE_ACTIVATION_BACKLOG',
          'previousStatus', alert.status,
          'cutoverAt', v_cutover_at,
          'quarantinedAt', v_quarantined_at
        )
      ),
      updated_at = v_quarantined_at
  where alert.channel = 'whatsapp'
    and alert.status = 'pending'
    and alert.payload ->> 'accountKey' = v_account_key
    and alert.created_at < v_cutover_at
    and alert.attempts = 0
    and alert.delivered_at is null
    and alert.lease_owner is null
    and alert.lease_expires_at is null
    and alert.dedupe_key is not null;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 165 then
    raise exception
      'SELLER_WHATSAPP_CUTOVER_UPDATE_EXPECTED_165_FOUND_%',
      v_updated_count;
  end if;

  update public.ebay_seller_whatsapp_alert_state as state
  set active = false,
      next_allowed_at = v_cutover_at,
      resolved_at = v_quarantined_at,
      updated_at = v_quarantined_at
  where state.dedupe_key in (
    select alert.dedupe_key
    from public.ebay_seller_alert_outbox as alert
    where alert.channel = 'whatsapp'
      and alert.status = 'cancelled'
      and alert.payload ->> 'accountKey' = v_account_key
      and alert.payload #>> '{activationCutover,version}' =
        'EBAY_SELLER_WHATSAPP_ACTIVATION_CUTOVER_V1'
  );

  -- Defensive consistency for an unexpected historical started-attempt row.
  update public.ebay_seller_alert_delivery_attempts as attempt
  set status = 'failed',
      error_code = 'PRE_ACTIVATION_BACKLOG_QUARANTINED',
      completed_at = v_quarantined_at
  where attempt.channel = 'whatsapp'
    and attempt.status = 'started'
    and exists (
      select 1
      from public.ebay_seller_alert_outbox as alert
      where alert.id = attempt.alert_id
        and alert.status = 'cancelled'
        and alert.payload ->> 'accountKey' = v_account_key
        and alert.payload #>> '{activationCutover,version}' =
          'EBAY_SELLER_WHATSAPP_ACTIVATION_CUTOVER_V1'
    );
end;
$$;
