import assert from "node:assert/strict"
import test from "node:test"

import {
  LUNA_FULFILLMENT_RATE_CARD_VERSION,
  LUNA_PACK_DISCOUNT_SCENARIO_VERSION,
  evaluatePackDiscountScenarios,
  quoteLunaFulfillment,
  rankRelatedPackStrategies,
} from "./luna-fulfillment-pricing.ts"

test("Luna native presentation adds no receiving or custom preparation charge", () => {
  const quote = quoteLunaFulfillment({
    source: "LUNA_NATIVE_PRESENTATION",
    nativePackCount: 6,
    offerPackCount: 6,
    physicalUnitsPerOffer: 1,
    unitCostUsd: 12,
    shippingCostUsd: 5,
  })
  assert.equal(quote.version, LUNA_FULFILLMENT_RATE_CARD_VERSION)
  assert.equal(quote.status, "CONTRACT_RATE_READY")
  assert.equal(quote.sameNativePresentation, true)
  assert.equal(quote.customPreparationApplied, false)
  assert.equal(quote.receivingFeeApplied, false)
  assert.equal(quote.exactFulfillmentCostUsd, 17)
  assert.deepEqual(quote.costs.map((entry) => entry.key), ["PRODUCT_COST", "SHIPPING"])
})

test("a six-pack built from Luna units applies the up-to-eight custom rate", () => {
  const quote = quoteLunaFulfillment({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    offerPackCount: 6,
    physicalUnitsPerOffer: 6,
    unitCostUsd: 2,
    shippingCostUsd: 6,
    packagingType: "POLYBAG",
    packagingMaterial: "POLY_MAILER",
  })
  assert.equal(quote.status, "CONTRACT_RATE_READY")
  assert.equal(quote.customPreparationApplied, true)
  assert.equal(quote.receivingFeeApplied, false)
  assert.equal(quote.costs.find((entry) => entry.key === "PREPARATION")?.amountUsd, 1.25)
  assert.equal(quote.exactFulfillmentCostUsd, 19.75)
})

test("external wholesale adds reception and blocks exact economics without storage", () => {
  const quote = quoteLunaFulfillment({
    source: "EXTERNAL_WHOLESALER_VIA_LUNA",
    nativePackCount: 1,
    offerPackCount: 12,
    unitCostUsd: 1,
    shippingCostUsd: 7,
    packagingType: "BOX",
    packagingMaterial: "SMALL_BOX",
  })
  assert.equal(quote.receivingFeeApplied, true)
  assert.equal(quote.costs.find((entry) => entry.key === "RECEIVING")?.amountUsd, 2.4)
  assert.ok(quote.blockers.includes("EXTERNAL_STORAGE_RATE_REQUIRED"))
  assert.equal(quote.exactFulfillmentCostUsd, null)
})

test("more than fifty physical units requires a Luna quote", () => {
  const quote = quoteLunaFulfillment({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    offerPackCount: 60,
    unitCostUsd: 1,
    shippingCostUsd: 10,
    packagingType: "POLYBAG",
    packagingMaterial: "POLY_MAILER",
  })
  assert.equal(quote.status, "QUOTE_REQUIRED")
  assert.ok(quote.blockers.includes("LUNA_PREPARATION_QUOTE_REQUIRED_OVER_50_UNITS"))
})

test("bubble wrap remains a contractual range until confirmed", () => {
  const quote = quoteLunaFulfillment({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    offerPackCount: 3,
    unitCostUsd: 2,
    shippingCostUsd: 5,
    packagingType: "BOX",
    packagingMaterial: "SMALL_BOX",
    bubbleWrapRequired: true,
  })
  assert.equal(quote.status, "CONSERVATIVE_RANGE_ONLY")
  assert.equal(quote.exactFulfillmentCostUsd, null)
  assert.equal(quote.costs.find((entry) => entry.key === "BUBBLE_WRAP")?.minimumUsd, .5)
  assert.equal(quote.costs.find((entry) => entry.key === "BUBBLE_WRAP")?.maximumUsd, 1)
})

