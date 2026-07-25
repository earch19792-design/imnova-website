-- Compensating ACL hardening for Preview environments where 20260720046000
-- was already applied. Scheduler state mutations remain available only
-- through the SECURITY DEFINER RPCs granted to service_role.

revoke all on table public.ebay_monitoring_scheduler_config
  from anon, authenticated;
revoke all on table public.ebay_monitoring_scheduler_config
  from public, service_role;
revoke all on table public.ebay_monitoring_scheduler_dispatch_audit
  from anon, authenticated;
revoke all on table public.ebay_monitoring_scheduler_dispatch_audit
  from public, service_role;
revoke all on sequence public.ebay_monitoring_scheduler_dispatch_audit_id_seq
  from public, anon, authenticated, service_role;

grant select on table public.ebay_monitoring_scheduler_config
  to service_role;
grant select on table public.ebay_monitoring_scheduler_dispatch_audit
  to service_role;

revoke all on function public.get_exact_ebay_monitoring_state(text)
  from public, anon, authenticated;
revoke all on function public.enqueue_ebay_monitoring_heartbeat_alerts(
  text, text, integer, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) from public, anon, authenticated;
revoke all on function public.enable_ebay_monitoring_staging_scheduler(text, text)
  from public, anon, authenticated;
revoke all on function public.disable_ebay_monitoring_staging_scheduler(text)
  from public, anon, authenticated;

grant execute on function public.get_exact_ebay_monitoring_state(text)
  to service_role;
grant execute on function public.enqueue_ebay_monitoring_heartbeat_alerts(
  text, text, integer, integer, timestamptz
) to service_role;
grant execute on function public.dispatch_ebay_monitoring_staging_worker(
  text, timestamptz
) to service_role;
grant execute on function public.enable_ebay_monitoring_staging_scheduler(text, text)
  to service_role;
grant execute on function public.disable_ebay_monitoring_staging_scheduler(text)
  to service_role;

notify pgrst, 'reload schema';
