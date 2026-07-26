import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260726131000_harden_ebay_confirmed_demand_v2.sql",
  "utf8",
)
const rollback = readFileSync(
  "supabase/rollback/20260726131000_harden_ebay_confirmed_demand_v2.down.sql",
  "utf8",
)

test("migration is additive, idempotent, immutable, and service-role only", () => {
  assert.match(migration, /add column if not exists/)
  assert.match(
    migration,
    /create table if not exists public\.ebay_demand_evidence_policy_configs/,
  )
  assert.match(
    migration,
    /create table if not exists public\.ebay_demand_evidence_policy_evaluations/,
  )
  assert.match(migration, /create or replace function/)
  assert.match(migration, /drop trigger if exists/)
  assert.match(migration, /before update or delete/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all[\s\S]+from anon, authenticated/)
  assert.match(migration, /to service_role/)
  assert.doesNotMatch(
    migration,
    /grant[\s\S]+to anon|grant[\s\S]+to authenticated/i,
  )
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b/i)
})

test("policy defaults to disabled shadow mode and separates exact sold metrics", () => {
  assert.match(migration, /enabled boolean not null default false/)
  assert.match(migration, /shadow_mode boolean not null default true/)
  assert.match(migration, /sold_exact_units integer/)
  assert.match(migration, /sold_exact_seller_count integer/)
  assert.match(migration, /sold_exact_comparable_count integer/)
  assert.match(migration, /demand_validation_passed boolean/)
})

test("compensating rollback preserves history and only closes the capability", () => {
  assert.match(rollback, /enabled = false/)
  assert.match(rollback, /shadow_mode = true/)
  assert.doesNotMatch(
    rollback,
    /\bdrop\s+(table|column|function|trigger)\b|\bdelete\s+from\b|\btruncate\b/i,
  )
})
