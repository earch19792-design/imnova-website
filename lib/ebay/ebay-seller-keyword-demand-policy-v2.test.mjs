import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildEbaySellerKeywordDemandValidation,
} from "./ebay-seller-keyword-demand-validation.ts"

const candidate = {
  productName: "Exact test product",
  gtin: "00012345600012",
  packQuantity: 1,
  condition: "NEW",
}
const runtime = {
  enabled: true,
  shadowMode: false,
  now: "2026-07-26T18:00:00.000Z",
}

function comparable(overrides = {}) {
  return {
    title: "Exact test product",
    gtin: "00012345600012",
    lotSize: 1,
    condition: "NEW",
    lastSoldDate: "2026-07-25T18:00:00.000Z",
    evidenceReviewed: true,
    ...overrides,
  }
}

test("estimated sold quantity and active sellers remain research-only", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate,
    asOf: runtime.now,
    demandEvidencePolicyRuntime: runtime,
    comparables: [
      comparable({
        itemId: "estimated-a",
        sellerUsername: "seller-a",
        source: "EBAY_BROWSE_ESTIMATED_SALES",
        estimatedSoldQuantity: 100,
      }),
      comparable({
        itemId: "estimated-b",
        sellerUsername: "seller-b",
        source: "EBAY_BROWSE_ESTIMATED_SALES",
        estimatedSoldQuantity: 100,
      }),
    ],
  })
  assert.equal(report.totalEstimatedSoldQuantity, 200)
  assert.equal(report.soldExactUnits, 0)
  assert.equal(report.demandValidationPassed, false)
  assert.equal(
    report.demandEvidencePolicy.evidenceClass,
    "OBSERVED_ESTIMATED_ROTATION",
  )
})

test("reviewed exact recent sold evidence keeps metrics separated", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate,
    asOf: runtime.now,
    demandEvidencePolicyRuntime: runtime,
    comparables: [
      comparable({
        itemId: "sold-a",
        sellerUsername: "seller-a",
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        totalSoldQuantity: 2,
      }),
      comparable({
        itemId: "sold-b",
        sellerUsername: "seller-b",
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        totalSoldQuantity: 1,
      }),
    ],
  })
  assert.equal(report.demandValidationPassed, true)
  assert.equal(report.soldExactUnits, 3)
  assert.equal(report.soldExactSellerCount, 2)
  assert.equal(report.soldExactComparableCount, 2)
})

test("missing review, pack, variant, or condition fails closed", () => {
  const report = buildEbaySellerKeywordDemandValidation({
    candidate,
    asOf: runtime.now,
    demandEvidencePolicyRuntime: runtime,
    comparables: [
      comparable({
        itemId: "unsafe-a",
        sellerUsername: "seller-a",
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        totalSoldQuantity: 3,
        evidenceReviewed: false,
      }),
      comparable({
        itemId: "unsafe-b",
        sellerUsername: "seller-b",
        source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY",
        totalSoldQuantity: 3,
        condition: null,
      }),
    ],
  })
  assert.equal(report.demandValidationPassed, false)
  assert.equal(report.soldExactUnits, 0)
})

test("gateway derives review only from complete official sold evidence", () => {
  const gateway = readFileSync(
    "lib/ebay/ebay-seller-keyword-demand-gateway.ts",
    "utf8",
  )
  assert.match(gateway, /condition:\s*officialCondition\(item\) \|\| null/)
  assert.match(
    gateway,
    /source === "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY"[\s\S]+Boolean\(text\(item\.itemId\)\)[\s\S]+Boolean\(lastSoldDate\)[\s\S]+\(totalSoldQuantity \?\? 0\) > 0/,
  )
  assert.doesNotMatch(gateway, /evidenceReviewed:\s*item\.evidenceReviewed/)
  assert.match(gateway, /item-v3:\$\{itemId\}/)
})

test("opportunity engine explicitly blocks estimated rotation from package readiness", () => {
  const source = readFileSync(
    "lib/ebay/ebay-luna-demand-opportunity-engine.ts",
    "utf8",
  )
  assert.match(source, /EXACT_BROWSE_SNAPSHOT_DELTAS_RESEARCH_ONLY/)
  assert.match(source, /NEED_CONFIRMED_SOLD_EXACT/)
  assert.match(
    source,
    /input\.demandReport\.demandEvidencePolicy\.demandValidated\s*&&/,
  )
})
