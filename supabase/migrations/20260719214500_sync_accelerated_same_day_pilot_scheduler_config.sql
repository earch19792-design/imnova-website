alter table public.ebay_same_day_pilot_scheduler_config
  drop constraint if exists ebay_same_day_pilot_scheduler_config_schedule_check;

alter table public.ebay_same_day_pilot_scheduler_config
  add constraint ebay_same_day_pilot_scheduler_config_schedule_check
  check (schedule in ('*/5 * * * *', '* * * * *'));

do $$
declare
  v_job_id bigint;
begin
  update public.ebay_same_day_pilot_scheduler_config
  set schedule = '* * * * *',
      updated_at = now()
  where singleton = true
    and environment = 'STAGING'
    and deployment_scope = 'PREVIEW'
    and supabase_project_ref = 'vsfthqydfrdzulldbfbe'
    and cron_job_name = 'seller-os-same-day-pilot-staging-v1'
  returning cron_job_id into v_job_id;

  if v_job_id is not null then
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *'
    );
  end if;
end;
$$;
