-- Prevent synchronized Seller OS runtimes from creating a periodic read
-- thundering herd on small Postgres compute. Runtime cadence is preserved;
-- only the minute offsets change. No business data or marketplace state is
-- mutated by this migration.

do $migration$
declare
  v_job record;
begin
  for v_job in
    select jobid, jobname,
      case jobname
        when 'seller-os-ebay-commercial-monitor-staging-v1'
          then '1-59/5 * * * *'
        when 'seller-os-commercial-alert-dispatcher-staging-v1'
          then '2-59/5 * * * *'
        when 'seller-os-same-day-pilot-staging-v1'
          then '3-59/5 * * * *'
        when 'seller-os-post-publisher-batch-runtime-v1'
          then '4-59/5 * * * *'
        when 'seller-os-ebay-luna-monitor-staging-v1'
          then '5-59/15 * * * *'
        when 'seller-os-post-operational-integrity-auditor-v1'
          then '7-59/15 * * * *'
        when 'seller-os-post-publisher-preauthorization-v1'
          then '9-59/15 * * * *'
      end as staggered_schedule
    from cron.job
    where jobname in (
      'seller-os-ebay-commercial-monitor-staging-v1',
      'seller-os-commercial-alert-dispatcher-staging-v1',
      'seller-os-same-day-pilot-staging-v1',
      'seller-os-post-publisher-batch-runtime-v1',
      'seller-os-ebay-luna-monitor-staging-v1',
      'seller-os-post-operational-integrity-auditor-v1',
      'seller-os-post-publisher-preauthorization-v1'
    )
  loop
    perform cron.alter_job(v_job.jobid, schedule => v_job.staggered_schedule);
  end loop;
end;
$migration$;

alter table public.ebay_same_day_pilot_scheduler_config
  drop constraint if exists ebay_same_day_pilot_scheduler_config_schedule_check;

update public.ebay_same_day_pilot_scheduler_config
set schedule = '3-59/5 * * * *', updated_at = clock_timestamp()
where singleton and schedule = '*/5 * * * *';

alter table public.ebay_same_day_pilot_scheduler_config
  add constraint ebay_same_day_pilot_scheduler_config_schedule_check
  check (schedule in ('*/5 * * * *', '3-59/5 * * * *'));

update public.seller_os_post_runtime_scheduler_v1
set schedule = case lane
    when 'PUBLISHER_BATCH_RUNTIME' then '4-59/5 * * * *'
    when 'OPERATIONAL_INTEGRITY_AUDITOR' then '7-59/15 * * * *'
    when 'PUBLISHER_PREAUTHORIZATION_RECOVERY' then '9-59/15 * * * *'
    else schedule
  end,
  updated_at = clock_timestamp()
where lane in (
  'PUBLISHER_BATCH_RUNTIME',
  'OPERATIONAL_INTEGRITY_AUDITOR',
  'PUBLISHER_PREAUTHORIZATION_RECOVERY'
);

comment on table public.seller_os_post_runtime_scheduler_v1 is
  'POST-only runtime scheduler control plane. Periodic lanes use staggered minute offsets to prevent synchronized read amplification.';
