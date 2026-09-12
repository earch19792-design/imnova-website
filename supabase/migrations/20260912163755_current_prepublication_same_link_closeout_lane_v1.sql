-- One bounded, on-demand continuation lane for the already existing SAME_LINK
-- package. It reuses the protected Vercel runtime and its secret references;
-- no recurring cron job is installed and the route grants no publication.

alter table public.seller_os_post_runtime_scheduler_v1
  drop constraint seller_os_post_runtime_lane_check;
alter table public.seller_os_post_runtime_scheduler_v1
  add constraint seller_os_post_runtime_lane_check check (lane in (
    'QUICK_PICK_RUNTIME_RECOVERY',
    'MARKET_RADAR_LUNA_SYNC',
    'EBAY_LUNA_OPPORTUNITY_SCAN',
    'DAILY_DOLLAR_RADAR_AUTOPILOT',
    'OPERATIONAL_INTEGRITY_AUDITOR',
    'PUBLISHER_BATCH_RUNTIME',
    'PUBLISHER_PREAUTHORIZATION_RECOVERY',
    'RUNTIME_CAPABILITY_ASSURANCE',
    'CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select 'CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT',
  '/api/cron/quick-pick-runtime-recovery', '0 0 1 1 *', 900,
  source.enabled and source.endpoint_url_secret_name is not null
    and source.authorization_secret_name is not null,
  source.endpoint_url_secret_name, source.authorization_secret_name,
  source.vercel_bypass_secret_name,
  'EBAY_SAME_DAY_PILOT_SCHEDULER_CONFIG_SECRET_REFERENCES'
from public.ebay_same_day_pilot_scheduler_config source
where source.singleton
on conflict (lane) do update set
  endpoint_path = excluded.endpoint_path,
  schedule = excluded.schedule,
  dispatch_window_seconds = excluded.dispatch_window_seconds,
  enabled = excluded.enabled,
  endpoint_url_secret_name = excluded.endpoint_url_secret_name,
  authorization_secret_name = excluded.authorization_secret_name,
  vercel_bypass_secret_name = excluded.vercel_bypass_secret_name,
  source_authority = excluded.source_authority,
  updated_at = case
    when (public.seller_os_post_runtime_scheduler_v1.endpoint_path,
      public.seller_os_post_runtime_scheduler_v1.schedule,
      public.seller_os_post_runtime_scheduler_v1.dispatch_window_seconds,
      public.seller_os_post_runtime_scheduler_v1.enabled,
      public.seller_os_post_runtime_scheduler_v1.endpoint_url_secret_name,
      public.seller_os_post_runtime_scheduler_v1.authorization_secret_name,
      public.seller_os_post_runtime_scheduler_v1.vercel_bypass_secret_name,
      public.seller_os_post_runtime_scheduler_v1.source_authority)
      is distinct from
      (excluded.endpoint_path, excluded.schedule,
        excluded.dispatch_window_seconds, excluded.enabled,
        excluded.endpoint_url_secret_name,
        excluded.authorization_secret_name,
        excluded.vercel_bypass_secret_name, excluded.source_authority)
    then clock_timestamp()
    else public.seller_os_post_runtime_scheduler_v1.updated_at
  end;
