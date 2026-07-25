import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722027000_reference_guided_final_asset_selection.sql",
  import.meta.url), "utf8")
const script = readFileSync(new URL(
  "../../scripts/record-reference-guided-final-asset-selection.mjs",
  import.meta.url), "utf8")

test("final deterministic selection is append-only and exact", () => {
  assert.match(migration, /primary_verdict = 'APPROVED'/)
  assert.match(migration, /material_detail_source = 'SIDE'/)
  assert.match(migration, /material_detail_verdict = 'APPROVED'/)
  assert.match(migration, /EDGE_CLIPPING\/INFERIOR_COMPOSITION/)
  assert.match(migration, /COMMERCIAL_OBJECTIVE_MISMATCH/)
  assert.match(migration, /prevent_reference_guided_human_evidence_mutation/)
})

test("positions 2-6 and provider budget are immutable selection preconditions", () => {
  assert.match(migration, /position between 2 and 6/)
  assert.match(migration, /status <> 'PENDING'/)
  assert.match(migration, /provider_calls <> 2/)
  assert.match(migration, /ebay_writes <> 0/)
  assert.match(migration, /production_changed <> false/)
  assert.match(migration, /grant execute[\s\S]*service_role/)
})

test("selection hashes are recalculated from downloaded private PNG bytes", () => {
  assert.match(script, /ebay-listing-image-staging/)
  assert.match(script, /\.download\(path\)/)
  assert.match(script, /sha256\(bytes\)/)
  assert.match(script, /metadata\.format !== "png"/)
  assert.match(script, /metadata\.width !== 1600/)
  assert.match(script, /OPENAI_REFERENCE_GUIDED_PRODUCT_GENERATION_ENABLED/)
})
