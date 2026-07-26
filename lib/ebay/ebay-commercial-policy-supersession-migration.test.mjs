import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260726123000_supersede_active_only_commercial_actions.sql",
  "utf8",
)

test("ACTIVE_ONLY supersession is additive, auditable, and idempotent", () => {
  assert.match(migration, /add column if not exists/)
  assert.match(
    migration,
    /create table if not exists public\.ebay_commercial_policy_supersessions/,
  )
  assert.match(migration, /on conflict \(commercial_event_id\) do nothing/)
  assert.match(migration, /on conflict \(execution_id\) do nothing/)
  assert.match(migration, /is distinct from 'BLOCKED_POLICY'/)
  assert.match(migration, /reconciliation_required is distinct from true/)
  assert.match(
    migration,
    /reject_ebay_commercial_policy_supersession_mutation/,
  )
  assert.match(migration, /before update or delete/)
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i)
})

test("only unsent previews are terminated and ambiguous phases reconcile", () => {
  assert.match(migration, /execution\.phase = 'preview_ready'/)
  assert.match(migration, /execution\.ebay_write_dispatched = false/)
  assert.match(
    migration,
    /supersession\.commercial_event_id =\s+execution\.commercial_event_id/,
  )
  assert.match(
    migration,
    /execution\.phase in \('write_in_flight', 'write_acknowledged'\)/,
  )
  assert.match(migration, /reconciliation_required = true/)
  assert.match(
    migration,
    /COMMERCIAL_POLICY_ACTIVE_MARKET_WRITE_RECONCILIATION_REQUIRED/,
  )
})

test("historical events and pending delivery invitations are blocked without deletion", () => {
  assert.match(migration, /commercial_policy_status = 'BLOCKED_POLICY'/)
  assert.match(migration, /set status = 'cancelled'/)
  assert.match(
    migration,
    /COMMERCIAL_POLICY_SUPERSEDED_CONFIRMED_SALES_REQUIRED/,
  )
  assert.match(migration, /outbox\.status in \('pending', 'failed'\)/)
})

test("the migration never hardcodes a product or eBay item identity", () => {
  assert.doesNotMatch(migration, /ITEM3155|80144|366543596425/)
})
