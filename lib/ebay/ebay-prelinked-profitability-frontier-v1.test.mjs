import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const subject = await import("./ebay-prelinked-profitability-frontier-v1.ts")
const {
  SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1,
  calculateSellerOsProfitabilityFrontierV1,
  evaluateSellerOsRadarExpansionFromProfitabilityV1,
  selectSellerOsTopDollarResearchCandidatesV1,
} = subject

const NOW = "2026-08-23T02:00:00.000Z"
const FRESH = "2026-08-23T01:00:00.000Z"
const STALE = "2026-08-20T01:00:00.000Z"
const D = (character) => `sha256:${character.repeat(64)}`

function evidence(authorityClass, reference, overrides = {}) {
  return {
    authorityClass,
    reference,
    evidenceDigest: overrides.evidenceDigest ?? D("a"),
    observedAt: overrides.observedAt ?? FRESH,
    maximumAgeSeconds: overrides.maximumAgeSeconds ?? 24 * 60 * 60,
  }
}

function price(valueUsd, support, name, overrides = {}) {
  return {
    valueUsd,
    support,
    evidence: overrides.evidence ?? evidence("DERIVED_FACT", `market:price:${name}`),
  }
}

let counter = 0
function input(overrides = {}) {
  counter += 1
  return {
    configurationId: overrides.configurationId ?? `configuration:i02v-${counter}`,
    familyId: overrides.familyId ?? "market-family-v1:test-family",
    familyName: overrides.familyName ?? "Test family",
    familyDemandStatus: overrides.familyDemandStatus ?? "FAMILY_DEMAND_PROVEN",
    lunaProductId: overrides.lunaProductId ?? "9220832493792",
    lunaVariantId: overrides.lunaVariantId ?? "48809643540704",
    lunaSku: overrides.lunaSku ?? `LUNA-SKU-${counter}`,
    productFit: overrides.productFit ?? "STRONG",
    components: overrides.components ?? [{
      componentId: "component:primary",
      unitCostUsd: 10.96,
      supplierQuantityRequired: 1,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:current"),
      quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:current"),
    }],
    marketPrices: overrides.marketPrices ?? {
      low: price(17, "SUPPORTED", "low"),
      median: price(27.17, "SUPPORTED", "median"),
      high: price(40, "SUPPORTED", "high"),
    },
    shipping: overrides.shipping ?? {
      status: "SHIPPING_PROVISIONAL_RESERVE",
      valueUsd: 6.99,
      evidence: evidence("PROVISIONAL_ASSUMPTION", "policy:shipping-reserve"),
    },
    complianceStatus: overrides.complianceStatus ?? "PASS",
    currentHardBlockers: overrides.currentHardBlockers ?? [],
    evidenceAcquisitionCost: overrides.evidenceAcquisitionCost ?? "LOW",
    evaluatedAt: overrides.evaluatedAt ?? NOW,
  }
}

test("reuses the existing canonical provisional thresholds without Phase 6 authority", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.targetMarginPolicy.minimumNetProfit, 5)
  assert.equal(result.targetMarginPolicy.minimumNetMarginPercent, 20)
  assert.equal(result.targetMarginPolicy.minimumRoiPercent, 30)
  assert.equal(result.targetMarginPolicy.phase6CanonicalAuthority, false)
  assert.equal(result.phase6CanonicalEconomicsAuthority, false)
  assert.equal(SELLER_OS_CANONICAL_PROVISIONAL_ECONOMICS_POLICY_V1
    .estimatedOutboundShipping, 6.99)
})

test("preserves every input authority class instead of flattening evidence", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    components: [{ componentId: "component:primary", unitCostUsd: 10,
      supplierQuantityRequired: 1,
      costEvidence: evidence("OFFICIAL_EXTERNAL_FACT", "luna:official-cost"),
      quantityEvidence: evidence("DURABLY_PERSISTED_FACT", "luna:quantity:approved") }],
    marketPrices: {
      low: price(20, "SUPPORTED", "low", { evidence:
        evidence("DIRECT_OBSERVATION", "market:direct-low") }),
      median: price(30, "SUPPORTED", "median", { evidence:
        evidence("DURABLY_PERSISTED_FACT", "market:durable-median") }),
      high: price(40, "SUPPORTED", "high", { evidence:
        evidence("DERIVED_FACT", "market:derived-high") }),
    },
  }))
  assert.deepEqual(result.inputAuthority.componentCosts, ["OFFICIAL_EXTERNAL_FACT"])
  assert.deepEqual(result.inputAuthority.componentQuantities,
    ["DURABLY_PERSISTED_FACT"])
  assert.equal(result.inputAuthority.marketLow, "DIRECT_OBSERVATION")
  assert.equal(result.inputAuthority.marketMedian, "DURABLY_PERSISTED_FACT")
  assert.equal(result.inputAuthority.marketHigh, "DERIVED_FACT")
  assert.equal(result.inputAuthority.shipping, "PROVISIONAL_ASSUMPTION")
  assert.equal(result.inputAuthority.ebayFeePolicy, "PROVISIONAL_ASSUMPTION")
})

