import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildReferenceGuidedFinalBatchSuccessorV2 } from
  "./reference-guided-final-batch-plan-v2.ts"

const objectives = [
  "CONFIRMED_PACKAGE_CONTENTS", "SCALE_AND_CAPACITY_CONTEXT",
  "PRIMARY_BENEFIT_IN_ACTION", "ASPIRATIONAL_LIFESTYLE",
  "REAL_HUMAN_USE",
]
const jobs = objectives.map((commercial_role, index) => ({
  position: index + 2,
  commercial_role,
  prompt_hash: String(index + 1).repeat(64),
  allowed_product_facts: [
    { key: "type", value: "colander", unit: null, scope: "PRODUCT_UNIT" },
    { key: "exactProductName", value: "Martha Stewart 1.5 Quart Colander",
      unit: null, scope: "PRODUCT_UNIT" },
    { key: "netContent", value: 1.5, unit: "quart", scope: "PRODUCT_UNIT" },
    { key: "unitGrossWeight", value: 454, unit: "g", scope: "LOGISTICS_ONLY" },
  ],
  allowed_generated_context: [`orientation ${index + 2}`],
  prohibited_claims: ["No invented facts."],
}))
const input = {
  attemptId: "f166b395-8d3a-4921-b273-1a62a6032707",
  revisionId: "3a4a233e-d4bc-4a65-825f-c4882bceb9d1",
  predecessorPlanId: "3cea1494-0f36-46ca-8db1-9d997b293e56",
  predecessorPlanHash: "1a1a048d77718f660e907150d622ba3c00293d7b4974c9b4a4497efe26ad5709",
  compositionManifestHash: "a".repeat(64),
  productDossierHash: `sha256:${"b".repeat(64)}`,
  marketVisualBriefHash: "c".repeat(64),
  mainSourceHash: "d".repeat(64),
  sideSourceHash: "e".repeat(64),
  approvedPrimarySha256: "f".repeat(64),
  approvedMaterialDetailSha256: "1".repeat(64),
  jobs,
}

test("V2 preserves its V1 predecessor and makes every position mandatory", () => {
  const { plan } = buildReferenceGuidedFinalBatchSuccessorV2(input)
  assert.equal(plan.predecessorPlanId, input.predecessorPlanId)
  assert.equal(plan.predecessorPlanHash, input.predecessorPlanHash)
  assert.deepEqual(plan.positions.map((position) => position.position),
    [2, 3, 4, 5, 6])
  for (const position of plan.positions) {
    assert.ok(position.mustInclude.length > 0)
    assert.ok(position.mustInclude.every((rule) => rule.startsWith("MUST ")))
    assert.doesNotMatch(position.exactPromptText, /\bmay\b/i)
    assert.match(position.exactPromptText, /POSITION_MUST_INCLUDE_JSON=/)
    assert.match(position.exactPromptText,
      /POSITION_MUST_INCLUDE MUST take priority/)
  }
})

test("position 3 removes logistics and capacity values from its visual prompt", () => {
  const { plan } = buildReferenceGuidedFinalBatchSuccessorV2(input)
  const position = plan.positions.find((item) => item.position === 3)
  assert.ok(position)
  assert.doesNotMatch(position.exactPromptText,
    /unitGrossWeight|454|1\.5 quart/i)
  assert.deepEqual(position.visualProductFacts,
    [{ key: "type", value: "colander", unit: null, scope: "PRODUCT_UNIT" }])
  assert.ok(position.mustInclude.some((rule) => /beside the product/.test(rule)))
  assert.ok(position.mustExclude.some((rule) => /lifestyle composition/.test(rule)))
})

test("positions 3-6 have distinct mandatory contracts and gated phases", () => {
  const { plan } = buildReferenceGuidedFinalBatchSuccessorV2(input)
  const positions = new Map(plan.positions.map((position) =>
    [position.position, position]))
  assert.ok(positions.get(4).mustInclude.some((rule) =>
    /fruit or vegetables inside/.test(rule)))
  assert.ok(positions.get(4).mustInclude.some((rule) =>
    /gentle rinse water/.test(rule)))
  assert.ok(positions.get(5).mustExclude.some((rule) =>
    /hands, water, or food inside/.test(rule)))
  assert.ok(positions.get(6).mustInclude.some((rule) =>
    /two real human hands/.test(rule)))
  assert.equal(positions.get(5).executionPhase,
    "PHASE_B_SINGLE_PROVIDER_VALIDATION_AFTER_POSITION_2_HUMAN_APPROVAL")
  for (const number of [3, 4, 6]) {
    assert.equal(positions.get(number).executionPhase,
      "BLOCKED_UNTIL_POSITION_5_HUMAN_APPROVAL")
  }
  assert.equal(plan.positions.every((position) =>
    position.distinctCommercialComposition.length === 5), true)
})

test("position 2 is deterministic and the lifetime provider budget is unchanged", () => {
  const { plan } = buildReferenceGuidedFinalBatchSuccessorV2(input)
  const position = plan.positions[0]
  assert.equal(position.position, 2)
  assert.equal(position.mode, "DETERMINISTIC")
  assert.equal(position.plannedProviderCalls, 0)
  assert.deepEqual(position.authorizedSources,
    [{ sourceImageId: "SIDE", sha256: "e".repeat(64) }])
  assert.equal(plan.lifetimeProviderBudgetUsed, 2)
  assert.equal(plan.lifetimeProviderBudgetRemaining, 4)
  assert.equal(plan.plannedProviderCalls, 4)
  assert.equal(plan.maxConcurrency, 2)
  assert.equal(plan.automaticRetries, false)
})

test("every exact prompt hash covers the complete UTF-8 prompt", () => {
  const { plan } = buildReferenceGuidedFinalBatchSuccessorV2(input)
  for (const position of plan.positions) {
    const hash = createHash("sha256")
      .update(Buffer.from(position.exactPromptText, "utf8")).digest("hex")
    assert.equal(position.exactPromptHash, hash)
  }
})

test("the V2 migration is append-only planning with no execution authority", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260722029000_reference_guided_batch_plan_successor_v2.sql",
    import.meta.url), "utf8")
  assert.match(migration, /predecessor_plan_id/)
  assert.match(migration, /references public\.ebay_reference_guided_final_batch_plans/)
  assert.match(migration, /prevent_reference_guided_human_evidence_mutation/)
  assert.match(migration, /SUCCESSOR_BATCH_PLAN_POSITIONS_INCOMPLETE/)
  assert.match(migration, /grant execute[\s\S]*service_role/)
  assert.doesNotMatch(migration,
    /update public\.ebay_reference_guided_generation_(?:attempts|jobs)/i)
  assert.doesNotMatch(migration,
    /set provider_calls =|set status = 'RESERVED'|lease_owner = p_/i)
})
