import assert from "node:assert/strict"
import test from "node:test"

import {
  EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT,
  evaluateControlledRiskManualOverride,
} from "./ebay-controlled-risk-manual-override.ts"

const BASE = {
  supplierCost: 9.2,
  exactSoldReferenceTotalBuyerPrice: 27,
  confirmedSoldExactQuantity: 8,
  exactIdentityConfirmed: true,
  exactOfferPackVerified: true,
  lunaAvailable: true,
  evidenceFresh: true,
  decisionFresh: true,
  decisionPackageHashMatches: true,
  factsReady: true,
  shippingEstimateReady: true,
  decisionVerdict: "NO_GO",
  decisionBlockers: ["MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE"],
  baseConfig: {
    estimatedEbayFeeRate: 0.153,
    fixedOrderFee: 0.4,
    estimatedOutboundShipping: 6.99,
    returnsReserveRate: 0.04,
    promotedListingsReserveRate: 0.05,
    minimumNetProfit: 5,
    minimumNetMarginPercent: 20,
    minimumRoiPercent: 30,
  },
}

test("la excepción sólo abre una ventana competitiva con margen neto de 10%", () => {
  const preview = evaluateControlledRiskManualOverride({
    ...BASE,
    decisionBlockers: ["ECONOMICS_NOT_VIABLE", "MARKET_PRICE_BELOW_MINIMUM_SAFE_PRICE"],
  })
  assert.equal(preview.available, true)
  assert.equal(preview.minimumRiskPrice, 23.47)
  assert.equal(preview.maximumCompetitivePrice, 27)
  assert.equal(preview.policy.minimumNetMarginPercent,
    EBAY_CONTROLLED_RISK_MINIMUM_MARGIN_PERCENT)
  assert.equal(preview.policy.promotedListingsReserveRate, 0)
  assert.equal(preview.policy.ebayWrites, 0)

  const approved = evaluateControlledRiskManualOverride({ ...BASE, operatorSalePrice: 25.99 })
  assert.equal(approved.available, true)
  assert.equal(approved.economics?.passesProfitGate, true)
  assert.equal(Number(approved.economics?.estimatedNetMarginPercent) >= 10, true)
})

test("sin venta exacta confirmada la autorización manual permanece cerrada", () => {
  const result = evaluateControlledRiskManualOverride({
    ...BASE,
    confirmedSoldExactQuantity: 0,
  })
  assert.equal(result.available, false)
  assert.ok(result.blockers.includes("CONFIRMED_SOLD_EXACT_REQUIRED"))
})

test("un piso de 10% superior a la referencia vendida no se considera competitivo", () => {
  const result = evaluateControlledRiskManualOverride({
    ...BASE,
    exactSoldReferenceTotalBuyerPrice: 23,
  })
  assert.equal(result.available, false)
  assert.ok(result.blockers.includes("TEN_PERCENT_MARGIN_NOT_COMPETITIVE"))
})

test("la excepción no permite identidad, pack ni cumplimiento incompletos", () => {
  const result = evaluateControlledRiskManualOverride({
    ...BASE,
    exactIdentityConfirmed: false,
    exactOfferPackVerified: false,
    factsReady: false,
  })
  assert.equal(result.available, false)
  assert.ok(result.blockers.includes("EXACT_IDENTITY_REQUIRED"))
  assert.ok(result.blockers.includes("EXACT_OFFER_PACK_REQUIRED"))
  assert.ok(result.blockers.includes("VERIFIED_PRODUCT_FACTS_REQUIRED"))
})

test("el precio escrito por el operador debe estar entre piso y referencia exacta", () => {
  const below = evaluateControlledRiskManualOverride({ ...BASE, operatorSalePrice: 23.46 })
  assert.equal(below.available, false)
  assert.ok(below.blockers.includes("OPERATOR_PRICE_BELOW_TEN_PERCENT_MARGIN_FLOOR"))

  const above = evaluateControlledRiskManualOverride({ ...BASE, operatorSalePrice: 27.01 })
  assert.equal(above.available, false)
  assert.ok(above.blockers.includes("OPERATOR_PRICE_ABOVE_EXACT_SOLD_REFERENCE"))
})

test("no elimina la reserva de garantía aunque la política voluntaria sea no returns", () => {
  const result = evaluateControlledRiskManualOverride(BASE)
  assert.equal(result.policy.voluntaryReturns, "NOT_ACCEPTED_WHERE_EBAY_ALLOWS")
  assert.equal(result.policy.ebayMoneyBackGuaranteeStillApplies, true)
  assert.equal(result.economics, null)
})
