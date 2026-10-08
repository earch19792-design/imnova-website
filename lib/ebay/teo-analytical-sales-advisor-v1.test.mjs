import assert from "node:assert/strict"
import test from "node:test"

import { buildTeoAnalyticalSalesAdvisorV1,
  TEO_ANALYTICAL_SALES_ADVISOR_V1 } from
  "./teo-analytical-sales-advisor-v1.ts"

const available = (value) => ({ status: "AVAILABLE", value,
  limitationCode: null })

function input(overrides = {}) {
  return {
    observedAt: "2026-10-08T18:00:00.000Z", limit: 20,
    commercialContext: {
      todaysPriorities: [{ entityKey: "123456789012",
        entityType: "EBAY_LIVE_LISTING", title: "Listing with low CTR",
        classification: "ACTIONABLE_COMMERCIAL", priority: "HIGH",
        confidence: "HIGH", reasonCodes: ["LOW_CTR"],
        recommendedAction: "IMPROVE_CTR", humanApprovalRequired: true,
        actionBlockedByEvidence: false, experimentProtectionExists: false,
        lastObservationTime: "2026-10-08T17:50:00.000Z" }],
      qualityGuidance: { status: "AVAILABLE", recommendations: [{
        actionState: "ACTIONABLE", freshness: "CURRENT",
        listingKey: "listing:123456789012",
        recommendationType: "TITLE", recommendationCategory: "DISCOVERY",
        recommendationText: "Improve the title with proven keywords",
        associationStatus: "ITEM_ID_CERTIFIED",
        observedAt: "2026-10-08T17:45:00.000Z",
        reportedBenchmark: 0.02, topCategoryBenchmark: 0.04,
      }] },
      recentSales: { status: "AVAILABLE", limitationCodes: [] },
    },
    systemReview: { automationCandidates: { entries: [{
      candidateId: "automation-1", manualOperation: "RECAPTURE_STALE_STOCK",
      deterministicPattern: "Three stale stock observations",
      evidenceCount: 3, evidenceRefs: ["item-1", "item-2", "item-3"],
      riskClass: "MEDIUM", proposedAutomationBoundary: "PREPARATION_ONLY",
    }] } },
    amazon: available({ automation: { sync: { run_status: "SUCCEEDED",
      connection_status: "CONNECTED", last_success_at:
        "2026-10-08T17:30:00.000Z" } }, cards: [{ id: "amazon-1",
      title: "Connie winner", capturedAt: "2026-10-08T17:40:00.000Z",
      purchaseGate: { decision: "BUY" }, observation: {
        product: { title: "Connie winner" }, supplier: { sku: "CONNIE-1" },
        demand: { confirmed: true }, blockers: [],
        outcome: { skillOutcome: "WINNER",
          reorderDecision: "REVIEW_REORDER" },
        performance: { authoritative: true, observedUnitsSold: 8,
          actualNetProfitPerUnitUsd: 7.5 },
        nextBestEvidence: { action: "REVIEW_REORDER" },
      } }] }),
    luna: available({ candidates: [{ productId: "100", variantId: "200",
      sku: "LUNA-1", title: "Luna proven candidate", availability: true,
      opportunityStatus: "COMMERCIAL_TRACE_APPROVED_OPPORTUNITY",
      freshness: { observedAt: "2026-10-08T17:20:00.000Z" },
      historicalCommercialEvidence: { demand_validation_passed: true,
        exact_identity: true, sold_exact_units: 5, decision: "ADVANCE" },
      economicFloors: { netProfit: 8 },
      landedCost: { status: "DEMONSTRATED" },
    }] }),
    workstation: available({ runtimeStatus: "ONLINE",
      observedAt: "2026-10-08T17:59:00.000Z",
      counts: { stale: 0, failedLast24Hours: 0 },
      session: { catchUpCandidateCount: 0 } }),
    ...overrides,
  }
}

