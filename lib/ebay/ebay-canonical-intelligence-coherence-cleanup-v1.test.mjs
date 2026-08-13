import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildCommercialIntelligenceUpgradeV1,
  buildKeywordIntelligenceV2,
  buildPriceOpportunityV2,
  buildReferenceStrategyV1,
  normalizeCommercialKeywordPhraseV2,
  resolveCanonicalProductFamilyV1,
} from "./ebay-commercial-intelligence-upgrade-v1.ts"
import {
  CANONICAL_OPPORTUNITY_PRECEDENCE_V2,
  buildProactiveExceptionQueueV1,
  selectMaterialPrioritiesV2,
} from "./ebay-seller-os-portfolio-intelligence-v1.ts"

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8")
const marketPage = read("../../app/admin/ebay/opportunity-queue/research/page.tsx")
const decisionsSurface = read("../../app/admin/ebay/intelligence/protected-intelligence-surface.tsx")
const intelligenceRoute = read("../../app/api/admin/ebay/intelligence/route.ts")
const assistantSource = read("./ebay-seller-os-assistant-gateway-v1.ts")
const portfolioSource = read("./ebay-seller-os-portfolio-intelligence-v1.ts")

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
  const itemId = String(overrides.itemId ?? 700_000_000_000 + evidenceSequence)
  return {
    evidenceId: String(overrides.evidenceId ?? `evidence-${itemId}`), itemId,
    title: "Portable Neck Fan Rechargeable 3 Speed Wearable Personal Cooling Fan",
    categoryId: "20612", categoryName: "Indoor Air Quality & Fans", brand: null,
    gtin: null, mpn: null, model: null, packCount: 1, size: null, color: null,
    condition: "New", price: 24.99, currency: "USD", shippingCost: 0,
    imageUrl: null, itemSpecifics: { Type: "Neck Fan", Features: "Rechargeable" },
    keywordSignals: [], activeListing: true, confirmedSold: false,
    confirmedSoldQuantity: null, saleObservedAt: null,
    observedAt: "2026-08-12T12:00:00.000Z",
    source: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE", sourceVersion: "test",
    evidenceCompleteness: "PARTIAL", sellerReferenceHash: `seller-${itemId}`,
    ...overrides,
  }
}

function observation(value, availability = "AVAILABLE") {
  return { value, availability, completeness: value === null ? "UNPROVEN" : "COMPLETE",
    source: { system: "TEST", operation: "READ", evidenceReference: "ref" },
    capturedAt: "2026-08-12T00:00:00Z", marketplace: { marketplaceId: "EBAY_US" },
    identity: { itemId: "366581876813" }, grain: "LISTING", reportingWindow: null,
    freshness: { status: "FRESH", ageSeconds: 0, maximumAgeSeconds: 60 }, unit: null,
    limitationCode: null, explicitAuthoritativeZero: value === 0 }
}

function listing(itemId, overrides = {}) {
  return { key: `listing:${itemId}`, identity: { itemId, title: `Listing ${itemId}`,
    sku: `SKU-${itemId}`, primaryImageUrl: null, lastObservedAt: "2026-08-12T00:00:00Z" },
  discovery: { livePresence: { status: "LIVE_ACTIVE" } },
  metrics: { impressions: observation(null, "UNAVAILABLE"), ebay_views: observation(null, "UNAVAILABLE"),
    views: observation(null, "UNAVAILABLE"), ctr_calculated: observation(null, "UNAVAILABLE"),
    ctr_reported: observation(null, "UNAVAILABLE"), transactions: observation(null, "UNAVAILABLE"),
    orders: observation(null, "UNAVAILABLE") },
  stock: { state: "STOCK_UNKNOWN", sourceContractStatus: "UNPROVEN",
    supplierProductId: null, supplierVariantId: null, supplierSku: null,
    quantity: observation(null, "UNKNOWN"),
    freshness: { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds: 60 },
    limitationCode: "UNPROVEN" }, composition: { bundleCapacity: observation(null, "UNKNOWN") },
  experiment: { status: "UNAVAILABLE", lifecycleState: null },
  evidenceReferences: [], alertCandidateKeys: [],
  blockers: [], dataQualityIssues: [], ...overrides }
}