test("labels 6.99 only as a provisional shipping reserve", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.shippingStatus, "SHIPPING_PROVISIONAL_RESERVE")
  assert.equal(result.provisionalShippingReserve, 6.99)
  assert.equal(result.shippingValue, 6.99)
  assert.equal(result.unknownShippingTreatedAsZero, false)
})

test("observed shipping requires direct-observation authority", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_OBSERVED", valueUsd: 3.25,
    evidence: evidence("DIRECT_OBSERVATION", "shipping:observed"),
  } }))
  assert.equal(result.shippingStatus, "SHIPPING_OBSERVED")
  assert.equal(result.provisionalShippingReserve, null)
  assert.equal(result.shippingValue, 3.25)
})

test("persisted shipping requires durable authority", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_DURABLY_PERSISTED", valueUsd: 3.25,
    evidence: evidence("DURABLY_PERSISTED_FACT", "shipping:durable"),
  } }))
  assert.equal(result.shippingStatus, "SHIPPING_DURABLY_PERSISTED")
})

test("stale shipping cannot produce a decision-usable economic scenario", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_OBSERVED", valueUsd: 2.50,
    evidence: evidence("DIRECT_OBSERVATION", "shipping:stale", {
      observedAt: STALE, maximumAgeSeconds: 60,
    }),
  } }))
  assert.equal(result.scenarios.median.usableForDecision, false)
  assert.equal(result.scenarios.median.contributionProfit, null)
  assert.equal(result.scenarios.median.passesTargetPolicy, null)
  assert.equal(result.breakEvenSellingPrice, null)
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
  assert.equal(result.shippingEvidenceRequired, true)
  assert.equal(result.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
})

test("shipping authority mismatch fails closed", () => {
  assert.throws(() => calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_OBSERVED", valueUsd: 3.25,
    evidence: evidence("PROVISIONAL_ASSUMPTION", "shipping:not-observed"),
  } })), /FRONTIER_SHIPPING_AUTHORITY_MISMATCH/)
})

test("unknown shipping stays null and economics remain unproven", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_UNPROVEN", valueUsd: null,
    evidence: evidence("UNPROVEN", "shipping:unproven"),
  } }))
  assert.equal(result.shippingValue, null)
  assert.equal(result.contributionProfitAtMarketMedian, null)
  assert.equal(result.breakEvenSellingPrice, null)
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
  assert.equal(result.unknownShippingTreatedAsZero, false)
})

test("unknown shipping with a numeric value is rejected rather than treated as fact", () => {
  assert.throws(() => calculateSellerOsProfitabilityFrontierV1(input({ shipping: {
    status: "SHIPPING_UNPROVEN", valueUsd: 0,
    evidence: evidence("UNPROVEN", "shipping:unproven"),
  } })), /FRONTIER_UNPROVEN_SHIPPING_CONTRACT_INVALID/)
})

test("calculates low median and high contribution scenarios", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.scenarios.low.sellingPrice, 17)
  assert.equal(result.scenarios.median.sellingPrice, 27.17)
  assert.equal(result.scenarios.high.sellingPrice, 40)
  assert.equal(result.scenarios.median.ebayFeeEstimate, 4.56)
  assert.equal(result.scenarios.median.returnsReserve, 1.09)
  assert.equal(result.scenarios.median.promotedListingsReserve, 1.36)
  assert.equal(result.contributionProfitAtMarketMedian, 2.22)
  assert.equal(result.contributionMarginAtMarketMedian, 8.16)
})

