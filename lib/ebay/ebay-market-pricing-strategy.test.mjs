import assert from "node:assert/strict"
import test from "node:test"

import { buildEbayMarketPricingRecommendation } from "./ebay-market-pricing-strategy.ts"

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
