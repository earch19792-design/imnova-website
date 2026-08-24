import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { runAutomaticCertifiedOosProtectionV1 } from
  "./ebay-auto-certified-oos-protection-v1.ts"

const SOURCE = "LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK"

function listing(itemId, sku, overrides = {}) {
  const value = {
    identity: { itemId, sku, listedQuantity: 1,
      marketplaceCertification: { status: "US_CERTIFIED" } },
    discovery: { livePresence: { status: "LIVE_ACTIVE" } },
    composition: { status: "AVAILABLE",
      components: [{ componentId: `${itemId}:component`, supplierSku: "SKU-1",
        quantityRequired: 1, evidenceReferences: ["evidence"] }],
      limitingComponentId: `${itemId}:component`,
      bundleCapacity: { value: 0, availability: "AVAILABLE",
        completeness: "COMPLETE", explicitAuthoritativeZero: true,
        source: { system: SOURCE } } },
    stock: { state: "CERTIFIED_OOS", sourceContractStatus: "HEALTHY",
      supplierLinkageStatus: "CERTIFIED", freshness: { status: "FRESH" },
      quantity: { source: { system: SOURCE } } },
    experiment: { status: "MISSING", commercialAction: "HUMAN_REVIEW_ONLY" },
  }
  return Object.assign(value, overrides)
}

function monitor(listings) {
  return { listings,
    alertCandidates: listings.map((entry) => ({
      reasonCode: "COMPONENT_OUT_OF_STOCK_CONFIRMED", severity: "CRITICAL",
      listingReference: { scope: "LISTING", itemId: entry.identity.itemId,
        sku: entry.identity.sku }, supportingEvidence: [{ reference: "evidence" }],
      candidateOnly: true, dispatchAllowed: false,
    })),
    liveCertification: { status: "CERTIFIED", marketplaceId: "EBAY_US",
      account: { bindingConfigured: true, bindingMatched: true },
      oauth: { status: "AVAILABLE", tokenReceived: true },
      safety: { marketplaceWrites: 0 } } }
}

test("certified OOS is dispatched server-side once without a browser", async () => {
  const calls = []
  const result = await runAutomaticCertifiedOosProtectionV1({
    monitor: monitor([listing("366584348898", "IMN-LST-000010")]),
    executor: async (preflight) => {
      calls.push(preflight.itemId)
      return { status: "PROTECTED_VERIFIED", itemId: preflight.itemId,
        sku: preflight.sku, marketplaceOperation: preflight.marketplaceOperation,
        ebayWriteCount: 1, officialBefore: { listingStatus: "Active" },
        officialAfter: { listingStatus: "Ended", ownership: "inactive" } }
    },
  })
  assert.deepEqual(calls, ["366584348898"])
  assert.equal(result.ebayWriteCount, 1)
  assert.equal(result.humanInterventionCount, 0)
  assert.equal(result.browserSessionRequired, false)
  assert.equal(result.marketplaceOperation, "EndFixedPriceItem")
  assert.equal(result.endingReason, "NotAvailable")
})

test("UNKNOWN, stale, identity mismatch and non-explicit zero write nothing", async () => {
  const cases = [
    listing("366584348898", "IMN-LST-000010", {
      stock: { state: "STOCK_UNKNOWN", sourceContractStatus: "HEALTHY",
        supplierLinkageStatus: "CERTIFIED", freshness: { status: "FRESH" },
        quantity: { source: { system: SOURCE } } },
    }),
    listing("366584348898", "IMN-LST-000010", {
      stock: { state: "CERTIFIED_OOS", sourceContractStatus: "HEALTHY",
        supplierLinkageStatus: "CERTIFIED", freshness: { status: "STALE" },
        quantity: { source: { system: SOURCE } } },
    }),
    listing("366584348898", "bad sku with spaces"),
    listing("366584348898", "IMN-LST-000010", {
      composition: { status: "AVAILABLE", components: [{ componentId: "c",
        supplierSku: "SKU-1", quantityRequired: 1, evidenceReferences: [] }],
        limitingComponentId: "c", bundleCapacity: { value: 0,
          availability: "AVAILABLE", completeness: "COMPLETE",
          explicitAuthoritativeZero: false, source: { system: SOURCE } } },
    }),
  ]
  for (const entry of cases) {
    let calls = 0
    const result = await runAutomaticCertifiedOosProtectionV1({
      monitor: monitor([entry]),
      executor: async () => { calls += 1; throw new Error("UNREACHABLE") },
    })
    assert.equal(calls, 0)
    assert.equal(result.ebayWriteCount, 0)
  }
})

test("one scheduled run is bounded to one marketplace write", async () => {
  const listings = [
    listing("366584348898", "IMN-LST-000010"),
    listing("366584348899", "IMN-LST-000011"),
  ]
  let calls = 0
  const result = await runAutomaticCertifiedOosProtectionV1({
    monitor: monitor(listings), executor: async (preflight) => {
      calls += 1
      return { status: "PROTECTED_VERIFIED", itemId: preflight.itemId,
        sku: preflight.sku, marketplaceOperation: preflight.marketplaceOperation,
        ebayWriteCount: 1, officialBefore: {}, officialAfter: {} }
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.ebayWriteCount, 1)
  assert.deepEqual(result.deferredEligibleItemIds, ["366584348899"])
})

test("historical rows sharing an ItemID cannot shadow the exact live SKU", async () => {
  const historical = listing("366584348898", "IMN-HISTORICAL-000010", {
    discovery: { livePresence: { status: "HISTORICAL_ONLY" } },
  })
  const exactLive = listing("366584348898", "IMN-LST-000010")
  const calls = []
  const result = await runAutomaticCertifiedOosProtectionV1({
    monitor: monitor([historical, exactLive]),
    executor: async (preflight) => {
      calls.push(preflight.sku)
      return { status: "PROTECTED_VERIFIED", itemId: preflight.itemId,
        sku: preflight.sku, marketplaceOperation: preflight.marketplaceOperation,
        ebayWriteCount: 1, officialBefore: {}, officialAfter: {} }
    },
  })
  assert.deepEqual(calls, ["IMN-LST-000010"])
  assert.equal(result.ebayWriteCount, 1)
})

test("the existing Preview monitor scheduler has an independent OOS activation gate", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/ebay-commercial-preview-monitor.yml", import.meta.url),
    "utf8",
  )
  assert.match(
    workflow,
    /active-listing-luna-monitor:[\s\S]*?if: vars\.EBAY_TARGETED_LUNA_ACTIVE_MONITOR_ENABLED == 'true'/,
  )
  assert.match(
    workflow,
    /commercial-monitor:[\s\S]*?if: vars\.EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED == 'true'/,
  )
})
