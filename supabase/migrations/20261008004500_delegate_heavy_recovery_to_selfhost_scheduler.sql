-- The full Quick Pick recovery can legitimately exceed public proxy and
-- pg_net timeouts. Docker now owns this daily lane over its private network;
-- Supabase continues to own the remaining short, publicly dispatched lanes.

do $delegate_heavy_recovery$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('seller-os-heavy-recovery-owner-v1', 0)
  );

  update public.seller_os_post_runtime_scheduler_v1
  set enabled = false,
      updated_at = clock_timestamp()
  where lane = 'QUICK_PICK_RUNTIME_RECOVERY';

  if exists (
    select 1
    from cron.job
    where jobname = 'seller-os-post-quick-pick-runtime-recovery-v1'
  ) then
    perform cron.unschedule(
      'seller-os-post-quick-pick-runtime-recovery-v1'
    );
  end if;
end;
$delegate_heavy_recovery$;

comment on table public.seller_os_post_runtime_scheduler_v1 is
  'POST-only Seller OS scheduler policy. The heavy Quick Pick recovery is owned by the private self-host Docker scheduler; this table stores secret references only.';
