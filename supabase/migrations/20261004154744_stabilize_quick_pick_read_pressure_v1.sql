-- Keep the bounded Quick Pick queue read on an ordered index. The reader asks
-- for the newest 100 rows before applying its durable-operation projection.
create index if not exists ebay_luna_queue_updated_at_idx
  on public.ebay_luna_opportunity_queue(updated_at desc);

-- The operational-integrity auditor currently reaches its statement timeout
-- in Mayel discovery on every 15-minute invocation. Reduce only this staging
-- control-plane cadence to hourly while the query is repaired. The named cron
-- job and its inspectable scheduler row must continue to describe one cadence.
do $migration$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'seller-os-post-operational-integrity-auditor-v1';

  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule => '7 * * * *');
  end if;
end;
$migration$;

update public.seller_os_post_runtime_scheduler_v1
set schedule = '7 * * * *',
    updated_at = clock_timestamp()
where lane = 'OPERATIONAL_INTEGRITY_AUDITOR'
  and schedule is distinct from '7 * * * *';