test("related sold packs suggest only a presentation to evaluate, not an automatic price", () => {
  const result = rankRelatedPackStrategies({
    nativePackCount: 1,
    feasiblePackCounts: [3, 6],
    relatedPackEvidence: [
      { packCount: 3, observationCount: 4, confirmedSoldQuantity: 12, confidence: "MEDIUM" },
      { packCount: 6, observationCount: 6, confirmedSoldQuantity: 25, confidence: "HIGH" },
      { packCount: 2, observationCount: 30, confirmedSoldQuantity: 50, confidence: "HIGH" },
    ],
  })
  assert.equal(result.suggestedPackCountForEvaluation, 6)
  assert.equal(result.requiresCustomPreparation, true)
  assert.equal(result.publicationRecommendation,
    "PREPARE_PACK_LISTING_AFTER_EXACT_ECONOMICS")
  assert.equal(result.exactEconomicsRequired, true)
  assert.equal(result.stockConfirmationRequired, true)
  assert.equal(result.humanApprovalRequired, true)
  assert.deepEqual(result.candidates.map((entry) => entry.packCount), [6, 3])
  assert.match(result.conclusion, /recomienda preparar una oferta de 6 unidades/i)
  assert.match(result.prohibitedConclusions.join(" "), /precio.*automáticamente/i)
})

test("related strategy accepts detected pack counts such as 5 and 24 by default", () => {
  const result = rankRelatedPackStrategies({
    nativePackCount: 1,
    relatedPackEvidence: [
      { packCount: 5, observationCount: 3, confirmedSoldQuantity: 8, confidence: "MEDIUM" },
      { packCount: 24, observationCount: 2, confirmedSoldQuantity: 20, confidence: "HIGH" },
    ],
  })
  assert.deepEqual(result.candidates.map((entry) => entry.packCount), [24, 5])
  assert.equal(result.suggestedPackCountForEvaluation, 24)
})

test("confirmed sold pack evidence can surface the deepest owner-cost discount that passes every gate", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    targetPackCount: 12,
    lunaPurchaseUnitsPerOffer: 12,
    lunaPurchaseUnitCostUsd: 2,
    approvedBaselinePricePerNativePresentationUsd: 5.5,
    shippingCostUsd: 6,
    packagingType: "POLYBAG",
    packagingMaterial: "POLY_MAILER",
    marketEvidence: {
      packCount: 12,
      evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
      activeListingCount: 7,
      activeSellerCount: 4,
      activeResultSampleSize: 20,
      confirmedSoldObservationCount: 3,
      confirmedSoldQuantity: 18,
      confidence: "MEDIUM",
    },
  })
  assert.equal(result.version, LUNA_PACK_DISCOUNT_SCENARIO_VERSION)
  assert.equal(result.quote.exactFulfillmentCostUsd, 32)
  assert.equal(result.strategyClassification, "SUPPORTED_BY_CONFIRMED_SOLD_RELATED_PACK")
  assert.equal(result.observedMarketPattern.activePackPrevalencePercent, 35)
  assert.deepEqual(result.scenarios.map((scenario) => [
    scenario.discountPercent,
    scenario.viableForOperatorReview,
  ]), [[10, true], [15, false], [20, false]])
  assert.equal(result.scenarioForOperatorReview?.discountPercent, 10)
  assert.equal(result.scenarioForOperatorReview?.competitorPriceUsed, false)
  assert.equal(result.controls.humanApprovalRequired, true)
  assert.equal(result.controls.ebayWrites, 0)
})

test("active pack prevalence remains descriptive and never recommends a discount", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    targetPackCount: 5,
    lunaPurchaseUnitsPerOffer: 5,
    lunaPurchaseUnitCostUsd: 1,
    approvedBaselinePricePerNativePresentationUsd: 8,
    shippingCostUsd: 5,
    packagingType: "POLYBAG",
    packagingMaterial: "POLY_MAILER",
    marketEvidence: {
      packCount: 5,
      evidenceTier: "ACTIVE_RELATED",
      activeListingCount: 12,
      activeSellerCount: 8,
      activeResultSampleSize: 20,
      confirmedSoldObservationCount: 0,
      confirmedSoldQuantity: 0,
      confidence: "HIGH",
    },
  })
  assert.equal(result.strategyClassification, "PRELIMINARY_ACTIVE_PATTERN_ONLY")
  assert.equal(result.scenarios.some((scenario) => scenario.viableForOperatorReview), true)
  assert.equal(result.scenarioForOperatorReview, null)
  assert.equal(result.controls.activeEvidenceCanRecommend, false)
  assert.match(result.interpretation, /no demuestra ventas/i)
})

