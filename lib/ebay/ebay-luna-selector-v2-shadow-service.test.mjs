import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS,
  getEbayLunaSelectorV2ShadowConfiguration,
  loadEbayLunaSelectorV2QueueRows,
  normalizeEbayLunaSelectorV2QueueRow,
} from "./ebay-luna-selector-v2-shadow-service.ts"
import {
  evaluateEbayLunaSelectorCandidateV2,
  DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
  selectEbayLunaBatchV2,
} from "./ebay-luna-selector-v2-domain.ts"
import {
  buildOpportunityQueueRow,
} from "./ebay-first-luna-opportunity-queue.ts"

test("shadow selector remains disabled by default and always blocked in Production", () => {
  assert.equal(getEbayLunaSelectorV2ShadowConfiguration({}).enabled, false)
  assert.equal(getEbayLunaSelectorV2ShadowConfiguration({
    VERCEL_ENV: "preview",
    EBAY_LUNA_SELECTOR_V2_SHADOW_ENABLED: "true",
  }).enabled, true)
  const production = getEbayLunaSelectorV2ShadowConfiguration({
    VERCEL_ENV: "production",
    EBAY_LUNA_SELECTOR_V2_SHADOW_ENABLED: "true",
  })
  assert.equal(production.enabled, false)
  assert.equal(production.productionBlocked, true)
  assert.equal(production.ebayWritesAllowed, false)
})

test("legacy estimated quantities cannot be normalized as confirmed sold evidence", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-1",
    product_id: "product-1",
    family_key: "family-1",
    evidence_class: "ACTIVE_ONLY",
    estimated_sold_quantity: 500,
    seller_count: 100,
    demand_score: 100,
  })
  assert.equal(normalized.demand.evidenceClass, "ACTIVE_ONLY")
  assert.equal(normalized.demand.soldExactUnits, null)
  assert.equal(normalized.demand.soldExactSellerCount, null)
  const evaluation = evaluateEbayLunaSelectorCandidateV2(normalized)
  assert.equal(evaluation.readyToList, false)
  assert.equal(evaluation.ebayDemandScore, 0)
})

test("unknown fields remain unknown instead of becoming confirmed zeroes", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-2",
    product_id: "product-2",
  })
  assert.equal(normalized.supplier.numericStock, null)
  assert.equal(normalized.supplier.costUsd, null)
  assert.equal(normalized.demand.soldExactUnits, null)
  assert.equal(normalized.demand.evidenceClass, "INSUFFICIENT_EVIDENCE")
})

test("canonical queue columns and assessment are normalized fail-closed", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-canonical",
    market_radar_product_id: "product-canonical",
    supplier_variant_id: "variant-canonical",
    supplier_price: 10,
    supplier_available: true,
    supplier_inventory_quantity: 12,
    supplier_snapshot_at: "2026-07-26T12:00:00.000Z",
    estimated_net_profit: 8,
    economics_score: 88,
    supply_score: 85,
    listing_readiness_score: 90,
    demand_score: 0,
    demand_evidence_class: "ACTIVE_ONLY",
    demand_evaluated_at: "2026-07-26T13:00:00.000Z",
    exact_identity: true,
    same_pack: true,
    same_size: true,
    same_variant: true,
    same_condition: true,
    hard_gates: [],
    assessment: {
      candidate: {
        supplierVariantId: "variant-canonical",
        restrictionGuards: [],
      },
      identity: { exactIdentityConfirmed: true },
      economics: {
        ready: true,
        salePrice: 32,
        estimatedNetProfit: 8,
        estimatedNetMarginPercent: 25,
        estimatedRoiPercent: 50,
        minimumProfitablePrice: 25,
      },
      scores: {
        confidenceScore: 90,
        supplyScore: 85,
        economicsScore: 88,
        listingReadinessScore: 90,
      },
      taxonomyVerification: {
        categoryConfirmed: true,
        missingRequiredAspects: [],
        hardGuards: [],
      },
      fulfillmentEvidence: {
        weightConfirmed: true,
        dimensionsRequired: false,
        dimensionsConfirmed: false,
      },
      listingIntelligencePackage: {
        categoryRecommendation: { categoryId: "123" },
        imagePlan: { authorizedLunaImagesAvailable: true },
      },
    },
  })
  assert.equal(normalized.supplier.numericStock, 12)
  assert.equal(normalized.supplier.costUsd, 10)
  assert.equal(normalized.supplier.exactVariant, true)
  assert.equal(normalized.demand.historicalMarketCheckCompleted, true)
  assert.equal(normalized.economics.netProfitUsd, 8)
  assert.equal(normalized.economics.marginRate, 0.25)
  assert.equal(normalized.economics.roiRate, 0.5)
  assert.equal(normalized.economics.safeFloorUsd, 25)
  assert.equal(normalized.operational.categoryValid, true)
  assert.equal(normalized.operational.complianceResolved, true)
  assert.equal(normalized.operational.weightResolved, true)
  assert.equal(normalized.operational.dimensionsResolved, true)
  assert.equal(normalized.operational.imagesAuthorized, true)
  assert.equal(normalized.operational.listingFactsComplete, true)
})

