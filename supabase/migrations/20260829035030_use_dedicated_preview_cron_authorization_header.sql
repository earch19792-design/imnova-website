-- Vercel Deployment Protection may reserve Authorization before the request
-- reaches the Preview runtime. The existing route accepts the dedicated
-- equivalent header; send both from the existing dispatcher with the same
-- Vault-backed secret so no alternate auth mechanism is introduced.

do $migration$
declare
  v_definition text;
  v_current text := $current$
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_authorization_secret,
    'User-Agent', 'seller-os-ebay-monitoring-staging-scheduler/1',
    'X-Seller-OS-Monitoring-Lane', v_lane,
    'x-commercial-scheduler-source', 'supabase_pg_cron'
  );
$current$;
  v_replacement text := $replacement$
  v_headers := jsonb_build_object(
    'Authorization', 'Bearer ' || v_authorization_secret,
    'x-ebay-commercial-authorization', 'Bearer ' || v_authorization_secret,
    'User-Agent', 'seller-os-ebay-monitoring-staging-scheduler/1',
    'X-Seller-OS-Monitoring-Lane', v_lane,
    'x-commercial-scheduler-source', 'supabase_pg_cron'
  );
$replacement$;
begin
  select pg_get_functiondef(
    'public.dispatch_ebay_monitoring_staging_worker(text,timestamptz)'::regprocedure
  ) into v_definition;

  if position(v_replacement in v_definition) > 0 then
    return;
  end if;
  if position(v_current in v_definition) = 0 then
    raise exception 'EBAY_MONITORING_DISPATCH_AUTHORIZATION_HEADER_TARGET_MISSING';
  end if;

  v_definition := replace(v_definition, v_current, v_replacement);
  execute v_definition;
end;
$migration$;

revoke all on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) from public, anon, authenticated;
grant execute on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) to service_role;