function decision(itemId, overrides = {}) {
  return { listingKey: `listing:${itemId}`, classification: "DATA_QUALITY", priority: "MEDIUM",
    evidenceStatus: "UNPROVEN", reasonCodes: ["INSUFFICIENT_ANALYTICS_EVIDENCE"],
    recommendedAction: "FIX_DATA_QUALITY", actionBlockedByInsufficientEvidence: true,
    experimentRunning: false, variableFrozen: false, protectionState: "NONE",
    experimentOperationalState: "INACTIVE", frozenVariables: [],
    nextReviewEvidenceRemaining: null, externalSignalCount: null,
    nextReviewCondition: null, nextReviewAt: null, actionExecutionAllowed: false,
    ...overrides }
}

function monitor(listings, decisions, overrides = {}) {
  return { contractVersion: "MONITOR", generatedAt: "2026-08-12T00:00:00Z", listings,
    alertCandidates: [], productCaseOperatingState: { status: "PAUSED" },
    learning: { status: "UNPROVEN", source: "EBAY_CATEGORY_LEARNING",
      evidenceTimestamp: null, categoryAdjustments: [], limitationCode: "NO_STORED_CATEGORY_LEARNING" },
    backend: { decisions, guidanceVsSellerOs: [],
      listingQualityReport: { status: "UNAVAILABLE_NO_CURRENT_REPORT", recommendations: [],
        limitationCode: "NO_CURRENT_REPORT" },
      orders: { status: "AUTH_PENDING", fulfillmentStatuses: ["AUTH_PENDING"] },
      trafficScopes: { accountTraffic: { status: "UNPROVEN" },
        currentLivePortfolio: { activeListings: listings.length } },
      kpis: { activeListings: { value: listings.length }, quantitySold: { value: null } },
      capabilities: { registry: { status: "CERTIFIED", humanReviewCount: 0,
        matchedCount: listings.length, coveragePercent: 100, limitationCodes: [] },
        inventory: { inventoryItemsResource: "UNPROVEN" } },
      operationalHealth: { runningExperiments: { status: "AVAILABLE" } },
      ...overrides },
  }
}

function canonicalOpportunity() {
  const rows = [11.99, 15.74, 20.99, 139.17].map((price, index) =>
    evidence({ itemId: String(800000000001 + index), evidenceId: `strict-${index}`,
      price, sellerReferenceHash: `strict-seller-${index}` }))
  return buildCommercialIntelligenceUpgradeV1({ request, evidence: rows,
    sourceItemId: "366581876813", observedResultCount: 5 }).canonicalResult
}

test("one canonical V2 result owns every primary commercial panel", () => {
  const result = canonicalOpportunity()
  assert.equal(result.authoritative, true)
  assert.equal(result.canonicalFamily.canonicalFamily, "Portable Neck Fan")
  assert.equal(result.commercialRecommendation.productFamily, "Portable Neck Fan")
  assert.equal(result.opportunityCase.canonicalFamily, "Portable Neck Fan")
  assert.equal(result.legacyDiagnosticsPolicy.authoritative, false)
  assert.equal(result.legacyDiagnosticsPolicy.mayOverrideCanonicalResult, false)
  assert.equal(result.legacyDiagnosticsPolicy.primarySurfaceVisible, false)
  assert.match(result.versions.canonicalResultVersion, /^CANONICAL_OPPORTUNITY_RESULT_V2/)
  assert.match(result.versions.decisionVersion, /^CANONICAL_OPPORTUNITY_DECISION_V2/)
})

