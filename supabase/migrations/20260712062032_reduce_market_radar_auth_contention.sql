create index if not exists market_radar_snapshots_source_available_captured_idx
  on public.market_radar_snapshots(source_id, available, captured_at desc);

create index if not exists market_radar_snapshots_source_manual_captured_idx
  on public.market_radar_snapshots(source_id, captured_at desc)
  where (raw -> 'manual_stock_confirmation') is not null;

create or replace view public.market_radar_manual_stock_snapshots
with (security_invoker = true) as
select *
from public.market_radar_snapshots
where (raw -> 'manual_stock_confirmation') is not null;

revoke all on public.market_radar_manual_stock_snapshots
  from anon, authenticated;

grant select on public.market_radar_manual_stock_snapshots
  to service_role;

notify pgrst, 'reload schema';
