import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCommercialIntelligenceUpgradeV1,
  buildKeywordIntelligenceV2,
  buildOpportunityBatchPlanV1,
  buildPriceOpportunityV2,
  buildReferenceStrategyV1,
  classifyStrictComparableV2,
  deriveItemIdCanonicalFamilyBridgeV1,
  resolveCanonicalProductFamilyV1,
} from "./ebay-commercial-intelligence-upgrade-v1.ts"

const request = {
  marketplace: "EBAY_US",
  seedType: "SEED_PRODUCT_TITLE",
  seedValue: "Personal Air Conditioner 6000mAh Neck Fan Rechargeable 3-Speed Portable Neck Fan",
  requestedWindowDays: 90,
  researchIntent: "OPPORTUNITY_VALIDATION",
  queryBudget: 2,
  seedIdentity: { categoryId: "20612", categoryName: "Indoor Air Quality & Fans",
    brand: null, gtin: null, mpn: null, model: null, packCount: 1, size: null, color: null },
}

let evidenceSequence = 0
function evidence(overrides = {}) {
  evidenceSequence += 1
  const index = String(overrides.itemId ?? 900_000_000_000 + evidenceSequence)
  return {
    evidenceId: `evidence-${index}`,
    itemId: index,
    title: "Portable Neck Fan Rechargeable 3 Speed Wearable Personal Cooling Fan",
    categoryId: "20612",
    categoryName: "Indoor Air Quality & Fans",
    brand: null,
    gtin: null,
    mpn: null,
    model: null,
    packCount: 1,
    size: null,
    color: null,
    condition: "New",
    price: 24.99,
    currency: "USD",
    shippingCost: 0,
    imageUrl: "https://i.ebayimg.com/example.jpg",
    itemSpecifics: { Type: "Neck Fan", Features: "Rechargeable" },
    keywordSignals: [],
    activeListing: true,
    confirmedSold: false,
    confirmedSoldQuantity: null,
    saleObservedAt: null,
    observedAt: "2026-08-12T12:00:00.000Z",
    source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
    sourceVersion: "test",
    evidenceCompleteness: "PARTIAL",
    sellerReferenceHash: `seller-${index}`,
    ...overrides,
  }
}

test("canonical family resolver separates product identity from title attributes", () => {
  const result = resolveCanonicalProductFamilyV1({ title: request.seedValue,
    categoryId: "20612", categoryName: "Indoor Air Quality & Fans",
    itemSpecifics: { Type: "Neck Fan", Features: "Rechargeable" } })
  assert.equal(result.canonicalFamily, "Portable Neck Fan")
  assert.equal(result.fingerprint.coreProduct, "neck fan")
  assert.equal(result.fingerprint.formFactor, "wearable / neck-mounted")
  assert.equal(result.fingerprint.placement, "neck")
  assert.ok(result.attributes.includes("6000mAh"))
  assert.ok(result.attributes.includes("3-speed"))
  assert.ok(result.attributes.includes("rechargeable"))

  const invalid = resolveCanonicalProductFamilyV1({ seedValue: "6000mah rechargeable speed" })
  assert.equal(invalid.canonicalFamily, null)
  assert.equal(invalid.status, "UNPROVEN")
})

test("Item ID bridge uses listing truth and expands beyond the source listing", () => {
  const source = evidence({ itemId: "366581876813", evidenceId: "source",
    title: request.seedValue })
  const bridge = deriveItemIdCanonicalFamilyBridgeV1({ itemId: "366581876813",
    evidence: [source] })
  assert.equal(bridge.authoritativeListingResolved, true)
  assert.equal(bridge.candidateCanonicalFamily, "Portable Neck Fan")
  assert.equal(bridge.marketExpansion.status, "READY")
  assert.equal(bridge.marketExpansion.excludeSourceItemId, "366581876813")
  assert.equal(bridge.sourceListingMayCountAsIndependentMarketEvidence, false)
})

