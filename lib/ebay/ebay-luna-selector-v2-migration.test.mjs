import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260726133000_create_ebay_luna_selector_v2_shadow.sql",
  import.meta.url,
)
const rollbackUrl = new URL(
  "../../supabase/rollback/20260726133000_create_ebay_luna_selector_v2_shadow.down.sql",
  import.meta.url,
)

test("selector V2 migration is additive, shadow-default, scoped, and reversible", async () => {
  const [migration, rollback] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(rollbackUrl, "utf8"),
  ])

  assert.match(migration, /^\s*begin\s*;/i)
  assert.match(migration, /commit\s*;\s*$/i)
  assert.match(migration, /enabled boolean not null default false/i)
  assert.match(migration, /shadow_mode boolean not null default true/i)
  assert.match(migration, /CONFIRMED_SOLD_EXACT/i)
  assert.match(migration, /cardinality\(hard_gate_codes\) = 0/i)
  assert.match(migration, /membership_kind = 'COMMERCIAL'/i)
  assert.match(migration, /task\.lane in \('hot', 'baseline', 'coverage'\)/i)
  assert.match(migration, /for update of task, membership skip locked/i)
  assert.match(migration, /limit greatest\(1, least\(coalesce\(p_limit, 5\), 5\)\)/i)
  assert.match(migration, /complete_ebay_commercial_scan_task_v2/i)
  assert.match(migration, /defer_ebay_commercial_scan_task_v2/i)
  assert.match(migration, /selector_v2_last_deep_analyzed_at = now\(\)/i)
  assert.match(migration, /selector_v2_next_deep_eligible_at = v_next/i)
  assert.match(migration, /enable row level security/i)
  assert.equal(migration.match(/force row level security/gi)?.length, 3)
  assert.match(
    migration,
    /membership\.membership_kind = 'COMMERCIAL'[\s\S]+membership\.status = 'LEASED'[\s\S]+get diagnostics v_membership_updated = row_count[\s\S]+if v_membership_updated <> 1/i,
  )
  assert.match(
    migration,
    /selector_v2_deferred_reason = null[\s\S]+returning task\.\* into v_task/i,
  )
  assert.match(migration, /revoke all[\s\S]+from public, anon, authenticated/i)
  assert.match(migration, /to service_role/i)
  assert.doesNotMatch(
    migration,
    /\b(?:publishOffer|createOffer|reviseInventoryStatus|sendOfferToInterestedBuyers)\b/i,
  )

  assert.match(rollback, /^\s*begin\s*;/i)
  assert.match(rollback, /set enabled = false/i)
  assert.doesNotMatch(rollback, /\b(?:drop table|truncate|delete from)\b/i)
  assert.doesNotMatch(rollback, /no force row level security/i)
  assert.match(rollback, /commit\s*;\s*$/i)
})
