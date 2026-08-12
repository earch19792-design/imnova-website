import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildCommercialMonitorBackendV1,
  classifyCommercialListingV1,
  compareEbayGuidanceWithSellerOsV1,
  normalizeEbayListingQualityReport,
} = await import("./ebay-commercial-monitor-intelligence-v1.ts")
const {
  sanitizeLiveEbayOrders,
} = await import("./ebay-commercial-monitor-live-readonly-domain.ts")

const AT = "2026-08-11T12:00:00.000Z"

function metric(value, availability = value === null ? "UNAVAILABLE" : "AVAILABLE") {
  return {
    value,
    availability,
    completeness: value === null ? "UNPROVEN" : "COMPLETE",
  }
}

function listing(index, values = {}, options = {}) {
  const unavailable = metric(null)
  return {
    key: `listing-${index}`,
    identity: {
      itemId: String(500000000000 + index),
      sku: `SKU-${index}`,
    },
    metrics: {
      listing_price: unavailable,
      impressions: metric(values.impressions ?? 500),
      ebay_views: metric(values.views ?? 50),
      external_views: unavailable,
      ctr_reported: metric(values.ctr ?? 2),
      ctr_calculated: unavailable,
      watchers: unavailable,
      transactions: metric(values.orders ?? 2),
      orders: metric(values.orders ?? 2),
      units_sold: unavailable,
      conversion: metric(values.conversion ?? 4),
      revenue: unavailable,
      fees: unavailable,
      promoted_fees: unavailable,
      supplier_cost: unavailable,
      shipping: unavailable,
      contribution: unavailable,
      net_profit: unavailable,
      margin: unavailable,
      roi: unavailable,
    },
    experiment: options.experiment ?? {
      status: "MISSING",
      checkedAt: AT,
      commercialAction: "HUMAN_REVIEW_ONLY",
      source: { reference: "experiment-none", source: "TEST", capturedAt: AT },
    },
    blockers: options.blockers ?? [],
    dataQualityIssues: options.dataQualityIssues ?? [],
  }
}

function liveCertification(ordersStatus = "UNAVAILABLE", orderGaps = [
  "FULFILLMENT_DEDICATED_REFRESH_TOKEN_MISSING",
]) {
  return {
    account: { bindingConfigured: true, bindingMatched: true },
    discovery: { status: "AVAILABLE", coverage: "COMPLETE" },
    analytics: { status: "CERTIFIED" },
    orders: { status: ordersStatus, gapCodes: orderGaps },
  }
}

test("decision engine emits all five canonical classes without executing", () => {
  const visibility = classifyCommercialListingV1(listing(1, { impressions: 0 }))
  const ctr = classifyCommercialListingV1(listing(2, { impressions: 500, ctr: 0.5 }))
  const conversion = classifyCommercialListingV1(listing(3, {
    impressions: 500,
    ctr: 2,
    views: 50,
    orders: 0,
    conversion: 0,
  }))
  const dataQuality = classifyCommercialListingV1(listing(4, {}, {
    blockers: [{ code: "SOURCE_UNAVAILABLE" }],
  }))
  const healthy = classifyCommercialListingV1(listing(5))
  assert.deepEqual([
    visibility.classification,
    ctr.classification,
    conversion.classification,
    dataQuality.classification,
    healthy.classification,
  ], ["VISIBILITY", "CTR", "CONVERSION", "DATA_QUALITY", "HEALTHY_WAIT"])
  for (const decision of [visibility, ctr, conversion, dataQuality, healthy]) {
    assert.equal(decision.actionExecutionAllowed, false)
  }
})

test("active experiments freeze actions and preserve the controlled loop", () => {
  const decision = classifyCommercialListingV1(listing(6, {
    impressions: 500,
    ctr: 0.5,
  }, {
    experiment: {
      status: "AVAILABLE",
      lifecycleState: "RUNNING",
      frozenVariables: ["title"],
      checkpointGate: "WAIT_7_DAYS",
    },
  }))
  assert.equal(decision.classification, "CTR")
  assert.equal(decision.recommendedAction, "WAIT")
  assert.equal(decision.experimentRunning, true)
  assert.equal(decision.variableFrozen, true)
  assert.ok(decision.reasonCodes.includes("ACTIVE_EXPERIMENT_PROTECTS_VARIABLE"))
})

test("missing analytics stays UNPROVEN rather than becoming zero", () => {
  const candidate = listing(7)
  candidate.metrics.impressions = metric(null)
  const decision = classifyCommercialListingV1(candidate)
  assert.equal(decision.classification, "DATA_QUALITY")
  assert.equal(decision.evidenceStatus, "UNPROVEN")
  assert.equal(decision.actionBlockedByInsufficientEvidence, true)
})

