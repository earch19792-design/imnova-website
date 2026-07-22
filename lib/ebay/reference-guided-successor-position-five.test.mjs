import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(new URL(
  "../../supabase/migrations/20260722032000_authorize_successor_phase_b_position_5.sql",
  import.meta.url), "utf8")
const qualificationMigration = readFileSync(new URL(
  "../../supabase/migrations/20260722033000_qualify_successor_position_5_authorization.sql",
  import.meta.url), "utf8")
const budgetQualificationMigration = readFileSync(new URL(
  "../../supabase/migrations/20260722034000_qualify_successor_position_5_budget.sql",
  import.meta.url), "utf8")
const executor = readFileSync(new URL(
  "../../scripts/execute-reference-guided-successor-phase-b-position-5.mjs",
  import.meta.url), "utf8")
const workspace = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx", import.meta.url), "utf8")
const route = readFileSync(new URL(
  "../../app/api/admin/ebay/images/reference-guided-successor-position-5/route.ts",
  import.meta.url), "utf8")

test("position 5 authorization is service-role-only and append-only", () => {
  assert.match(migration, /event_type in\s*\n?\s*\('AUTHORIZED','CONSUMED','OUTPUT_PERSISTED','FAILED_FINAL'\)/)
  assert.match(migration, /before update or delete[\s\S]*prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /force row level security/)
  assert.match(migration, /revoke all on table[\s\S]*public, anon, authenticated, service_role/)
  assert.match(migration, /grant select, insert on table[\s\S]*to service_role/)
})

test("one atomic RPC gates persisted plan, prompt, protected sources and call 3", () => {
  assert.match(migration, /plan_hash <> encode\(extensions\.digest/)
  assert.match(migration, /exact_prompt_hash <> encode\(extensions\.digest/)
  assert.match(migration, /POSITION_MUST_INCLUDE MUST take priority/)
  assert.match(migration, /provider_calls <> 2/)
  assert.match(migration, /status <> 'PENDING'/)
  assert.match(migration, /position in \(3,4,6\)/)
  assert.match(migration, /set provider_calls = provider_calls \+ 1/)
  assert.match(migration, /if v_calls <> 3/)
  assert.match(migration, /'CONSUMED'[\s\S]*'ATOMIC_SINGLE_PROVIDER_CALL_RESERVED'/)
  assert.match(qualificationMigration,
    /ebay_reference_guided_successor_provider_events\.job_id = v_job\.id/)
  assert.match(qualificationMigration, /pg_get_functiondef/)
  assert.match(budgetQualificationMigration,
    /set provider_calls = a\.provider_calls \+ 1/)
  assert.match(budgetQualificationMigration, /returning a\.provider_calls into v_calls/)
})

test("executor uses exactly one HTTP request and disables its transient flag", () => {
  assert.match(executor, /providerFetches \+= 1/)
  assert.match(executor, /providerFetches !== 1/)
  assert.match(executor, /https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.match(executor, /process\.env\[FEATURE_FLAG\] = "false"/)
  assert.doesNotMatch(executor, /for \(let attempt|while \(/i)
  assert.match(executor, /automaticRetryOccurred: false/)
  assert.match(executor, /sourceImageIds: \["MAIN", "SIDE"\]/)
  assert.match(executor, /size: "1600x1600"/)
  assert.match(executor, /quality: "high"/)
  assert.match(executor, /outputFormat: "png"/)
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /VERCEL_ENV !== "preview"/)
  assert.match(route, /VERCEL_GIT_COMMIT_REF !== AUTHORIZED_BRANCH/)
  assert.match(route, /process\.env\[FEATURE_FLAG\] = "false"/)
  assert.doesNotMatch(route, /body\.(prompt|plan|position|hash|reference)/)
})

test("position 5 remains fail-closed for human review and is rendered privately", () => {
  assert.match(executor, /automaticStatus: "HUMAN_REVIEW_REQUIRED"/)
  assert.match(executor, /autoApproved: false/)
  assert.match(executor, /publicationAuthorized: false/)
  assert.match(executor, /createSignedUrl\(outputStoragePath, 300\)/)
  assert.match(workspace, /SECONDARY_ASPIRATIONAL_LIFESTYLE/)
  assert.match(workspace, /nunca aprobada automáticamente/)
})
