begin;

revoke execute on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) from service_role;

alter function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) set search_path = public, pg_temp;

comment on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) is
  'Retained for audit after compensating rollback; runtime snapshot persistence V1 must remain disabled.';

notify pgrst, 'reload schema';
commit;
