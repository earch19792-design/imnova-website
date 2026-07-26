import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260726145000_correct_ebay_luna_canary_risk_semantics.sql",
  import.meta.url,
)

test("canary risk is independent from taxonomy and remains fail-closed", async () => {
  const migration = await readFile(migrationUrl, "utf8")
  assert.match(migration, /^\s*begin\s*;/i)
  assert.match(migration, /candidate,restrictionGuards/i)
  assert.match(
    migration,
    /EBAY_LUNA_SELECTOR_POLICY_MUST_BE_DISABLED_FOR_RISK_BACKFILL/i,
  )
  assert.match(migration, /enabled is distinct from false/i)
  assert.match(migration, /shadow_mode is distinct from true/i)
  assert.match(migration, /bootstrapCanaryEnabled/i)
  assert.doesNotMatch(
    migration,
    /taxonomyVerification,hardGuards/i,
  )
  assert.match(migration, /then 0[\s\S]*else 100/i)
  assert.match(migration, /else null/i)
  assert.match(migration, /is distinct from/i)
  assert.doesNotMatch(
    migration,
    /\b(?:publishOffer|createOffer|reviseInventoryStatus)\b/i,
  )
  assert.match(migration, /commit\s*;\s*$/i)
})
