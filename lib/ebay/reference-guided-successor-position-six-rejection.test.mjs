import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722045000_reject_successor_position_6.sql",
  import.meta.url), "utf8")

test("position 6 rejection is append-only and exact-evidence-bound", () => {
  assert.match(migration,
    /ebay_reference_guided_position_6_human_verdict_events/)
  assert.match(migration,
    /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /to service_role/)
  assert.match(migration,
    /0fb3b3241860c3f045ad822eb576cb0a8a11fb5b0f02cb522825c3d82bdfda14/)
  assert.match(migration, /req_9237452d1c5e4604bdefdb6e7d382871/)
  assert.match(migration, /BACKGROUND_KITCHEN_UTENSILS_PRESENT/)
  assert.match(migration, /EFFECTIVE_CONTRACT_VIOLATION/)
})

test("rejection preserves prompt, amendment, provider, and Storage evidence", () => {
  assert.match(migration, /effective_prompt_text text not null/)
  assert.match(migration,
    /d9aed20d4a22b109a2093da86d29c1b46bf461927b50c9891d80aee0b381d204/)
  assert.match(migration,
    /180408823f7544477176bebf70fc14fc610fd755bc85d117c3792eb15945b144/)
  assert.match(migration,
    /27d40d2330ad3f33ca88ffde19b20021d5f91ef9d16105c0626a71153d3aaa52/)
  assert.match(migration, /event_type = 'OUTPUT_PERSISTED'/)
  assert.match(migration, /o\.name = v_job\.output_storage_path/)
  assert.match(migration, /status = 'BLOCKED_FIDELITY'/)
})

test("rejection records passed checks and creates no execution state", () => {
  assert.match(migration, /'exactlyTwoHands', true/)
  assert.match(migration, /'naturalAnatomy', true/)
  assert.match(migration, /'productIdentityPassed', true/)
  assert.match(migration, /'backgroundKitchenUtensilsPresent', true/)
  assert.match(migration, /v_attempt\.provider_calls <> 6/)
  assert.match(migration, /position = 4[\s\S]*status = 'BLOCKED_FIDELITY'/)
  assert.match(migration, /replacementAuthorized',false/)
  assert.doesNotMatch(migration, /set provider_calls =/)
  assert.doesNotMatch(migration, /set status = 'PROVIDER_CALLING'/)
  assert.doesNotMatch(migration, /insert[\s\S]{0,300}'CONSUMED'/)
})
