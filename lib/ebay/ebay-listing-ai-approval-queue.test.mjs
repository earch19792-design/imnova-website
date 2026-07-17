import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  approvalQueueRankingScore,
  buildLunaOperatorConfirmation,
  evaluateApprovalQueueCatalogCandidate,
  evaluateApprovalQueueDecision,
  rankApprovalQueue,
  rankTop20OpportunityPool,
} from "./ebay-listing-ai-approval-queue.ts"

const now = new Date("2026-07-16T20:00:00.000Z")

function catalogCandidate(overrides = {}) {
  return {
    marketRadarProductId: "00000000-0000-4000-8000-000000000001",
    supplierProductId: "luna-1",
    supplierVariantId: "variant-1",
    supplierSku: "LUNA-1",
    productUrl: "https://www.lunaportex.com/products/luna-1",
    imageUrl: "https://www.lunaportex.com/cdn/luna-1.jpg",
    imageAuthorized: true,
    supplierCost: 8,
    available: true,
    inventoryQuantity: 24,
    capturedAt: "2026-07-16T19:00:00.000Z",
    manufacturerBrand: "Example Brand",
    gtin: "036000291452",
    gtinValid: true,
    mpn: null,
    model: null,
    productName: "Example Product",
    packCount: 3,
    unitCount: 1,
    size: "10 oz",
    color: "blue",
    scent: null,
    variant: "standard",
    condition: "new",
    weight: 2,
    weightUnit: "lb",
    dimensions: { length: 10, width: 8, height: 6, unit: "in" },
    exactContents: ["3 identical units"],
    categoryId: "123",
    categoryName: "Home",
    requiredAspects: [{ name: "Brand", value: "Example Brand" }],
    approvedKeywords: ["example product"],
    outboundShippingCost: 7,
    packagingCost: 1,
    fixedFulfillmentCost: 1,
    supplierShippingReserveUsd: 8,
    complianceBlocked: false,
    complianceFindings: [],
    ...overrides,
  }
}

function evidence(index, overrides = {}) {
  const fingerprint = `sha256:${String(index).padStart(64, "0")}`
  return {
    id: `item-${index}`,
    marketRadarProductId: `product-${index}`,
    supplierVariantId: `variant-${index}`,
    supplierSku: `SKU-${String(index).padStart(2, "0")}`,
    productName: `Product ${index}`,
    verdict: "GO_WITH_CHANGES",
    identityStrong: true,
    identityFingerprint: fingerprint,
    baseProductFingerprint: fingerprint,
    offerPackFingerprint: fingerprint,
    exactLunaMapping: true,
    costRecent: true,
    stockRecent: true,
    minimumSafePrice: 25,
    targetPrice: 29,
    estimatedProfit: 7,
    roiPercent: 40,
    netMarginPercent: 24,
    stockAvailable: 20,
    recommendedPackCount: 3,
    safePackStrategy: true,
    shippingComplete: true,
    complianceBlocked: false,
    activeExactCount: 3,
    soldExactCount: 1,
    estimatedDemandCount: 0,
    evidenceConfidence: "MEDIUM",
    categoryKey: `category-${Math.floor(index / 3)}`,
    scores: {
      overallOpportunity: 90 - index,
      demandConfidence: 70,
      marginSafety: 80,
      packStrategy: 75,
      keywordOpportunity: 65,
      visualOpportunity: 60,
      listingReadiness: 85,
      competitionPressure: 30,
      freshness: 95,
      operationalSimplicity: 100,
    },
    rankingScore: 0,
    cohort: "READY_FOR_OPERATOR_APPROVAL",
    reasonCodes: [],
    rank: null,
    ...overrides,
  }
}

test("complete catalog candidate can run Loop 1 without asking technical facts", () => {
  const result = evaluateApprovalQueueCatalogCandidate(catalogCandidate(), now)
  assert.equal(result.cohort, "READY_FOR_OPERATOR_APPROVAL")
  assert.equal(result.canRunOfficialMarketRead, true)
  assert.equal(result.technicalDataRequestedFromOperator, false)
})

test("weak identity and missing dimensions route to NEEDS_DATA automatically", () => {
  const result = evaluateApprovalQueueCatalogCandidate(catalogCandidate({
    gtin: null, gtinValid: false, manufacturerBrand: null, mpn: null, model: null,
    dimensions: null,
  }), now)
  assert.equal(result.cohort, "NEEDS_DATA")
  assert.ok(result.reasonCodes.includes("STRONG_PRODUCT_IDENTIFIER_REQUIRED"))
  assert.ok(result.reasonCodes.includes("PACKAGE_DIMENSIONS_REQUIRED"))
  assert.equal(result.technicalDataRequestedFromOperator, false)
})

test("out of stock and compliance-blocked products are rejected before eBay reads", () => {
  const stock = evaluateApprovalQueueCatalogCandidate(catalogCandidate({ available: false, inventoryQuantity: 0 }), now)
  const compliance = evaluateApprovalQueueCatalogCandidate(catalogCandidate({ complianceBlocked: true,
    complianceFindings: ["RESTRICTED_PRODUCT"] }), now)
  assert.deepEqual(stock.reasonCodes, ["LUNA_OUT_OF_STOCK"])
  assert.equal(stock.canRunOfficialMarketRead, false)
  assert.equal(compliance.cohort, "REJECTED")
})

