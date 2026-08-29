-- Keep the existing 15-minute staging scheduler and dispatcher, but scope the
-- LUNA_MONITOR lane to the canonical LIVE cohort resolved inside the existing
-- worker. The legacy ebay_active_listings completeness projection remains
-- visible as diagnostic debt and continues to gate the commercial lanes; it
-- no longer vetoes supplier-evidence renewal for unrelated non-LIVE rows.

do $migration$
declare
  v_definition text;
  v_old text := $old$
  else
    v_state := public.get_exact_ebay_monitoring_state(
      v_config.marketplace_account_key
    );
    if v_state -> 'ready' is distinct from 'true'::jsonb then
      v_status := 'BLOCKED_MONITORING_STATE';
      v_reason := 'EXACT_ACTIVE_LISTING_STATE_REQUIRED';
    end if;
  end if;
$old$;
  v_new text := $new$
  else
    v_state := public.get_exact_ebay_monitoring_state(
      v_config.marketplace_account_key
    );
    if v_lane in ('COMMERCIAL_MONITOR', 'ALERT_DISPATCHER')
      and v_state -> 'ready' is distinct from 'true'::jsonb then
      v_status := 'BLOCKED_MONITORING_STATE';
      v_reason := 'EXACT_ACTIVE_LISTING_STATE_REQUIRED';
    elsif v_lane = 'LUNA_MONITOR' then
      v_state := jsonb_build_object(
        'ready', true,
        'reasonCode', 'CANONICAL_CURRENT_LIVE_COHORT_SCOPED_IN_WORKER',
        'liveDenominatorAuthority',
          'OFFICIAL_EBAY_CURRENT_LIVE_INTERSECT_CERTIFIED_LINKAGES',
        'nonLiveLegacyRowsBlockDispatch', false,
        'legacyMonitoringDebt', v_state
      );
    end if;
  end if;
$new$;
begin
  select pg_get_functiondef(
    'public.dispatch_ebay_monitoring_staging_worker(text,timestamptz)'
      ::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'LUNA_MONITOR_LEGACY_GLOBAL_GATE_TARGET_MISSING';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;

revoke all on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) from public, anon, authenticated;
grant execute on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) to service_role;

notify pgrst, 'reload schema';