test("Comparable V2 keeps handheld and two-pack offers out of strict single-unit pricing", () => {
  const canonical = resolveCanonicalProductFamilyV1({ title: request.seedValue, packCount: 1 })
  const handheld = evidence({ itemId: "2", evidenceId: "handheld",
    title: "3-in-1 Portable Mini Turbo Fan Handheld Foldable Fan", price: 19.99 })
  const twoPack = evidence({ itemId: "3", evidenceId: "two-pack",
    title: "Portable Neck Fan Rechargeable 2 PACK", packCount: 2, price: 85.99 })
  const strict = evidence({ itemId: "4", evidenceId: "strict", price: 25 })
  const handheldAssessment = classifyStrictComparableV2({ canonical, seed: request.seedIdentity,
    evidence: handheld })
  const packAssessment = classifyStrictComparableV2({ canonical, seed: request.seedIdentity,
    evidence: twoPack })
  const strictAssessment = classifyStrictComparableV2({ canonical, seed: request.seedIdentity,
    evidence: strict })
  assert.equal(handheldAssessment.classification, "FORM_FACTOR_CONFLICT")
  assert.equal(packAssessment.classification, "PACK_MISMATCH")
  assert.equal(strictAssessment.classification, "STRICT_COMPARABLE")

  const pricing = buildPriceOpportunityV2({ evidence: [handheld, twoPack, strict], comparables: [
    { evidenceId: "handheld", classification: handheldAssessment.classification },
    { evidenceId: "two-pack", classification: packAssessment.classification },
    { evidenceId: "strict", classification: strictAssessment.classification },
  ] })
  assert.equal(pricing.strictComparables, 1)
  assert.equal(pricing.packMismatchExcluded, 1)
  assert.equal(pricing.formFactorExcluded, 1)
  assert.equal(pricing.priceBand?.median, 25)
  assert.notEqual(pricing.priceBand?.median, 85.99)
  assert.equal(pricing.recommendedEntryPrice, null)
  assert.equal(pricing.recommendationReason, "ECONOMICS_UNPROVEN")
})

test("known category and brand conflicts cannot enter strict pricing", () => {
  const canonical = resolveCanonicalProductFamilyV1({ title: request.seedValue, packCount: 1 })
  const categoryConflict = classifyStrictComparableV2({ canonical,
    seed: request.seedIdentity,
    evidence: evidence({ itemId: "5", evidenceId: "category-conflict", categoryId: "99999" }) })
  assert.equal(categoryConflict.classification, "FAMILY_COMPARABLE")
  assert.equal(categoryConflict.strictPricingEligible, false)
  const brandConflict = classifyStrictComparableV2({ canonical,
    seed: { ...request.seedIdentity, brand: "Exact Brand" },
    evidence: evidence({ itemId: "6", evidenceId: "brand-conflict", brand: "Other Brand" }) })
  assert.equal(brandConflict.classification, "IDENTITY_CONFLICT")
  assert.equal(brandConflict.strictPricingEligible, false)
})

test("complete but non-viable economics suppress a recommended entry price", () => {
  const rows = [1, 2, 3].map((value) => evidence({ itemId: `margin-${value}`,
    evidenceId: `margin-${value}`, price: 20 + value }))
  const pricing = buildPriceOpportunityV2({ evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })),
    economics: { supplierCost: 25, shippingCost: 4, ebayFeeRate: .15,
      promotedFeeRate: .05, promotedFeeComplete: true } })
  assert.equal(pricing.recommendedEntryPrice, null)
  assert.equal(pricing.recommendationReason, "MARGIN_CONSTRAINED")
  assert.ok((pricing.economics.contribution ?? 0) < 0)
  assert.ok((pricing.economics.margin ?? 0) < 0)
})

