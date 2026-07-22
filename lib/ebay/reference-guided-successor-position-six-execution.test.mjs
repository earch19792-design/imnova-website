import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722043000_authorize_successor_position_6.sql",
  import.meta.url), "utf8")
const executor = readFileSync(new URL(
  "../../scripts/execute-reference-guided-successor-position-6.mjs",
  import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/reference-guided-successor-position-6/route.ts",
  import.meta.url), "utf8")
const resolverRepair = readFileSync(new URL(
  "../../supabase/migrations/20260722044000_fix_position_6_resolver_alias.sql",
  import.meta.url), "utf8")

test("position 6 authorization binds the persisted amendment before reservation", () => {
  assert.match(migration, /position6AmendmentId/)
  assert.match(migration, /position6AmendmentHash/)
  assert.match(migration, /position6EffectiveContractHash/)
  assert.match(migration, /position6EffectivePromptHash/)
  assert.match(migration, /provider_calls <> 5/)
  assert.match(migration, /provider_calls = 5/)
  assert.match(migration, /v_calls <> 6/)
  assert.match(migration, /position = 6 and e\.event_type = 'AUTHORIZED'/)
  assert.match(migration, /position = 6 and provider_call_ordinal = 6/)
})

test("position 6 canary performs one HTTP request and requires human review", () => {
  assert.match(executor, /providerFetches \+= 1/)
  assert.match(executor, /providerFetches !== 1/)
  assert.match(executor, /automaticRetryOccurred: false/)
  assert.match(executor, /HUMAN_REVIEW_REQUIRED/)
  assert.match(executor, /position6\?\.status !== "QA_PENDING"/)
  assert.match(executor, /Number\(after\.attempt\.provider_calls\) !== 6/)
  assert.match(executor, /process\.env\[FEATURE_FLAG\] = "false"/)
  assert.match(executor, /position4Unchanged/)
  assert.match(executor, /positions0To5Unchanged/)
})

test("position 6 endpoint is service-role-only and preview-staging-only", () => {
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/)
  assert.match(route, /VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH/)
  assert.match(route, /RUN_ONE_STAGING_SUCCESSOR_V2_POSITION_6_PROVIDER_CALL_6/)
  assert.match(route, /finally \{[\s\S]*process\.env\[FEATURE_FLAG\] = "false"/)
})

test("position 6 resolver repair is additive and qualifies colliding columns", () => {
  assert.match(resolverRepair, /r\.main_source_hash, r\.side_source_hash/)
  assert.match(resolverRepair, /POSITION_6_RESOLVER_ALIAS_REPAIR_SOURCE_MISMATCH/)
  assert.match(resolverRepair, /pg_get_functiondef/)
  assert.doesNotMatch(resolverRepair, /provider_calls\s*=/)
  assert.doesNotMatch(resolverRepair, /insert into public\.ebay_reference_guided_successor_provider_events/)
})
