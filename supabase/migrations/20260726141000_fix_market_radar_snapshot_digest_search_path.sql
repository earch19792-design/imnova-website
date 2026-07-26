begin;

alter function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) set search_path = public, extensions, pg_temp;

comment on function public.persist_market_radar_snapshot_batch_v1(
  uuid, text, integer, text, text, jsonb, jsonb
) is
  'Service-role Luna snapshot batch persistence. pgcrypto is schema-qualified through the restricted extensions search path.';

notify pgrst, 'reload schema';
commit;