test("Keyword V2 penalizes generic and nonsense phrases while retaining a supported core phrase", () => {
  const canonical = resolveCanonicalProductFamilyV1({ title: request.seedValue })
  const rows = [
    evidence({ itemId: "10", evidenceId: "10",
      title: "Portable Neck Fan Rechargeable Speed Portable Neck Cooling" }),
    evidence({ itemId: "11", evidenceId: "11",
      title: "Portable Neck Fan 6000mAh Rechargeable Personal Fan" }),
    evidence({ itemId: "12", evidenceId: "12",
      title: "Wearable Portable Neck Fan Rechargeable 3 Speed" }),
  ]
  const keywords = buildKeywordIntelligenceV2({ canonical, evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })) })
  const core = keywords.keywords.find((row) => row.phrase === "portable neck fan")
  const generic = keywords.keywords.find((row) => row.phrase === "fan")
  const nonsense = keywords.keywords.find((row) => row.phrase === "rechargeable speed portable")
  assert.equal(core?.role, "CORE_PRODUCT")
  assert.ok((core?.relevanceScore ?? 0) >= 80)
  assert.equal(generic?.role, "GENERIC")
  assert.ok((generic?.relevanceScore ?? 100) < 35)
  assert.equal(nonsense?.role, "REJECT")
  assert.equal(nonsense?.opportunityScore, 0)
  assert.equal(keywords.primaryKeyword, "portable neck fan")
  assert.equal(keywords.keywords.find((row) => row.phrase === "wearable neck fan")?.role,
    "FORM_FACTOR")
  assert.equal(keywords.keywords.find((row) => row.phrase === "rechargeable neck fan")?.role,
    "POWER")
  assert.equal(keywords.searchVolume.status, "UNPROVEN")
  assert.equal(keywords.searchVolume.value, null)
  assert.equal(keywords.spine.absurdConcatenationsAllowed, false)
})

test("active-market screening is distinct from demand validation and sales probability", () => {
  const rows = [1, 2, 3, 4].map((value) => evidence({ itemId: `${20 + value}`,
    evidenceId: `${20 + value}`, price: 20 + value }))
  const result = buildCommercialIntelligenceUpgradeV1({ request, evidence: rows,
    observedResultCount: 5, searchResultCap: 50 })
  assert.equal(result.competition.OBSERVED_ACTIVE_RESULTS, 5)
  assert.equal(result.competition.MARKETPLACE_COMPETITION_TOTAL.status, "UNPROVEN")
  assert.equal(result.competition.sampleSizeIsMarketplaceTotal, false)
  assert.equal(result.activeMarketAttractiveness.status, "CALCULATED_FROM_ACTIVE_MARKET")
  assert.equal(result.activeMarketAttractiveness.isSalesProbability, false)
  assert.equal(result.salesProbability.status, "NOT_CALCULATED")
  assert.equal(result.demandValidation.status, "UNPROVEN")
  assert.equal(result.commercialRecommendation.searchVolume, "UNPROVEN")
  assert.notEqual(result.commercialRecommendation.finalDecision, "HUMAN_REVIEW")
  assert.equal(result.commercialRecommendation.finalDecision, "ADVANCE_TO_SUPPLIER_VALIDATION")
  assert.equal(result.nextBestEvidence.priority, "NEED_EXACT_SUPPLIER_MATCH")
})

test("active-market attractiveness remains unproven when active evidence is too narrow", () => {
  const result = buildCommercialIntelligenceUpgradeV1({ request,
    evidence: [evidence({ itemId: "31", evidenceId: "31" })],
    observedResultCount: 1 })
  assert.equal(result.activeMarketAttractiveness.status, "UNPROVEN")
  assert.equal(result.activeMarketAttractiveness.score, null)
  assert.equal(result.activeMarketAttractiveness.salesProbability.status, "NOT_CALCULATED")
})

test("near-duplicate results from one seller do not inflate strict support", () => {
  const duplicateTitle = "Portable Neck Fan Rechargeable 3 Speed Wearable Personal Cooling Fan"
  const rows = [
    evidence({ itemId: "dup-1", evidenceId: "dup-1", title: duplicateTitle,
      sellerReferenceHash: "same-seller" }),
    evidence({ itemId: "dup-2", evidenceId: "dup-2", title: duplicateTitle,
      sellerReferenceHash: "same-seller" }),
    evidence({ itemId: "dup-3", evidenceId: "dup-3", title: duplicateTitle,
      sellerReferenceHash: "different-seller" }),
  ]
  const result = buildCommercialIntelligenceUpgradeV1({ request, evidence: rows,
    observedResultCount: 3 })
  assert.equal(result.competition.OBSERVED_ACTIVE_RESULTS, 3)
  assert.equal(result.competition.STRICT_COMPARABLE_COUNT, 2)
  assert.equal(result.competition.NEAR_DUPLICATE_RESULTS_EXCLUDED, 1)
})

