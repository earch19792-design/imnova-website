import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260726144000_add_ebay_luna_bootstrap_canary_v1_shadow.sql",
  import.meta.url,
)
const rollbackUrl = new URL(
  "../../supabase/rollback/20260726144000_add_ebay_luna_bootstrap_canary_v1_shadow.down.sql",
  import.meta.url,
)

test("bootstrap canary migration is additive, shadow-only, and reversible", async () => {
  const [migration, rollback] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(rollbackUrl, "utf8"),
  ])
  assert.match(migration, /^\s*begin\s*;/i)
  assert.match(migration, /add column if not exists eligible_for_bootstrap_canary/i)
  assert.match(migration, /add column if not exists lane text/i)
  assert.match(migration, /add column if not exists risk_score numeric/i)
  assert.match(migration, /bootstrapCanaryEnabled', false/i)
  assert.match(migration, /enabled = false/i)
  assert.match(
    migration,
    /coalesce\([\s\S]*public\.ebay_luna_selector_policies_v2\.policy,[\s\S]*\|\|[\s\S]*'bootstrapCanaryEnabled', false/i,
  )
  assert.match(migration, /forced_listing_quantity = 1/i)
  assert.match(migration, /promotion_rate_percent = 0/i)
  assert.match(migration, /not price_decrease_allowed/i)
  assert.match(migration, /not external_writes_allowed/i)
  assert.match(migration, /EXACT_PACK_REQUIRED/i)
  assert.match(migration, /execution_mode = 'SHADOW'/i)
  assert.match(migration, /consumable_research_boost between 0 and 5/i)
  assert.match(migration, /force row level security/i)
  assert.match(migration, /to service_role/i)
  assert.doesNotMatch(
    migration,
    /\b(?:publishOffer|createOffer|reviseInventoryStatus|sendOfferToInterestedBuyers)\b/i,
  )
  assert.match(migration, /commit\s*;\s*$/i)
  assert.match(rollback, /bootstrapCanaryEnabled/i)
  assert.match(rollback, /'false'::jsonb/i)
  assert.doesNotMatch(rollback, /\b(?:drop table|truncate|delete from)\b/i)
  assert.match(rollback, /commit\s*;\s*$/i)
})