test("TEO ranks products, listings, inventory and automation without mutations", () => {
  const result = buildTeoAnalyticalSalesAdvisorV1(input())
  assert.equal(result.contractVersion, TEO_ANALYTICAL_SALES_ADVISOR_V1)
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.executiveSummary.productOpportunities, 1)
  assert.equal(result.executiveSummary.listingImprovements, 2)
  assert.equal(result.executiveSummary.inventoryActions, 1)
  assert.equal(result.executiveSummary.automationImprovements, 1)
  assert.equal(result.opportunities[0].title, "Connie winner")
  assert.equal(result.opportunities[0].nextSafeAction, "OWNER_REVIEW_REORDER")
  assert.equal(result.opportunities.every((row) =>
    row.automaticExecutionAllowed === false), true)
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.supplierPurchases, 0)
  assert.equal(result.safety.repricing, 0)
  assert.equal(result.guidancePolicy.missingDataNeverBecomesZero, true)
  assert.doesNotMatch(JSON.stringify(result),
    /accessToken|refreshToken|clientSecret|serviceRoleKey|buyerEmail/i)
})

test("unavailable sources remain explicit data gaps and do not become false zeros", () => {
  const unavailable = { status: "UNAVAILABLE", value: null,
    limitationCode: "SOURCE_NOT_CERTIFIED" }
  const result = buildTeoAnalyticalSalesAdvisorV1(input({
    amazon: unavailable, luna: unavailable, workstation: unavailable,
  }))
  assert.equal(result.status, "PARTIAL")
  assert.equal(result.dataGaps.includes("SOURCE_NOT_CERTIFIED"), true)
  assert.equal(result.sourceReads.filter((row) =>
    row.status === "UNAVAILABLE").length, 3)
  assert.equal(result.guidancePolicy.contributorClaimsAreNotMarketplaceProof,
    true)
})

test("analytical seller output is bounded to twenty ranked recommendations", () => {
  const many = Array.from({ length: 30 }, (_, index) => ({
    entityKey: String(300000000000 + index),
    entityType: "EBAY_LIVE_LISTING", title: `Listing ${index}`,
    classification: "ACTIONABLE_COMMERCIAL", priority: "HIGH",
    confidence: "HIGH", reasonCodes: ["LOW_CTR"],
    recommendedAction: "IMPROVE_CTR", humanApprovalRequired: true,
    actionBlockedByEvidence: false, experimentProtectionExists: false,
    lastObservationTime: "2026-10-08T17:50:00.000Z",
  }))
  const value = input({ limit: 20,
    commercialContext: { ...input().commercialContext,
      todaysPriorities: many } })
  const result = buildTeoAnalyticalSalesAdvisorV1(value)
  assert.equal(result.opportunities.length, 20)
  assert.deepEqual(result.opportunities.map((row) => row.rank),
    Array.from({ length: 20 }, (_, index) => index + 1))
})

test("TEO surfaces a durable partial recovery as an automation improvement", () => {
  const result = buildTeoAnalyticalSalesAdvisorV1(input({
    workstation: available({ runtimeStatus: "ONLINE",
      observedAt: "2026-10-08T18:10:00.000Z",
      counts: { stale: 0, failedLast24Hours: 0 },
      session: { catchUpCandidateCount: 0 },
      jobs: [{ name: "quick-pick-runtime-recovery",
        outcomeCode: "QUICK_PICK_RECOVERY_PARTIAL" }] }),
  }))
  const recovery = result.automationIdeas.find((row) =>
    row.source === "SELLER_OS_SELFHOST_RUNTIME_STATUS")
  assert.ok(recovery)
  assert.deepEqual(recovery.evidence.deferredJobs, [{
    name: "quick-pick-runtime-recovery",
    outcomeCode: "QUICK_PICK_RECOVERY_PARTIAL",
  }])
  assert.equal(recovery.automaticExecutionAllowed, false)
})
