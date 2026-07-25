import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722039000_authorize_successor_position_4.sql",
  import.meta.url), "utf8")
const executor = readFileSync(new URL(
  "../../scripts/execute-reference-guided-successor-position-4.mjs",
  import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/reference-guided-successor-position-4/route.ts",
  import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx",
  import.meta.url), "utf8")

test("position 4 authorization is bound to the active amendment and fifth call", () => {
  assert.match(migration, /resolve_ebay_reference_guided_position_4_effective_contract/)
  assert.match(migration, /select attempt_id, successor_plan_id, job_id, 4, 'AUTHORIZED', 5/)
  assert.match(migration, /5fdc0614-8467-4d0c-97e9-9fc4c99828f7/)
  assert.match(migration, /d360d2f21818634a1b23497563031d5a29f9f71f7510731f4d8948d5ba2b9747/)
  assert.match(migration, /f20e805193add892e1c1d66e7aa3fb2543ee5e98a1f55ecdf7a342164aa49fc2/)
  assert.match(migration, /54a052f05f8724cd43c9c3db8ce9da6409ee53cfdc057ba5762be6aea7872d40/)
  assert.match(migration, /set provider_calls = a\.provider_calls \+ 1/)
  assert.match(migration, /a\.provider_calls = 4/)
  assert.match(migration, /if v_calls <> 5/)
  assert.match(migration, /POSITION_MUST_EXCLUDE=No human hands, fingers, arms, people, or human body parts/)
})
test("position 4 executor makes exactly one edit request with MAIN then SIDE", () => {
  assert.match(executor, /providerFetches \+= 1/)
  assert.match(executor, /providerFetches !== 1/)
  assert.match(executor, /https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.match(executor, /slot: "USE_CONTEXT", salesObjective: "PRIMARY_USE"/)
  assert.match(executor, /sourceImageIds: \["MAIN", "SIDE"\]/)
  assert.match(executor, /size: "1600x1600"/)
  assert.match(executor, /quality: "high"/)
  assert.match(executor, /outputFormat: "png"/)
  assert.match(executor, /automaticRetryOccurred: false/)
  assert.doesNotMatch(executor, /for \(let attempt|while \(/i)
})

test("position 4 route is Preview service-role-only and accepts no visual input", () => {
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /VERCEL_ENV !== "preview"/)
  assert.match(route, /VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH/)
  assert.match(route, /POSITION_4_PROVIDER_CALL_5/)
  assert.match(route, /process\.env\[FEATURE_FLAG\] = "false"/)
  assert.doesNotMatch(route, /body\.(prompt|plan|position|hash|reference|amendment)/)
})

test("position 4 output remains private and pending human review", () => {
  assert.match(executor, /automaticStatus: "HUMAN_REVIEW_REQUIRED"/)
  assert.match(executor, /handsOrHumanPartsDetected: human/)
  assert.match(executor, /autoApproved: false/)
  assert.match(executor, /publicationAuthorized: false/)
  assert.match(executor, /createSignedUrl\(outputStoragePath, 300\)/)
  assert.match(workspace, /SECONDARY_USE_CONTEXT/)
  assert.match(workspace, /partes humanas/)
})

test("position 4 completion persists every effective hash", () => {
  assert.match(migration, /p_qa_result->>'amendmentHash'/)
  assert.match(migration, /p_qa_result->>'effectivePositionContractHash'/)
  assert.match(migration, /p_qa_result->>'effectivePromptHash'/)
  assert.match(migration, /position = 6/)
  assert.match(migration, /automaticRetries',false/)
  assert.doesNotMatch(migration, /provider_calls\s*=\s*0/)
})
