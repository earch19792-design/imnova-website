import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier ?? "")
    if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
      try { return nextResolve(`${value}.ts`, context) } catch {}
    }
    return nextResolve(specifier, context)
  },
})

const { deriveSellerOsDashboardCommercialHealthV1 } = await import(
  "./seller-os-dashboard-commercial-health-v1.ts")
const { analyticsLastKnownGoodItemSetDigestV1 } = await import(
  "./ebay-analytics-last-known-good-v1.ts")

const ITEM_ID = "366582586826"
const PRODUCT_ID = "9220805755104"
const VARIANT_ID = "48809607659744"
const SKU = "ITEM5810"
const LINKAGE_ID = `luna-linkage-v1:sha256:${"a".repeat(64)}`
const JOB_ID = `luna-stock-check-v1:sha256:${"b".repeat(64)}`
const NOW = new Date("2026-08-31T18:00:00.000Z")

function componentId() {
  return `luna-component-identity-v1:sha256:${createHash("sha256")
    .update(JSON.stringify([PRODUCT_ID, VARIANT_ID, SKU])).digest("hex")}`
}

function source(rows, status = "AVAILABLE") {
  return { source: "TEST", status, rows, limitationCode: null,
    truncated: false }
}

function registry(includeHistoricalActive = false) {
  const rows = [{ id: "listing-1", account_key: "seller:test",
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING", ebay_item_id: ITEM_ID,
    ebay_sku: "IMN-5810", listing_status: "active", title: "Exact product",
    ebay_quantity: 1, ebay_price: 71.99, currency: "USD",
    market_radar_product_id: PRODUCT_ID, supplier_variant_id: VARIANT_ID,
    supplier_sku: SKU, supplier_cost_at_linking: 44.2,
    last_ebay_sync_at: NOW.toISOString(), raw_payload: {}, sync_generation: 1,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString() }]
  if (includeHistoricalActive) rows.push({ ...rows[0], id: "listing-old",
    ebay_item_id: "366543596425", ebay_sku: "HISTORICAL-ROW" })
  return source(rows)
}

function stockSources() {
  const component = { lunaProductId: PRODUCT_ID, lunaVariantId: VARIANT_ID,
    lunaSku: SKU, supplierQuantityRequired: 1, exactProductIdentity: true,
    exactVariantIdentity: true, exactSupplierSku: true,
    structuredVariantAttributesComplete: true, identityConflict: false }
  return {
    decisions: source([{ decision_id: "decision-1", decision_version: 1,
      decision: "APPROVE_EXACT_LINKAGE", decision_at: NOW.toISOString(),
      ebay_item_id: ITEM_ID, ebay_sku: "IMN-5810", linkage_id: LINKAGE_ID,
      components: [component], evidence_digest: `sha256:${"c".repeat(64)}`,
      evidence_references: [] }]),
    jobs: source([{ stock_check_job_id: JOB_ID, linkage_id: LINKAGE_ID,
      ebay_item_id: ITEM_ID, observation_window_start:
        "2026-08-31T16:00:00.000Z", observation_window_end:
        "2026-08-31T17:30:00.000Z", workflow_state: "SUCCEEDED",
      attempt_count: 1,
      success_receipt_digest: `luna-stock-package-v1:sha256:${"d".repeat(64)}` }]),
    observations: source([{ observation_id:
        `luna-stock-observation-v1:sha256:${"e".repeat(64)}`,
      stock_check_job_id: JOB_ID, linkage_id: LINKAGE_ID,
      ebay_item_id: ITEM_ID, component_identity_id: componentId(),
      luna_product_id: PRODUCT_ID, luna_variant_id: VARIANT_ID,
      luna_sku: SKU, supplier_quantity_required: 1,
      observation_state: "OBSERVED_QUANTITY", source_status: "AVAILABLE",
      observed_availability: true, observed_supplier_quantity: 8,
      evidence_class: "SUPPLIER_STATED",
      evidence_digest: `luna-stock-evidence-v1:sha256:${"f".repeat(64)}`,
      acquisition_method: "CANONICAL_SERVER_READ", attempt_number: 1,
      observed_at: "2026-08-31T17:30:00.000Z",
      maximum_age_seconds: 21_600,
      limitations: ["LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK"] }]),
  }
}

