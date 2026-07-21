import assert from "node:assert/strict"
import test from "node:test"

import {
  aggregateEbayMarketPricingByPack,
  buildEbayMarketPricingRecommendation,
} from "./ebay-market-pricing-strategy.ts"

test("no competitor reference enables a cost-floor controlled test instead of blocking", () => {
  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 24.99,
    marketPricing: {},
    controlledExploratoryTest: true,
  })
  assert.equal(recommendation.status, "CONTROLLED_TEST_PRICE_READY_FOR_HUMAN_APPROVAL")
  assert.equal(recommendation.marketReferenceUsed, false)
  assert.equal(recommendation.controlledExploratoryFloorUsed, true)
  assert.equal(recommendation.recommendedSalePrice, 24.99)
  assert.equal(recommendation.competitiveness, "UNBENCHMARKED_CONTROLLED_TEST")
  assert.equal(recommendation.decisionLogic, "OWN_COST_FLOOR_CONTROLLED_TEST_QUANTITY_ONE")
})

test("no competitor reference remains blocked without the explicit controlled-test route", () => {
  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 24.99,
    marketPricing: {},
  })
  assert.equal(recommendation.status, "MARKET_REFERENCE_REQUIRED")
  assert.equal(recommendation.recommendedSalePrice, null)
  assert.equal(recommendation.controlledExploratoryFloorUsed, false)
})

test("conserva comparables unbranded de una presentación aunque eBay omita Pack Quantity", () => {
  const market = aggregateEbayMarketPricingByPack({
    nativePackCount: 1,
    confirmedBrand: "Unbranded",
    comparableEvidence: [
      {
        title: "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
        brand: "Unbranded",
        currency: "USD",
        price: 34.99,
        shippingCost: 0,
        sellerUsername: "seller-one",
        eligibleComparable: true,
        identityMatchQuality: "EXACT",
        localizedAspects: [{ name: "Unit Quantity", value: "1" }],
        identityConflicts: [],
        evidenceSource: "EBAY_BROWSE_ACTIVE_LISTING",
      },
      {
        title: "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
        brand: "Unbranded",
        currency: "USD",
        price: 29.99,
        shippingCost: 0,
        sellerUsername: "seller-two",
        eligibleComparable: true,
        identityMatchQuality: "EXACT",
        localizedAspects: [],
        identityConflicts: [],
        evidenceSource: "EBAY_BROWSE_ESTIMATED_SALES",
      },
      {
        title: "Hearing Aids Hearing Amplifiers for Seniors Rechargeable with Noise Cancelling",
        brand: "Wuvee",
        currency: "USD",
        price: 29.99,
        shippingCost: 0,
        sellerUsername: "seller-three",
        eligibleComparable: true,
        identityMatchQuality: "EXACT",
        localizedAspects: [{ name: "Unit Quantity", value: "1" }],
        identityConflicts: [],
        evidenceSource: "EBAY_BROWSE_ESTIMATED_SALES",
      },
    ],
  })
  assert.equal(market.currentPresentation?.active?.sampleSize, 2)
  assert.equal(market.currentPresentation?.active?.sellerCount, 2)
  assert.equal(market.currentPresentation?.active?.medianLandedPrice, 32.49)
})

test("usa la ventana de 10% sin promoción cuando el piso normal supera el mercado", () => {
  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 41.32,
    controlledRiskMinimumPrice: 32.55,
    marketPricing: {
      nativePackCount: 1,
      currentPresentation: {
        active: {
          sampleSize: 2,
          sellerCount: 2,
          medianLandedPrice: 32.49,
          minimumLandedPrice: 29.99,
          maximumLandedPrice: 34.99,
          confidence: "MEDIUM",
        },
      },
      presentationPortfolio: { candidates: [] },
    },
  })
  assert.equal(recommendation.status,
    "CONTROLLED_RISK_ACTIVE_MARKET_PRICE_READY_FOR_HUMAN_APPROVAL")
  assert.equal(recommendation.recommendedSalePrice, 32.55)
  assert.equal(recommendation.controlledRiskActiveMarketFallbackUsed, true)
  assert.equal(recommendation.promotionAllowed, false)
  assert.equal(recommendation.minimumNetMarginPercent, 10)
})

