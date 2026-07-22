import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildReferenceGuidedFinalBatchPlan } from
  "./reference-guided-final-batch-plan.ts"

const objectives = [
  "CONFIRMED_PACKAGE_CONTENTS", "SCALE_AND_CAPACITY_CONTEXT",
  "PRIMARY_BENEFIT_IN_ACTION", "ASPIRATIONAL_LIFESTYLE",
  "REAL_HUMAN_USE",
]
const jobs = objectives.map((commercial_role, index) => ({
  position: index + 2,
  commercial_role,
  prompt_hash: String(index + 1).repeat(64),
  allowed_product_facts: [{ key: "exactProductName", value: "Exact item",
    unit: null, scope: "PRODUCT_UNIT" }],
  allowed_generated_context: [`orientation ${index + 2}`],
  prohibited_claims: ["No invented facts."],
}))
const input = {
  attemptId: "f166b395-8d3a-4921-b273-1a62a6032707",
  revisionId: "3a4a233e-d4bc-4a65-825f-c4882bceb9d1",
  compositionManifestHash: "a".repeat(64),
  productDossierHash: `sha256:${"b".repeat(64)}`,
  marketVisualBriefHash: "c".repeat(64),
  mainSourceHash: "d".repeat(64),
  sideSourceHash: "e".repeat(64),
  approvedPrimarySha256: "f".repeat(64),
  approvedMaterialDetailSha256: "1".repeat(64),
  jobs,
}

test("position 2 is deterministic SIDE-only and positions 3-6 use four calls", () => {
  const { plan } = buildReferenceGuidedFinalBatchPlan(input)
  assert.equal(plan.positions[0].position, 2)
  assert.equal(plan.positions[0].mode, "DETERMINISTIC")
  assert.equal(plan.positions[0].plannedProviderCalls, 0)
  assert.deepEqual(plan.positions[0].authorizedSources,
    [{ sourceImageId: "SIDE", sha256: "e".repeat(64) }])
  assert.equal(plan.positions.slice(1).every((position) =>
    position.mode === "PROVIDER" && position.plannedProviderCalls === 1), true)
  assert.equal(plan.plannedNewProviderCalls, 4)
  assert.equal(plan.lifetimeProviderBudgetUsed, 2)
  assert.equal(plan.lifetimeProviderBudgetRemaining, 4)
  assert.equal(plan.maxConcurrency, 2)
  assert.equal(plan.automaticRetries, false)
})

test("every exact prompt hash covers the complete UTF-8 prompt", () => {
  const { plan } = buildReferenceGuidedFinalBatchPlan(input)
  for (const position of plan.positions) {
    const hash = createHash("sha256")
      .update(Buffer.from(position.exactPromptText, "utf8")).digest("hex")
    assert.equal(position.promptHash, hash)
    assert.match(position.exactPromptText, /CANONICAL_PRODUCT_FACTS_JSON=/)
    assert.match(position.exactPromptText, /RESEARCH_GUIDANCE_ONLY_JSON=/)
    assert.match(position.exactPromptText, /RESEARCH_SCOPE=/)
    assert.match(position.exactPromptText, /IDENTITY_LOCK=/)
    assert.match(position.exactPromptText, /no text/i)
  }
})

test("the persisted planner is append-only and creates no execution authority", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722028000_reference_guided_final_batch_plan.sql",
    import.meta.url), "utf8")
  assert.match(migration, /AWAITING_HUMAN_BATCH_AUTHORIZATION/)
  assert.match(migration, /provider_calls <> 2/)
  assert.match(migration, /status <> 'PENDING' or lease_owner is not null/)
  assert.match(migration, /provider_call_started_at is not null/)
  assert.match(migration, /prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /grant execute[\s\S]*service_role/)
  assert.doesNotMatch(migration, /set provider_calls =|set status = 'RESERVED'|lease_owner = p_/)
})