function run(readers) {
  return { started_at: "2026-08-31T17:45:00.000Z", readers }
}

function stockRun() {
  return { started_at: "2026-08-31T17:45:00.000Z",
    completed_at: "2026-08-31T17:46:00.000Z", status: "completed",
    metrics: { stage: "LUNA_PRODUCTION_STOCK_POLLING_V1",
      currentLiveCount: 1, certifiedLinkageCount: 1,
      freshnessRenewal: {
        contractVersion: "SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_V1",
        schedulerIntervalSeconds: 900,
        outcomes: [{ itemId: ITEM_ID, due: false,
          reasonCode: "EVIDENCE_CURRENT" }],
      },
      refreshResults: { freshCount: 1, staleCount: 0, unknownCount: 0,
        certifiedOosCount: 0 },
    } }
}

function lkgSnapshot() {
  const capturedAt = "2026-08-31T15:00:00.000Z"
  const windowStart = "2026-08-01T00:00:00.000Z"
  const windowEnd = "2026-08-30T23:59:59.999Z"
  return { id: "snapshot-1", listing_id: ITEM_ID, sku: null,
    listing_status: "active", impressions: 120, views: 12, ctr: 10,
    transactions: 2, sales_conversion_rate: 1, revenue: null,
    current_watchers: null, stock_available: null, supplier_cost: null,
    estimated_margin_percent: null, observed_at: capturedAt,
    window_start: windowStart, window_end: windowEnd,
    completeness_status: "complete", source: {
      analyticsLkgContractVersion: "ANALYTICS_LAST_KNOWN_GOOD_FALLBACK_V1",
      liveReadOnlyProjection: true,
      analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      syntheticFallbackUsed: false, fixtureEvidenceUsed: false,
      analyticsSnapshotId: "analytics-snapshot-1", snapshotCapturedAt: capturedAt,
      currentLiveScope: { scope: "CURRENT_LIVE_PORTFOLIO", scopeCount: 1,
        itemSetDigest: analyticsLastKnownGoodItemSetDigestV1([ITEM_ID]) },
      accountTrafficLastKnownGood: { status: "AVAILABLE",
        scope: "ACCOUNT_TRAFFIC", scopeId: "account-traffic:test",
        scopeType: "ACCOUNT_TRAFFIC_SCOPE", scopeCount: 30,
        grain: "ACCOUNT_DAY_AGGREGATE",
        entityType: "ACCOUNT_TRAFFIC_DAY_BUCKET",
        source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        windowStart, windowEnd, timeZone: "UTC", observedAt: capturedAt,
        sourceUpdatedAt: capturedAt, completeness: "COMPLETE",
        impressions: 800, listingViews: 45, quantitySold: 3, ctr: 2.5,
        accountTrafficSnapshotId: "account-traffic-1", auditSpanId: "audit-1",
        metadataValidationStatus: "VALID", metadataValidationReasonCode: null,
        upstreamSnapshotAcquisitionCount: 1, cumulativeAcquisitionCount: 1,
        cacheHitCount: 0, retryCount: 0, retryPolicy: "NO_RETRY",
        snapshotReuseStatus: "ACQUIRED",
        snapshotReuseReasonCode: "CACHE_MISS_ACQUIRED", gapCodes: [] },
      calculatedCtr: 10, calculatedCtrNumerator: 12,
      calculatedCtrDenominator: 120, externalViews: 0,
      impressionsApplicable: true, totalListingViewsApplicable: true,
      externalViewsApplicable: true, transactionsApplicable: true,
      reportedCtrApplicable: true, calculatedCtrApplicable: true,
      reportedConversionApplicable: true, sourceUpdatedAt: capturedAt,
      lastUpdatedDate: "2026-08-31",
    } }
}

function currentSnapshot() {
  const row = lkgSnapshot()
  const capturedAt = "2026-08-31T17:55:00.000Z"
  return { ...row, observed_at: capturedAt, source: { ...row.source,
    snapshotCapturedAt: capturedAt,
    accountTrafficLastKnownGood: {
      ...row.source.accountTrafficLastKnownGood,
      observedAt: capturedAt,
      sourceUpdatedAt: capturedAt,
      completeness: "COMPLETE",
      impressions: 21_347,
      listingViews: 148,
      quantitySold: 2,
      ctr: 0.585,
      analyticsStatus: "CURRENT",
      currentSourceStatus: "AVAILABLE",
      snapshotDataStatus: "AVAILABLE_CURRENT",
      snapshotCapturedAt: capturedAt,
      snapshotAgeSeconds: 0,
    },
  } }
}

