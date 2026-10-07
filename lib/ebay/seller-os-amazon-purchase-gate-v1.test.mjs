import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { buildSellerOsAmazonPurchaseGateV1 } from
  "../marketplace/seller-os-amazon-purchase-gate-v1.ts"

const now = new Date("2026-10-06T22:00:00.000Z")

function observation(overrides = {}) {
  const base = {
    observationDigest: `sha256:${"a".repeat(64)}`,
    observedAt: now.toISOString(),
    capture: { mode: "AMAZON_SP_API_READ_ONLY",
      authority: "AMAZON_SELLER_CENTRAL", reportStatus: "DONE",
      financeStatus: "AVAILABLE" },
    supplier: { sourceKey: "sunshine-wholesale", name: "Sunshine Wholesale",
      sku: "SUP-101", inventoryQuantity: 20, evidenceState: "CONFIRMED" },
    product: { title: "Fixture product", asin: "B012345678" },
    demand: { confirmed: true, freshness: "CURRENT",
      confirmationBasis: "SELLER_CENTRAL_RESULT" },
    eligibility: { state: "CONFIRMED", confirmed: true,
      freshness: "CURRENT" },
    economics: { unitCostUsd: 8, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5, expectedSalePriceUsd: 30,
      referralFeePerUnitUsd: 4.5, fbaFeePerUnitUsd: 5,
      otherVariableCostPerUnitUsd: 0.5 },
    amazonListing: { state: "ACTIVE", sellerSku: "CON-101",
      listingPriceUsd: 30, lastUpdatedAt: now.toISOString() },
    performance: { authority: "SELLER_CENTRAL_REPORT", authoritative: true,
      observedUnitsSold: 6, observationWindowDays: 28,
      velocityUnitsPerDay: 0.2143, freshness: "CURRENT" },
    outcome: { skillOutcome: "PENDING_RESULT", reorderDecision: "UNPROVEN" },
  }
  return { ...base, ...overrides }
}

test("purchase gate treats 4 dollars as a floor and keeps higher profit", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({
    observation: observation(), now,
  })
  assert.equal(result.decision, "SMALL_TEST")
  assert.equal(result.economics.minimumNetProfitUsd, 4)
  assert.equal(result.economics.projectedNetProfitPerUnitUsd, 10.5)
  assert.equal(result.economics.minimumProfitMet, true)
  assert.equal(result.economics.maximumSupplierUnitCostUsd, 14.5)
  assert.equal(result.recommendedPurchaseQuantity, 1)
  assert.equal(result.safety.automaticPurchaseAllowed, false)
})

test("purchase gate rejects profit below the 4 dollar floor", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    economics: { unitCostUsd: 16, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5, expectedSalePriceUsd: 30,
      referralFeePerUnitUsd: 4.5, fbaFeePerUnitUsd: 5,
      otherVariableCostPerUnitUsd: 0.5 },
  }), now })
  assert.equal(result.economics.projectedNetProfitPerUnitUsd, 2.5)
  assert.equal(result.decision, "REJECT")
  assert(result.blockers.includes("MINIMUM_4_USD_NET_NOT_MET"))
})

test("missing fees remain null and resolve to exactly one next evidence", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    economics: { unitCostUsd: 8, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5, expectedSalePriceUsd: 30,
      referralFeePerUnitUsd: null, fbaFeePerUnitUsd: null,
      otherVariableCostPerUnitUsd: 0.5 },
  }), now })
  assert.equal(result.decision, "WAIT")
  assert.equal(result.economics.projectedNetProfitPerUnitUsd, null)
  assert.equal(result.economics.maximumSupplierUnitCostUsd, null)
  assert.equal(result.nextBestEvidence.action, "COMPLETE_AMAZON_FEES")
})

test("stale demand stays fail closed", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    demand: { confirmed: false, freshness: "STALE",
      confirmationBasis: "SELLER_CENTRAL_RESULT" },
  }), now })
  assert.equal(result.decision, "WAIT")
  assert.equal(result.nextBestEvidence.action, "GET_AMAZON_DEMAND")
  assert(result.blockers.includes("AMAZON_DEMAND_STALE"))
})