test("legacy V1 family, decision, and comparable diagnostics are contained below the primary surface", () => {
  const canonicalStart = marketPage.indexOf("Commercial Recommendation V2 · Canonical result")
  const legacyStart = marketPage.indexOf("Legacy diagnostics / provenance")
  assert.ok(canonicalStart >= 0 && legacyStart > canonicalStart)
  const primarySurface = marketPage.slice(canonicalStart, legacyStart)
  assert.doesNotMatch(primarySurface, /research\.decision|research\.productFamilies|research\.comparables/)
  assert.match(primarySurface, /canonical\.commercialRecommendation/)
  assert.match(primarySurface, /canonical\.comparables/)
  assert.match(marketPage.slice(legacyStart), /non-authoritative/)
  assert.match(marketPage.slice(legacyStart), /Legacy Opportunity Case V1/)
  assert.match(marketPage, /decisionIntegration: canonical\.decisionIntegration/)
  assert.match(decisionsSurface, /readCanonicalSessionDecision/)
  assert.match(decisionsSurface, /sessionPresentationOnly: true/)
  assert.match(decisionsSurface, /externalExecutionAllowed: false/)
})

test("UNPROVEN listing evidence and a missing Quality Report do not become commercial interventions", () => {
  const listings = Array.from({ length: 27 }, (_, index) => listing(String(366581876800 + index)))
  const decisions = listings.map((row) => decision(row.identity.itemId))
  const queue = buildProactiveExceptionQueueV1({ monitor: monitor(listings, decisions) })
  assert.equal(queue.some((row) => row.classification === "ACTIONABLE_COMMERCIAL"), false)
  const evidenceGap = queue.find((row) => row.entityType === "PORTFOLIO_EVIDENCE_GAP")
  assert.equal(evidenceGap?.observedEvidence.affectedListingCount, 27)
  const quality = queue.find((row) => row.entityKey === "CAPABILITY:QUALITY_REPORT")
  assert.equal(quality?.classification, "CAPABILITY_BLOCKED")
  assert.ok(quality?.reasonCodes.includes("NO_PROVEN_LISTING_DEFECT"))
  assert.equal(selectMaterialPrioritiesV2(queue, 20).length, 2)
})

test("proven quality and authoritative Registry conflicts keep their stronger taxonomy", () => {
  const itemId = "366581876813"
  const proven = listing(itemId, { blockers: [{ code: "METRIC_GRAIN_MISMATCH",
    domain: "ANALYTICS", source: "EBAY_ANALYTICS" }] })
  const queue = buildProactiveExceptionQueueV1({ monitor: monitor([proven], [decision(itemId)], {
    capabilities: { registry: { status: "PARTIAL_CERTIFIED", humanReviewCount: 1,
      matchedCount: 0, coveragePercent: 0, limitationCodes: ["HUMAN_REVIEW"] },
      inventory: { inventoryItemsResource: "UNPROVEN" } },
  }) })
  assert.equal(queue.find((row) => row.entityKey === itemId)?.classification,
    "ACTIONABLE_COMMERCIAL")
  assert.equal(queue.find((row) => row.entityKey === "REGISTRY_HUMAN_REVIEW")?.classification,
    "HUMAN_REVIEW")
})

test("canonical opportunity action feeds Decisions and outranks generic evidence absence", () => {
  const canonical = canonicalOpportunity()
  const currentMonitor = monitor([listing("366581876813")], [decision("366581876813")])
  const queue = buildProactiveExceptionQueueV1({ monitor: currentMonitor,
    canonicalOpportunities: [canonical.decisionIntegration] })
  const row = queue.find((entry) => entry.entityKey === "366581876813")
  assert.equal(row?.classification, "RESEARCH_OR_EVIDENCE")
  assert.equal(row?.recommendedAction, "NEED_EXACT_SUPPLIER_MATCH")
  assert.equal(row?.observedEvidence.canonicalFamily, "Portable Neck Fan")
  assert.equal(row?.precedenceApplied, "CANONICAL_OPPORTUNITY_OVERRIDES_GENERIC_EVIDENCE_BLOCKER")
  assert.ok(row?.reasonCodes.includes("SUPPLIER_VALIDATION_REQUIRED"))
})