test("returns the full median profitability frontier", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.totalProductCost, 10.96)
  assert.equal(result.breakEvenSellingPrice, 24.25)
  assert.equal(result.maxShippingAtBreakEven, 9.2)
  assert.equal(result.maxShippingAtTargetMargin, 3.77)
  assert.equal(result.maxProductCostAtTargetMargin, 7.74)
  assert.equal(result.minSellingPriceAtTargetMargin, 32.95)
})

test("multiplier and BOM costs are structural rather than title-derived", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ components: [
    { componentId: "component:a", unitCostUsd: 4, supplierQuantityRequired: 3,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:a"),
      quantityEvidence: evidence("DURABLY_PERSISTED_FACT", "linkage:quantity:a") },
    { componentId: "component:b", unitCostUsd: 2.5, supplierQuantityRequired: 2,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:b"),
      quantityEvidence: evidence("DURABLY_PERSISTED_FACT", "linkage:quantity:b") },
  ] }))
  assert.equal(result.totalProductCost, 17)
  assert.equal(result.bomCost, 17)
  assert.equal(result.lunaUnitCost, null)
  assert.equal(result.supplierQuantityRequired, null)
})

test("stale Luna cost makes the frontier unproven", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ components: [{
    componentId: "component:primary", unitCostUsd: 10, supplierQuantityRequired: 1,
    costEvidence: evidence("DIRECT_OBSERVATION", "luna:stale", {
      observedAt: STALE, maximumAgeSeconds: 60,
    }),
    quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:fresh"),
  }] }))
  assert.equal(result.totalProductCost, null)
  assert.equal(result.supplierQuantityRequired, null)
  assert.equal(result.scenarios.median.usableForDecision, false)
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
  assert.equal(result.nextBestEvidence, "LUNA_COST_CONFIRMATION")
})

test("inferred cost cannot become authoritative economics", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ components: [{
    componentId: "component:primary", unitCostUsd: 10, supplierQuantityRequired: 1,
    costEvidence: evidence("INFERENCE", "luna:cost-inference"),
    quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:current"),
  }] }))
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
})

test("an inferred structural quantity cannot become authoritative economics", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ components: [{
    componentId: "component:primary", unitCostUsd: 10, supplierQuantityRequired: 3,
    costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:current"),
    quantityEvidence: evidence("INFERENCE", "title:quantity-inference"),
  }] }))
  assert.equal(result.totalProductCost, null)
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
})

test("a conservative median that passes target policy is promising", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    marketPrices: {
      low: price(40, "SUPPORTED", "low"),
      median: price(45, "SUPPORTED", "median"),
      high: price(50, "SUPPORTED", "high"),
    },
    shipping: { status: "SHIPPING_OBSERVED", valueUsd: 3,
      evidence: evidence("DIRECT_OBSERVATION", "shipping:actual") },
  }))
  assert.equal(result.scenarios.median.passesTargetPolicy, true)
  assert.equal(result.economicClassification, "ECONOMICALLY_PROMISING")
})

test("a failed provisional case with bounded zero-shipping path is recoverable", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.failsCurrentProvisionalCase, true)
  assert.equal(result.passesTargetAtZeroShippingAtMedian, true)
  assert.equal(result.economicClassification, "ECONOMICALLY_RECOVERABLE")
  assert.equal(result.shippingEvidenceRequired, true)
  assert.equal(result.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
  assert.equal(result.nextEvidenceValue, "HIGH")
})

test("median shipping-only recovery asks for actual shipping even when high is excluded", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ marketPrices: {
    low: price(17, "SUPPORTED", "low"),
    median: price(27.17, "SUPPORTED", "median"),
    high: price(113.56, "EXCLUDED_OUTLIER", "high"),
  } }))
  assert.equal(result.passesTargetAtZeroShippingAtMedian, true)
  assert.equal(result.shippingEvidenceRequired, true)
  assert.equal(result.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
})

test("exact subtype demand is resolved before shipping research", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    currentHardBlockers: ["EXACT_SUBTYPE_DEMAND_UNPROVEN"],
  }))
  assert.equal(result.shippingEvidenceRequired, true)
  assert.equal(result.nextBestEvidence, "EXACT_SUBTYPE_DEMAND")
  assert.equal(result.nextEvidenceValue, "HIGH")
})

test("single-comparable price evidence is resolved before shipping research", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    currentHardBlockers: ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE"],
  }))
  assert.equal(result.shippingEvidenceRequired, true)
  assert.equal(result.nextBestEvidence, "BETTER_PRICE_DISTRIBUTION")
})

