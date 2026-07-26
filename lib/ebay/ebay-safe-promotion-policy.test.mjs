import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  evaluateSafePromotionRate,
  MAXIMUM_SAFE_PROMOTION_RATE_PERCENT,
  POST_PUBLICATION_PROMOTION_POLICY_VERSION,
} from "../marketplace/post-publication-optimization-domain.ts"

function eligibility(overrides = {}) {
  return {
    evidenceLevel: "E4",
    salesClassification: "SOLD_CONFIRMED",
    confirmedSalesSource:
      "EBAY_SELL_FULFILLMENT_COMPLETED_CHECKOUT_ORDERS",
    confirmedUnitsSold: 2,
    costsComplete: true,
    economicsPassesProfitGate: true,
    expectedNetProfit: 9,
    minimumNetProfit: 5,
    expectedMarginPercent: 29,
    minimumMarginPercent: 20,
    expectedRoiPercent: 48,
    minimumRoiPercent: 30,
    safetyReservePercent: 3,
    configuredMaximumRatePercent: 2,
    stockAvailable: 12,
    stockEvidenceFresh: true,
    evidenceFresh: true,
    configurationVersion: "COMMERCIAL_THRESHOLDS_V2",
    ...overrides,
  }
}

test("limita la tasa al menor entre 2%, configuración y headroom", () => {
  const maximum = evaluateSafePromotionRate({ eligibility: eligibility() })
  assert.equal(maximum.allowed, true)
  assert.equal(maximum.ratePercent, MAXIMUM_SAFE_PROMOTION_RATE_PERCENT)
  assert.equal(maximum.headroomPercent, 6)
  assert.equal(maximum.policyVersion, POST_PUBLICATION_PROMOTION_POLICY_VERSION)

  const headroom = evaluateSafePromotionRate({
    eligibility: eligibility({ expectedMarginPercent: 24.25 }),
  })
  assert.equal(headroom.allowed, true)
  assert.equal(headroom.ratePercent, 1.25)

  const configured = evaluateSafePromotionRate({
    eligibility: eligibility({ configuredMaximumRatePercent: 0.75 }),
  })
  assert.equal(configured.allowed, true)
  assert.equal(configured.ratePercent, 0.75)
})

test("ACTIVE_ONLY, E3, costos incompletos y stock vencido fallan cerrados", () => {
  const activeOnly = evaluateSafePromotionRate({
    eligibility: eligibility({
      evidenceLevel: "E1",
      salesClassification: "ACTIVE_ONLY",
      confirmedSalesSource: null,
      confirmedUnitsSold: 0,
    }),
  })
  assert.equal(activeOnly.allowed, false)
  assert.equal(activeOnly.reasonCode, "PROMOTION_E4_REQUIRED")

  assert.equal(evaluateSafePromotionRate({
    eligibility: eligibility({ evidenceLevel: "E3" }),
  }).allowed, false)
  assert.equal(evaluateSafePromotionRate({
    eligibility: eligibility({ costsComplete: false }),
  }).allowed, false)
  assert.equal(evaluateSafePromotionRate({
    eligibility: eligibility({ stockEvidenceFresh: false }),
  }).allowed, false)
})

test("la ejecución no conserva una ruta fija de 5% y revalida antes de Marketing", () => {
  const service = readFileSync(
    "lib/ebay/ebay-commercial-improvement-action-service.ts",
    "utf8",
  )
  const panel = readFileSync(
    "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
    "utf8",
  )
  assert.doesNotMatch(service, /SellerOS-5pct|bidPercentage:\s*"5\.0"/)
  assert.match(service, /assertPromotionConfigurationCurrent/)
  assert.match(service, /PROMOTION_ECONOMICS_CHANGED_REVIEW_REQUIRED/)
  assert.ok(
    service.indexOf("PROMOTION_ECONOMICS_CHANGED_REVIEW_REQUIRED") <
      service.indexOf("const marketingToken = await marketingAccessToken"),
  )
  assert.match(panel, /Tasa limitada al menor entre 2% y el headroom real/)
  assert.doesNotMatch(panel, /PROMOCIÓN 5%/)
})
