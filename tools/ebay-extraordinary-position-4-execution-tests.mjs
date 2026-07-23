import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  "supabase/migrations/20260722047000_execute_extraordinary_position_4.sql", "utf8")
const executor = readFileSync(
  "scripts/execute-reference-guided-extraordinary-position-4.mjs", "utf8")
const route = readFileSync(
  "app/api/admin/ebay/images/reference-guided-extraordinary-position-4/route.ts", "utf8")
const authorizationFix = readFileSync(
  "supabase/migrations/20260722048000_fix_extraordinary_authorization_rpc.sql", "utf8")
const consumeFix = readFileSync(
  "supabase/migrations/20260722049000_fix_extraordinary_consume_rpc.sql", "utf8")

test("extraordinary ordinal 7 is exact, atomic, and scoped to one attempt", () => {
  assert.match(migration, /extraordinary_ordinal<>7/)
  assert.match(migration, /provider_calls=7/)
  assert.match(migration, /max_provider_calls=8/)
  assert.match(migration, /id <> 'f166b395-8d3a-4921-b273-1a62a6032707'/)
  assert.match(migration, /position=6 and status='BLOCKED_FIDELITY'/)
  assert.match(migration, /extraordinary_ordinal=8/)
  assert.match(migration, /EXTRAORDINARY_POSITION_4_ATOMIC_BUDGET_INVALID/)
})

test("authorization RPC qualifies ordinal columns and stays service-role-only", () => {
  assert.match(authorizationFix, /auth4\.extraordinary_ordinal=7/)
  assert.match(authorizationFix, /existing\.extraordinary_ordinal=v_position\.extraordinary_ordinal/)
  assert.match(authorizationFix, /grant execute[\s\S]*to service_role/)
  assert.doesNotMatch(authorizationFix, /grant execute[\s\S]*to authenticated/)
})

test("consume RPC qualifies authorization event and preserves migration history", () => {
  assert.match(consumeFix, /pg_get_functiondef/)
  assert.match(consumeFix, /authorization_provider_event\.authorization_event_id/)
  assert.match(consumeFix, /REPAIR_NOT_APPLIED/)
  assert.match(consumeFix, /to service_role/)
})

test("exact persisted plan, amendment, contract, prompt, and sources gate execution", () => {
  for (const value of [
    "9541617972ca0bf778941bcd5c6b11131df144b9fdb0e5bdca111f81b0e5f8f3",
    "8dbe3c4c8068a31d4c18153434faf7d7b88b25c17542cb67ad37f8aca80c1c8f",
    "6cac13ae461915ba22d79b381c98eb53de93bd1f052e54716f67901013ca582a",
    "4aca1c9ca9623e238c2f3714a01ed8d8931779d8fd06741c8173f8e9786ced91",
    "3e920855560159a9722cb54680f565beae9c41ff1cd247cd47af4cf626c5aed1",
    "f15c9e6e24018241290ded5a4838df1f9477f7b028fdf1f74c627b0780d42f21",
  ]) {
    assert.match(migration, new RegExp(value))
    assert.match(executor, new RegExp(value))
  }
  assert.match(migration, /final_effective_prompt_hash<>encode\(extensions\.digest\(convert_to\(v_position\.final_effective_prompt_text,'UTF8'\)/)
})

test("provider transport is one-shot Preview staging and never retries", () => {
  assert.match(executor, /providerFetches \+= 1/)
  assert.match(executor, /providerFetches !== 1/)
  assert.match(executor, /https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.match(executor, /automaticRetryOccurred: false/)
  assert.match(executor, /state\.authorizations\.length > 1/)
  assert.match(executor, /before\.authorizations\.length === 1/)
  assert.doesNotMatch(executor, /for \(let attempt|while \(|retry\(/i)
  assert.match(route, /VERCEL_ENV !== "preview"/)
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /RUN_ONE_STAGING_EXTRAORDINARY_POSITION_4_PROVIDER_CALL_7/)
  assert.match(route, /FEATURE_MUST_START_DISABLED/)
  assert.match(route, /process\.env\[FEATURE_FLAG\] = "false"/)
})

test("output remains private, roundtripped, and human-review-only", () => {
  assert.match(executor, /persistReferenceGuidedCanaryPng/)
  assert.match(executor, /reference-guided-extraordinary/)
  assert.match(executor, /HUMAN_REVIEW_REQUIRED/)
  assert.match(executor, /status !== "QA_PENDING"/)
  assert.match(migration, /technicalChecks'->>'png/)
  assert.match(migration, /technicalChecks'->>'width'\)::integer<>1600/)
  assert.match(migration, /technicalChecks'->>'height'\)::integer<>1600/)
})
