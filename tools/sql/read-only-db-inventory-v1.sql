-- READ ONLY
-- Metadata inventory only
-- No business row data
-- No PII
-- No writes
-- No destructive SQL

BEGIN READ ONLY;

SELECT
  schemaname,
  relname AS table_name,
  n_live_tup AS estimated_rows,
  pg_total_relation_size(relid) AS total_bytes,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(relid) DESC, relname ASC;

SELECT
  table_schema,
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name ASC;

COMMIT;