test("broad-search quantities cannot masquerade as confirmed related-pack sales", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    targetPackCount: 5,
    lunaPurchaseUnitsPerOffer: 5,
    lunaPurchaseUnitCostUsd: 1,
    approvedBaselinePricePerNativePresentationUsd: 8,
    shippingCostUsd: 5,
    packagingType: "POLYBAG",
    packagingMaterial: "POLY_MAILER",
    marketEvidence: {
      packCount: 5,
      evidenceTier: "BROAD_SEARCH_ONLY",
      activeListingCount: 100,
      confirmedSoldObservationCount: 20,
      confirmedSoldQuantity: 200,
    },
  })
  assert.equal(result.strategyClassification, "PRELIMINARY_ACTIVE_PATTERN_ONLY")
  assert.equal(result.scenarioForOperatorReview, null)
})

test("pack scenario blocks a presentation that cannot be assembled from the confirmed Luna unit", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 6,
    targetPackCount: 24,
    lunaPurchaseUnitsPerOffer: 3,
    lunaPurchaseUnitCostUsd: 10,
    approvedBaselinePricePerNativePresentationUsd: 20,
    shippingCostUsd: 8,
    packagingType: "BOX",
    packagingMaterial: "SMALL_BOX",
    marketEvidence: {
      packCount: 24,
      evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
      confirmedSoldObservationCount: 2,
      confirmedSoldQuantity: 10,
    },
  })
  assert.ok(result.blockers.includes("PACK_CONFIGURATION_CONFLICT"))
  assert.equal(result.scenarios.some((scenario) => scenario.viableForOperatorReview), false)
  assert.equal(result.scenarioForOperatorReview, null)
})

test("custom discount bands are evaluated but never become automatic competitor repricing", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    targetPackCount: 24,
    lunaPurchaseUnitsPerOffer: 24,
    lunaPurchaseUnitCostUsd: 1,
    approvedBaselinePricePerNativePresentationUsd: 6,
    shippingCostUsd: 9,
    packagingType: "BOX",
    packagingMaterial: "MEDIUM_BOX",
    discountPercentScenarios: [5, 12.5, 25],
    marketEvidence: {
      packCount: 24,
      evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
      confirmedSoldObservationCount: 4,
      confirmedSoldQuantity: 30,
    },
  })
  assert.deepEqual(result.scenarios.map((scenario) => scenario.discountPercent), [5, 12.5, 25])
  assert.equal(result.controls.automaticPricingAllowed, false)
  assert.equal(result.controls.competitorPricesUsed, false)
  assert.equal(result.scenarios.every((scenario) =>
    scenario.priceBasis === "OWNER_APPROVED_BASELINE_PRICE"), true)
})

test("runtime preflight treats absent Luna cost, shipping and owner baseline as blocking, never as zero", () => {
  const result = evaluatePackDiscountScenarios({
    source: "LUNA_CUSTOM_PRESENTATION",
    nativePackCount: 1,
    targetPackCount: 6,
    lunaPurchaseUnitsPerOffer: 6,
    lunaPurchaseUnitCostUsd: null,
    approvedBaselinePricePerNativePresentationUsd: null,
    shippingCostUsd: null,
    packagingType: "UNKNOWN",
    packagingMaterial: "UNKNOWN",
    marketEvidence: {
      packCount: 6,
      evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
      confirmedSoldObservationCount: 2,
      confirmedSoldQuantity: 8,
    },
  })
  assert.ok(result.blockers.includes("OWNER_APPROVED_BASELINE_PRICE_REQUIRED"))
  assert.ok(result.blockers.includes("OFFER_PACK_OR_UNIT_COST_REQUIRED"))
  assert.equal(result.quote.exactFulfillmentCostUsd, null)
  assert.equal(result.scenarioForOperatorReview, null)
  assert.equal(result.scenarios.every((scenario) =>
    scenario.candidateSalePriceUsd === null && scenario.viableForOperatorReview === false), true)
})
