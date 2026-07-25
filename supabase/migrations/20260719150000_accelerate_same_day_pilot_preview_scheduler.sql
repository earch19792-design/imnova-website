-- Reduce operator-visible wait time for the staging same-day pilot.
-- The exact staging job name keeps this migration a no-op in Production.
do $$
declare
  staging_job_id bigint;
begin
  select jobid
  into staging_job_id
  from cron.job
  where jobname = 'seller-os-same-day-pilot-staging-v1'
  limit 1;

  if staging_job_id is not null then
    perform cron.alter_job(
      job_id := staging_job_id,
      schedule := '* * * * *',
      active := true
    );
  end if;
end;
$$;
