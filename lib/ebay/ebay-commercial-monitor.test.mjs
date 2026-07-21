import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildDailyCommercialSummary,
  containsPrivateBuyerData,
  DEFAULT_COMMERCIAL_THRESHOLDS,
  detectWatcherSignals,
  evaluateCommercialRules,
  marketplaceLineItemKey,
  mergePreviousCommercialSnapshot,
  normalizeCompletedEbayOrders,
  renderDailyCommercialSummary,
  selectExactCommercialSupply,
  stableCommercialKey,
} from "../marketplace/commercial-monitor-domain.ts"
import {
  buildCommercialMonitorRunRequest,
  formatCommercialMetricValue,
  isSatisfactoryCommercialDryRun,
} from "./commercial-monitor-ui.ts"
import {
  calculateSellerHubCtr,
  classifySellerHubComparison,
  closedEbayAnalyticsWindow,
  reconcileEbayTrafficAnalyticsReport,
} from "./ebay-commercial-analytics-domain.ts"
import { normalizeEbaySellerTrafficReport } from "./ebay-seller-traffic-report.ts"
import {
  ANALYTICS_SOURCE_DIVERGENCE,
  commercialAnalyticsDivergenceState,
  MANUAL_EVIDENCE_NOT_COMPARABLE,
  normalizeSellerHubListingEvidence,
} from "./ebay-commercial-analytics-divergence-domain.ts"
import {
  commercialAnalyticsDivergenceRecheckDue,
  commercialScheduleLaneDue,
  commercialPreviewPilotConfiguration,
  summarizeCommercialPilotRuns,
} from "./ebay-commercial-preview-pilot.ts"

const ACCOUNT_A = "seller-a:" + "a".repeat(64)
const ACCOUNT_B = "seller-b:" + "b".repeat(64)

function snapshot(overrides = {}) {
  return {
    marketplaceAccountKey: ACCOUNT_A,
    listingId: "366543596425",
    sku: "ITEM3995",
    listingStatus: "active",
    impressions: 100,
    views: 10,
    ctr: 1,
    transactions: 0,
    salesConversionRate: 0,
    revenue: null,
    currentWatchers: 0,
    stockAvailable: 8,
    supplierCost: 4,
    estimatedMarginPercent: 30,
    observedAt: "2026-07-15T12:00:00.000Z",
    windowStart: "2026-07-08",
    windowEnd: "2026-07-14",
    completenessStatus: "complete",
    ...overrides,
  }
}

function officialOrderPayload() {
  return {
    orders: [{
      orderId: "12-34567-89012",
      creationDate: "2026-07-15T10:00:00.000Z",
      lastModifiedDate: "2026-07-15T10:01:00.000Z",
      orderPaymentStatus: "PAID",
      orderFulfillmentStatus: "NOT_STARTED",
      buyer: {
        username: "private-buyer",
        email: "private@example.com",
      },
      fulfillmentStartInstructions: [{
        shippingStep: {
          shipTo: { fullName: "Private Name", addressLine1: "Private street" },
        },
      }],
      pricingSummary: { total: { value: "24.99", currency: "USD" } },
      lineItems: [{
        lineItemId: "line-1",
        legacyItemId: "366543596425",
        sku: "ITEM3995",
        title: "Lysol Disinfecting Wipes Lemon 15ct — 3 Pack",
        quantity: 1,
        lineItemCost: { value: "24.99", currency: "USD" },
        lineItemFulfillmentInstructions: { shipByDate: "2026-07-17T23:59:59.000Z" },
      }],
    }],
  }
}

test("deduplica por cuenta, Order ID y Line Item ID", () => {
  const first = marketplaceLineItemKey(ACCOUNT_A, "order-1", "line-1")
  assert.equal(first, marketplaceLineItemKey(ACCOUNT_A, "order-1", "line-1"))
  assert.notEqual(first, marketplaceLineItemKey(ACCOUNT_A, "order-1", "line-2"))
  assert.notEqual(first, marketplaceLineItemKey(ACCOUNT_B, "order-1", "line-1"))
})

test("primera venta y venta repetida producen una sola identidad estable", () => {
  const dedupe = stableCommercialKey(ACCOUNT_A, "FIRST_SALE_CONFIRMED", "366543596425")
  const emitted = new Set()
  const emit = () => emitted.has(dedupe) ? false : Boolean(emitted.add(dedupe))
  assert.equal(emit(), true)
  assert.equal(emit(), false)
  assert.equal(emitted.size, 1)
})

test("snapshots parciales no borran el último WatchCount oficial para calcular deltas", () => {
  const latestOrdersOnly = snapshot({
    observedAt: "2026-07-16T05:00:00.000Z",
    currentWatchers: null,
    completenessStatus: "unavailable",
  })
  const priorOfficialWatcher = snapshot({
    observedAt: "2026-07-16T01:58:26.820Z",
    currentWatchers: 2,
  })
  const merged = mergePreviousCommercialSnapshot(latestOrdersOnly, priorOfficialWatcher)
  assert.equal(merged.observedAt, latestOrdersOnly.observedAt)
  assert.equal(merged.currentWatchers, 2)
  assert.deepEqual(detectWatcherSignals(merged.currentWatchers, 5), [
    { kind: "milestone", threshold: 3, current: 5, previous: 2 },
    { kind: "milestone", threshold: 5, current: 5, previous: 2 },
    { kind: "increase", threshold: 3, current: 5, previous: 2 },
  ])
})

test("stock, costo y margen aceptan un vínculo exacto variant + supplier SKU sin product ID", () => {
  const supply = { price: 4.25, inventory: 8 }
  assert.equal(selectExactCommercialSupply({
    productId: null,
    variantId: "variant-3995",
    sku: "ITEM3995",
  }, [{
    productId: "luna-product-1",
    variantId: "variant-3995",
    sku: "ITEM3995",
    value: supply,
  }]), supply)
  assert.equal(selectExactCommercialSupply({
    productId: null,
    variantId: "variant-3995",
    sku: "ITEM3995",
  }, [{
    productId: "luna-product-1",
    variantId: "variant-3995",
    sku: "OTHER-SKU",
    value: supply,
  }]), null)
  assert.equal(selectExactCommercialSupply({ sku: "ITEM3995" }, [
    { sku: "ITEM3995", value: supply },
    { sku: "ITEM3995", value: { price: 5, inventory: 2 } },
  ]), null)
})

