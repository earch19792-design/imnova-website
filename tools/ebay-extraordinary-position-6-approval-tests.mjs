import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260722052000_approve_extraordinary_position_6_final_set.sql",
  "utf8",
)

test("position 6 approval is exact, append-only and service-role-only", () => {
  assert.match(migration,
    /ebay_reference_guided_position_6_extraordinary_human_verdict_events/)
  assert.match(migration, /extraordinary_ordinal=8/)
  assert.match(migration,
    /a8fa2ce661850c386697cc762962c33376cdc2cd4d28b340f0c0c232de8b3c84/)
  assert.match(migration,
    /HUMAN_CONFIRMED_EXACT_TWO_HANDS_ONE_PER_HANDLE_NATURAL_ANATOMY_EMPTY_PROP_FREE_BACKGROUND_PRODUCT_EMPTY_AND_IDENTITY_PRESERVED/)
  assert.match(migration, /prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration,
    /revoke all on function public\.approve_ebay_reference_guided_extraordinary_position_6/)
  assert.match(migration,
    /grant execute on function public\.approve_ebay_reference_guided_extraordinary_position_6\([\s\S]*to service_role/)
})

test("approval preserves rejected evidence and validates ordinal 8 provenance", () => {
  assert.match(migration,
    /ebay_reference_guided_position_6_human_verdict_events/)
  assert.match(migration, /EXTRAORDINARY_POSITION_6_REJECTED_HISTORY_NOT_PRESERVED/)
  assert.match(migration, /event_type='CONSUMED'/)
  assert.match(migration, /event_type='OUTPUT_PERSISTED'/)
  assert.match(migration, /v_output\.evidence->>'outputSha256'<>p_output_sha256/)
  assert.match(migration, /v_consumed\.evidence->>'batchPlanHash'<>v_plan\.plan_hash/)
})

test("final selected set is exact, ordered, unique and not publication authorization", () => {
  for (const [position, role, sha] of [
    [0, "PRIMARY_MAIN", "44c7c5d832c4dd655fcc4a4865c51779406662c438a3e6ff5239606360cef3ba"],
    [1, "SECONDARY_MATERIAL_DETAIL", "38a8a2134ea3f1ce6415df061ee293690d09f6f8da82e66660b156eda6d53464"],
    [2, "SECONDARY_PACKAGE_CONTENTS", "7f0fc110c8ddcae312f596d9cccfc7174959f89553aab02fdd5a10c5d76583d2"],
    [3, "SECONDARY_SCALE_CAPACITY", "7a802b4fb4327ba1015a68ee5aa92d41f1892e2e5575ceef4366e321a0ae58da"],
    [4, "SECONDARY_USE_CONTEXT", "d2e22d365178742d4cb9baaac72f286fea2c7745fa607082b8a940f18bb7ed24"],
    [5, "SECONDARY_ASPIRATIONAL_LIFESTYLE", "c9f8f3fa5a090468a046c4868b4d0cb5c91b563ded69462864941e2ebbe9e47c"],
    [6, "SECONDARY_HUMAN_CONTEXT", "a8fa2ce661850c386697cc762962c33376cdc2cd4d28b340f0c0c232de8b3c84"],
  ]) {
    assert.match(migration, new RegExp(`'position',${position},'assetRole','${role}'`))
    assert.match(migration, new RegExp(sha))
  }
  assert.match(migration, /jsonb_array_length\(v_selected_assets\)<>7/)
  assert.match(migration, /count\(distinct asset->>'sha256'\)/)
  assert.match(migration, /final_set_atomic_gate/)
  assert.match(migration, /publication_authorized.*check \(not publication_authorized\)/s)
})

test("approval cannot create provider, lease, output or eBay writes", () => {
  assert.doesNotMatch(migration, /OPENAI_API_KEY|api\.openai\.com|images\/edits/)
  assert.doesNotMatch(migration, /provider_calls\s*=\s*provider_calls\s*\+/)
  assert.doesNotMatch(migration, /lease_owner\s*=/)
  assert.doesNotMatch(migration, /storage\.objects\s*\(/)
  assert.doesNotMatch(migration, /ebay_writes\s*=/)
  assert.match(migration, /provider_calls<>8/)
  assert.match(migration, /ebay_writes<>0/)
  assert.match(migration, /production_changed/)
})
