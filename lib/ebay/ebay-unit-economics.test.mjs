import assert from "node:assert/strict"
import test from "node:test"

import { calculateEbayMinimumOperatorPrice, calculateEbayUnitEconomics } from "./ebay-unit-economics.ts"

test("calculates the operator floor only from owned costs and configured reserves", () => {
  const floor = calculateEbayMinimumOperatorPrice({ supplierCost: 10 })
  assert.equal(floor.ready, true)
  assert.equal(floor.minimumOperatorPrice > 10, true)
  assert.equal(floor.calculationSource, "SERVER_OWN_COST_PRICE_FLOOR_V1")

  const approved = calculateEbayUnitEconomics({ supplierCost: 10, salePrice: floor.minimumOperatorPrice })
  assert.equal(approved.ready, true)
  assert.equal(approved.passesProfitGate, true)
})

test("does not calculate a price floor without a verified supplier cost", () => {
  const floor = calculateEbayMinimumOperatorPrice({ supplierCost: null })
  assert.equal(floor.ready, false)
  assert.equal(floor.minimumOperatorPrice, null)
})

test("the minimum operator price always rounds upward and still passes every gate", () => {
  for (const supplierCost of [0.01, 1.01, 4.37, 12.99]) {
    const floor = calculateEbayMinimumOperatorPrice({ supplierCost })
    assert.equal(floor.ready, true)
    const validation = calculateEbayUnitEconomics({ supplierCost, salePrice: floor.minimumOperatorPrice })
    assert.equal(validation.passesProfitGate, true, `floor must remain safe for cost ${supplierCost}`)
  }
})

test("unit economics separates contribution break-even from the profit floor", () => {
  const result = calculateEbayUnitEconomics({ supplierCost: 10,
    salePrice: 30 }, { estimatedOutboundShipping: 6.99 })
  assert.equal(result.ready, true)
  assert.equal(result.contributionBreakEvenPrice, 22.97)
  assert.ok(result.minimumProfitablePrice > result.contributionBreakEvenPrice)
})