test("quality report uses Item ID first, unique SKU second, and never fabricates", () => {
  const listings = [listing(8), listing(9)]
  const missing = normalizeEbayListingQualityReport({ listings })
  assert.equal(missing.status, "UNAVAILABLE_NO_CURRENT_REPORT")
  assert.deepEqual(missing.recommendations, [])
  const quality = normalizeEbayListingQualityReport({
    listings,
    artifact: {
      source: "EBAY_LISTING_QUALITY_REPORT",
      sourceVersion: "v1",
      observedAt: AT,
      importedAt: AT,
      rows: [
        {
          itemId: listings[0].identity.itemId,
          sku: "WRONG-SKU-MUST-NOT-OVERRIDE-ITEM",
          recommendationCategory: "CTR",
          recommendationType: "IMPROVE_TITLE",
          reportedBenchmark: 1.5,
        },
        {
          sku: listings[1].identity.sku,
          recommendationCategory: "CONVERSION",
          recommendationType: "REVIEW_PRICE",
        },
        {
          sku: "NO-MATCH",
          recommendationCategory: "VISIBILITY",
          recommendationType: "REVIEW_CATEGORY",
        },
      ],
    },
  })
  assert.equal(quality.status, "PARTIAL")
  assert.deepEqual(quality.recommendations.map((row) => row.associationStatus), [
    "ITEM_ID_CERTIFIED", "SKU_UNIQUE", "UNPROVEN",
  ])
})

test("eBay guidance is separate and never auto-executes", () => {
  const decision = classifyCommercialListingV1(listing(10, {
    impressions: 500,
    ctr: 0.5,
  }))
  const comparison = compareEbayGuidanceWithSellerOsV1({
    decision,
    guidance: {
      associationStatus: "ITEM_ID_CERTIFIED",
      recommendationCategory: "CTR",
      reportedBenchmark: 1.5,
      topCategoryBenchmark: null,
    },
  })
  assert.equal(comparison.conclusion, "AGREE")
  assert.equal(comparison.automaticExecutionAllowed, false)
})

test("orders capability is auth-pending with null KPI and Inventory remains degraded", () => {
  const backend = buildCommercialMonitorBackendV1({
    liveCertification: liveCertification(),
    listings: [listing(11)],
    alertCandidates: [],
    registry: {
      status: "PARTIAL_CERTIFIED",
      currentLiveCount: 27,
      matchedCount: 24,
      humanReviewCount: 3,
      coveragePercent: 88.89,
      limitationCodes: ["REGISTRY_HUMAN_REVIEW_RELATIONSHIPS_PRESENT"],
    },
    orders: {
      status: "UNAVAILABLE_AUTH_PENDING",
      orderCount: null,
      lineItemCount: null,
      quantitySold: null,
      latestOrderCreationAt: null,
      orderStatuses: [],
      fulfillmentStatuses: [],
      trackingAvailability: "UNPROVEN",
    },
  })
  assert.equal(backend.capabilities.ordersFulfillment, "UNAVAILABLE_AUTH_PENDING")
  assert.equal(backend.kpis.orders.value, null)
  assert.equal(backend.capabilities.registry.matchedCount, 24)
  assert.equal(backend.capabilities.registry.humanReviewCount, 3)
  assert.equal(backend.capabilities.inventory.status, "DEGRADED")
  assert.equal(backend.capabilities.inventory.inventoryItemsResource,
    "EBAY_REJECTED_25709_UNRESOLVED")
  assert.equal(backend.safety.marketplaceWrites, 0)
  assert.equal(backend.safety.registryWrites, 0)
})

test("Fulfillment normalization strips buyer PII and preserves safe order facts", () => {
  const orders = sanitizeLiveEbayOrders({
    orders: [{
      orderId: "SAFE-ORDER-1",
      creationDate: AT,
      lastModifiedDate: AT,
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      buyer: { username: "private-buyer", email: "buyer@example.com" },
      fulfillmentStartInstructions: [{
        shippingStep: { shipTo: { fullName: "Private Name", phoneNumber: "555" } },
      }],
      pricingSummary: { total: { value: "19.99", currency: "USD" } },
      lineItems: [{
        lineItemId: "LINE-1",
        legacyItemId: "123456789012",
        listingMarketplaceId: "EBAY_US",
        sku: "SAFE-SKU",
        quantity: 2,
        lineItemCost: { value: "19.99", currency: "USD" },
      }],
    }],
  })
  assert.equal(orders.length, 1)
  assert.equal(orders[0].lineItems[0].quantity, 2)
  const serialized = JSON.stringify(orders)
  assert.doesNotMatch(serialized, /buyer|email|shipTo|fullName|phone|Private/i)
})