function postSaleStatus() {
  return {
    contractVersion: "SELLER_OS_POST_SALE_DASHBOARD_STATUS_V1",
    officialOrders: {
      contractVersion: "SELLER_OS_OFFICIAL_ORDERS_READ_V1",
      source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
      sourceStatus: "AVAILABLE",
      observedAt: "2026-08-31T17:59:00.000Z",
      sourceUpdatedAt: "2026-08-31T17:58:00.000Z",
      officialOrderCount: 2,
      officialLineItemQuantity: 2,
    },
    whatsappSaleAlert: {
      deliveryPathStatus: "READY",
      providerReadiness: { provider: "META_CLOUD_API",
        configurationStatus: "READY", preflightStatus: "PASSED",
        realDeliveryPermitted: true },
      deliveryOutcomes: { newlyDetectedSuccessfulReceiptCount: 0,
        historicalSendCount: 0, productionNewSaleSendObserved: false },
      entries: [{ detectionClass: "HISTORICAL_REPLAY",
        workflowStep: { state: "SKIPPED",
          observedAt: "2026-08-31T17:59:00.000Z" },
        durableReceipt: { status: "ABSENT", providerAcceptanceAt: null },
        limitationCodes: [
          "HISTORICAL_REPLAY_EXTERNAL_NOTIFICATION_FORBIDDEN"],
      }],
    },
    buyerThankYou: {
      capability: { provider: "EBAY_COMMERCE_MESSAGE_API", status: "READY",
        deliveryAttemptAllowed: true,
        automaticExecutionAuthority: "AUTO_EXECUTION_ALLOWED" },
      activation: { historicalOrderCount: 2, newlyDetectedOrderCount: 0 },
      message: { templateVersion: "POST_PURCHASE_THANK_YOU_TEMPLATE_V1" },
      buyerMessageSendCount: 0,
      productionNewSaleBuyerMessageObserved: false,
      entries: [{ detectionClass: "HISTORICAL_REPLAY",
        workflowStep: { state: "SKIPPED",
          observedAt: "2026-08-31T17:59:00.000Z" },
        receipt: { status: "ABSENT", succeededAt: null,
          manualReviewRequired: false },
      }],
    },
  }
}

test("canonical fresh stock and official Orders remain READY during Analytics 429", () => {
  const stock = stockSources()
  const result = deriveSellerOsDashboardCommercialHealthV1({
    registry: registry(), ...stock, snapshots: source([]),
    runs: [run({ analytics: { status: "unavailable",
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      observedAt: NOW.toISOString(), error: "EBAY_MONITOR_ACCOUNT_TRAFFIC_429" },
    orders: { status: "available", source:
      "EBAY_SELL_FULFILLMENT_GET_ORDERS", observedAt: NOW.toISOString(),
    metrics: { orders: 4 } } })], stockRuns: [stockRun()],
    accountAlias: "primary", now: NOW,
  })
  assert.deepEqual(result.stockGuard, {
    scopeCount: 1, certifiedCount: 1, freshCount: 1, staleCount: 0,
    unknownCount: 0, riskCount: 0, dashboardStatus: "READY",
    coverageComplete: true,
    cohortAuthority:
      "OFFICIAL_EBAY_CURRENT_LIVE_INTERSECT_CERTIFIED_LINKAGES",
    cohortObservedAt: "2026-08-31T17:46:00.000Z",
    cohortReceiptFresh: true,
    currentLiveItemIds: [ITEM_ID],
    currentAuthorityState: "CURRENT_FRESH",
    lastCertifiedState: "LAST_CERTIFIED_AVAILABLE",
    lastCertifiedLiveCount: 1,
    lastCertifiedAt: "2026-08-31T17:46:00.000Z",
    sourceFailureCode: null,
    nextRetryAt: null,
  })
  assert.equal(result.orders.dashboardStatus, "READY")
  assert.equal(result.orders.officialOrderCount, 4)
  assert.equal(result.orders.analyticsReconciliationAffectsHealth, false)
  assert.equal(result.analytics.dashboardStatus, "DEGRADED")
  assert.equal(result.analytics.currentSourceStatus, "UNAVAILABLE_429")
  assert.equal(result.analytics.impressions, null)
  assert.equal(result.analytics.falseZero, false)
})