test("critical hard override and proven data quality outrank an opportunity recommendation", () => {
  assert.deepEqual(CANONICAL_OPPORTUNITY_PRECEDENCE_V2, [
    "CRITICAL_OPERATIONAL_OR_POLICY_COMPLIANCE_HARD_OVERRIDE",
    "EXPERIMENT_GUARDIAN_DO_NOT_TOUCH",
    "IDENTITY_OR_PRODUCT_TRUTH_CONFLICT",
    "PROVEN_DATA_QUALITY_BLOCK",
    "CANONICAL_OPPORTUNITY_RESULT_V2",
    "GENERIC_UNPROVEN_EVIDENCE_BLOCKER",
  ])
  const canonical = canonicalOpportunity()
  const itemId = "366581876813"
  const hard = decision(itemId, { reasonCodes: ["HARD_OVERRIDE_REQUIRES_HUMAN_REVIEW"] })
  const hardRow = buildProactiveExceptionQueueV1({ monitor: monitor([listing(itemId)], [hard]),
    canonicalOpportunities: [canonical.decisionIntegration] })
    .find((row) => row.entityKey === itemId)
  assert.equal(hardRow?.classification, "CRITICAL_OPERATIONAL")
  const provenListing = listing(itemId, { blockers: [{ code: "METRIC_GRAIN_MISMATCH",
    domain: "ANALYTICS", source: "EBAY_ANALYTICS" }] })
  const provenRow = buildProactiveExceptionQueueV1({
    monitor: monitor([provenListing], [decision(itemId)]),
    canonicalOpportunities: [canonical.decisionIntegration],
  }).find((row) => row.entityKey === itemId)
  assert.equal(provenRow?.classification, "ACTIONABLE_COMMERCIAL")
  assert.equal(provenRow?.recommendedAction, "FIX_PROVEN_DATA_QUALITY_ISSUE")
})

test("commercial keyword normalization canonicalizes order, dedupes, and rejects promotions", () => {
  assert.deepEqual(normalizeCommercialKeywordPhraseV2("fan portable").phrase, "portable fan")
  assert.deepEqual(normalizeCommercialKeywordPhraseV2("neck fan portable").phrase,
    "portable neck fan")
  const promotional = normalizeCommercialKeywordPhraseV2("free portable fan")
  assert.equal(promotional.status, "REJECT")
  assert.ok(promotional.reasonCodes.includes("REJECT_PROMOTIONAL_CONTAMINATION"))
  const canonical = resolveCanonicalProductFamilyV1({ title: request.seedValue })
  const rows = [
    evidence({ title: "Fan Portable Neck Rechargeable 8000mAh" }),
    evidence({ title: "Portable Neck Fan Cooling Rechargeable" }),
    evidence({ title: "Free Portable Fan Neck Wearable" }),
    evidence({ title: "5-Speed Neck Fan Portable Cooling" }),
  ]
  const keywords = buildKeywordIntelligenceV2({ canonical, evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })) })
  assert.equal(keywords.keywords.filter((row) => row.phrase === "portable neck fan").length, 1)
  assert.ok(keywords.keywords.find((row) => row.phrase === "portable neck fan")
    ?.normalizedFrom.includes("neck fan portable"))
  assert.equal(keywords.keywords.find((row) => row.phrase === "free portable fan")?.role,
    "REJECT")
})

test("keyword roles and semantic relevance cannot promote generic or pure attribute fragments", () => {
  const canonical = resolveCanonicalProductFamilyV1({ title: request.seedValue })
  const rows = [1, 2, 3].map((index) => evidence({
    title: `${index === 1 ? "Portable Neck Fan" : "Neck Fan Portable"} 8000mAh Rechargeable`,
  }))
  const keywords = buildKeywordIntelligenceV2({ canonical, evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })) })
  const generic = keywords.keywords.find((row) => row.phrase === "portable")
  assert.equal(generic?.role, "GENERIC")
  assert.ok((generic?.relevanceScore ?? 100) < 35)
  assert.doesNotMatch(keywords.primaryKeyword ?? "", /^8000|^rechargeable$/i)
  assert.ok(["neck fan", "portable neck fan"].includes(keywords.primaryKeyword))
  assert.equal(new Set([keywords.primaryKeyword, ...keywords.secondaryKeywords]).size,
    [keywords.primaryKeyword, ...keywords.secondaryKeywords].length)
  assert.deepEqual(keywords.spine.REJECTION_REASONS, keywords.spine.REJECTION_REASON)
  assert.equal(keywords.spine.absurdConcatenationsAllowed, false)
})