test("NO_GO and canonical margin failures never enter READY", () => {
  assert.equal(evaluateApprovalQueueDecision(evidence(1, { verdict: "NO_GO" })).cohort, "REJECTED")
  const margin = evaluateApprovalQueueDecision(evidence(2, {
    estimatedProfit: 4.99, roiPercent: 29.9, netMarginPercent: 19.9,
  }))
  assert.equal(margin.cohort, "REJECTED")
  assert.ok(margin.reasonCodes.includes("PROFIT_BELOW_5_USD"))
  assert.ok(margin.reasonCodes.includes("ROI_BELOW_30_PERCENT"))
  assert.ok(margin.reasonCodes.includes("NET_MARGIN_BELOW_20_PERCENT"))
})

test("safe pack is required and high shipping reserve can leave economics rejected", () => {
  assert.equal(evaluateApprovalQueueDecision(evidence(1, { safePackStrategy: false })).cohort, "NEEDS_DATA")
  assert.equal(evaluateApprovalQueueDecision(evidence(2, { estimatedProfit: 2 })).cohort, "REJECTED")
})

test("Top 20 pool caps at 20 and ranking is reproducible", () => {
  const candidates = Array.from({ length: 28 }, (_, index) => evidence(index + 1))
  const first = rankTop20OpportunityPool(candidates)
  const second = rankTop20OpportunityPool([...candidates].reverse())
  assert.equal(first.length, 20)
  assert.deepEqual(first.map((entry) => entry.id), second.map((entry) => entry.id))
  assert.deepEqual(first.map((entry) => entry.poolRank), Array.from({ length: 20 }, (_, index) => index + 1))
})

test("visible pool allows fewer than 20 and excludes NEEDS_DATA and rejected products", () => {
  const candidates = [
    evidence(1),
    evidence(2, { cohort: "NEEDS_DATA", identityStrong: false }),
    evidence(3, { cohort: "REJECTED" }),
  ]
  const result = rankTop20OpportunityPool(candidates)
  assert.equal(result.length, 1)
  assert.ok(result.every((entry) => entry.cohort === "READY_FOR_OPERATOR_APPROVAL"))
})

test("diversity keeps at most three products per category and one base fingerprint", () => {
  const duplicate = evidence(20, { id: "duplicate", baseProductFingerprint: evidence(1).baseProductFingerprint })
  const sameCategory = Array.from({ length: 8 }, (_, index) => evidence(index + 1, { categoryKey: "same" }))
  const result = rankTop20OpportunityPool([...sameCategory, duplicate])
  assert.equal(result.filter((entry) => entry.categoryKey === "same").length, 3)
  assert.equal(new Set(result.map((entry) => entry.baseProductFingerprint)).size, result.length)
})

test("approval ranking contains only ready products", () => {
  const result = rankApprovalQueue([evidence(1), evidence(2, { cohort: "NEEDS_DATA" })])
  assert.deepEqual(result.map((entry) => entry.id), ["item-1"])
})

test("unknown Luna quantity permits exactly one offer pack", () => {
  const result = buildLunaOperatorConfirmation({
    priceObserved: 9.99,
    availability: "AVAILABLE_QUANTITY_NOT_SHOWN",
    recommendedPackCount: 3,
    supplierShippingReserveUsd: 8,
  })
  assert.equal(result.supplierUnitQuantity, null)
  assert.equal(result.stockConfidence, "UNKNOWN_QUANTITY")
  assert.equal(result.availableOfferPackCapacity, 1)
  assert.equal(result.ebayListingQuantity, 1)
  assert.equal(result.requiresAvailabilityRecheckAfterSale, true)
})

test("exact Luna quantity is separated from pack capacity and eBay quantity", () => {
  const result = buildLunaOperatorConfirmation({
    priceObserved: 7,
    availability: "EXACT_QUANTITY_VISIBLE",
    exactQuantity: 8,
    recommendedPackCount: 3,
    supplierShippingReserveUsd: 8,
  })
  assert.equal(result.supplierUnitQuantity, 8)
  assert.equal(result.recommendedPackCount, 3)
  assert.equal(result.availableOfferPackCapacity, 2)
  assert.equal(result.ebayListingQuantity, 1)
})

test("out-of-stock confirmation removes candidate so next candidate is promoted", () => {
  const out = buildLunaOperatorConfirmation({
    priceObserved: 7,
    availability: "OUT_OF_STOCK",
    recommendedPackCount: 2,
    supplierShippingReserveUsd: 8,
  })
  assert.equal(out.canRemainReady, false)
  const result = rankTop20OpportunityPool([evidence(1, { cohort: "REJECTED" }), evidence(2)])
  assert.equal(result[0].id, "item-2")
})

test("ranking score includes inverse competition and remains bounded", () => {
  const lowCompetition = approvalQueueRankingScore(evidence(1).scores)
  const highCompetition = approvalQueueRankingScore({ ...evidence(1).scores, competitionPressure: 100 })
  assert.ok(lowCompetition > highCompetition)
  assert.ok(lowCompetition >= 0 && lowCompetition <= 100)
})

test("queue source has no OpenAI generation or eBay write path", () => {
  const service = readFileSync(new URL("./ebay-listing-ai-approval-queue-service.ts", import.meta.url), "utf8")
  const route = readFileSync(new URL("../../app/api/admin/ebay/listing-ai/approval-queue/route.ts", import.meta.url), "utf8")
  assert.doesNotMatch(service, /createRealOpenAi|generateListingAi|shipping_fulfillment|publishOffer/)
  assert.doesNotMatch(route, /createRealOpenAi|generateListingAi|publishOffer/)
  assert.match(service, /openAiCalls: 0/)
  assert.match(service, /ebayWrites: 0/)
})