test("official Amazon finance totals are reused as actual fees per unit", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    economics: { unitCostUsd: 8, inboundShippingPerUnitUsd: 1,
      prepCostPerUnitUsd: 0.5, expectedSalePriceUsd: 30,
      referralFeePerUnitUsd: null, fbaFeePerUnitUsd: null,
      otherVariableCostPerUnitUsd: null },
    performance: { authority: "SELLER_CENTRAL_REPORT", authoritative: true,
      observedUnitsSold: 10, observationWindowDays: 28,
      velocityUnitsPerDay: 0.3571, freshness: "CURRENT",
      amazonFeesUsd: 45, fulfillmentFeesUsd: 50,
      refundsUsd: 0, otherActualCostsUsd: 0 },
  }), now })
  assert.equal(result.economics.referralFeePerUnitUsd, 4.5)
  assert.equal(result.economics.fbaFeePerUnitUsd, 5)
  assert.equal(result.economics.otherVariableCostPerUnitUsd, 0)
  assert.equal(result.economics.feeAuthority,
    "AMAZON_FINANCES_ACTUAL_PER_UNIT")
  assert.equal(result.decision, "SMALL_TEST")
})

test("authoritative zero is a rejection but unavailable upstream is not zero", () => {
  const zero = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    demand: { confirmed: false, freshness: "CURRENT" },
    performance: { authority: "SELLER_CENTRAL_REPORT", authoritative: true,
      observedUnitsSold: 0, observationWindowDays: 28,
      velocityUnitsPerDay: 0, freshness: "CURRENT" },
  }), now })
  assert.equal(zero.decision, "REJECT")
  assert(zero.blockers.includes("AMAZON_AUTHORITATIVE_ZERO_DEMAND"))

  const unavailable = buildSellerOsAmazonPurchaseGateV1({
    observation: observation({
      capture: { reportStatus: "WAIT_UPSTREAM",
        financeStatus: "UNAVAILABLE" },
      demand: { confirmed: false, freshness: "MISSING" },
      performance: { authority: "UNPROVEN", authoritative: false,
        observedUnitsSold: null, observationWindowDays: null },
    }), now,
  })
  assert.equal(unavailable.decision, "WAIT")
  assert.equal(unavailable.nextBestEvidence.action, "WAIT_UPSTREAM")
  assert.equal(unavailable.evidence.authoritativeZeroDemand, false)
})

test("confirmed winner produces a bounded reorder review, never an order", () => {
  const result = buildSellerOsAmazonPurchaseGateV1({ observation: observation({
    supplier: { sourceKey: "sunshine-wholesale", name: "Sunshine Wholesale",
      sku: "SUP-101", inventoryQuantity: 5, evidenceState: "CONFIRMED" },
    performance: { authority: "SELLER_CENTRAL_REPORT", authoritative: true,
      observedUnitsSold: 14, observationWindowDays: 28,
      velocityUnitsPerDay: 0.5, freshness: "CURRENT" },
    outcome: { skillOutcome: "WINNER", reorderDecision: "REVIEW_REORDER" },
  }), now })
  assert.equal(result.decision, "BUY")
  assert.equal(result.recommendedPurchaseQuantity, 5)
  assert.equal(result.nextBestEvidence.action, "REVIEW_REORDER")
  assert.equal(result.safety.supplierPurchases, 0)
})

test("888lots is removed from active navigation and retired without erasing history", async () => {
  const [navigation, page, route, migration, assistant] = await Promise.all([
    readFile(new URL("../../lib/seller-os/navigation.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/marketplace/888lots/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/admin/marketplace/supplier-catalog/888lots/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../supabase/migrations/20261007023605_retire_888lots_supplier_v1.sql", import.meta.url), "utf8"),
    readFile(new URL("./ebay-seller-os-assistant-gateway-v1.ts", import.meta.url), "utf8"),
  ])
  assert.doesNotMatch(navigation, /supplier-888lots/)
  assert.match(navigation, /Amazon · Connie/)
  assert.match(page, /Proveedor retirado/)
  assert.match(route, /SELLER_OS_888LOTS_SUPPLIER_RETIRED/)
  assert.match(route, /READ_ONLY_HISTORY/)
  assert.match(migration, /where key = '888lots'/)
  assert.match(migration, /historicalEvidencePreserved/)
  assert.match(assistant, /888lots is retired because the supplier is closing/)
})
