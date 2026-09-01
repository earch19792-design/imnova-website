import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveAnalyticsLastKnownGoodV1 } from
  "./ebay-analytics-last-known-good-v1"
import type { EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import { unavailableAccountTrafficV1 } from
  "./ebay-commercial-monitor-traffic-scope-v1"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
import { loadSellerOsPostSaleDashboardSnapshotV1 } from
  "./ebay-seller-os-assistant-runtime"
import {
  readCanonicalLunaLinkageDecisions,
  readCanonicalLunaStockJobs,
  readCanonicalLunaStockObservations,
  readCommercialSnapshots,
  readRegistry,
  type ReadonlyCommercialSnapshotRow,
  type ReadonlyRegistryListingRow,
  type ReadonlySourceResult,
} from "./commercial-monitor-readonly-repository"

export const SELLER_OS_DASHBOARD_COMMERCIAL_HEALTH_VERSION =
  "SELLER_OS_DASHBOARD_COMMERCIAL_HEALTH_V1" as const
const DASHBOARD_CURRENT_ANALYTICS_MAXIMUM_AGE_SECONDS = 45 * 60

type Reader = Readonly<{
  status: string
  source: string | null
  observedAt: string | null
  error: string | null
  metrics: Record<string, unknown>
  runStartedAt: string | null
}>

type RunRow = Readonly<{
  started_at?: unknown
  readers?: unknown
}>

type StockAutomationRunRow = Readonly<{
  started_at?: unknown
  completed_at?: unknown
  status?: unknown
  metrics?: unknown
}>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function text(value: unknown, maximum = 160) {
  return typeof value === "string" && value.length > 0 &&
      value.length <= maximum ? value : null
}

function iso(value: unknown) {
  const candidate = text(value, 80)
  return candidate && Number.isFinite(Date.parse(candidate))
    ? new Date(candidate).toISOString() : null
}

function metric(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function integer(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && value.trim() === "") return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function configuredOrderPollIntervalMinutes() {
  const configured = Number(
    process.env.EBAY_COMMERCIAL_ORDERS_INTERVAL_MINUTES ?? "5")
  return Number.isSafeInteger(configured)
    ? Math.max(5, Math.min(1_440, configured)) : 5
}

function postSaleProjection(value: unknown,
  orders: Readonly<{ sourceStatus: string; lastSuccessfulReadAt: string | null;
    officialOrderCount: number | null; officialLineItemQuantity: number | null }>) {
  const source = record(value)
  const whatsapp = record(source.whatsappSaleAlert)
  const whatsappProvider = record(whatsapp.providerReadiness)
  const whatsappOutcomes = record(whatsapp.deliveryOutcomes)
  const whatsappEntries = records(whatsapp.entries)
  const buyer = record(source.buyerThankYou)
  const buyerCapability = record(buyer.capability)
  const buyerActivation = record(buyer.activation)
  const buyerMessage = record(buyer.message)
  const buyerEntries = records(buyer.entries)
  const whatsappSuccessful = integer(
    whatsappOutcomes.newlyDetectedSuccessfulReceiptCount) ?? 0
  const whatsappHistoricalSent = integer(
    whatsappOutcomes.historicalSendCount) ?? 0
  const whatsappManualReview = whatsappEntries.filter((entry) => {
    const state = text(record(entry.workflowStep).state, 40)
    return state === "TERMINAL_FAILURE" ||
      entry.limitationCodes instanceof Array && entry.limitationCodes.some(
        (code) => String(code).includes("MANUAL_REVIEW"))
  }).length
  const whatsappFailed = whatsappEntries.filter((entry) => {
    if (entry.detectionClass === "HISTORICAL_REPLAY") return false
    return ["RETRYABLE_FAILURE", "TERMINAL_FAILURE", "BLOCKED"].includes(
      text(record(entry.workflowStep).state, 40) ?? "")
  }).length
  const whatsappPathReady = whatsapp.deliveryPathStatus === "READY" &&
    whatsappProvider.provider === "META_CLOUD_API" &&
    whatsappProvider.configurationStatus === "READY" &&
    whatsappProvider.preflightStatus === "PASSED" &&
    whatsappProvider.realDeliveryPermitted === true
  const whatsappNewEntries = whatsappEntries.filter((entry) =>
    entry.detectionClass === "NEWLY_DETECTED_AFTER_I04_ACTIVATION")
  const lastWhatsappEntry = [...whatsappNewEntries].sort((left, right) => {
    const leftAt = Date.parse(iso(record(left.durableReceipt)
      .providerAcceptanceAt) ?? iso(record(left.workflowStep).observedAt) ?? "")
    const rightAt = Date.parse(iso(record(right.durableReceipt)
      .providerAcceptanceAt) ?? iso(record(right.workflowStep).observedAt) ?? "")
    return rightAt - leftAt
  })[0]
  const buyerSuccessful = buyerEntries.filter((entry) =>
    entry.detectionClass === "NEWLY_DETECTED_AFTER_ACTIVATION" &&
    record(entry.workflowStep).state === "SUCCEEDED").length
  const buyerManualReview = buyerEntries.filter((entry) =>
    record(entry.receipt).manualReviewRequired === true).length
  const buyerFailed = buyerEntries.filter((entry) => {
    if (entry.detectionClass === "HISTORICAL_REPLAY") return false
    return ["RETRYABLE_FAILURE", "TERMINAL_FAILURE", "BLOCKED"].includes(
      text(record(entry.workflowStep).state, 40) ?? "")
  }).length
  const buyerCapabilityReady = buyerCapability.provider ===
      "EBAY_COMMERCE_MESSAGE_API" && buyerCapability.status === "READY" &&
    buyerCapability.deliveryAttemptAllowed === true &&
    buyerCapability.automaticExecutionAuthority === "AUTO_EXECUTION_ALLOWED"
  const buyerNewEntries = buyerEntries.filter((entry) =>
    entry.detectionClass === "NEWLY_DETECTED_AFTER_ACTIVATION")
  const lastBuyerEntry = [...buyerNewEntries].sort((left, right) =>
    Date.parse(iso(record(right.receipt).succeededAt) ??
      iso(record(right.workflowStep).observedAt) ?? "") -
    Date.parse(iso(record(left.receipt).succeededAt) ??
      iso(record(left.workflowStep).observedAt) ?? ""))[0]
  const intervalMinutes = configuredOrderPollIntervalMinutes()
  const recentSaleTraces = whatsappNewEntries.slice(0, 5).map((entry) => {
    const eventId = text(entry.eventId, 120)
    const buyerEntry = buyerNewEntries.find((candidate) =>
      Array.isArray(candidate.eventIds) && eventId &&
      candidate.eventIds.includes(eventId))
    return Object.freeze({
      eventId,
      detectedAt: iso(record(entry.workflowStep).observedAt),
      orderDetected: true as const,
      dashboardAlert: "READY" as const,
      whatsappStatus: text(record(entry.workflowStep).state, 40)
        ?? "NOT_STARTED",
      whatsappReceiptAt: iso(record(entry.durableReceipt)
        .providerAcceptanceAt),
      buyerThankYouStatus: buyerEntry
        ? text(record(buyerEntry.workflowStep).state, 40) ?? "NOT_STARTED"
        : "NOT_STARTED",
      buyerThankYouReceiptAt: buyerEntry
        ? iso(record(buyerEntry.receipt).succeededAt) : null,
      buyerPiiIncluded: false as const,
    })
  })
  return Object.freeze({
    contractVersion: "DASHBOARD_POST_SALE_AUTOMATION_OBSERVABILITY_V1",
    authorityAvailable: source.contractVersion ===
      "SELLER_OS_POST_SALE_DASHBOARD_STATUS_V1",
    saleDetection: Object.freeze({
      status: orders.sourceStatus === "AVAILABLE" ? "READY" as const
        : orders.sourceStatus === "UNPROVEN" ? "WAITING" as const
          : "DEGRADED" as const,
      source: "EBAY_SELL_FULFILLMENT_GET_ORDERS" as const,
      lastSuccessfulReadAt: orders.lastSuccessfulReadAt,
      officialOrderCount: orders.officialOrderCount,
      officialLineItemQuantity: orders.officialLineItemQuantity,
      newSaleDetectionLatency:
        `Hasta ~${intervalMinutes} minutos más latencia de eBay`,
    }),
    whatsapp: Object.freeze({
      status: whatsappManualReview > 0 ? "MANUAL_REVIEW" as const
        : whatsappFailed > 0 ? "FAILED" as const
          : whatsappSuccessful > 0 ? "SUCCEEDED" as const
            : whatsappPathReady ? "ARMED" as const : "WAITING" as const,
      provider: "META_CLOUD_API" as const,
      configuration: whatsappProvider.configurationStatus ?? "UNPROVEN",
      deliveryPath: whatsapp.deliveryPathStatus ?? "UNPROVEN",
      realDeliveryPermitted:
        whatsappProvider.realDeliveryPermitted === true,
      lastNewSaleSendAt: lastWhatsappEntry
        ? iso(record(lastWhatsappEntry.durableReceipt)
          .providerAcceptanceAt) : null,
      lastDeliveryStatus: lastWhatsappEntry
        ? text(record(lastWhatsappEntry.workflowStep).state, 40) : null,
      successfulSendCount: whatsappSuccessful,
      manualReviewCount: whatsappManualReview,
      productionNewSaleSendObserved: whatsappSuccessful > 0,
      historicalReplaySkippedCount: whatsappEntries.filter((entry) =>
        entry.detectionClass === "HISTORICAL_REPLAY" &&
        record(entry.workflowStep).state === "SKIPPED").length,
      historicalReplaySendCount: whatsappHistoricalSent,
    }),
    buyerThankYou: Object.freeze({
      status: buyerManualReview > 0 ? "MANUAL_REVIEW" as const
        : buyerFailed > 0 ? "FAILED" as const
          : buyerSuccessful > 0 ? "SUCCEEDED" as const
            : buyerCapabilityReady ? "ARMED" as const : "WAITING" as const,
      provider: "EBAY_COMMERCE_MESSAGE_API" as const,
      capability: buyerCapability.status ?? "UNPROVEN",
      automaticExecution: buyerCapability.automaticExecutionAuthority ??
        "UNPROVEN",
      template: buyerMessage.templateVersion ??
        "POST_PURCHASE_THANK_YOU_TEMPLATE_V1",
      lastSendAt: lastBuyerEntry
        ? iso(record(lastBuyerEntry.receipt).succeededAt) : null,
      lastSendStatus: lastBuyerEntry
        ? text(record(lastBuyerEntry.workflowStep).state, 40) : null,
      totalNewSaleMessagesSent: buyerSuccessful,
      manualReviewRequired: buyerManualReview,
      productionNewSaleBuyerMessageObserved: buyerSuccessful > 0,
      historicalReplaySkippedCount: integer(
        buyerActivation.historicalOrderCount) ?? 0,
    }),
    recentSaleTraces: Object.freeze(recentSaleTraces),
    historicalReplayNotShownAsFailure: true as const,
    historicalReplayNotSent: whatsappHistoricalSent === 0 &&
      buyerEntries.every((entry) => entry.detectionClass !==
        "HISTORICAL_REPLAY" ||
        record(entry.workflowStep).state !== "SUCCEEDED"),
    productionNewSaleWhatsappProof: whatsappSuccessful > 0
      ? "OBSERVED" as const : "WAITING_NEXT_REAL_NEW_SALE" as const,
    productionNewSaleBuyerMessageProof: buyerSuccessful > 0
      ? "OBSERVED" as const : "WAITING_NEXT_REAL_NEW_SALE" as const,
  })
}

function canonicalCurrentLiveReceipt(rows: readonly StockAutomationRunRow[],
  now: Date) {
  for (const row of rows) {
    const metrics = record(row.metrics)
    const renewal = record(metrics.freshnessRenewal)
    const outcomes = Array.isArray(renewal.outcomes) ? renewal.outcomes : []
    const itemIds = [...new Set(outcomes.flatMap((outcome) => {
      const itemId = text(record(outcome).itemId, 20)
      return itemId && /^\d{9,20}$/.test(itemId) ? [itemId] : []
    }))].sort()
    const scopeCount = integer(metrics.currentLiveCount)
    const observedAt = iso(row.completed_at) ?? iso(row.started_at)
    const intervalSeconds = integer(renewal.schedulerIntervalSeconds)
    const maximumReceiptAgeSeconds = intervalSeconds === null
      ? 3_600 : Math.max(900, intervalSeconds * 3)
    const ageSeconds = observedAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(observedAt)) / 1_000))
      : null
    if (row.status !== "completed" ||
        metrics.stage !== "LUNA_PRODUCTION_STOCK_POLLING_V1" ||
        renewal.contractVersion !==
          "SELLER_OS_LUNA_STOCK_FRESHNESS_RENEWAL_V1" ||
        scopeCount === null || scopeCount === 0 ||
        itemIds.length !== scopeCount || !observedAt) continue
    return Object.freeze({
      itemIds: Object.freeze(itemIds),
      scopeCount,
      observedAt,
      ageSeconds,
      fresh: ageSeconds !== null && ageSeconds <= maximumReceiptAgeSeconds,
      authority:
        "OFFICIAL_EBAY_CURRENT_LIVE_INTERSECT_CERTIFIED_LINKAGES" as const,
    })
  }
  return null
}

