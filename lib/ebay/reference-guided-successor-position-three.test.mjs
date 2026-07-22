import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722036000_authorize_successor_position_3.sql",
  import.meta.url), "utf8")
const executor = readFileSync(new URL(
  "../../scripts/execute-reference-guided-successor-position-3.mjs",
  import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/reference-guided-successor-position-3/route.ts",
  import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx",
  import.meta.url), "utf8")

test("position 3 persists one exact mandatory lemon contract", () => {
  assert.match(migration,
    /select attempt_id, successor_plan_id, job_id, 3, 'AUTHORIZED', 4/)
  assert.match(migration,
    /MUST show exactly one common lemon beside the product, never inside it/)
  assert.match(migration, /exactPromptText/)
  assert.match(migration, /exactPromptHash/)
  assert.match(migration, /unitGrossWeight/)
  assert.match(migration, /v_position\.exact_prompt_text ~\* 'unitGrossWeight'/)
  assert.match(migration, /set provider_calls = a\.provider_calls \+ 1/)
  assert.match(migration, /a\.provider_calls = 3/)
  assert.match(migration, /if v_calls <> 4/)
  assert.match(migration, /position in \(4,6\)/)
})

test("position 3 executor makes one edit request with MAIN then SIDE", () => {
  assert.match(executor, /providerFetches \+= 1/)
  assert.match(executor, /providerFetches !== 1/)
  assert.match(executor, /https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.match(executor, /sourceImageIds: \["MAIN", "SIDE"\]/)
  assert.match(executor, /size: "1600x1600"/)
  assert.match(executor, /quality: "high"/)
  assert.match(executor, /outputFormat: "png"/)
  assert.match(executor, /automaticRetryOccurred: false/)
  assert.doesNotMatch(executor, /for \(let attempt|while \(/i)
})

test("position 3 route is Preview service-role-only and accepts no visual input", () => {
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /VERCEL_ENV !== "preview"/)
  assert.match(route, /VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH/)
  assert.match(route, /process\.env\[FEATURE_FLAG\] = "false"/)
  assert.doesNotMatch(route, /body\.(prompt|plan|position|hash|reference)/)
})

test("position 3 output stays pending human review and is rendered privately", () => {
  assert.match(executor, /automaticStatus: "HUMAN_REVIEW_REQUIRED"/)
  assert.match(executor, /autoApproved: false/)
  assert.match(executor, /publicationAuthorized: false/)
  assert.match(executor, /createSignedUrl\(outputStoragePath, 300\)/)
  assert.match(workspace, /SECONDARY_SCALE_CAPACITY/)
  assert.match(workspace, /exactamente un limón común al lado/)
})
