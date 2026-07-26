begin;

update public.market_radar_snapshot_ingestion_batches
set status = 'CANCELLED',
    updated_at = now()
where status = 'RUNNING';

revoke execute on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) from service_role;

comment on table public.market_radar_snapshot_ingestion_batches is
  'Retained audit evidence after compensating rollback; snapshot persistence V1 must remain disabled in runtime.';

-- The set-based trigger and nullable ingestion key are intentionally retained.
-- They are backwards-compatible, preserve audit evidence and avoid restoring
-- the row-by-row write amplification.

notify pgrst, 'reload schema';
commit;