test("positive contribution without a supported target-margin path stays unproven, not dead", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    components: [{ componentId: "component:primary", unitCostUsd: 24,
      supplierQuantityRequired: 1,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:expensive"),
      quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:expensive") }],
    marketPrices: {
      low: price(35, "SUPPORTED", "low"),
      median: price(40, "SUPPORTED", "median"),
      high: price(42, "SUPPORTED", "high"),
    },
  }))
  assert.ok(result.scenarios.high.contributionProfit > 0)
  assert.equal(result.passesTargetAtZeroShippingAtBestSupportedPrice, false)
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
  assert.equal(result.shippingEvidenceRequired, false)
  assert.equal(result.nextBestEvidence, "BETTER_PRICE_DISTRIBUTION")
  assert.equal(result.nextEvidenceValue, "HIGH")
  assert.ok(result.dollarPriorityScore > 0)
})

test("a product negative even at zero shipping and realistic high price is dead", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    components: [{ componentId: "component:primary", unitCostUsd: 50,
      supplierQuantityRequired: 1,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:dead"),
      quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:dead") }],
    marketPrices: {
      low: price(25, "SUPPORTED", "low"),
      median: price(30, "SUPPORTED", "median"),
      high: price(35, "SUPPORTED", "high"),
    },
  }))
  assert.equal(result.economicClassification, "ECONOMICALLY_DEAD")
})

test("an excluded high outlier cannot rescue a structurally dead product", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    components: [{ componentId: "component:primary", unitCostUsd: 24,
      supplierQuantityRequired: 1,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:tesla"),
      quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:tesla") }],
    marketPrices: {
      low: price(20, "SUPPORTED", "low"),
      median: price(30, "SUPPORTED", "median"),
      high: price(179.95, "EXCLUDED_OUTLIER", "high"),
    },
  }))
  assert.equal(result.scenarios.high.usableForDecision, false)
  assert.equal(result.economicClassification, "ECONOMICALLY_DEAD")
})

test("unsupported median price makes economics unproven", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({ marketPrices: {
    low: price(20, "SUPPORTED", "low"),
    median: price(30, "UNPROVEN", "median"),
    high: price(40, "SUPPORTED", "high"),
  } }))
  assert.equal(result.economicClassification, "ECONOMICS_UNPROVEN")
  assert.equal(result.nextBestEvidence, "BETTER_PRICE_DISTRIBUTION")
})

test("current compliance blockers are preserved and economics never authorize listing", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input({
    complianceStatus: "BLOCKED",
    currentHardBlockers: ["COMPLIANCE_BLOCKER", "EXACT_SUBTYPE_DEMAND_UNPROVEN"],
  }))
  assert.deepEqual(result.currentHardBlockers,
    ["COMPLIANCE_BLOCKER", "EXACT_SUBTYPE_DEMAND_UNPROVEN"])
  assert.equal(result.listingAuthorized, false)
})

test("dollar priority is generated only for non-dead products", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.ok(result.dollarPriorityScore > 0)
  assert.ok(result.dollarPriorityScore <= 100)
  assert.equal(result.dollarPriorityScoreVersion,
    "SELLER_OS_DOLLAR_PRIORITY_SCORE_V1")
  assert.deepEqual(result.dollarPriorityComponents, {
    familyDemandQuality: 25,
    productFit: 25,
    profitabilityHeadroom: 14,
    uncertaintyBurden: 10,
    evidenceAcquisitionCost: 10,
    evidenceAcquisitionCostClass: "LOW",
    evidenceAcquisitionCostAuthority: "INFERENCE",
  })
  assert.equal(result.dollarPriorityScoreAuthority, "INFERENCE")
  assert.equal(Object.values(result.dollarPriorityComponents)
    .filter((value) => typeof value === "number")
    .reduce((sum, value) => sum + value, 0), result.dollarPriorityScore)
})

test("top research selection is capped at three and deterministically ranked", () => {
  const candidates = [
    calculateSellerOsProfitabilityFrontierV1(input({ configurationId: "configuration:c",
      evidenceAcquisitionCost: "HIGH" })),
    calculateSellerOsProfitabilityFrontierV1(input({ configurationId: "configuration:a",
      evidenceAcquisitionCost: "LOW" })),
    calculateSellerOsProfitabilityFrontierV1(input({ configurationId: "configuration:b",
      evidenceAcquisitionCost: "MEDIUM" })),
    calculateSellerOsProfitabilityFrontierV1(input({ configurationId: "configuration:d",
      evidenceAcquisitionCost: "LOW", productFit: "MEDIUM" })),
  ]
  const selected = selectSellerOsTopDollarResearchCandidatesV1(candidates)
  assert.equal(selected.length, 3)
  assert.equal(selected[0].configurationId, "configuration:a")
  assert.equal(selected[1].configurationId, "configuration:b")
})

