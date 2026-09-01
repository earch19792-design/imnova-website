import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveAnalyticsLastKnownGoodV1 } from
  "./ebay-analytics-last-known-good-v1"
import type { EbayCommercialMonitorLiveReadonlyResult } from
  "./ebay-commercial-monitor-live-readonly"
import { unavailableAccountTrafficV1 } from
  "./ebay-commercial-monitor-traffic-scope-v1"
import { projectSellerOsCanonicalLunaStockReadModelV1 } from
  "./ebay-luna-canonical-stock-read-model-adapter-v1"
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
  const ordersReady = currentOrderReader?.status === "available" &&
    currentOrderReader.source === "EBAY_SELL_FULFILLMENT_GET_ORDERS"
  const officialOrderCount = ordersReady
    ? metric(currentOrderReader.metrics.orders) : null
  const orders = Object.freeze({
    sourceStatus: ordersReady ? "AVAILABLE" as const
      : currentOrderReader ? "UNAVAILABLE" as const : "UNPROVEN" as const,
    source: currentOrderReader?.source ?? null,
    lastSuccessfulReadAt: lastSuccessfulOrderReader?.observedAt ??
      lastSuccessfulOrderReader?.runStartedAt ?? null,
    officialOrderCount,
    dashboardStatus: ordersReady ? "READY" as const
      : currentOrderReader ? "DEGRADED" as const : "WAITING" as const,
    analyticsReconciliationAffectsHealth: false,
  })

  const analyticsReaders = readerHistory(input.runs, "analytics")
  const currentAnalyticsReader = analyticsReaders[0] ?? null
  const analyticsError = currentAnalyticsReader?.error ??
    "ANALYTICS_DURABLE_ATTEMPT_UNPROVEN"
  const analytics429 = analyticsError.includes("429")
  const analyticsResolution = resolveAnalyticsLastKnownGoodV1({
    analytics: unavailableAnalytics(analyticsError,
      currentLiveItemIds.length),
    storedRows: input.snapshots.rows,
    currentLiveItemIds,
    now,
  })
  const currentAnalyticsAvailable = currentAnalyticsReader?.status ===
    "available"
  const staleAvailable = !currentAnalyticsAvailable &&
    analyticsResolution.analyticsStatus === "LAST_KNOWN_GOOD" &&
    analyticsResolution.snapshotDataStatus === "AVAILABLE_STALE"
  const currentSnapshotAvailable = currentAnalyticsAvailable &&
    analyticsResolution.currentLiveSnapshotAvailable
  const metricsAvailable = currentSnapshotAvailable || staleAvailable
  const accountTraffic = analyticsResolution.analytics.accountTraffic
  const analytics = Object.freeze({
    dashboardStatus: currentAnalyticsAvailable && currentSnapshotAvailable
      ? "READY" as const : "DEGRADED" as const,
    currentSourceStatus: currentAnalyticsAvailable ? "AVAILABLE" as const
      : analytics429 ? "UNAVAILABLE_429" as const
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

  return Object.freeze({
    contractVersion: SELLER_OS_DASHBOARD_COMMERCIAL_HEALTH_VERSION,
    observedAt: now.toISOString(),
    activeListings: currentLiveItemIds.length,
    stockGuard,
    orders,
    analytics,
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
  const [registry, decisions, jobs, observations, snapshots, runRows,
    stockRunRows] =
    await Promise.all([
      readRegistry(input.supabase, input.accountKey),
      readCanonicalLunaLinkageDecisions(input.supabase, input.accountKey),
      readCanonicalLunaStockJobs(input.supabase, input.accountKey),
      readCanonicalLunaStockObservations(input.supabase, input.accountKey),
      readCommercialSnapshots(input.supabase, input.accountKey),
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
    ])
  if (runRows.error) throw new Error("DASHBOARD_READER_HISTORY_UNAVAILABLE")
  if (stockRunRows.error) {
    throw new Error("DASHBOARD_CURRENT_LIVE_RECEIPT_UNAVAILABLE")
  }
  return deriveSellerOsDashboardCommercialHealthV1({
    registry, decisions, jobs, observations, snapshots,
    runs: (runRows.data ?? []) as RunRow[],
    stockRuns: (stockRunRows.data ?? []) as StockAutomationRunRow[],
    accountAlias: input.accountAlias,
    now: input.now,
  })
}