test("canonical hard gates remain blockers after assessment normalization", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "candidate-blocked",
    supplier_variant_id: "variant-blocked",
    hard_gates: ["NEED_AUTHORIZED_PRODUCT_IMAGES"],
    assessment: { hardGates: ["NEED_PACKAGE_WEIGHT"] },
  })
  assert.deepEqual(
    normalized.risk.blockerCodes.sort(),
    ["NEED_AUTHORIZED_PRODUCT_IMAGES", "NEED_PACKAGE_WEIGHT"],
  )
  assert.equal(normalized.operational.listingFactsComplete, false)
})

test("a real producer row can reach only the safe bootstrap canary lane", () => {
  const now = new Date("2026-07-26T16:00:00.000Z")
  const assessment = {
    candidate: {
      candidateKey: "producer-canary",
      marketRadarProductId: "00000000-0000-4000-8000-000000000500",
      supplierProductId: "luna-500",
      supplierVariantId: "variant-500",
      sku: "SKU-500",
      title: "Verified Luna product",
      variantTitle: "Default",
      gtin: "0000000000500",
      available: true,
      inventoryQuantity: 20,
      stockCapturedAt: "2026-07-26T12:00:00.000Z",
      supplierCost: 10,
      restrictionGuards: [],
      categoryId: "123",
    },
    decision: "OPPORTUNITY_REVIEW_REQUIRED",
    canProceedToListingPackage: false,
    scores: {
      opportunityScore: 80,
      demandScore: 20,
      economicsScore: 90,
      identityScore: 90,
      competitionScore: 70,
      supplyScore: 90,
      listingReadinessScore: 90,
      confidenceScore: 90,
    },
    market: {
      activeExactComparables: 1,
      sellersWithPositiveMovement: 0,
      totalEstimatedWeeklyVelocity: 0,
      medianTotalBuyerPrice: 32,
    },
    economics: {
      ready: true,
      estimatedNetProfit: 8,
      estimatedNetMarginPercent: 25,
      estimatedRoiPercent: 50,
      minimumProfitablePrice: 25,
      salePrice: 32,
    },
    identity: {
      exactIdentityConfirmed: true,
      comparables: [],
    },
    hardGates: [],
    evidenceGuards: ["NEED_CONFIRMED_SOLD_EXACT"],
    demandEvidencePolicy: {
      evaluated: true,
      historicalMarketCheckCompleted: true,
    },
    taxonomyVerification: {
      categoryConfirmed: true,
      missingRequiredAspects: [],
      hardGuards: [],
    },
    fulfillmentEvidence: {
      weightConfirmed: true,
      dimensionsRequired: false,
      dimensionsConfirmed: false,
    },
    listingIntelligencePackage: {
      titleStrategy: {},
      categoryRecommendation: { categoryId: "123" },
      imagePlan: { authorizedLunaImagesAvailable: true },
    },
  }
  const produced = buildOpportunityQueueRow(
    assessment,
    [],
    now,
    { lane: "coverage" },
  )
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    ...produced,
    demand_evidence_class: "ACTIVE_ONLY",
    demand_evaluated_at: "2026-07-26T13:00:00.000Z",
    exact_identity: false,
    same_pack: false,
    same_size: false,
    same_variant: false,
    same_condition: false,
  })
  const policy = {
    ...DEFAULT_EBAY_LUNA_SELECTOR_V2_POLICY,
    policyVersion: "BOOTSTRAP_CANARY_PRODUCER_TEST",
    bootstrapCanaryEnabled: true,
    maximumBootstrapCanaries: 5,
  }
  const evaluation = evaluateEbayLunaSelectorCandidateV2(
    normalized,
    { now, policy },
  )
  const batch = selectEbayLunaBatchV2([evaluation], policy)
  assert.equal(produced.lane, "coverage")
  assert.equal(produced.risk_score, 0)
  assert.equal(normalized.supplier.exactVariant, true)
  assert.equal(evaluation.eligibleForBootstrapCanary, true)
  assert.equal(evaluation.externalWritesAllowed, false)
  assert.equal(batch.bootstrapCanaries.length, 1)
})