test("normaliza sólo checkout pagado y elimina PII del comprador", () => {
  const orders = normalizeCompletedEbayOrders(officialOrderPayload())
  assert.equal(orders.length, 1)
  assert.equal(orders[0].lineItems[0].listingId, "366543596425")
  assert.equal(orders[0].lineItems[0].sku, "ITEM3995")
  assert.equal(containsPrivateBuyerData(orders), false)
  assert.doesNotMatch(JSON.stringify(orders), /private-buyer|private@example|Private Name|Private street/)
  const pending = officialOrderPayload()
  pending.orders[0].orderPaymentStatus = "PENDING"
  assert.equal(normalizeCompletedEbayOrders(pending).length, 0)
})

test("UI separa dry run y actualización persistente con gate de seguridad", () => {
  assert.deepEqual(buildCommercialMonitorRunRequest(true), {
    action: "run",
    dryRun: true,
  })
  assert.deepEqual(buildCommercialMonitorRunRequest(false), {
    action: "run",
    dryRun: false,
  })
  assert.deepEqual(buildCommercialMonitorRunRequest(false, "dry-run-id"), {
    action: "run",
    dryRun: false,
    dryRunId: "dry-run-id",
  })

  const completedAt = "2026-07-15T20:30:00.000Z"
  const satisfactory = {
    status: "completed",
    completedAt,
    readers: {
      orders: { status: "available", auth: { status: "READY", scopeConfirmed: true } },
      messages: { status: "available", auth: { status: "READY" } },
      analytics: { status: "available", auth: { status: "READY" } },
      watchers: { status: "available", auth: { status: "READY" } },
      competitors: { status: "available" },
      listing_identity: {
        status: "available",
        metrics: { itemIdAndCustomLabelExact: true, supplierSkuLinked: true },
      },
      luna_supply: { status: "available" },
    },
    metrics: {
      dryRun: true,
      activeListings: 1,
      officialOrdersRead: 0,
      sellerHubMessageHeadersRead: 0,
      sellerHubMessageContentReturned: false,
      sellerHubMessageRawXmlPersisted: false,
      analyticsListingsRead: 1,
      watcherListingsRead: 1,
      listingIdentityVerified: true,
      lunaExactSupplyLinked: true,
      lunaSupplyFresh: true,
      commercialDataPersistencePerformed: false,
      persistenceWrites: 0,
      eventsCreated: 0,
      alertsEnqueued: 0,
      outboxRowsCreated: 0,
      fulfillmentTasksCreated: 0,
      whatsappMetaAccepted: 0,
      whatsappDelivered: 0,
      buyerPiiFieldsReturned: 0,
      ebayWrites: 0,
      buyerPiiReturned: false,
    },
    safety: {
      dryRun: true,
      commercialDataPersistencePerformed: false,
      alertDeliveryAttempted: false,
      ebayWriteUsed: false,
      buyerPiiReturned: false,
    },
    errors: [],
  }
  const now = Date.parse("2026-07-15T20:31:00.000Z")
  assert.equal(isSatisfactoryCommercialDryRun(null, now), false)
  assert.equal(isSatisfactoryCommercialDryRun(satisfactory, now), true)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    status: "partial",
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    readers: {
      ...satisfactory.readers,
      analytics: { status: "incomplete", auth: { status: "READY" } },
    },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    metrics: { ...satisfactory.metrics, lunaSupplyFresh: false },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    metrics: { ...satisfactory.metrics, eventsCreated: 1 },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    errors: [{ reader: "orders", code: "EBAY_FULFILLMENT_OAUTH_FAILED" }],
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    readers: {
      ...satisfactory.readers,
      orders: { status: "unavailable", auth: { status: "INVALID_SCOPE" } },
    },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    errors: [{ reader: "orders", code: "EBAY_ORDERS_READ_403" }],
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    errors: [{ reader: "watchers", code: "EBAY_COMMERCIAL_ACCOUNT_IDENTITY_MISMATCH" }],
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    completedAt: "2026-07-15T19:30:00.000Z",
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    metrics: { ...satisfactory.metrics, buyerPiiReturned: true },
    safety: { ...satisfactory.safety, buyerPiiReturned: true },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    metrics: { ...satisfactory.metrics, whatsappDelivered: 1 },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    metrics: { ...satisfactory.metrics, commercialDataPersistencePerformed: true },
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    consumedAt: "2026-07-15T20:31:00.000Z",
  }, now), false)
  assert.equal(isSatisfactoryCommercialDryRun({
    ...satisfactory,
    errors: [{
      reader: "listing_identity",
      code: "COMMERCIAL_LISTING_ITEM_ID_OR_CUSTOM_LABEL_MISMATCH",
    }],
  }, now), false)
})

