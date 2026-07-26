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