test("search-term analysis can derive a canonical family from bounded market consensus", () => {
  const queryRequest = { ...request, seedType: "SEED_QUERY",
    seedValue: "personal cooling wearable" }
  const rows = ["51", "52", "53"].map((itemId) => evidence({ itemId,
    evidenceId: itemId }))
  const result = buildCommercialIntelligenceUpgradeV1({ request: queryRequest,
    evidence: rows })
  assert.equal(result.consensus.CANONICAL_FAMILY, "Portable Neck Fan")
  assert.equal(result.canonicalFamily.canonicalFamily, "Portable Neck Fan")
  assert.ok(result.consensus.seedPaths.some((path) =>
    path.path === "ACTIVE_MARKET_FAMILY_CLUSTER" && path.supportCount === 3))
})

test("Reference Strategy rejects identity conflicts and handoff never transfers competitor content", () => {
  const good = evidence({ itemId: "40", evidenceId: "good", brand: "Competitor",
    model: "Their Model", gtin: "012345678905" })
  const bad = evidence({ itemId: "41", evidenceId: "bad",
    title: "Portable Neck Fan 2 Pack", packCount: 2 })
  const wrongCategory = evidence({ itemId: "42", evidenceId: "wrong-category",
    categoryId: "99999" })
  const strategy = buildReferenceStrategyV1({ evidence: [good, bad, wrongCategory], comparables: [
    { evidenceId: "good", classification: "STRICT_COMPARABLE", confidence: 95,
      riskCodes: ["BRAND_IDENTITY_MUST_NOT_TRANSFER"] },
    { evidenceId: "bad", classification: "PACK_MISMATCH", confidence: 70,
      riskCodes: ["PACK_COUNT_CONFLICT"] },
    { evidenceId: "wrong-category", classification: "FAMILY_COMPARABLE", confidence: 60,
      riskCodes: ["CATEGORY_CONFLICT"] },
  ] })
  assert.equal(strategy.candidates.find((row) => row.evidenceId === "bad")?.referenceDecision,
    "REJECT")
  assert.equal(strategy.candidates.find((row) => row.evidenceId === "wrong-category")
    ?.referenceDecision, "REJECT")
  const handoff = strategy.candidates.find((row) => row.evidenceId === "good")?.handoff
  assert.equal(handoff?.competitorContentCopied, false)
  assert.deepEqual(handoff?.rejectedCompetitorIdentity, ["BRAND", "MODEL", "MPN", "UPC_GTIN"])
  assert.deepEqual(handoff?.rejectedCopyrightContent, ["IMAGES", "DESCRIPTION", "CLAIMS"])
  assert.equal(handoff?.ebayDraftCreated, false)
  assert.equal(handoff?.ebayWrites, 0)
})

test("large-volume plan is bounded, resumable, cache-aware, and write-free", () => {
  const plan = buildOpportunityBatchPlanV1({ candidateCount: 1_000,
    requestedConcurrency: 99, checkpointCursor: "checkpoint-40" })
  assert.equal(plan.boundedConcurrency, 4)
  assert.equal(plan.maximumConcurrentMarketplaceCalls, 4)
  assert.equal(plan.maxMarketplaceQueriesPerCandidate, 2)
  assert.equal(plan.totalChunks, 40)
  assert.equal(plan.resumeSupported, true)
  assert.equal(plan.checkpointCursor, "checkpoint-40")
  assert.equal(plan.rateLimitAwareness, true)
  assert.equal(plan.uncontrolledMarketplaceBurst, false)
  assert.equal(plan.marketplaceWrites, 0)
})