function readerHistory(rows: readonly RunRow[], name: string) {
  return rows.flatMap((run) => {
    const value = record(record(run.readers)[name])
    const status = text(value.status, 40)?.toLowerCase() ?? ""
    if (!status || status === "skipped") return []
    return [{
      status,
      source: text(value.source),
      observedAt: iso(value.observedAt),
      error: text(value.error),
      metrics: record(value.metrics),
      runStartedAt: iso(run.started_at),
    } satisfies Reader]
  })
}

function unavailableAnalytics(reasonCode: string,
  requestedCount: number): EbayCommercialMonitorLiveReadonlyResult["analytics"] {
  return {
    status: "UNAVAILABLE",
    observedAt: null,
    windowStart: null,
    windowEnd: null,
    analyticsRequestedItemCount: requestedCount,
    analyticsRepresentedItemCount: null,
    analyticsMissingItemCount: null,
    analyticsCoverageStatus: "UNPROVEN",
    accountTraffic: unavailableAccountTrafficV1(reasonCode),
    observations: [],
    gapCodes: [reasonCode, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
  }
}

function stockProjection(input: {
  registry: Awaited<ReturnType<typeof readRegistry>>
  decisions: Awaited<ReturnType<typeof readCanonicalLunaLinkageDecisions>>
  jobs: Awaited<ReturnType<typeof readCanonicalLunaStockJobs>>
  observations: Awaited<ReturnType<typeof readCanonicalLunaStockObservations>>
  accountAlias: string | null
  now: Date
  stockRuns: readonly StockAutomationRunRow[]
}) {
  const receipt = canonicalCurrentLiveReceipt(input.stockRuns, input.now)
  const registryByItemId = new Map(input.registry.rows.map((row) =>
    [row.ebay_item_id, row]))
  const currentLiveItemIds = receipt?.itemIds ?? []
  const projections = currentLiveItemIds.map((itemId) => {
    const row = registryByItemId.get(itemId)
    return projectSellerOsCanonicalLunaStockReadModelV1({
      itemId,
      marketplace: { marketplaceId: "EBAY_US",
        accountAlias: input.accountAlias },
      identity: { itemId, variationKey: null,
        sku: row?.ebay_sku ?? null },
      now: input.now,
      decisions: input.decisions,
      jobs: input.jobs,
      observations: input.observations,
    })
  })
  const certifiedCount = projections.filter((projection) =>
    projection.supplierLinkageStatus === "CERTIFIED").length
  const freshCount = projections.filter((projection) =>
    projection.stock?.freshness.status === "FRESH").length
  const staleCount = projections.filter((projection) =>
    projection.stock?.freshness.status === "STALE").length
  const unknownCount = Math.max(0,
    currentLiveItemIds.length - freshCount - staleCount)
  const riskCount = projections.filter((projection) =>
    projection.stock?.state === "CERTIFIED_OOS").length
  const sourceAvailable = receipt?.fresh === true &&
    input.decisions.status === "AVAILABLE" && input.jobs.status === "AVAILABLE" &&
    input.observations.status === "AVAILABLE"
  const complete = currentLiveItemIds.length > 0 && sourceAvailable &&
    certifiedCount === currentLiveItemIds.length &&
    freshCount === currentLiveItemIds.length &&
    staleCount === 0 && unknownCount === 0
  return Object.freeze({
    scopeCount: currentLiveItemIds.length,
    certifiedCount,
    freshCount,
    staleCount,
    unknownCount,
    riskCount,
    dashboardStatus: complete ? "READY" as const
      : currentLiveItemIds.length === 0
        ? "WAITING" as const : "DEGRADED" as const,
    coverageComplete: complete,
    cohortAuthority: receipt?.authority ?? null,
    cohortObservedAt: receipt?.observedAt ?? null,
    cohortReceiptFresh: receipt?.fresh ?? false,
    currentLiveItemIds: Object.freeze([...currentLiveItemIds]),
  })
}

export function deriveSellerOsDashboardCommercialHealthV1(input: Readonly<{
  registry: ReadonlySourceResult<ReadonlyRegistryListingRow>
  decisions: Awaited<ReturnType<typeof readCanonicalLunaLinkageDecisions>>
  jobs: Awaited<ReturnType<typeof readCanonicalLunaStockJobs>>
  observations: Awaited<ReturnType<typeof readCanonicalLunaStockObservations>>
  snapshots: ReadonlySourceResult<ReadonlyCommercialSnapshotRow>
  runs: readonly RunRow[]
  stockRuns: readonly StockAutomationRunRow[]
  accountAlias: string | null
  postSale?: unknown
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const stockGuard = stockProjection({ ...input, now })
  const currentLiveItemIds = [...stockGuard.currentLiveItemIds]

  const orderReaders = readerHistory(input.runs, "orders")
  const currentOrderReader = orderReaders[0] ?? null
  const lastSuccessfulOrderReader = orderReaders.find((reader) =>
    reader.status === "available" &&
    reader.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS") ?? null
  const postSale = record(input.postSale)
  const currentOfficialOrders = record(postSale.officialOrders)
  const currentOfficialOrdersPresent = currentOfficialOrders.contractVersion ===
    "SELLER_OS_OFFICIAL_ORDERS_READ_V1"
  const currentOfficialOrdersAvailable = currentOfficialOrdersPresent &&
    currentOfficialOrders.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS" &&
    currentOfficialOrders.sourceStatus === "AVAILABLE"
  const historicalOrdersReady = currentOrderReader?.status === "available" &&
    currentOrderReader.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS"
  const ordersReady = currentOfficialOrdersPresent
    ? currentOfficialOrdersAvailable : historicalOrdersReady
  const officialOrderCount = ordersReady
    ? currentOfficialOrdersPresent
      ? metric(currentOfficialOrders.officialOrderCount)
      : metric(currentOrderReader?.metrics.orders)
    : null
  const officialLineItemQuantity = currentOfficialOrdersAvailable
    ? metric(currentOfficialOrders.officialLineItemQuantity) : null
  const currentOrdersSourceStatus = currentOfficialOrdersPresent
    ? text(currentOfficialOrders.sourceStatus, 40)
    : currentOrderReader ? currentOrderReader.status === "available"
      ? "AVAILABLE" : "UNAVAILABLE" : "UNPROVEN"
  const orders = Object.freeze({
    sourceStatus: ordersReady ? "AVAILABLE" as const
      : currentOrdersSourceStatus === "UNPROVEN" ? "UNPROVEN" as const
        : "UNAVAILABLE" as const,
    source: currentOfficialOrdersPresent
      ? text(currentOfficialOrders.source, 80)
      : currentOrderReader?.source ?? null,
    lastSuccessfulReadAt: currentOfficialOrdersAvailable
      ? iso(currentOfficialOrders.observedAt) ??
        iso(currentOfficialOrders.sourceUpdatedAt)
      : lastSuccessfulOrderReader?.observedAt ??
        lastSuccessfulOrderReader?.runStartedAt ?? null,
    officialOrderCount,
    officialLineItemQuantity,
    dashboardStatus: ordersReady ? "READY" as const
      : currentOfficialOrdersPresent || currentOrderReader
        ? "DEGRADED" as const : "WAITING" as const,
    analyticsReconciliationAffectsHealth: false,
  })

  const analyticsReaders = readerHistory(input.runs, "analytics")
  const currentAnalyticsReader = analyticsReaders[0] ?? null
  const analyticsError = currentAnalyticsReader?.error ??
    "ANALYTICS_DURABLE_ATTEMPT_UNPROVEN"
  const analyticsResolution = resolveAnalyticsLastKnownGoodV1({
    analytics: unavailableAnalytics(analyticsError,
      currentLiveItemIds.length),
    storedRows: input.snapshots.rows,
    currentLiveItemIds,
    now,
    durableCurrentMaximumAgeSeconds:
      DASHBOARD_CURRENT_ANALYTICS_MAXIMUM_AGE_SECONDS,
  })
  const currentAnalyticsAvailable = analyticsResolution.analyticsStatus ===
      "CURRENT" && analyticsResolution.currentSourceStatus === "AVAILABLE"
  const staleAvailable = !currentAnalyticsAvailable &&
    analyticsResolution.analyticsStatus === "LAST_KNOWN_GOOD" &&
    analyticsResolution.snapshotDataStatus === "AVAILABLE_STALE"
  const currentSnapshotAvailable = currentAnalyticsAvailable &&
    analyticsResolution.snapshotDataStatus === "AVAILABLE_CURRENT" &&
    analyticsResolution.currentLiveSnapshotAvailable
  const metricsAvailable = currentSnapshotAvailable || staleAvailable
  const accountTraffic = analyticsResolution.analytics.accountTraffic
  const analytics = Object.freeze({
    dashboardStatus: currentAnalyticsAvailable && currentSnapshotAvailable
      ? "READY" as const : "DEGRADED" as const,
    currentSourceStatus: analyticsResolution.currentSourceStatus ===
      "AVAILABLE" ? "AVAILABLE" as const
      : analyticsResolution.currentSourceStatus === "UNAVAILABLE_429"
        ? "UNAVAILABLE_429" as const
        : currentAnalyticsReader ? "UNAVAILABLE_OTHER" as const
          : "UNPROVEN" as const,
    snapshotDataStatus: currentSnapshotAvailable
      ? "AVAILABLE_CURRENT" as const : staleAvailable
        ? "AVAILABLE_STALE" as const : "UNAVAILABLE" as const,
    snapshotCapturedAt: metricsAvailable
      ? analyticsResolution.snapshotCapturedAt : null,
    reportingWindow: metricsAvailable ? {
      start: accountTraffic.windowStart,
      end: accountTraffic.windowEnd,
    } : null,
    impressions: metricsAvailable ? metric(accountTraffic.impressions) : null,
    views: metricsAvailable ? metric(accountTraffic.listingViews) : null,
    ctr: metricsAvailable ? metric(accountTraffic.ctr) : null,
    quantitySold: metricsAvailable ? metric(accountTraffic.quantitySold) : null,
    falseZero: false,
  })
  const projectedPostSale = postSaleProjection(input.postSale, orders)

  return Object.freeze({
    contractVersion: SELLER_OS_DASHBOARD_COMMERCIAL_HEALTH_VERSION,
    observedAt: now.toISOString(),
    activeListings: currentLiveItemIds.length,
    stockGuard,
    orders,
    analytics,
    postSale: projectedPostSale,
    safety: Object.freeze({
      upstreamEbayRequests: 0,
      analyticsRequests: 0,
      marketplaceWrites: 0,
      customerProductionTouched: false,
    }),
  })
}

export async function getSellerOsDashboardCommercialHealthV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
  accountAlias: string | null
  now?: Date
}>) {
  const now = input.now ?? new Date()
  const [registry, decisions, jobs, observations, runRows, stockRunRows,
    postSale] =
    await Promise.all([
      readRegistry(input.supabase, input.accountKey),
      readCanonicalLunaLinkageDecisions(input.supabase, input.accountKey),
      readCanonicalLunaStockJobs(input.supabase, input.accountKey),
      readCanonicalLunaStockObservations(input.supabase, input.accountKey),
      input.supabase.from("commercial_monitor_runs")
        .select("started_at,readers,status")
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", "EBAY_US")
        .order("started_at", { ascending: false })
        .limit(100),
      input.supabase.from("ebay_seller_automation_runs")
        .select("started_at,completed_at,status,metrics")
        .eq("run_kind", "risk_monitor")
        .eq("metrics->>accountKey", input.accountKey)
        .in("status", ["completed", "partial"])
        .order("started_at", { ascending: false })
        .limit(50),
      loadSellerOsPostSaleDashboardSnapshotV1().catch(() => null),
    ])
  if (runRows.error) throw new Error("DASHBOARD_READER_HISTORY_UNAVAILABLE")
  if (stockRunRows.error) {
    throw new Error("DASHBOARD_CURRENT_LIVE_RECEIPT_UNAVAILABLE")
  }
  const receipt = canonicalCurrentLiveReceipt(
    (stockRunRows.data ?? []) as StockAutomationRunRow[], now)
  const snapshots = receipt
    ? await readCommercialSnapshots(input.supabase, input.accountKey,
        receipt.itemIds)
    : {
        source: "COMMERCIAL_SNAPSHOT_REGISTRY",
        status: "ERROR" as const,
        rows: [],
        limitationCode: "CURRENT_LIVE_RECEIPT_UNAVAILABLE",
        truncated: false,
      }
  return deriveSellerOsDashboardCommercialHealthV1({
    registry, decisions, jobs, observations, snapshots,
    runs: (runRows.data ?? []) as RunRow[],
    stockRuns: (stockRunRows.data ?? []) as StockAutomationRunRow[],
    accountAlias: input.accountAlias,
    postSale,
    now,
  })
}