test("an explicit false exact-variant result cannot be overwritten by an id", () => {
  const normalized = normalizeEbayLunaSelectorV2QueueRow({
    candidate_key: "variant-conflict",
    supplier_variant_id: "variant-conflict",
    exact_supplier_variant: false,
    assessment: {
      candidate: { supplierVariantId: "variant-conflict" },
    },
  })
  assert.equal(normalized.supplier.exactVariant, false)
})

function queueSupabase(rows) {
  const calls = []
  return {
    calls,
    rpc(functionName, parameters) {
      assert.equal(
        functionName,
        "read_eligible_ebay_luna_opportunities_v2",
      )
      calls.push({ functionName, parameters: { ...parameters } })
      return Promise.resolve({
        data: rows.slice(
          parameters.p_offset,
          parameters.p_offset + parameters.p_limit,
        ),
        error: null,
      })
    },
  }
}

test("queue pagination uses the scoped RPC with stable offsets", async () => {
  const rows = Array.from({ length: 1_002 }, (_, index) => ({
    id: `id-${String(index).padStart(5, "0")}`,
    candidate_key: `candidate-${String(index).padStart(5, "0")}`,
  }))
  const supabase = queueSupabase(rows)
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase,
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, false)
  assert.equal(result.rows.length, 1_002)
  assert.deepEqual(result.scopeColumns, {
    account: "marketplace_account_key",
    marketplace: "marketplace",
  })
  assert.deepEqual(
    supabase.calls.map((call) => call.parameters.p_offset),
    [0, 1_000],
  )
  assert.ok(supabase.calls.every((call) =>
    call.parameters.p_account_key === "ACCOUNT_A" &&
    call.parameters.p_marketplace === "EBAY_US" &&
    call.parameters.p_limit === 1_000
  ))
})

test("queue overflow is explicit and fail-closed", async () => {
  const rows = Array.from(
    { length: EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1 },
    (_, index) => ({
      id: `id-${String(index).padStart(6, "0")}`,
      candidate_key: `candidate-${String(index).padStart(6, "0")}`,
    }),
  )
  const supabase = queueSupabase(rows)
  const result = await loadEbayLunaSelectorV2QueueRows({
    supabase,
    accountKey: "ACCOUNT_A",
    marketplace: "EBAY_US",
  })
  assert.equal(result.truncated, true)
  assert.equal(
    result.scannedRows,
    EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS + 1,
  )
  assert.deepEqual(result.rows, [])
  assert.deepEqual(
    supabase.calls.at(-1)?.parameters,
    {
      p_account_key: "ACCOUNT_A",
      p_marketplace: "EBAY_US",
      p_limit: 1,
      p_offset: EBAY_LUNA_SELECTOR_V2_MAX_QUEUE_ROWS,
    },
  )
})