test("dead products never enter the research top three", () => {
  const dead = calculateSellerOsProfitabilityFrontierV1(input({
    configurationId: "configuration:dead",
    components: [{ componentId: "component:primary", unitCostUsd: 100,
      supplierQuantityRequired: 1,
      costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:dead-2"),
      quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:dead-2") }],
  }))
  const survivor = calculateSellerOsProfitabilityFrontierV1(input({
    configurationId: "configuration:survivor",
  }))
  assert.deepEqual(selectSellerOsTopDollarResearchCandidatesV1([dead, survivor])
    .map((item) => item.configurationId), ["configuration:survivor"])
})

test("terminal blockers cannot enter top research or suppress Radar expansion", () => {
  const blocked = calculateSellerOsProfitabilityFrontierV1(input({
    configurationId: "configuration:blocked",
    complianceStatus: "BLOCKED",
    currentHardBlockers: ["CONFIGURATION_CONFLICT"],
  }))
  assert.equal(blocked.researchEligible, false)
  assert.deepEqual(blocked.researchIneligibilityReasons,
    ["COMPLIANCE_BLOCKED", "CONFIGURATION_CONFLICT"])
  assert.deepEqual(selectSellerOsTopDollarResearchCandidatesV1([blocked]), [])
  assert.equal(blocked.strongRecoverablePath, false)
  assert.equal(evaluateSellerOsRadarExpansionFromProfitabilityV1([blocked])
    .radarExpansionRequired, "YES")
})

test("radar expansion is not required when a strong recoverable path exists", () => {
  const result = calculateSellerOsProfitabilityFrontierV1(input())
  assert.equal(result.strongRecoverablePath, true)
  assert.equal(evaluateSellerOsRadarExpansionFromProfitabilityV1([result])
    .radarExpansionRequired, "NO")
})

test("radar expansion is required when there is neither promising nor strong recoverable", () => {
  const weak = calculateSellerOsProfitabilityFrontierV1(input({ productFit: "WEAK" }))
  assert.equal(weak.economicClassification, "ECONOMICALLY_RECOVERABLE")
  assert.equal(weak.strongRecoverablePath, false)
  assert.equal(evaluateSellerOsRadarExpansionFromProfitabilityV1([weak])
    .radarExpansionRequired, "YES")
})

test("the reviewed eight-configuration cohort keeps the certified frontier", () => {
  const cases = [
    { id: "tesla-14-30", cost: 17.82, prices: [35, 35.99, 42.30],
      demand: "FAMILY_DEMAND_PROVEN", fit: "MEDIUM", acquisition: "MEDIUM",
      blockers: ["EXACT_SUBTYPE_DEMAND_UNPROVEN"] },
    { id: "tesla-14-50", cost: 24.77, prices: [35, 35.99, 42.30],
      demand: "FAMILY_DEMAND_PROVEN", fit: "MEDIUM", acquisition: "HIGH",
      blockers: ["EXACT_SUBTYPE_DEMAND_UNPROVEN"] },
    { id: "microcurrent", cost: 10.96, prices: [23.80, 27.17, 34.82],
      demand: "FAMILY_DEMAND_PROVEN", fit: "STRONG", acquisition: "LOW",
      blockers: [] },
    { id: "grace-boom", cost: 6, prices: [8, 14.25, 25.90],
      supports: ["SUPPORTED", "SUPPORTED", "UNPROVEN"],
      demand: "FAMILY_DEMAND_SUPPORTED", fit: "STRONG", acquisition: "HIGH",
      blockers: ["EXACT_PRODUCT_DEMAND_UNPROVEN"] },
    { id: "miss-delicate", cost: 6.50, prices: [8, 14.25, 25.90],
      supports: ["SUPPORTED", "SUPPORTED", "UNPROVEN"],
      demand: "FAMILY_DEMAND_SUPPORTED", fit: "STRONG", acquisition: "HIGH",
      blockers: ["EXACT_PRODUCT_DEMAND_UNPROVEN"] },
    { id: "rug-grippers", cost: 11.08, prices: [26.10, 26.10, 26.10],
      supports: ["UNPROVEN", "SUPPORTED", "UNPROVEN"],
      demand: "FAMILY_DEMAND_SUPPORTED", fit: "STRONG", acquisition: "MEDIUM",
      blockers: ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE"] },
    { id: "v60-black", cost: 12.70, prices: [27.99, 27.99, 27.99],
      supports: ["UNPROVEN", "SUPPORTED", "UNPROVEN"],
      demand: "FAMILY_DEMAND_SUPPORTED", fit: "STRONG", acquisition: "MEDIUM",
      blockers: ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE"] },
    { id: "v60-silver", cost: 11.69, prices: [27.99, 27.99, 27.99],
      supports: ["UNPROVEN", "SUPPORTED", "UNPROVEN"],
      demand: "FAMILY_DEMAND_SUPPORTED", fit: "WEAK", acquisition: "HIGH",
      blockers: ["PRICE_DISTRIBUTION_SINGLE_COMPARABLE", "CONFIGURATION_CONFLICT"] },
  ]
  const results = cases.map((item, index) => {
    const supports = item.supports ?? ["SUPPORTED", "SUPPORTED", "SUPPORTED"]
    return calculateSellerOsProfitabilityFrontierV1(input({
      configurationId: `configuration:${item.id}`,
      familyDemandStatus: item.demand,
      productFit: item.fit,
      evidenceAcquisitionCost: item.acquisition,
      currentHardBlockers: item.blockers,
      lunaSku: `I02V-SKU-${index + 1}`,
      components: [{ componentId: "component:primary", unitCostUsd: item.cost,
        supplierQuantityRequired: 1,
        costEvidence: evidence("DIRECT_OBSERVATION", `i02u:cost:${item.id}`),
        quantityEvidence: evidence("DIRECT_OBSERVATION", `i02u:quantity:${item.id}`) }],
      marketPrices: {
        low: price(item.prices[0], supports[0], `${item.id}:low`),
        median: price(item.prices[1], supports[1], `${item.id}:median`),
        high: price(item.prices[2], supports[2], `${item.id}:high`),
      },
    }))
  })
  const count = (classification) => results.filter((item) =>
    item.economicClassification === classification).length
  assert.equal(count("ECONOMICALLY_DEAD"), 0)
  assert.equal(count("ECONOMICALLY_RECOVERABLE"), 5)
  assert.equal(count("ECONOMICALLY_PROMISING"), 0)
  assert.equal(count("ECONOMICS_UNPROVEN"), 3)
  assert.equal(results.filter((item) => item.shippingEvidenceRequired).length, 5)
  assert.deepEqual(selectSellerOsTopDollarResearchCandidatesV1(results)
    .map((item) => item.configurationId), [
      "configuration:microcurrent",
      "configuration:rug-grippers",
      "configuration:v60-black",
    ])
  assert.equal(evaluateSellerOsRadarExpansionFromProfitabilityV1(results)
    .radarExpansionRequired, "NO")
})

test("frontier identity and digest are deterministic", () => {
  const shared = input({ configurationId: "configuration:stable" })
  const first = calculateSellerOsProfitabilityFrontierV1(shared)
  const second = calculateSellerOsProfitabilityFrontierV1(shared)
  assert.equal(first.frontierDigest, second.frontierDigest)
  assert.match(first.frontierDigest, /^sha256:[0-9a-f]{64}$/)
})

test("invalid price order fails closed", () => {
  assert.throws(() => calculateSellerOsProfitabilityFrontierV1(input({ marketPrices: {
    low: price(30, "SUPPORTED", "low"),
    median: price(20, "SUPPORTED", "median"),
    high: price(40, "SUPPORTED", "high"),
  } })), /FRONTIER_PRICE_ORDER_INVALID/)
})

test("duplicate component identity fails closed", () => {
  const component = { componentId: "component:same", unitCostUsd: 2,
    supplierQuantityRequired: 1,
    costEvidence: evidence("DIRECT_OBSERVATION", "luna:cost:same"),
    quantityEvidence: evidence("DIRECT_OBSERVATION", "luna:quantity:same") }
  assert.throws(() => calculateSellerOsProfitabilityFrontierV1(input({
    components: [component, component],
  })), /FRONTIER_COMPONENT_DUPLICATE/)
})