test("precios activos atípicos no ensanchan el rango ni impiden una ventana 10% cercana", () => {
  const comparableEvidence = [34.99, 35, 35.5, 40, 107.13].map((price, index) => ({
    title: "Tesla NEMA 14-30 Gen II Mobile Connector Smart Adapter",
    brand: "Tesla",
    currency: "USD",
    price,
    shippingCost: 0,
    sellerUsername: `seller-${index}`,
    eligibleComparable: true,
    identityMatchQuality: "EXACT",
    localizedAspects: [{ name: "Unit Quantity", value: "1" }],
    identityConflicts: [],
    evidenceSource: "EBAY_BROWSE_ACTIVE_LISTING",
  }))
  const market = aggregateEbayMarketPricingByPack({
    nativePackCount: 1,
    confirmedBrand: "Tesla",
    comparableEvidence,
  })
  const active = market.currentPresentation?.active
  assert.equal(active?.sourceSampleSize, 5)
  assert.equal(active?.sampleSize, 3)
  assert.equal(active?.excludedOutlierCount, 2)
  assert.equal(active?.minimumLandedPrice, 34.99)
  assert.equal(active?.medianLandedPrice, 35)
  assert.equal(active?.maximumLandedPrice, 35.5)
  assert.equal(active?.observedMaximumLandedPrice, 107.13)

  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 45.27,
    controlledRiskMinimumPrice: 35.66,
    marketPricing: market,
  })
  assert.equal(recommendation.status,
    "CONTROLLED_RISK_ACTIVE_MARKET_PRICE_READY_FOR_HUMAN_APPROVAL")
  assert.equal(recommendation.recommendedSalePrice, 35.66)
  assert.equal(recommendation.controlledRiskActiveMarketFallbackUsed, true)
  assert.equal(recommendation.promotionAllowed, false)
  assert.equal(recommendation.competitiveCeilingPrice, 36.21)
  assert.equal(recommendation.competitiveTolerancePercent, 2)
  assert.equal(recommendation.marketReference?.excludedOutlierCount, 2)
})

test("no recomienda publicar si ni el piso de 10% entra en el mercado", () => {
  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 41.32,
    controlledRiskMinimumPrice: 36,
    marketPricing: {
      nativePackCount: 1,
      currentPresentation: {
        active: {
          sampleSize: 2,
          sellerCount: 2,
          medianLandedPrice: 32.49,
          minimumLandedPrice: 29.99,
          maximumLandedPrice: 34.99,
          confidence: "MEDIUM",
        },
      },
      presentationPortfolio: { candidates: [] },
    },
  })
  assert.equal(recommendation.status, "OWN_COST_FLOOR_ABOVE_MARKET")
  assert.equal(recommendation.recommendedSalePrice, null)
  assert.equal(recommendation.competitiveness, "NOT_COMPETITIVE")
})

test("sold evidence in another pack recommends preparing that pack only after exact economics", () => {
  const recommendation = buildEbayMarketPricingRecommendation({
    minimumOperatorPrice: 18,
    marketPricing: {
      nativePackCount: 1,
      currentPresentation: {
        active: {
          sampleSize: 2,
          sellerCount: 2,
          medianLandedPrice: 22,
          minimumLandedPrice: 20,
          maximumLandedPrice: 24,
          confidence: "MEDIUM",
        },
      },
      strategicPresentation: {
        recommendedPackCountForEvaluation: 3,
        offerMultiplier: 3,
        evidenceTier: "PRODUCT_RESEARCH_SOLD",
        confidence: "HIGH",
      },
      presentationPortfolio: { candidates: [] },
    },
    confirmedRelatedPackStrategy: {
      suggestedPackCountForEvaluation: 3,
      evidenceTier: "CONFIRMED_SOLD_RELATED_PACK",
      confirmedSoldQuantity: 12,
    },
  })
  assert.equal(recommendation.relatedPackStrategy?.recommendedPackCountForEvaluation, 3)
  assert.equal(recommendation.relatedPackStrategy?.publicationRecommendation,
    "PREPARE_PACK_LISTING_AFTER_EXACT_ECONOMICS")
  assert.equal(recommendation.relatedPackStrategy?.requiresExactPackEconomics, true)
  assert.equal(recommendation.relatedPackStrategy?.requiresStockConfirmation, true)
  assert.equal(recommendation.relatedPackStrategy?.humanApprovalRequired, true)
})