test("price representativeness flags a possible outlier without changing physical comparability", () => {
  const rows = [11.99, 15.74, 20.99, 139.17].map((price, index) =>
    evidence({ evidenceId: `price-${index}`, itemId: `price-item-${index}`, price }))
  const price = buildPriceOpportunityV2({ evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })) })
  assert.equal(price.strictComparables, 4)
  assert.equal(price.priceBand?.range.maximum, 139.17)
  const premium = price.PRICE_OUTLIER_LIST.find((row) => row.price === 139.17)
  assert.equal(premium?.physicalComparableClassification, "STRICT_COMPARABLE")
  assert.equal(premium?.removedFromPhysicalComparables, false)
  assert.equal(premium?.outlierAssessment, "POSSIBLE_PRICE_OUTLIER")
  assert.equal(price.ROBUST_CORE_PRICE_BAND?.range.maximum, 20.99)
})

test("tiny price samples remain conservative", () => {
  const rows = [10, 20, 100].map((price, index) =>
    evidence({ evidenceId: `tiny-${index}`, itemId: `tiny-item-${index}`, price }))
  const price = buildPriceOpportunityV2({ evidence: rows,
    comparables: rows.map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE" })) })
  assert.equal(price.PRICE_OUTLIER_COUNT, 0)
  assert.equal(price.PRICE_OUTLIER_REASON, "TINY_SAMPLE_OUTLIER_UNPROVEN")
  assert.ok(price.priceRepresentativeness.assessments.every((row) =>
    row.priceRepresentativeness === "PRICE_OUTLIER_UNPROVEN"))
})

test("reference selection labels structural quality and applies a stable explainable tie-break", () => {
  const first = evidence({ evidenceId: "reference-b", itemId: "200", itemSpecifics: { Type: "Neck Fan" } })
  const second = evidence({ evidenceId: "reference-a", itemId: "100", itemSpecifics: { Type: "Neck Fan" } })
  const strategy = buildReferenceStrategyV1({ evidence: [first, second],
    comparables: [first, second].map((row) => ({ evidenceId: row.evidenceId,
      classification: "STRICT_COMPARABLE", confidence: 95, riskCodes: [] })) })
  assert.equal(strategy.primaryReference?.itemId, "100")
  assert.equal(strategy.primaryReference?.referenceRole, "PRIMARY_REFERENCE")
  assert.equal(strategy.runnerUpReference?.itemId, "200")
  assert.equal(strategy.primaryReference?.REFERENCE_STRUCTURE_QUALITY_SCORE,
    strategy.primaryReference?.referenceStructureQualityScore)
  assert.equal(strategy.primaryReference?.scoreMeaning,
    "SELL_ONE_LIKE_THIS_STRUCTURAL_SUITABILITY_NOT_OVERALL_LISTING_QUALITY")
  assert.ok(strategy.tieBreakPolicy.includes("STABLE_ITEM_ID"))
})

test("Sell One Like This remains a read-only structure handoff", () => {
  const row = evidence({ evidenceId: "safe-reference", itemId: "500", brand: "Competitor",
    model: "Competitor Model", gtin: "012345678905", itemSpecifics: { Type: "Neck Fan" } })
  const handoff = buildReferenceStrategyV1({ evidence: [row], comparables: [{
    evidenceId: row.evidenceId, classification: "STRICT_COMPARABLE", confidence: 95,
    riskCodes: ["BRAND_IDENTITY_MUST_NOT_TRANSFER"],
  }] }).primaryReference?.handoff
  assert.deepEqual(handoff?.safeStructureCandidates, ["CATEGORY_ID", "ASPECT_NAMES"])
  assert.deepEqual(handoff?.requiresProductTruth, ["ASPECT_VALUES", "PACK_QUANTITY", "COMPATIBILITY"])
  assert.deepEqual(handoff?.rejectedCompetitorIdentity, ["BRAND", "MODEL", "MPN", "UPC_GTIN"])
  assert.deepEqual(handoff?.rejectedCopyrightContent, ["IMAGES", "DESCRIPTION", "CLAIMS"])
  assert.equal(handoff?.competitorContentCopied, false)
  assert.equal(handoff?.ebayWrites, 0)
})

test("Learning is explicitly empty/non-synthetic and Experiment Guardian remains unchanged", () => {
  assert.match(intelligenceRoute, /storedLearningStatus: monitor\.learning\.categoryAdjustments\.length \? "AVAILABLE" : "NONE"/)
  assert.match(intelligenceRoute, /observedSource: monitor\.learning\.categoryAdjustments\.length \? monitor\.learning\.source : null/)
  assert.match(intelligenceRoute, /syntheticLearning: false/)
  assert.match(intelligenceRoute, /universalRuleAllowed: false/)
  assert.match(intelligenceRoute, /listingLevelLearnings: \[\], familyCandidates: \[\]/)
  assert.match(decisionsSurface, /Stored learning status:/)
  assert.match(decisionsSurface, /Eligible sources when evidence exists:/)
  assert.match(intelligenceRoute, /active: experimentRows\.filter/)
  assert.doesNotMatch(intelligenceRoute, /syntheticExperiment|fakeExperiment/i)
})

test("Assistant listing DTO exposes one canonical V2 truth and suppresses title-only fallback", () => {
  assert.match(assistantSource,
    /canonicalFamily: canonical\.canonicalFamily\.canonicalFamily/)
  assert.match(assistantSource, /commercialRecommendation: canonical\.commercialRecommendation/)
  assert.match(assistantSource, /decisionTaxonomy: canonical\.decisionIntegration/)
  assert.match(assistantSource, /canonicalFamily: null/)
  assert.match(assistantSource, /titleOnlyFamilyResolutionSuppressed: true/)
  assert.match(assistantSource, /legacyDiagnostics: \{ authoritative: false/)
  assert.match(assistantSource, /authoritativeCommercialRecommendation: false/)
  assert.match(assistantSource, /mayOverrideCanonicalOpportunity: false/)
  assert.doesNotMatch(assistantSource, /resolveCanonicalProductFamilyV1/)
  assert.match(assistantSource, /canonicalOpportunities\?\.\[itemId\]/)
  assert.match(assistantSource,
    /seller_os_get_opportunity_radar[\s\S]*canonicalResults\.map[\s\S]*decisionTaxonomy/)
  assert.match(assistantSource,
    /seller_os_get_opportunity_case[\s\S]*CANONICAL_V2_AVAILABLE[\s\S]*canonical\.commercialRecommendation/)
})

test("1000-listing shared evidence absence is bounded and never padded into interventions", () => {
  const listings = Array.from({ length: 1000 }, (_, index) =>
    listing(String(300000000000 + index)))
  const decisions = listings.map((row) => decision(row.identity.itemId))
  const queue = buildProactiveExceptionQueueV1({ monitor: monitor(listings, decisions),
    maximumEntries: 250 })
  assert.equal(queue.length, 2)
  assert.equal(queue.some((row) => row.classification === "ACTIONABLE_COMMERCIAL"), false)
  assert.equal(queue.find((row) => row.entityType === "PORTFOLIO_EVIDENCE_GAP")
    ?.observedEvidence.affectedListingCount, 1000)
  assert.equal(queue.find((row) => row.entityType === "PORTFOLIO_EVIDENCE_GAP")
    ?.observedEvidence.affectedItemIdSample.length, 20)
  assert.equal(selectMaterialPrioritiesV2(queue, 20).length, 2)
  assert.match(portfolioSource, /const decisionByListingKey = new Map/)
  assert.doesNotMatch(portfolioSource,
    /for \(const listing of input\.monitor\.listings\)[\s\S]{0,180}backend\.decisions\.find/)
})

test("all cleanup surfaces remain read-only with zero marketplace mutation paths", () => {
  for (const source of [marketPage, decisionsSurface, intelligenceRoute, assistantSource]) {
    assert.doesNotMatch(source, /createOffer|publishOffer|reviseInventoryStatus|sendWhatsApp|\.insert\(|\.upsert\(|\.delete\(/)
  }
  assert.match(intelligenceRoute, /marketplaceWrites: 0/)
  assert.match(assistantSource, /marketplaceWrites: 0/)
})
