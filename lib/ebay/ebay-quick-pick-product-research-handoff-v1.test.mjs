import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const {
  projectQuickPickProductResearchEligibilityV1,
  reconcileQuickPickProductResearchHandoffV1,
} = await import("./ebay-quick-pick-product-research-handoff-v1.ts")

const candidate = `sha256:${"4".repeat(64)}`

function quickPickRow(overrides = {}) {
  return {
    id: "90477894-9ac3-47ea-9cbd-208ee641abdb",
    candidate_key: candidate,
    supplier_product_id: "9266387058912",
    supplier_variant_id: "48907793826016",
    supplier_sku: "ITEM1046",
    product_title: "U.S. Kitchen 4 Piece Set Stainless Steel Mesh Strainers",
    opportunity_score: 50,
    assessment: {
      lunaQuickPickOperationV1: {
        contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
      },
      market: { familyDemandStatus: "FAMILY_DEMAND_UNPROVEN" },
    },
    ...overrides,
  }
}

function dependencies({ rows = [quickPickRow()], fresh = false,
  createPlan } = {}) {
  return {
    readRows: async () => rows,
    readCapability: async () => ({ fresh,
      extensionState: fresh ? "HEALTHY" : "WAITING_DEPENDENCY",
      workerState: fresh ? "HEALTHY" : "WAITING_DEPENDENCY",
      receiptId: "capability-receipt", observedAt: "2026-09-07T04:00:00Z" }),
    createPlan: createPlan ?? (async ({ eligibility,
      workerCapabilityFresh }) => ({
      planId: `plan:${eligibility.candidateId}`,
      planCreated: true,
      researchState: workerCapabilityFresh
        ? "CLAIMABLE" : "WAITING_FOR_WORKER",
    })),
  }
}

test("PASS_QUICK_PICK_UNPROVEN_DEMAND_CREATES_RESEARCH_PLAN", async () => {
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT", dependencies: dependencies(),
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.eligibleCandidateCount, 1)
  assert.equal(result.createdPlanCount, 1)
  assert.equal(result.outcomes[0].lunaProductId, "9266387058912")
})

test("PASS_EXISTING_PLAN_REUSED", async () => {
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT",
    dependencies: dependencies({ createPlan: async () => ({
      planId: "existing-plan", planCreated: false,
      researchState: "WAITING_FOR_WORKER",
    }) }),
  })
  assert.equal(result.createdPlanCount, 0)
  assert.equal(result.reusedPlanCount, 1)
  assert.equal(result.outcomes[0].planId, "existing-plan")
})

test("PASS_REPEATED_CONTINUATION_NO_DUPLICATE", async () => {
  const plans = new Map()
  const createPlan = async ({ eligibility, workerCapabilityFresh }) => {
    const existing = plans.get(eligibility.candidateId)
    if (existing) return { ...existing, planCreated: false,
      researchState: workerCapabilityFresh
        ? "CLAIMABLE" : "WAITING_FOR_WORKER" }
    const plan = { planId: "one-durable-plan" }
    plans.set(eligibility.candidateId, plan)
    return { ...plan, planCreated: true,
      researchState: "WAITING_FOR_WORKER" }
  }
  const input = { supabase: {}, accountKey: "EBAY_US_ACCOUNT",
    dependencies: dependencies({ createPlan }) }
  const first = await reconcileQuickPickProductResearchHandoffV1(input)
  const second = await reconcileQuickPickProductResearchHandoffV1(input)
  assert.equal(first.createdPlanCount, 1)
  assert.equal(second.createdPlanCount, 0)
  assert.equal(second.reusedPlanCount, 1)
  assert.equal(plans.size, 1)
})

test("PASS_EXPIRED_WORKER_PRESERVES_WAITING_FOR_WORKER", async () => {
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT", dependencies: dependencies(),
  })
  assert.equal(result.workerCapability, "EXPIRED_OR_UNPROVEN")
  assert.equal(result.waitingForWorkerCount, 1)
  assert.equal(result.outcomes[0].researchState, "WAITING_FOR_WORKER")
  assert.equal(result.failedCount, 0)
})

test("PASS_CAPABILITY_RESTORED_PLAN_BECOMES_CLAIMABLE", async () => {
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT",
    dependencies: dependencies({ fresh: true }),
  })
  assert.equal(result.workerCapability, "FRESH")
  assert.equal(result.claimableCount, 1)
  assert.equal(result.outcomes[0].researchState, "CLAIMABLE")
})

test("PASS_PROVEN_MARKET_RESEARCH_DOES_NOT_CREATE_DUPLICATE_PLAN", async () => {
  let createCalls = 0
  const row = quickPickRow({ assessment: {
    lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
    },
    market: { familyDemandStatus: "FAMILY_DEMAND_PROVEN" },
  } })
  assert.equal(projectQuickPickProductResearchEligibilityV1(row).eligible,
    false)
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT",
    dependencies: dependencies({ rows: [row], createPlan: async () => {
      createCalls += 1
      return {}
    } }),
  })
  assert.equal(result.eligibleCandidateCount, 0)
  assert.equal(createCalls, 0)
})

test("PASS_EXISTING_GOLDEN_PRODUCT_RECOVERED_WITHOUT_OWNER_RESUBMIT", async () => {
  let requestedCandidateScope = "NOT_CALLED"
  const deps = dependencies()
  deps.readRows = async ({ candidateKeys }) => {
    requestedCandidateScope = candidateKeys
    return [quickPickRow()]
  }
  const result = await reconcileQuickPickProductResearchHandoffV1({
    supabase: {}, accountKey: "EBAY_US_ACCOUNT", dependencies: deps,
  })
  assert.equal(requestedCandidateScope, undefined)
  assert.equal(result.reconciledPlanCount, 1)
  assert.equal(result.outcomes[0].candidateId, candidate)
})

test("migration and scheduled runtime preserve the systemic contract", () => {
  const migration = readFileSync(
    "supabase/migrations/20260907042647_golden_quick_pick_research_handoff_v1.sql",
    "utf8",
  )
  const runtime = readFileSync(
    "app/api/cron/quick-pick-runtime-recovery/route.ts", "utf8")
  const mechanism = readFileSync(
    "lib/ebay/ebay-quick-pick-product-research-handoff-v1.ts", "utf8")
  const queryPlan = readFileSync(
    "lib/ebay/ebay-product-research-query-plan.ts", "utf8")
  assert.match(migration,
    /create_or_reuse_quick_pick_product_research_plan_v1/)
  assert.match(migration,
    /marketplace_product_research_query_plans_quick_pick_identity_uidx/)
  assert.match(migration, /WAITING_FOR_WORKER/)
  assert.match(runtime, /reconcileQuickPickProductResearchHandoffV1/)
  assert.match(runtime,
    /QUICK_PICK_PRODUCT_RESEARCH_HANDOFF_RECONCILIATION_FAILED/)
  assert.match(runtime,
    /success: recovery\.status === "PASS"/)
  assert.match(queryPlan,
    /baseQuery\(\)\.eq\("status", "ACTIVE"\)/)
  assert.doesNotMatch(mechanism, /ITEM1046|9266387058912|48907793826016/)
  assert.doesNotMatch(mechanism,
    /publishEbay|ReviseFixedPriceItem|createOffer|updatePrice/i)
})
