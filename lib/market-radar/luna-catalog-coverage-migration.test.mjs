import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const forward = readFileSync(
  new URL("../../supabase/migrations/20260726130000_create_market_radar_catalog_coverage_v1.sql", import.meta.url),
  "utf8",
)
const rollback = readFileSync(
  new URL("../../supabase/rollback/20260726130000_create_market_radar_catalog_coverage_v1.down.sql", import.meta.url),
  "utf8",
)
const snapshotForward = readFileSync(
  new URL("../../supabase/migrations/20260726140000_harden_market_radar_snapshot_persistence_v1.sql", import.meta.url),
  "utf8",
)
const snapshotRollback = readFileSync(
  new URL("../../supabase/rollback/20260726140000_harden_market_radar_snapshot_persistence_v1.down.sql", import.meta.url),
  "utf8",
)
const snapshotSearchPathForward = readFileSync(
  new URL("../../supabase/migrations/20260726141000_fix_market_radar_snapshot_digest_search_path.sql", import.meta.url),
  "utf8",
)
const snapshotSearchPathRollback = readFileSync(
  new URL("../../supabase/rollback/20260726141000_fix_market_radar_snapshot_digest_search_path.down.sql", import.meta.url),
  "utf8",
)
const service = readFileSync(
  new URL("../market-radar-lunaportex.ts", import.meta.url),
  "utf8",
)

test("migration is additive, idempotent and service-role only", () => {
  assert.match(forward, /create table if not exists public\.market_radar_catalog_scan_runs/i)
  assert.match(forward, /add column if not exists source_observed_at/i)
  assert.match(forward, /enable row level security/i)
  assert.match(forward, /product_payload jsonb/i)
  assert.match(forward, /release_market_radar_luna_hydration_window_v1/i)
  assert.match(forward, /revoke all on table public\.market_radar_catalog_scan_runs[\s\S]*authenticated/i)
  assert.doesNotMatch(forward, /grant[\s\S]{0,120}to authenticated/i)
})

test("rollback preserves audit evidence", () => {
  assert.match(rollback, /ROLLBACK_COMPENSATION_APPLIED/)
  assert.match(rollback, /release_market_radar_luna_hydration_window_v1/i)
  assert.doesNotMatch(rollback, /drop\s+table/i)
  assert.doesNotMatch(rollback, /delete\s+from/i)
  assert.doesNotMatch(rollback, /truncate/i)
})

test("snapshot persistence is idempotent, set-based and service-role only", () => {
  assert.match(snapshotForward, /snapshot_ingestion_key/i)
  assert.match(snapshotForward, /persist_market_radar_snapshot_batch_v1/i)
  assert.match(snapshotForward, /on conflict \(snapshot_ingestion_key\) do nothing/i)
  assert.match(snapshotForward, /SNAPSHOT_REPLAY_PAYLOAD_MISMATCH/i)
  assert.match(snapshotForward, /referencing new table as inserted_market_radar_snapshots/i)
  assert.match(snapshotForward, /for each statement/i)
  assert.match(snapshotForward, /force row level security/i)
  assert.match(snapshotForward, /grant execute[\s\S]*to service_role/i)
  assert.doesNotMatch(snapshotForward, /grant[\s\S]{0,120}to authenticated/i)
})

test("snapshot rollback preserves audit rows and service removes premature freshness", () => {
  assert.match(snapshotRollback, /Retained audit evidence/i)
  assert.doesNotMatch(snapshotRollback, /drop\s+table/i)
  assert.doesNotMatch(snapshotRollback, /delete\s+from/i)
  assert.doesNotMatch(snapshotRollback, /truncate/i)
  const productUpsert = service.match(
    /async function upsertProducts[\s\S]*?return savedProducts/,
  )?.[0] || ""
  assert.doesNotMatch(productUpsert, /last_snapshot_at/)
  assert.match(service, /SNAPSHOT_PERSISTENCE/)
  assert.match(service, /market_radar_current_variant_snapshots/)
  assert.doesNotMatch(service, /SNAPSHOT HISTORY LOOKUP TIMEOUT; CONTINUING WITHOUT PREVIOUS/)
})

test("snapshot RPC resolves pgcrypto from a restricted extensions search path", () => {
  assert.match(
    snapshotSearchPathForward,
    /persist_market_radar_snapshot_batch_v1[\s\S]*set search_path = public, extensions, pg_temp/i,
  )
  assert.doesNotMatch(snapshotSearchPathForward, /grant[\s\S]{0,120}to authenticated/i)
  assert.match(snapshotSearchPathRollback, /revoke execute[\s\S]*from service_role/i)
  assert.doesNotMatch(snapshotSearchPathRollback, /drop\s+function/i)
})
