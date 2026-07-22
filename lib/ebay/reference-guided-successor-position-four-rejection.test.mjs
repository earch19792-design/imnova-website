import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722040000_reject_successor_position_4.sql",
  import.meta.url), "utf8")

test("position 4 rejection is append-only and exact-output-bound", () => {
  assert.match(migration,
    /ebay_reference_guided_position_4_human_verdict_events/)
  assert.match(migration,
    /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /to service_role/)
  assert.match(migration,
    /988304aedd2ce2c7ebcd505a5e812a930d550be99a5f8fb2d2b7e61561c5d123/)
  assert.match(migration,
    /OVERDRAMATIC_DRAINAGE_FLOW_AND_PRODUCT_IDENTITY_UNCERTAIN/)
  assert.match(migration, /output_preserved.*check \(output_preserved\)/)
  assert.match(migration, /reassigned.*check \(not reassigned\)/)
})

test("rejection preserves provider evidence and all effective hashes", () => {
  assert.match(migration, /req_204b2c7dff174a2cb395c063eb0232cd/)
  assert.match(migration, /d360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747/)
  assert.match(migration, /f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2/)
  assert.match(migration, /54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40/)
  assert.match(migration, /event_type = 'OUTPUT_PERSISTED'/)
  assert.match(migration, /o\.name = v_job\.output_storage_path/)
  assert.match(migration, /status = 'BLOCKED_FIDELITY'/)
})

test("rejection creates no budget, lease, reservation, or position 6 mutation", () => {
  assert.match(migration, /v_attempt\.provider_calls <> 5/)
  assert.match(migration, /position = 6[\s\S]*status = 'PENDING'/)
  assert.match(migration, /replacementAuthorized',false/)
  assert.doesNotMatch(migration, /set provider_calls =/)
  assert.doesNotMatch(migration, /set status = 'PROVIDER_CALLING'/)
  assert.doesNotMatch(migration, /insert[\s\S]{0,300}'CONSUMED'/)
  assert.doesNotMatch(migration, /position\s*=\s*6\s*;/)
})