test("compatible durable Analytics snapshot is selected as stale without false zero", () => {
  const stock = stockSources()
  const result = deriveSellerOsDashboardCommercialHealthV1({
    registry: registry(), ...stock, snapshots: source([lkgSnapshot()]),
    runs: [run({ analytics: { status: "unavailable",
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      observedAt: NOW.toISOString(), error: "EBAY_MONITOR_ACCOUNT_TRAFFIC_429" },
    orders: { status: "available", source:
      "EBAY_SELL_FULFILLMENT_GET_ORDERS", observedAt: NOW.toISOString(),
    metrics: { orders: 0 } } })], stockRuns: [stockRun()],
    accountAlias: "primary", now: NOW,
  })
  assert.equal(result.analytics.dashboardStatus, "DEGRADED")
  assert.equal(result.analytics.snapshotDataStatus, "AVAILABLE_STALE")
  assert.equal(result.analytics.impressions, 800)
  assert.equal(result.analytics.views, 45)
  assert.equal(result.analytics.quantitySold, 3)
  assert.equal(result.analytics.ctr, 2.5)
  assert.equal(result.orders.officialOrderCount, 0)
  assert.equal(result.analytics.falseZero, false)
  assert.equal(result.safety.analyticsRequests, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("current durable Analytics, official Orders and armed post-sale paths share one authority", () => {
  const stock = stockSources()
  const result = deriveSellerOsDashboardCommercialHealthV1({
    registry: registry(), ...stock, snapshots: source([currentSnapshot()]),
    runs: [run({ analytics: { status: "unavailable",
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      observedAt: "2026-08-31T17:45:00.000Z",
      error: "EBAY_MONITOR_ACCOUNT_TRAFFIC_429" },
    orders: { status: "available", source:
      "EBAY_SELL_FULFILLMENT_GET_ORDERS",
    observedAt: "2026-08-11T00:00:00.000Z",
    metrics: { orders: 0 } } })], stockRuns: [stockRun()],
    accountAlias: "primary", postSale: postSaleStatus(), now: NOW,
  })
  assert.equal(result.analytics.dashboardStatus, "READY")
  assert.equal(result.analytics.currentSourceStatus, "AVAILABLE")
  assert.equal(result.analytics.snapshotDataStatus, "AVAILABLE_CURRENT")
  assert.equal(result.analytics.impressions, 21_347)
  assert.equal(result.analytics.views, 148)
  assert.equal(result.analytics.quantitySold, 2)
  assert.equal(result.analytics.ctr, 0.585)
  assert.equal(result.orders.dashboardStatus, "READY")
  assert.equal(result.orders.officialOrderCount, 2)
  assert.equal(result.orders.officialLineItemQuantity, 2)
  assert.equal(result.postSale.saleDetection.status, "READY")
  assert.equal(result.postSale.whatsapp.status, "ARMED")
  assert.equal(result.postSale.whatsapp.successfulSendCount, 0)
  assert.equal(result.postSale.buyerThankYou.status, "ARMED")
  assert.equal(result.postSale.buyerThankYou.totalNewSaleMessagesSent, 0)
  assert.equal(result.postSale.historicalReplayNotShownAsFailure, true)
  assert.equal(result.postSale.historicalReplayNotSent, true)
  assert.equal(result.postSale.productionNewSaleWhatsappProof,
    "WAITING_NEXT_REAL_NEW_SALE")
  assert.equal(result.postSale.productionNewSaleBuyerMessageProof,
    "WAITING_NEXT_REAL_NEW_SALE")
})

test("historical active registry rows never expand the canonical current-live receipt", () => {
  const stock = stockSources()
  const result = deriveSellerOsDashboardCommercialHealthV1({
    registry: registry(true), ...stock, snapshots: source([]), runs: [],
    stockRuns: [stockRun()], accountAlias: "primary", now: NOW,
  })
  assert.equal(result.activeListings, 1)
  assert.equal(result.stockGuard.scopeCount, 1)
  assert.deepEqual(result.stockGuard.currentLiveItemIds, [ITEM_ID])
})
