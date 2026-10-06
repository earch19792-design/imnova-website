-- Keep the new auth.users foreign-key lookup indexed without changing the
-- canonical Market Radar write/read model.
create index if not exists market_radar_events_recorded_by_user_idx
  on public.market_radar_events(recorded_by_user_id, created_at desc)
  where recorded_by_user_id is not null;
