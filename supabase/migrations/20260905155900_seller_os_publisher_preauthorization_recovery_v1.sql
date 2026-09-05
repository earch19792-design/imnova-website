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
    'PUBLISHER_PREAUTHORIZATION_RECOVERY'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select 'PUBLISHER_PREAUTHORIZATION_RECOVERY',
  '/api/cron/quick-pick-runtime-recovery', '*/15 * * * *', 900,
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
  updated_at = clock_timestamp();

select cron.schedule(
  'seller-os-post-publisher-preauthorization-v1',
  '*/15 * * * *',
  $$select public.dispatch_seller_os_post_runtime_v1(
    'PUBLISHER_PREAUTHORIZATION_RECOVERY');$$
);

comment on column public.seller_os_post_runtime_scheduler_v1.lane is
  'POST-only runtime lane. Publisher preauthorization recovery may prepare only packages without active commercial authorization.';
