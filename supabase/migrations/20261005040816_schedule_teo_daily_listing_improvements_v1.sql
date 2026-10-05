-- TEO reviews verified owner listings every morning. The scheduler only sends
-- an authenticated POST to a read-only eBay workflow; listing edits remain a
-- manual owner action.

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
    'CURRENT_PREPUBLICATION_SAME_LINK_CLOSEOUT',
    'AUTONOMOUS_GREENFIELD_END_TO_END_PUBLICATION_CANARY',
    'TEO_LISTING_IMPROVEMENTS'
  ));

insert into public.seller_os_post_runtime_scheduler_v1 (
  lane, endpoint_path, schedule, dispatch_window_seconds, enabled,
  endpoint_url_secret_name, authorization_secret_name,
  vercel_bypass_secret_name, source_authority
)
select
  'TEO_LISTING_IMPROVEMENTS',
  '/api/cron/teo-listing-improvements',
  '10 13 * * *',
  86400,
  true,
  source.endpoint_url_secret_name,
  source.authorization_secret_name,
  source.vercel_bypass_secret_name,
  source.source_authority
from public.seller_os_post_runtime_scheduler_v1 source
where source.lane = 'QUICK_PICK_RUNTIME_RECOVERY'
  and source.enabled
  and source.endpoint_url_secret_name is not null
  and source.authorization_secret_name is not null
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
  'seller-os-post-teo-listing-improvements-v1',
  '10 13 * * *',
  $$select public.dispatch_seller_os_post_runtime_v1(
    'TEO_LISTING_IMPROVEMENTS'
  );$$
);

comment on table public.seller_os_post_runtime_scheduler_v1 is
  'Allowlisted authenticated POST schedules for Seller OS, including TEO daily verified-listing review.';
