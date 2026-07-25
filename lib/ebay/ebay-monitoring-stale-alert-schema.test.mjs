import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const heartbeatMigration = readFileSync(
  "supabase/migrations/20260720046000_enable_ebay_monitoring_and_stale_alerts.sql",
  "utf8",
)
const accountLevelEventMigration = readFileSync(
  "supabase/migrations/20260720074000_allow_account_level_commercial_alert_events.sql",
  "utf8",
)
const nestedHeartbeatMigration = readFileSync(
  "supabase/migrations/20260720075000_accept_nested_scheduled_monitor_identity_heartbeat.sql",
  "utf8",
)

test("account-level heartbeat alerts do not invent a listing identity", () => {
  assert.match(
    heartbeatMigration,
    /'MONITOR_HEARTBEAT_STALE'[\s\S]*?null,[\s\S]*?null,[\s\S]*?null,[\s\S]*?null,[\s\S]*?v_event_key/,
  )
  assert.match(
    accountLevelEventMigration,
    /alter table public\.commercial_alert_events[\s\S]*alter column listing_id drop not null/,
  )
  assert.doesNotMatch(accountLevelEventMigration, /grant\s|disable row level security/i)
})

test("scheduled identity verification remains compatible with the dry-run heartbeat field", () => {
  assert.match(nestedHeartbeatMigration, /metrics -> ''listingIdentityVerified''/)
  assert.match(
    nestedHeartbeatMigration,
    /metrics #> ''\{listingIdentity,allActiveListingsVerified\}''/,
  )
  assert.match(nestedHeartbeatMigration, /pg_get_functiondef/)
  assert.doesNotMatch(nestedHeartbeatMigration, /grant\s|disable row level security/i)
})