test("panel expone dry run, bloquea persistencia y exige confirmación", () => {
  const panel = readFileSync("app/admin/ebay/mobile-review/commercial-monitor-panel.tsx", "utf8")
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  const route = readFileSync("app/api/admin/ebay/commercial-monitor/route.ts", "utf8")
  assert.match(panel, /Ejecutar dry run/)
  assert.match(panel, /buildCommercialMonitorRunRequest\([\s\S]*mode === "dry_run",[\s\S]*authorizedDryRunId/)
  assert.match(panel, /disabled=\{Boolean\(busyMode\) \|\| loading \|\| !dryRunSatisfactory\}/)
  assert.match(panel, /Esta acción guardará snapshots y eventos comerciales y podría entregar una alerta pendiente por WhatsApp en Preview\. ¿Continuar\?/)
  assert.match(panel, /Persistencia comercial/)
  assert.match(panel, /Dry run anterior: CONSUMIDO/)
  assert.match(panel, /Última actualización persistente/)
  assert.match(panel, /authorizedPersistentRunId/)
  assert.match(panel, /Comparar con Seller Hub/)
  assert.match(panel, /ANALYTICS_SOURCE_DIVERGENCE/)
  assert.match(panel, /Evidencia manual usada como métrica API/)
  assert.match(panel, /Alertas encoladas/)
  assert.match(panel, /WhatsApp META_ACCEPTED/)
  assert.doesNotMatch(panel, /WhatsApp (?:delivered|entregados)/i)
  assert.match(panel, /Escrituras eBay/)
  assert.match(panel, /Orders OAuth/)
  assert.match(panel, /Watchers auth/)
  assert.match(panel, /Analytics auth/)
  assert.match(panel, /Scope fulfillment confirmado/)
  assert.match(panel, /Identidad oficial/)
  assert.match(panel, /Autorizar 60 minutos/)
  assert.match(panel, /Pausar monitor/)
  assert.match(panel, /action: "authorize_scheduler" \| "revoke_scheduler"/)
  assert.doesNotMatch(panel, /buyerName|buyerEmail|shipTo|addressLine/)
  assert.match(service, /commercialDataPersistencePerformed: false,[\s\S]*persistenceWrites: 0,[\s\S]*eventsCreated: 0,[\s\S]*alertsEnqueued: 0,[\s\S]*outboxRowsCreated: 0,[\s\S]*fulfillmentTasksCreated: 0,[\s\S]*whatsappMetaAccepted: 0,[\s\S]*whatsappDelivered: 0,[\s\S]*buyerPiiFieldsReturned: 0,[\s\S]*ebayWrites: 0,[\s\S]*buyerPiiReturned: false/)
  assert.match(route, /process\.env\.VERCEL_ENV === "production"/)
  assert.match(route, /COMMERCIAL_MONITOR_PREVIEW_ONLY/)
  assert.match(route, /getEbayReadonlyRateLimitMetadata/)
  assert.match(route, /"Retry-After"/)
  assert.match(route, /status: rateLimit\?\.httpStatus/)
})

function analyticsReport({
  dimension = "366543596425",
  impressions = 18,
  views = 1,
  transactions = 0,
  ctr = 5.56,
  searchImpressions = impressions,
  searchViews = views,
  applicable = true,
  startDate = "2026-04-16T00:00:00.000Z",
  endDate = "2026-07-14T23:59:59.999Z",
  lastUpdatedDate = "2026-07-15T03:00:00.000Z",
} = {}) {
  const keys = [
    "TOTAL_IMPRESSION_TOTAL",
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
    "LISTING_VIEWS_TOTAL",
    "CLICK_THROUGH_RATE",
    "TRANSACTION",
    "SALES_CONVERSION_RATE",
  ]
  return {
    header: {
      dimensionKeys: [{ key: "LISTING_ID" }],
      metrics: keys.map((key) => ({ key })),
    },
    records: [{
      dimensionValues: [{ value: dimension, applicable: true }],
      metricValues: [impressions, searchImpressions, searchViews, views, ctr, transactions, 0]
        .map((value) => ({ value, applicable })),
    }],
    startDate,
    endDate,
    lastUpdatedDate,
    warnings: [],
  }
}

function reconciled(report, dateFrom = "2026-04-16", dateTo = "2026-07-14") {
  return reconcileEbayTrafficAnalyticsReport({
    listingIds: ["366543596425"],
    dateFrom,
    dateTo,
  }, normalizeEbaySellerTrafficReport(report))
}

test("Analytics empareja exactamente Item ID y conserva cero oficial", () => {
  const result = reconciled(analyticsReport())
  assert.equal(result.queryDimension, "LISTING")
  assert.deepEqual(result.requestedListingIds, ["366543596425"])
  assert.deepEqual(result.returnedListingDimensions, ["366543596425"])
  assert.deepEqual(result.matchedListingIds, ["366543596425"])
  assert.deepEqual(result.unmatchedRequestedListingIds, [])
  assert.deepEqual(result.unexpectedDimensions, [])
  assert.equal(result.observations[0].transactions, 0)
  assert.equal(formatCommercialMetricValue(result.observations[0].transactions), "0")
})

test("Analytics no transforma null, inapplicable o dimensión inesperada en cero", () => {
  assert.equal(formatCommercialMetricValue(null), "—")
  assert.equal(formatCommercialMetricValue(undefined), "—")
  const inapplicable = reconciled(analyticsReport({ applicable: false }))
  assert.equal(inapplicable.observations[0].impressions, null)
  const unexpected = reconciled(analyticsReport({ dimension: "999999999999" }))
  assert.deepEqual(unexpected.matchedListingIds, [])
  assert.deepEqual(unexpected.unmatchedRequestedListingIds, ["366543596425"])
  assert.deepEqual(unexpected.unexpectedDimensions, ["999999999999"])
  assert.equal(unexpected.observations.length, 0)
  assert.equal(unexpected.completenessStatus, "incomplete")
})

test("ventanas oficiales son 7 y 90 días cerrados terminando ayer UTC", () => {
  const now = new Date("2026-07-15T20:00:00.000Z")
  assert.deepEqual(closedEbayAnalyticsWindow(now, 7), {
    dateFrom: "2026-07-08", dateTo: "2026-07-14", days: 7,
  })
  assert.deepEqual(closedEbayAnalyticsWindow(now, 90), {
    dateFrom: "2026-04-16", dateTo: "2026-07-14", days: 90,
  })
})

test("CTR Seller Hub 1/18 es 5.56% y diagnostica MATCH_DIFFERENT_WINDOW", () => {
  assert.equal(calculateSellerHubCtr(1, 18), 5.56)
  const operational = reconciled(
    analyticsReport({ impressions: 0, views: 0, ctr: 0 }),
    "2026-07-08",
    "2026-07-14",
  )
  const comparison = reconciled(analyticsReport())
  assert.equal(classifySellerHubComparison({
    listingId: "366543596425",
    evidence: { impressions: 18, views: 1, transactions: 0, ctr: 5.6, scope: "LISTING" },
    operational,
    comparison,
  }), "MATCH_DIFFERENT_WINDOW")
})

test("Analytics normaliza CTR a porcentaje desde sus componentes oficiales", () => {
  const result = reconciled(analyticsReport({
    impressions: 200,
    views: 4,
    searchImpressions: 100,
    searchViews: 1,
    ctr: 0.01,
  }))
  assert.equal(result.observations[0].ctr, 1)
})

test("diagnóstico cuenta/día no se mezcla con el listing", () => {
  const operational = reconciled(
    analyticsReport({ impressions: 0, views: 0, ctr: 0 }),
    "2026-07-08",
    "2026-07-14",
  )
  const comparison = reconciled(
    analyticsReport({ impressions: 0, views: 0, ctr: 0 }),
  )
  assert.equal(classifySellerHubComparison({
    listingId: "366543596425",
    evidence: { impressions: 18, views: 1, transactions: 0, ctr: 5.6, scope: "LISTING" },
    operational,
    comparison,
    accountDiagnostic: {
      completenessStatus: "complete",
      dataFreshnessStatus: "CURRENT",
      metrics: [{ impressions: 18, views: 1, transactions: 0, ctr: 5.56 }],
    },
  }), "SELLER_HUB_ACCOUNT_LEVEL_NOT_LISTING_LEVEL")
})

test("clasifica discrepancia Seller Hub listing contra Traffic API oficial", () => {
  const operational = reconciled(
    analyticsReport({ impressions: 0, views: 0, ctr: 0 }),
    "2026-07-08",
    "2026-07-14",
  )
  const comparison = reconciled(
    analyticsReport({ impressions: 0, views: 0, ctr: 0 }),
  )
  assert.equal(classifySellerHubComparison({
    listingId: "366543596425",
    evidence: { impressions: 18, views: 1, transactions: 0, ctr: 5.6, scope: "LISTING" },
    operational,
    comparison,
  }), "SELLER_HUB_LISTING_API_DISCREPANCY")
})

test("evidencia orgánica sin ventana no suspende Analytics total oficial", () => {
  const manual = normalizeSellerHubListingEvidence({
    listingId: "366543596425",
    sku: "ITEM3995",
    observedOn: "2026-07-14",
    impressions: 18,
    views: 1,
    transactions: 0,
    ctr: 5.6,
  })
  assert.equal(manual.source, "SELLER_HUB_MANUAL_LISTING_OBSERVATION")
  const state = commercialAnalyticsDivergenceState({
    manual,
    official: { impressions: 0, views: 0, transactions: 0, ctr: 0 },
    officialComparable: true,
    manualContext: manual,
    officialContext: {
      entityScope: "LISTING",
      impressionsMetric: "TOTAL_IMPRESSION_TOTAL",
      viewsMetric: "LISTING_VIEWS_TOTAL",
      transactionsMetric: "TRANSACTION",
      ctrMetric: "CLICK_THROUGH_RATE",
      ctrUnit: "PERCENT",
      windowStart: "2026-04-16",
      windowEnd: "2026-07-14",
      timeZone: "UTC",
    },
  })
  assert.equal(state.status, "resolved")
  assert.equal(state.classification, MANUAL_EVIDENCE_NOT_COMPARABLE)
  assert.equal(state.healthFlag, null)
  assert.equal(state.analyticsRulesSuspended, false)
  assert.deepEqual(state.comparison.reasonCodes, [
    "METRIC_MAPPING_MISMATCH",
    "WINDOW_MISSING",
    "TIME_ZONE_MISSING",
  ])
})

test("sólo una comparación de igual alcance puede abrir divergencia", () => {
  const context = {
    entityScope: "LISTING",
    impressionsMetric: "TOTAL_IMPRESSION_TOTAL",
    viewsMetric: "LISTING_VIEWS_TOTAL",
    transactionsMetric: "TRANSACTION",
    ctrMetric: "CLICK_THROUGH_RATE",
    ctrUnit: "PERCENT",
    windowStart: "2026-04-16",
    windowEnd: "2026-07-14",
    timeZone: "UTC",
  }
  const manual = { impressions: 18, views: 1, transactions: 0, ctr: 5.56 }
  const open = commercialAnalyticsDivergenceState({
    manual,
    official: { impressions: 0, views: 0, transactions: 0, ctr: 0 },
    officialComparable: true,
    manualContext: context,
    officialContext: context,
  })
  assert.equal(open.status, "open")
  assert.equal(open.healthFlag, ANALYTICS_SOURCE_DIVERGENCE)
  assert.equal(open.analyticsRulesSuspended, true)
  assert.equal(commercialAnalyticsDivergenceState({
    manual,
    official: { impressions: 18, views: 1, transactions: 0, ctr: 5.56 },
    officialComparable: true,
    manualContext: context,
    officialContext: context,
  }).status, "resolved")
  assert.equal(commercialAnalyticsDivergenceState({
    manual,
    official: { impressions: 0, views: 0, transactions: 0, ctr: 0 },
    officialComparable: true,
    manualContext: context,
    officialContext: context,
    verifiedExplanation: "eBay support case with reproducible report scope",
  }).classification, "VERIFIED_EXPLANATION")
})

test("migración resuelve sólo divergencias manuales no comparables", () => {
  const migration = readFileSync(
    "supabase/migrations/20260720080000_reconcile_noncomparable_seller_hub_analytics.sql",
    "utf8",
  )
  assert.match(migration, /MANUAL_EVIDENCE_NOT_COMPARABLE/)
  assert.match(migration, /manual\.impressions_metric <> 'TOTAL_IMPRESSION_TOTAL'/)
  assert.match(migration, /manual\.window_start is null/)
  assert.match(migration, /status = 'resolved'/)
  assert.doesNotMatch(migration, /delete\s+from/i)
})

test("comparación diagnóstica está aislada de persistencia y entregas", () => {
  const reconciliation = readFileSync("lib/ebay/ebay-commercial-analytics-reconciliation.ts", "utf8")
  const route = readFileSync("app/api/admin/ebay/commercial-monitor/route.ts", "utf8")
  assert.match(route, /input\.action === "compare_seller_hub"/)
  assert.match(reconciliation, /persistencePerformed: false/)
  assert.match(reconciliation, /commercialRulesEvaluated: false/)
  assert.match(reconciliation, /getAccountDailyDiagnostic/)
  assert.match(reconciliation, /alertsGenerated: 0/)
  assert.match(reconciliation, /whatsappDelivered: 0/)
  assert.match(reconciliation, /ebayWrites: 0/)
  assert.doesNotMatch(reconciliation, /buyerName|buyerEmail|shipTo|addressLine|refreshToken|accessToken/)
})

test("gate persistente consume un dry run una sola vez con lock transaccional", () => {
  const migration = readFileSync(
    "supabase/migrations/20260715143000_add_commercial_monitor_dry_run_gate.sql",
    "utf8",
  )
  assert.match(migration, /dry_run_satisfactory/)
  assert.match(migration, /dry_run_consumed_at/)
  assert.match(migration, /authorized_persistent_run_id/)
  assert.match(migration, /commercial_monitor_runs_one_use_dry_run_uidx/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /for update/)
  assert.doesNotMatch(migration, /drop\s+(table|column|constraint)|delete\s+from|truncate/i)
})

test("scheduler y dispatcher exigen autorización durable nacida de dry run estricto", () => {
  const migration = readFileSync(
    "supabase/migrations/20260718046000_gate_commercial_monitor_scheduler.sql",
    "utf8",
  )
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  const monitorCron = readFileSync("app/api/cron/ebay-commercial-monitor/route.ts", "utf8")
  const dispatcherCron = readFileSync("app/api/cron/commercial-alert-dispatcher/route.ts", "utf8")
  assert.match(migration, /commercial_monitor_scheduler_authorizations/)
  assert.match(migration, /authorized_by uuid not null/)
  assert.match(migration, /status <> 'completed'/)
  assert.doesNotMatch(migration, /status not in \('completed', 'partial'\)/)
  assert.match(migration, /lunaExactSupplyLinked'[\s\S]*is distinct from 'true'/)
  assert.match(migration, /lunaSupplyFresh'[\s\S]*is distinct from 'true'/)
  assert.equal((migration.match(/completed_at > v_now \+ interval '1 minute'/g) ?? []).length, 2)
  assert.equal((migration.match(/metrics -> 'dryRun' is distinct from 'true'/g) ?? []).length, 2)
  assert.equal((migration.match(/listingIdentityVerified' is distinct from 'true'/g) ?? []).length, 2)
  assert.equal((migration.match(/itemIdAndCustomLabelExact/g) ?? []).length, 2)
  assert.equal((migration.match(/supplierSkuLinked/g) ?? []).length, 2)
  assert.match(migration, /\{messages,status\}/)
  assert.equal((migration.match(/\{messages,auth,status\}/g) ?? []).length, 2)
  assert.equal((migration.match(/jsonb_typeof\(v_dry_run\.readers -> 'messages'\)/g) ?? []).length, 2)
  assert.equal((migration.match(/rawOAuthDescriptionExposed/g) ?? []).length, 8)
  assert.equal((migration.match(/officialOrdersRead/g) ?? []).length, 4)
  assert.equal((migration.match(/analyticsListingsRead/g) ?? []).length, 4)
  assert.equal((migration.match(/watcherListingsRead/g) ?? []).length, 4)
  assert.equal((migration.match(/sellerHubMessageHeadersRead/g) ?? []).length, 4)
  assert.match(migration, /sellerHubMessageContentReturned/)
  assert.match(migration, /sellerHubMessageRawXmlPersisted/)
  assert.equal((migration.match(/commercialDataPersistencePerformed/g) ?? []).length, 2)
  assert.equal((migration.match(/alertsEnqueued/g) ?? []).length, 2)
  assert.equal((migration.match(/whatsappDelivered/g) ?? []).length, 2)
  assert.equal((migration.match(/buyerPiiReturned/g) ?? []).length, 2)
  assert.equal((migration.match(/jsonb_typeof\(v_dry_run\.readers\)/g) ?? []).length, 2)
  assert.equal((migration.match(/jsonb_typeof\(v_dry_run\.metrics\)/g) ?? []).length, 2)
  assert.match(migration, /require_active_commercial_monitor_scheduler_authorization/)
  assert.match(migration, /start_authorized_commercial_monitor_scheduled_run/)
  assert.match(migration, /expires_at > v_now/)
  assert.match(migration, /force row level security/)
  assert.doesNotMatch(migration, /drop\s+(table|column|constraint)|delete\s+from|truncate/i)
  assert.match(service, /input\.triggerSource === "schedule"[\s\S]*start_authorized_commercial_monitor_scheduled_run/)
  assert.match(monitorCron, /COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED/)
  assert.match(dispatcherCron, /require_active_commercial_monitor_scheduler_authorization/)
  assert.match(dispatcherCron, /whatsappAttempted: false/)
})

test("workflow Preview soporta bypass de Vercel sin hacerlo obligatorio", () => {
  const workflow = readFileSync(".github/workflows/ebay-commercial-preview-monitor.yml", "utf8")
  assert.match(workflow, /EBAY_COMMERCIAL_VERCEL_BYPASS_SECRET/)
  assert.match(workflow, /x-vercel-protection-bypass/)
  assert.match(workflow, /if \[ -n "\$VERCEL_BYPASS_SECRET" \]/)
})

test("Salud y Configuración monta el monitor y reporta aceptación Meta honestamente", () => {
  const healthPage = readFileSync("app/admin/ebay-seller-os/page.tsx", "utf8")
  const panel = readFileSync("app/admin/ebay/mobile-review/commercial-monitor-panel.tsx", "utf8")
  const dispatcher = readFileSync("lib/marketplace/commercial-alert-dispatcher.ts", "utf8")
  assert.match(healthPage, /CommercialMonitorPanel/)
  assert.match(healthPage, /<CommercialMonitorPanel \/>/)
  assert.match(panel, /WhatsApp META_ACCEPTED/)
  assert.match(panel, /entrega final requiere webhook/)
  assert.match(panel, /Requiere dry run satisfactorio y autorización durable/)
  assert.match(dispatcher, /metaAccepted/)
  assert.match(dispatcher, /Delivery remains zero until a provider webhook is verified/)
})

test("WhatsApp conserva la acción y limita el cuerpo hidratado aceptado por Meta", () => {
  const dispatcher = readFileSync("lib/marketplace/commercial-alert-dispatcher.ts", "utf8")
  const gateway = readFileSync("lib/ebay/ebay-seller-whatsapp-gateway.ts", "utf8")
  assert.match(dispatcher, /META_132005/)
  assert.match(dispatcher, /summary: 220/)
  assert.match(dispatcher, /action: 300/)
  assert.match(dispatcher, /row\.payload\.whatsappAction \?\? row\.payload\.action/)
  assert.match(gateway, /APPROVED_TEMPLATE_TEXT_BUDGET/)
  assert.match(gateway, /summary: 220/)
  assert.match(gateway, /action: 300/)
})

test("hitos de watchers son señales de interés y no ventas", () => {
  assert.deepEqual(detectWatcherSignals(0, 1).map((signal) => [signal.kind, signal.threshold]), [["first", 1]])
  assert.deepEqual(detectWatcherSignals(2, 3).map((signal) => [signal.kind, signal.threshold]), [["milestone", 3]])
  assert.deepEqual(detectWatcherSignals(4, 5).map((signal) => [signal.kind, signal.threshold]), [["milestone", 5]])
  assert.deepEqual(detectWatcherSignals(9, 10).map((signal) => [signal.kind, signal.threshold]), [["milestone", 10]])
  assert.ok(detectWatcherSignals(2, 6).some((signal) => signal.kind === "increase"))
  const events = evaluateCommercialRules({
    current: snapshot({ currentWatchers: 3 }),
    previous: snapshot({ currentWatchers: 0 }),
  }).filter((event) => event.eventType.startsWith("WATCHER_"))
  assert.ok(events.length >= 2)
  assert.ok(events.every((event) => event.evidence.classification === "INTEREST_SIGNAL_NOT_SALE"))
})

test("detecta buen tráfico con CTR bajo", () => {
  const events = evaluateCommercialRules({ current: snapshot() })
  assert.ok(events.some((event) => event.eventType === "GOOD_TRAFFIC_LOW_CTR"))
})

test("divergencia suspende sólo reglas Analytics y mantiene las demás señales", () => {
  const events = evaluateCommercialRules({
    current: snapshot({ currentWatchers: 3, stockAvailable: 3 }),
    previous: snapshot({ currentWatchers: 0, stockAvailable: 8 }),
    unitsSold24h: 2,
    analyticsRulesSuspended: true,
  })
  assert.equal(events.some((event) => [
    "GOOD_TRAFFIC_LOW_CTR", "GOOD_CTR_LOW_CONVERSION",
  ].includes(event.eventType)), false)
  assert.ok(events.some((event) => event.eventType === "ACCELERATED_SALES"))
  assert.ok(events.some((event) => event.eventType === "LOW_STOCK"))
  assert.ok(events.some((event) => event.eventType.startsWith("WATCHER_")))
})

test("detecta buen CTR y conversión baja", () => {
  const events = evaluateCommercialRules({
    current: snapshot({ impressions: 400, views: 30, ctr: 2.5, transactions: 0 }),
  })
  assert.ok(events.some((event) => event.eventType === "GOOD_CTR_LOW_CONVERSION"))
})

test("detecta stock bajo y listing activo sin stock", () => {
  const low = evaluateCommercialRules({ current: snapshot({ stockAvailable: 3 }) })
  const empty = evaluateCommercialRules({ current: snapshot({ stockAvailable: 0 }) })
  assert.ok(low.some((event) => event.eventType === "LOW_STOCK"))
  assert.ok(empty.some((event) => event.eventType === "ACTIVE_LISTING_OUT_OF_STOCK" && event.severity === "critical"))
})

test("detecta margen en riesgo y nivel crítico", () => {
  const risk = evaluateCommercialRules({ current: snapshot({ estimatedMarginPercent: 19.99 }) })
  const critical = evaluateCommercialRules({ current: snapshot({ estimatedMarginPercent: 9.99 }) })
  assert.ok(risk.some((event) => event.eventType === "MARGIN_RISK" && event.severity === "high"))
  assert.ok(critical.some((event) => event.eventType === "MARGIN_RISK" && event.severity === "critical"))
})

test("ventanas incompletas no disparan reglas de Analytics", () => {
  const events = evaluateCommercialRules({
    current: snapshot({ completenessStatus: "incomplete", impressions: 1000, views: 100, ctr: 0.2 }),
  })
  assert.equal(events.some((event) => ["GOOD_TRAFFIC_LOW_CTR", "GOOD_CTR_LOW_CONVERSION"].includes(event.eventType)), false)
})

test("detecta ventas aceleradas sólo con unidades confirmadas", () => {
  const events = evaluateCommercialRules({ current: snapshot(), unitsSold24h: 2 })
  const accelerated = events.find((event) => event.eventType === "ACCELERATED_SALES")
  assert.equal(accelerated?.evidence.source, "OFFICIAL_COMPLETED_CHECKOUT_ORDERS")
})

test("resumen diario compara únicamente dos ventanas completas", () => {
  const summary = buildDailyCommercialSummary({
    snapshots: [snapshot(), snapshot({ listingId: "366543596426", impressions: 200, views: 20 })],
    confirmedSales: 2,
    revenue: 49.98,
    estimatedProfit: 12.5,
    pendingPurchaseOrders: 1,
    awaitingTrackingOrders: 1,
    previousDayComplete: true,
  })
  assert.equal(summary.activeListings, 2)
  assert.equal(summary.impressions, 300)
  assert.equal(summary.sales, 2)
  assert.equal(summary.comparableToPreviousDay, true)
  const incomplete = buildDailyCommercialSummary({
    snapshots: [snapshot({ completenessStatus: "incomplete" })],
    confirmedSales: 0,
    revenue: 0,
    estimatedProfit: 0,
    pendingPurchaseOrders: 0,
    awaitingTrackingOrders: 0,
    previousDayComplete: true,
  })
  assert.equal(incomplete.comparableToPreviousDay, false)
  assert.equal(incomplete.impressions, null)
  assert.match(renderDailyCommercialSummary(incomplete), /Impresiones: N\/D/)
})

test("aislamiento por cuenta forma dedupe keys diferentes", () => {
  assert.notEqual(
    stableCommercialKey(ACCOUNT_A, "SALE_DETECTED", "order-1", "line-1"),
    stableCommercialKey(ACCOUNT_B, "SALE_DETECTED", "order-1", "line-1"),
  )
})

test("migración implementa idempotencia, leases, reintentos y dead letter", () => {
  const migration = readFileSync("supabase/migrations/20260715120000_create_marketplace_commercial_monitor_v1.sql", "utf8")
  assert.match(migration, /marketplace_account_key, marketplace, marketplace_order_id,[\s\S]*marketplace_line_item_id/)
  assert.match(migration, /commercial_monitor_runs_one_active_uidx/)
  assert.match(migration, /pg_try_advisory_xact_lock/)
  assert.match(migration, /for update skip locked/)
  assert.match(migration, /power\(2, greatest\(0, attempts - 1\)\)/)
  assert.match(migration, /dead_letter/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on table/)
})

test("piloto comercial sólo se activa en Preview durante una ventana máxima de 24 horas", () => {
  const startedAt = "2026-07-16T06:00:00.000Z"
  const expiresAt = "2026-07-17T06:00:00.000Z"
  const environment = {
    vercelEnvironment: "preview",
    previewMonitorEnabled: "true",
    monitorEnabled: "true",
    startedAt,
    expiresAt,
  }
  assert.equal(commercialPreviewPilotConfiguration(
    environment,
    new Date("2026-07-16T12:00:00.000Z"),
  ).enabled, true)
  assert.equal(commercialPreviewPilotConfiguration(
    { ...environment, vercelEnvironment: "production" },
    new Date("2026-07-16T12:00:00.000Z"),
  ).status, "production_blocked")
  assert.equal(commercialPreviewPilotConfiguration(
    environment,
    new Date(expiresAt),
  ).status, "expired")
  assert.equal(commercialPreviewPilotConfiguration(
    { ...environment, expiresAt: "2026-07-17T06:00:00.001Z" },
    new Date("2026-07-16T12:00:00.000Z"),
  ).status, "misconfigured")
  assert.equal(commercialPreviewPilotConfiguration(
    { ...environment, previewMonitorEnabled: "false" },
    new Date("2026-07-16T12:00:00.000Z"),
  ).status, "disabled")
})

test("reporte de piloto acumula runs, deduplicación y entregas sin escrituras eBay", () => {
  const report = summarizeCommercialPilotRuns({
    runs: [
      { status: "completed", metrics: { officialOrdersRead: 2, newSales: 1, fulfillmentTasksCreated: 1, alertsGenerated: 1, duplicatesAvoided: 0 } },
      { status: "partial", metrics: { officialOrdersRead: 2, newSales: 0, fulfillmentTasksCreated: 0, alertsGenerated: 0, duplicatesAvoided: 1 } },
      { status: "failed", metrics: {} },
    ],
    deliveryAttempts: [
      { status: "delivered", attempt_number: 1 },
      { status: "failed", attempt_number: 2 },
    ],
    deadLetterCount: 1,
    divergenceStatus: "open",
  })
  assert.deepEqual(report, {
    totalRuns: 3,
    completedRuns: 1,
    partialRuns: 1,
    failedRuns: 1,
    ordersRead: 4,
    newSales: 1,
    fulfillmentTasksCreated: 1,
    alertsGenerated: 1,
    duplicatesAvoided: 1,
    whatsappMetaAccepted: 1,
    whatsappDelivered: 0,
    whatsappFailed: 1,
    retries: 1,
    deadLetter: 1,
    analyticsDivergenceStatus: "open",
    ebayWrites: 0,
    productionChanged: false,
  })
})

test("cron comercial exige TTL y secreto dedicado sin exponerlo", () => {
  const monitorRoute = readFileSync("app/api/cron/ebay-commercial-monitor/route.ts", "utf8")
  const dispatcherRoute = readFileSync("app/api/cron/commercial-alert-dispatcher/route.ts", "utf8")
  const pilot = readFileSync("lib/ebay/ebay-commercial-preview-pilot.ts", "utf8")
  assert.match(monitorRoute, /commercialPreviewCronAuthorized/)
  assert.match(dispatcherRoute, /commercialPreviewCronAuthorized/)
  assert.match(pilot, /EBAY_COMMERCIAL_PREVIEW_MONITOR_ENABLED/)
  assert.match(pilot, /EBAY_COMMERCIAL_PILOT_EXPIRES_AT/)
  assert.match(pilot, /PILOT_MAX_DURATION_MS = 24/)
  assert.match(pilot, /EBAY_COMMERCIAL_PILOT_CRON_SECRET/)
  assert.doesNotMatch(pilot, /console\.(log|error)/)
})

test("dispatcher expone preflight WhatsApp de solo lectura bajo el secreto dedicado", () => {
  const dispatcherRoute = readFileSync("app/api/cron/commercial-alert-dispatcher/route.ts", "utf8")
  assert.match(dispatcherRoute, /commercialPreviewCronAuthorized/)
  assert.match(dispatcherRoute, /mode\"\) === \"whatsapp-preflight\"/)
  assert.match(dispatcherRoute, /preflightSellerWhatsAppGateway\(\{ force: true \}\)/)
  assert.match(dispatcherRoute, /alertClaimed: false/)
  assert.match(dispatcherRoute, /realMessageSent: false/)
  assert.match(dispatcherRoute, /providerWriteUsed: false/)
  assert.match(dispatcherRoute, /secretsReturned: false/)
})

test("cadencia tolera jitter del cron sin convertir 5 minutos en 10", () => {
  const last = "2026-07-16T05:45:02.909Z"
  assert.equal(
    commercialScheduleLaneDue(last, 5, new Date("2026-07-16T05:50:01.477Z")),
    true,
  )
  assert.equal(
    commercialScheduleLaneDue(last, 5, new Date("2026-07-16T05:49:31.000Z")),
    false,
  )
})

test("divergencia Analytics vencida fuerza reconsulta con backoff independiente", () => {
  const now = new Date("2026-07-17T04:15:00.000Z")
  assert.equal(commercialAnalyticsDivergenceRecheckDue({
    nextCheckAt: ["2026-07-17T04:14:00.000Z"],
    lastAnalyticsAttemptAt: "2026-07-16T14:00:00.000Z",
    now,
  }), true)
  assert.equal(commercialAnalyticsDivergenceRecheckDue({
    nextCheckAt: ["2026-07-17T04:14:00.000Z"],
    lastAnalyticsAttemptAt: "2026-07-17T04:15:01.000Z",
    now: new Date("2026-07-17T04:20:00.000Z"),
  }), false)
  assert.equal(commercialAnalyticsDivergenceRecheckDue({
    nextCheckAt: ["2026-07-18T04:14:00.000Z"],
    lastAnalyticsAttemptAt: null,
    now,
  }), false)
})

test("persistencia de divergencia es separada, RLS y reconsulta diaria", () => {
  const migration = readFileSync(
    "supabase/migrations/20260715153000_add_commercial_analytics_source_divergence.sql",
    "utf8",
  )
  const service = readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8")
  const route = readFileSync("app/api/admin/ebay/commercial-monitor/route.ts", "utf8")
  assert.match(migration, /listing_commercial_manual_evidence/)
  assert.match(migration, /listing_analytics_source_divergences/)
  assert.match(migration, /marketplace_listing_identity_verifications/)
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all on table public\.%I from anon, authenticated/)
  assert.doesNotMatch(migration, /drop\s+(table|column|constraint)|delete\s+from|truncate/i)
  assert.match(service, /24 \* 60 \* 60 \* 1_000/)
  assert.match(service, /READER_HISTORY_LIMIT = 500/)
  assert.match(service, /manualEvidenceUsedAsApiMetric: false/)
  assert.match(service, /listing\.ebay_sku === line\.sku/)
  assert.match(service, /verifiedIdentities\.has/)
  assert.match(service, /\.eq\("supplier_sku", evidence\.sku\)/)
  assert.match(service, /expectedEbayCustomLabel/)
  assert.doesNotMatch(service, /const fulfillmentSku = listing\.supplier_sku \?\? line\.sku/)
  assert.match(service, /SALE_EXACT_LUNA_IDENTITY_LINK_REQUIRED/)
  assert.match(service, /supply\.supplier_variant_id !== listing\.supplier_variant_id/)
  assert.match(service, /sku: listing\.supplier_sku \?\? listing\.ebay_sku/)
  assert.match(service, /ebayCustomLabel: listing\.ebay_sku/)
  assert.match(route, /record_seller_hub_listing_evidence/)
})

test("WhatsApp permanece bloqueado fuera de Preview y Radar no ejecuta monitoreo comercial", () => {
  const dispatcher = readFileSync("lib/marketplace/commercial-alert-dispatcher.ts", "utf8")
  const opportunityCenter = readFileSync("app/admin/ebay/mobile-review/opportunity-command-center.tsx", "utf8")
  const commercialPanel = readFileSync("app/admin/ebay/mobile-review/commercial-monitor-panel.tsx", "utf8")
  assert.match(dispatcher, /process\.env\.VERCEL_ENV === "preview"/)
  assert.match(dispatcher, /productionDeliveryBlocked: true/)
  assert.doesNotMatch(opportunityCenter, /commercial-monitor|Actualizar rendimiento/)
  assert.match(commercialPanel, /separado de Radar/)
})

test("el enlace de WhatsApp abre Operación y enfoca la mejora comercial exacta", () => {
  const page = readFileSync("app/admin/ebay/mobile-review/page.tsx", "utf8")
  const commercialPanel = readFileSync(
    "app/admin/ebay/mobile-review/commercial-monitor-panel.tsx",
    "utf8",
  )
  assert.match(page, /section === "alerts" \|\| section === "commercial-monitor"/)
  assert.match(commercialPanel, /params\.get\("section"\) !== "commercial-monitor"/)
  assert.match(commercialPanel, /commercial-improvement-\$\{requestedImprovementId\}/)
  assert.match(commercialPanel, /target\.scrollIntoView/)
  assert.match(commercialPanel, /ring-2 ring-emerald-200/)
})

test("lectores y rutas comerciales no contienen APIs eBay de escritura", () => {
  const source = [
    readFileSync("lib/ebay/ebay-commercial-readers.ts", "utf8"),
    readFileSync("lib/ebay/ebay-commercial-monitor-service.ts", "utf8"),
    readFileSync("app/api/admin/ebay/commercial-monitor/route.ts", "utf8"),
  ].join("\n")
  assert.match(source, /sell\.fulfillment\.readonly/)
  assert.match(source, /IncludeWatchCount>true/)
  assert.match(source, /Item\.SellingStatus\.CurrentPrice/)
  assert.match(source, /EBAY_TRADING_GET_ITEM_CURRENT_PRICE/)
  assert.doesNotMatch(source, /publishOffer\s*\(|createOffer\s*\(|ReviseItem|EndItem|AddItem/)
  assert.deepEqual(DEFAULT_COMMERCIAL_THRESHOLDS, {
    version: "COMMERCIAL_THRESHOLDS_V1",
    trafficMinimumImpressions: 100,
    lowCtrPercent: 1.5,
    conversionMinimumViews: 30,
    acceleratedUnits24h: 2,
    lowStockMinimum: 1,
    lowStockMaximum: 3,
    marginRiskPercent: 20,
    marginCriticalPercent: 10,
  })
})
