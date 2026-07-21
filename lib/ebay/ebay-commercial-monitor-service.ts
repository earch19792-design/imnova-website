import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildDailyCommercialSummary,
  containsPrivateBuyerData,
  DEFAULT_COMMERCIAL_THRESHOLDS,
  evaluateCommercialRules,
  extractPackQuantity,
  mergePreviousCommercialSnapshot,
  renderDailyCommercialSummary,
  renderSaleDetectedMessage,
  stableCommercialKey,
  selectExactCommercialSupply,
  type CommercialEvent,
  type CommercialSnapshot,
  type CommercialThresholds,
  type SafeMarketplaceOrder,
  type SafeMarketplaceOrderLine,
} from "../marketplace/commercial-monitor-domain"
import {
  diagnosePostPublicationListing,
  postPublicationCooldownElapsed,
  POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES,
  resolvePostPublicationListingStart,
  type PostPublicationDiagnostic,
} from "../marketplace/post-publication-optimization-domain"
import {
  dispatchCommercialAlertOutbox,
} from "../marketplace/commercial-alert-dispatcher"
import {
  fulfillmentIdentityFingerprint,
  isAllowedLunaProductUrl,
} from "../marketplace/fulfillment-v1a-domain"
import { calculateEbayUnitEconomics } from "./ebay-unit-economics"
import {
  getComparableEbayTrafficAnalytics,
  getEbayCommercialReadersConfiguration,
  getEbayCompletedCheckoutOrders,
  getEbayListingWatchers,
  getEbaySellerInboxMessageHeaders,
  verifyEbayActiveListingIdentities,
} from "./ebay-commercial-readers"
import {
  EBAY_SELLER_MESSAGE_ALERT_SCHEMA_VERSION,
  sellerMessageAlertPayload,
  type EbaySellerMessageHeader,
} from "./ebay-seller-message-alert-domain"
import {
  ANALYTICS_SOURCE_DIVERGENCE,
  commercialAnalyticsDivergenceState,
  normalizeSellerHubListingEvidence,
  type CommercialAnalyticsMetrics,
  type CommercialAnalyticsSourceContext,
  type SellerHubListingEvidence,
} from "./ebay-commercial-analytics-divergence-domain"
import { closedEbayAnalyticsWindow } from "./ebay-commercial-analytics-domain"
import {
  getEbayCommercialReaderAuthState,
  settleEbayCommercialReaderPromises,
} from "./ebay-commercial-oauth-domain"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { isSatisfactoryCommercialDryRun } from "./commercial-monitor-ui"
import {
  commercialAnalyticsDivergenceRecheckDue,
  commercialScheduleLaneDue,
  currentCommercialPreviewPilotConfiguration,
  summarizeCommercialPilotRuns,
} from "./ebay-commercial-preview-pilot"
import {
  assertEbayLaneAvailable,
  recordPersistentEbayRateLimit,
  type EbayQuotaLane,
} from "./ebay-persistent-quota-coordinator"
import { monitorEbayListingCompetitors } from "./ebay-competitor-watch-service"

const MARKETPLACE = "EBAY_US"
const COMPETITOR_PARTIAL_RETRY_MINUTES = 15
const MONITOR_LEASE_SECONDS = 300
const READER_HISTORY_LIMIT = 500
const DEFAULT_LUNA_SUPPLY_MAX_AGE_MINUTES = 24 * 60

export const COMMERCIAL_MONITOR_LANES = [
  "orders", "messages", "analytics", "watchers", "competitors", "rules", "daily_summary", "whatsapp",
] as const

export type CommercialMonitorLane = typeof COMMERCIAL_MONITOR_LANES[number]

type ListingRow = {
  id: string
  account_key: string
  source: string
  ebay_item_id: string
  ebay_sku: string | null
  listing_status: string
  title: string
  ebay_price: number | string | null
  ebay_price_source?: string | null
  currency: string
  market_radar_product_id: string | null
  supplier_variant_id: string | null
  supplier_sku: string | null
  supplier_cost_at_linking: number | string | null
  last_ebay_sync_at: string | null
  raw_payload: Record<string, unknown> | null
  created_at: string
}

type SupplyRow = {
  product_id: string
  supplier_variant_id: string | null
  sku: string | null
  title: string | null
  variant_title: string | null
  price: number | string | null
  available: boolean | null
  inventory_quantity: number | null
  product_url: string | null
  captured_at: string | null
  barcode: string | null
  vendor: string | null
  product_type: string | null
  metadata: Record<string, unknown> | null
}

type ReaderState = {
  status: "available" | "partial" | "incomplete" | "unavailable" | "skipped"
  source: string
  observedAt: string | null
  metrics?: Record<string, unknown>
  error?: string
  auth?: ReturnType<typeof getEbayCommercialReaderAuthState>
}

type RunError = { reader: string; code: string; retryable: boolean }

type CommercialQuotaDependency = {
  apiFamily: string
  operation: string
  endpoint: string
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sumAvailableSnapshotMetric(
  snapshots: CommercialSnapshot[],
  key: "impressions" | "views" | "transactions" | "currentWatchers",
) {
  if (!snapshots.length || snapshots.some((snapshot) => snapshot[key] === null)) return null
  return snapshots.reduce((sum, snapshot) => sum + (snapshot[key] ?? 0), 0)
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback
}

function quotaPauseFrom(error: unknown) {
  if (!error || typeof error !== "object" || !("quotaPause" in error)) return null
  const pause = (error as { quotaPause?: unknown }).quotaPause
  return pause && typeof pause === "object" && !Array.isArray(pause)
    ? pause as Record<string, unknown>
    : null
}

function quotaReaderMetrics(error: unknown) {
  const pause = quotaPauseFrom(error)
  if (!pause) return undefined
  const safeText = (value: unknown) => typeof value === "string"
    ? value.replace(/[^A-Za-z0-9_./:-]/g, "").slice(0, 160)
    : null
  return {
    httpStatus: 429,
    apiFamily: safeText(pause.apiFamily),
    operation: safeText(pause.operation),
    endpoint: safeText(pause.endpoint),
    resumeAt: safeText(pause.resumeAt),
    affectedLane: safeText(pause.affectedLane),
    retriesPerformedAfter429: 0,
  }
}

async function quotaProtectedCommercialRead<T>(
  supabase: SupabaseClient,
  input: {
    dependencies: CommercialQuotaDependency[]
    lane: EbayQuotaLane
    checkpoint: Record<string, unknown>
  },
  read: () => Promise<T>,
) {
  for (const dependency of input.dependencies) {
    const state = await assertEbayLaneAvailable(
      supabase,
      dependency.apiFamily,
      dependency.operation,
    )
    if (!state.available) {
      const paused = new Error("EBAY_READONLY_GET_429")
      Object.assign(paused, {
        quotaPause: {
          ...state,
          apiFamily: dependency.apiFamily,
          operation: dependency.operation,
          endpoint: dependency.endpoint,
          affectedLane: input.lane,
          checkpoint: input.checkpoint,
        },
      })
      throw paused
    }
  }
  try {
    return await read()
  } catch (error) {
    const primary = input.dependencies.at(-1) as CommercialQuotaDependency
    const persisted = await recordPersistentEbayRateLimit(supabase, {
      error,
      apiFamily: primary.apiFamily,
      operation: primary.operation,
      endpoint: primary.endpoint,
      lane: input.lane,
      checkpoint: input.checkpoint,
      retryCount: 0,
    })
    if (persisted && error && typeof error === "object") {
      Object.assign(error, { quotaPause: persisted })
    }
    throw error
  }
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function analyticsWindow(now: Date) {
  const days = integer(process.env.EBAY_COMMERCIAL_ANALYTICS_WINDOW_DAYS, 7, 1, 30)
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { dateFrom: isoDay(start), dateTo: isoDay(end), days }
}

function normalizedLanes(input: CommercialMonitorLane[] | undefined) {
  const requested = input?.length ? input : [...COMMERCIAL_MONITOR_LANES]
  return [...new Set(requested.filter((lane) => COMMERCIAL_MONITOR_LANES.includes(lane)))]
}

function thresholdNumber(
  source: Record<string, unknown>,
  key: keyof Omit<CommercialThresholds, "version">,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = numeric(source[key])
  return value === null ? fallback : Math.max(minimum, Math.min(maximum, value))
}

export function normalizeCommercialThresholds(value: unknown): CommercialThresholds {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const version = typeof source.version === "string" && /^[A-Z0-9_.-]{3,80}$/.test(source.version)
    ? source.version
    : DEFAULT_COMMERCIAL_THRESHOLDS.version
  return {
    version,
    trafficMinimumImpressions: thresholdNumber(source, "trafficMinimumImpressions", 100, 1, 1_000_000_000),
    lowCtrPercent: thresholdNumber(source, "lowCtrPercent", 1.5, 0, 100),
    conversionMinimumViews: thresholdNumber(source, "conversionMinimumViews", 30, 1, 1_000_000_000),
    acceleratedUnits24h: thresholdNumber(source, "acceleratedUnits24h", 2, 1, 100_000),
    lowStockMinimum: thresholdNumber(source, "lowStockMinimum", 1, 0, 1_000_000),
    lowStockMaximum: thresholdNumber(source, "lowStockMaximum", 3, 0, 1_000_000),
    marginRiskPercent: thresholdNumber(source, "marginRiskPercent", 20, -1_000, 100),
    marginCriticalPercent: thresholdNumber(source, "marginCriticalPercent", 10, -1_000, 100),
  }
}

function thresholdPayload(thresholds: CommercialThresholds) {
  return {
    trafficMinimumImpressions: thresholds.trafficMinimumImpressions,
    lowCtrPercent: thresholds.lowCtrPercent,
    conversionMinimumViews: thresholds.conversionMinimumViews,
    acceleratedUnits24h: thresholds.acceleratedUnits24h,
    lowStockMinimum: thresholds.lowStockMinimum,
    lowStockMaximum: thresholds.lowStockMaximum,
    marginRiskPercent: thresholds.marginRiskPercent,
    marginCriticalPercent: thresholds.marginCriticalPercent,
  }
}

async function loadThresholds(
  supabase: SupabaseClient,
  accountKey: string,
  createDefault = true,
) {
  const { data, error } = await supabase
    .from("commercial_threshold_configs")
    .select("version,thresholds")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("active", true)
    .maybeSingle()
  if (error) throw new Error("COMMERCIAL_THRESHOLDS_READ_FAILED")
  if (data) return normalizeCommercialThresholds({
    ...(data.thresholds as Record<string, unknown>),
    version: data.version,
  })

  const defaults = DEFAULT_COMMERCIAL_THRESHOLDS
  if (!createDefault) return defaults
  const { error: insertError } = await supabase
    .from("commercial_threshold_configs")
    .insert({
      marketplace_account_key: accountKey,
      marketplace: MARKETPLACE,
      version: defaults.version,
      active: true,
      thresholds: thresholdPayload(defaults),
    })
  if (insertError && insertError.code !== "23505") {
    throw new Error("COMMERCIAL_THRESHOLDS_CREATE_FAILED")
  }
  return defaults
}

export async function updateCommercialThresholds(
  supabase: SupabaseClient,
  input: {
    marketplaceAccountKey: string
    version: string
    thresholds: unknown
    userId?: string | null
  },
) {
  const thresholds = normalizeCommercialThresholds({
    ...(input.thresholds && typeof input.thresholds === "object" ? input.thresholds : {}),
    version: input.version,
  })
  if (thresholds.version !== input.version) throw new Error("COMMERCIAL_THRESHOLDS_VERSION_INVALID")
  if (thresholds.lowStockMinimum > thresholds.lowStockMaximum) {
    throw new Error("COMMERCIAL_THRESHOLDS_STOCK_RANGE_INVALID")
  }
  if (thresholds.marginCriticalPercent > thresholds.marginRiskPercent) {
    throw new Error("COMMERCIAL_THRESHOLDS_MARGIN_RANGE_INVALID")
  }
  const now = new Date().toISOString()
  const { error: deactivateError } = await supabase
    .from("commercial_threshold_configs")
    .update({ active: false, updated_at: now })
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("active", true)
  if (deactivateError) throw new Error("COMMERCIAL_THRESHOLDS_UPDATE_FAILED")
  const { error } = await supabase
    .from("commercial_threshold_configs")
    .upsert({
      marketplace_account_key: input.marketplaceAccountKey,
      marketplace: MARKETPLACE,
      version: thresholds.version,
      active: true,
      thresholds: thresholdPayload(thresholds),
      created_by: input.userId ?? null,
      updated_at: now,
    }, { onConflict: "marketplace_account_key,marketplace,version" })
  if (error) throw new Error("COMMERCIAL_THRESHOLDS_UPDATE_FAILED")
  return thresholds
}

function listingPreference(row: ListingRow) {
  if (row.source === "EBAY_SELL_INVENTORY_READONLY") return 3
  if (row.source === "EBAY_TRADING_GET_ITEM_READONLY") return 2
  return 1
}

function canonicalListings(rows: ListingRow[]) {
  const byIdentity = new Map<string, ListingRow>()
  for (const row of rows) {
    const key = `${row.ebay_item_id}:${row.ebay_sku ?? row.supplier_sku ?? ""}`
    const current = byIdentity.get(key)
    if (!current || listingPreference(row) > listingPreference(current)) byIdentity.set(key, row)
  }
  return [...byIdentity.values()]
}

function listingAgeEvidenceStart(listing: ListingRow) {
  const raw = listing.raw_payload && typeof listing.raw_payload === "object"
    ? listing.raw_payload
    : {}
  return resolvePostPublicationListingStart({
    officialStartTimeCandidates: [
      raw.startTime,
      raw.listingStartTime,
      raw.listing_start_time,
      raw.StartTime,
    ],
    sellerOsRegisteredAt: listing.created_at,
  })
}

async function loadActiveListings(supabase: SupabaseClient, accountKey: string) {
  const { data, error } = await supabase
    .from("ebay_active_listings")
    .select("id,account_key,source,ebay_item_id,ebay_sku,listing_status,title,ebay_price,currency,market_radar_product_id,supplier_variant_id,supplier_sku,supplier_cost_at_linking,last_ebay_sync_at,raw_payload,created_at")
    .eq("account_key", accountKey)
    .eq("listing_status", "active")
    .order("updated_at", { ascending: false })
    .limit(500)
  if (error) throw new Error("COMMERCIAL_ACTIVE_LISTINGS_READ_FAILED")
  return canonicalListings((data ?? []) as ListingRow[])
}

function officialAnalyticsMetrics(value: {
  impressions?: number | null
  views?: number | null
  transactions?: number | null
  ctr?: number | null
} | null | undefined): CommercialAnalyticsMetrics | null {
  if (!value) return null
  return {
    impressions: numeric(value.impressions),
    views: numeric(value.views),
    transactions: numeric(value.transactions),
    ctr: numeric(value.ctr),
  }
}

function sellerHubAnalyticsContext(
  evidence: Pick<SellerHubListingEvidence,
    "entityScope" | "impressionsMetric" | "viewsMetric" |
    "transactionsMetric" | "ctrMetric" | "ctrUnit" | "windowStart" |
    "windowEnd" | "timeZone">,
): CommercialAnalyticsSourceContext {
  return {
    entityScope: evidence.entityScope,
    impressionsMetric: evidence.impressionsMetric,
    viewsMetric: evidence.viewsMetric,
    transactionsMetric: evidence.transactionsMetric,
    ctrMetric: evidence.ctrMetric,
    ctrUnit: evidence.ctrUnit,
    windowStart: evidence.windowStart,
    windowEnd: evidence.windowEnd,
    timeZone: evidence.timeZone,
  }
}

function persistedSellerHubAnalyticsContext(value: Record<string, unknown>) {
  return {
    entityScope: value.entity_scope === "LISTING" || value.entity_scope === "ACCOUNT"
      ? value.entity_scope
      : "UNKNOWN",
    impressionsMetric: typeof value.impressions_metric === "string"
      ? value.impressions_metric
      : null,
    viewsMetric: typeof value.views_metric === "string" ? value.views_metric : null,
    transactionsMetric: typeof value.transactions_metric === "string"
      ? value.transactions_metric
      : null,
    ctrMetric: typeof value.ctr_metric === "string" ? value.ctr_metric : null,
    ctrUnit: value.ctr_unit === "PERCENT" || value.ctr_unit === "RATIO"
      ? value.ctr_unit
      : "UNKNOWN",
    windowStart: typeof value.window_start === "string" ? value.window_start : null,
    windowEnd: typeof value.window_end === "string" ? value.window_end : null,
    timeZone: typeof value.time_zone === "string" ? value.time_zone : null,
  } satisfies CommercialAnalyticsSourceContext
}

function officialAnalyticsContext(input: {
  windowStart?: string | null
  windowEnd?: string | null
  timeZone?: string | null
}): CommercialAnalyticsSourceContext {
  return {
    entityScope: "LISTING",
    impressionsMetric: "TOTAL_IMPRESSION_TOTAL",
    viewsMetric: "LISTING_VIEWS_TOTAL",
    transactionsMetric: "TRANSACTION",
    ctrMetric: "CLICK_THROUGH_RATE",
    ctrUnit: "PERCENT",
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    timeZone: input.timeZone ?? null,
  }
}

async function persistListingIdentityVerification(
  supabase: SupabaseClient,
  accountKey: string,
  input: {
    listingId: string
    expectedSku: string
    observedListingId?: string | null
    observedSku?: string | null
    observedListingStatus?: string | null
    itemIdMatches?: boolean
    skuMatches?: boolean
    activeListingConfirmed?: boolean
    observedAt?: string
    errorCode?: string | null
  },
) {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const { error } = await supabase.from("marketplace_listing_identity_verifications").upsert({
    marketplace_account_key: accountKey,
    marketplace: MARKETPLACE,
    listing_id: input.listingId,
    expected_sku: input.expectedSku,
    observed_listing_id: input.observedListingId ?? null,
    observed_sku: input.observedSku ?? null,
    observed_listing_status: input.observedListingStatus ?? null,
    item_id_matches: input.itemIdMatches === true,
    sku_matches: input.skuMatches === true,
    active_listing_confirmed: input.activeListingConfirmed === true,
    source: "EBAY_TRADING_GET_ITEM_READONLY",
    error_code: input.errorCode ?? null,
    observed_at: observedAt,
    updated_at: observedAt,
  }, { onConflict: "marketplace_account_key,marketplace,listing_id,expected_sku" })
  if (error) throw new Error("COMMERCIAL_LISTING_IDENTITY_AUDIT_FAILED")
}

export async function recordSellerHubListingEvidence(
  supabase: SupabaseClient,
  input: {
    marketplaceAccountKey: string
    evidence: Record<string, unknown>
    userId?: string | null
  },
) {
  const evidence = normalizeSellerHubListingEvidence(input.evidence)
  const { data: activeListing, error: listingError } = await supabase
    .from("ebay_active_listings")
    .select("ebay_item_id,ebay_sku,supplier_sku,listing_status")
    .eq("account_key", input.marketplaceAccountKey)
    .eq("ebay_item_id", evidence.listingId)
    .eq("supplier_sku", evidence.sku)
    .eq("listing_status", "active")
    .limit(1)
    .maybeSingle()
  if (listingError) throw new Error("COMMERCIAL_ACTIVE_LISTING_READ_FAILED")
  if (!activeListing?.ebay_sku) {
    throw new Error("COMMERCIAL_LISTING_ITEM_ID_OR_CUSTOM_LABEL_MISMATCH")
  }

  const verification = await verifyEbayActiveListingIdentities({
    listings: [{ listingId: evidence.listingId, sku: activeListing.ebay_sku }],
  })
  const identity = verification.observations[0]
  const identityError = verification.errors[0]
  await persistListingIdentityVerification(supabase, input.marketplaceAccountKey, identity ? {
    ...identity,
  } : {
      listingId: evidence.listingId,
      expectedSku: activeListing.ebay_sku,
    errorCode: identityError?.code ?? "EBAY_LISTING_IDENTITY_UNAVAILABLE",
  })
  if (!identity?.activeListingConfirmed) {
    throw new Error("COMMERCIAL_LISTING_ITEM_ID_OR_CUSTOM_LABEL_MISMATCH")
  }

  const { data: manual, error: manualError } = await supabase
    .from("listing_commercial_manual_evidence")
    .upsert({
      marketplace_account_key: input.marketplaceAccountKey,
      marketplace: MARKETPLACE,
      listing_id: evidence.listingId,
      sku: evidence.sku,
      source: evidence.source,
      entity_scope: evidence.entityScope,
      impressions_metric: evidence.impressionsMetric,
      views_metric: evidence.viewsMetric,
      transactions_metric: evidence.transactionsMetric,
      ctr_metric: evidence.ctrMetric,
      ctr_unit: evidence.ctrUnit,
      window_start: evidence.windowStart,
      window_end: evidence.windowEnd,
      time_zone: evidence.timeZone,
      observed_on: evidence.observedOn,
      impressions: evidence.impressions,
      views: evidence.views,
      transactions: evidence.transactions,
      ctr: evidence.ctr,
      recorded_by: input.userId ?? null,
    }, {
      onConflict: "marketplace_account_key,marketplace,listing_id,sku,source,observed_on",
    })
    .select("id")
    .single()
  if (manualError || !manual?.id) throw new Error("COMMERCIAL_MANUAL_EVIDENCE_WRITE_FAILED")

  const { data: snapshot, error: snapshotError } = await supabase
    .from("listing_commercial_snapshots")
    .select("impressions,views,transactions,ctr,source,window_start,window_end,completeness_status,observed_at")
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("listing_id", evidence.listingId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (snapshotError) throw new Error("COMMERCIAL_SNAPSHOT_HISTORY_READ_FAILED")
  const official = officialAnalyticsMetrics(snapshot)
  const state = commercialAnalyticsDivergenceState({
    manual: evidence,
    official,
    officialComparable: snapshot?.completeness_status === "complete",
    manualContext: sellerHubAnalyticsContext(evidence),
    officialContext: officialAnalyticsContext({
      windowStart: snapshot?.window_start,
      windowEnd: snapshot?.window_end,
      timeZone: "UTC",
    }),
  })
  const now = new Date().toISOString()
  const nextCheckAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1_000).toISOString()
  const { data: existing, error: existingError } = await supabase
    .from("listing_analytics_source_divergences")
    .select("id")
    .eq("marketplace_account_key", input.marketplaceAccountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("listing_id", evidence.listingId)
    .eq("sku", evidence.sku)
    .eq("status", "open")
    .maybeSingle()
  if (existingError) throw new Error("COMMERCIAL_ANALYTICS_DIVERGENCE_READ_FAILED")
  const divergencePayload = {
    manual_evidence_id: manual.id,
    classification: state.classification,
    health_flag: state.healthFlag ?? "RESOLVED",
    status: state.status,
    official_source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    official_metrics: official,
    official_window_start: snapshot?.window_start ?? null,
    official_window_end: snapshot?.window_end ?? null,
    comparison_details: state.comparison,
    last_checked_at: now,
    next_check_at: nextCheckAt,
    resolved_at: state.status === "resolved" ? now : null,
    resolution_code: state.status === "resolved" ? state.classification : null,
    updated_at: now,
  }
  const divergenceWrite = existing?.id
    ? await supabase.from("listing_analytics_source_divergences")
        .update(divergencePayload).eq("id", existing.id)
    : await supabase.from("listing_analytics_source_divergences").insert({
        marketplace_account_key: input.marketplaceAccountKey,
        marketplace: MARKETPLACE,
        listing_id: evidence.listingId,
        sku: evidence.sku,
        ...divergencePayload,
      })
  if (divergenceWrite.error) throw new Error("COMMERCIAL_ANALYTICS_DIVERGENCE_WRITE_FAILED")
  return {
    classification: state.classification,
    healthFlag: state.healthFlag,
    status: state.status,
    analyticsRulesSuspended: state.analyticsRulesSuspended,
    manual: evidence,
    official: {
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      observedAt: snapshot?.observed_at ?? null,
      windowStart: snapshot?.window_start ?? null,
      windowEnd: snapshot?.window_end ?? null,
      metrics: official,
    },
    identity: {
      listingId: identity.listingId,
      expectedEbayCustomLabel: identity.expectedSku,
      observedEbayCustomLabel: identity.observedSku,
      supplierSku: evidence.sku,
      itemIdMatches: identity.itemIdMatches,
      skuMatches: identity.skuMatches,
      activeListingConfirmed: identity.activeListingConfirmed,
      observedAt: identity.observedAt,
    },
    nextCheckAt,
    manualEvidenceUsedAsApiMetric: false,
  }
}

async function loadOpenAnalyticsDivergences(
  supabase: SupabaseClient,
  accountKey: string,
) {
  const { data, error } = await supabase
    .from("listing_analytics_source_divergences")
    .select("id,listing_id,sku,manual_evidence_id,next_check_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("status", "open")
    .limit(500)
  if (error) throw new Error("COMMERCIAL_ANALYTICS_DIVERGENCE_READ_FAILED")
  return data ?? []
}

async function reconcileOpenAnalyticsDivergences(
  supabase: SupabaseClient,
  accountKey: string,
  now: Date,
) {
  const open = await loadOpenAnalyticsDivergences(supabase, accountKey)
  const openListingIds = new Set(open.map((row) => row.listing_id as string))
  const dueRows = open.filter((row) =>
    !row.next_check_at || Date.parse(row.next_check_at) <= now.getTime()
  )
  if (!dueRows.length) return {
    openListingIds,
    rechecked: 0,
    resolved: 0,
    error: null as string | null,
  }
  try {
    const evidenceIds = dueRows.map((row) => row.manual_evidence_id)
    const { data: evidenceRows, error: evidenceError } = await supabase
      .from("listing_commercial_manual_evidence")
      .select("id,listing_id,sku,entity_scope,impressions_metric,views_metric,transactions_metric,ctr_metric,ctr_unit,window_start,window_end,time_zone,impressions,views,transactions,ctr")
      .in("id", evidenceIds)
    if (evidenceError) throw new Error("COMMERCIAL_MANUAL_EVIDENCE_READ_FAILED")
    const evidenceById = new Map((evidenceRows ?? []).map((row) => [row.id, row]))
    const window = closedEbayAnalyticsWindow(now, 90)
    const official = await getComparableEbayTrafficAnalytics({
      listingIds: [...new Set(dueRows.map((row) => row.listing_id as string))],
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      timeZone: "UTC",
    })
    const officialByListing = new Map(official.observations.map((row) => [row.listingId, row]))
    let resolved = 0
    for (const divergence of dueRows) {
      const evidence = evidenceById.get(divergence.manual_evidence_id)
      const observation = officialByListing.get(divergence.listing_id)
      if (!evidence) continue
      const manual: CommercialAnalyticsMetrics = {
        impressions: numeric(evidence.impressions),
        views: numeric(evidence.views),
        transactions: numeric(evidence.transactions),
        ctr: numeric(evidence.ctr),
      }
      const api = officialAnalyticsMetrics(observation)
      const state = commercialAnalyticsDivergenceState({
        manual,
        official: api,
        officialComparable: official.completenessStatus === "complete" &&
          official.matchedListingIds.includes(divergence.listing_id),
        manualContext: persistedSellerHubAnalyticsContext(evidence),
        officialContext: officialAnalyticsContext({
          windowStart: official.windowStart,
          windowEnd: official.windowEnd,
          timeZone: official.queryTimeZone,
        }),
      })
      const checkedAt = now.toISOString()
      const nextCheckAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
      const { error } = await supabase.from("listing_analytics_source_divergences").update({
        classification: state.classification,
        health_flag: state.healthFlag ?? "RESOLVED",
        status: state.status,
        official_source: official.source,
        official_metrics: api,
        official_window_start: official.windowStart,
        official_window_end: official.windowEnd,
        official_last_updated_date: official.reportCoverage.lastUpdatedDay,
        comparison_details: state.comparison,
        last_checked_at: checkedAt,
        next_check_at: nextCheckAt,
        resolved_at: state.status === "resolved" ? checkedAt : null,
        resolution_code: state.status === "resolved" ? state.classification : null,
        updated_at: checkedAt,
      }).eq("id", divergence.id)
      if (error) throw new Error("COMMERCIAL_ANALYTICS_DIVERGENCE_WRITE_FAILED")
      if (state.status === "resolved") {
        resolved += 1
        openListingIds.delete(divergence.listing_id)
      }
    }
    return { openListingIds, rechecked: dueRows.length, resolved, error: null as string | null }
  } catch (error) {
    return {
      openListingIds,
      rechecked: 0,
      resolved: 0,
      error: safeCode(error, "COMMERCIAL_ANALYTICS_DIVERGENCE_RECHECK_FAILED"),
    }
  }
}

async function loadSupplyRows(supabase: SupabaseClient, listings: ListingRow[]) {
  const productIds = [...new Set(listings
    .map((row) => row.market_radar_product_id)
    .filter((value): value is string => Boolean(value)))]
  const variantIds = [...new Set(listings
    .map((row) => row.supplier_variant_id)
    .filter((value): value is string => Boolean(value)))]
  const supplierSkus = [...new Set(listings
    .map((row) => row.supplier_sku)
    .filter((value): value is string => Boolean(value)))]
  const rows: SupplyRow[] = []
  const selectors: Array<["product_id" | "supplier_variant_id" | "sku", string[]]> = [
    ["product_id", productIds],
    ["supplier_variant_id", variantIds],
    ["sku", supplierSkus],
  ]
  for (const [column, values] of selectors) {
    for (let index = 0; index < values.length; index += 100) {
      const { data, error } = await supabase
        .from("market_radar_latest_variants")
        .select("product_id,supplier_variant_id,sku,title,variant_title,price,available,inventory_quantity,product_url,captured_at,barcode,vendor,product_type,metadata")
        .in(column, values.slice(index, index + 100))
      if (error) throw new Error("COMMERCIAL_LUNA_SUPPLY_READ_FAILED")
      rows.push(...((data ?? []) as SupplyRow[]))
    }
  }
  return [...new Map(rows.map((row) => [
    `${row.product_id}:${row.supplier_variant_id ?? ""}:${row.sku ?? ""}`,
    row,
  ])).values()]
}

function supplyForListing(listing: ListingRow, supplies: SupplyRow[]) {
  return selectExactCommercialSupply({
    productId: listing.market_radar_product_id,
    variantId: listing.supplier_variant_id,
    sku: listing.supplier_sku,
  }, supplies.map((row) => ({
    productId: row.product_id,
    variantId: row.supplier_variant_id,
    sku: row.sku,
    value: row,
  })))
}

function isFreshLunaSupplyEvidence(supply: SupplyRow | null, observedAt: string) {
  if (!supply?.captured_at) return false
  const capturedAt = Date.parse(supply.captured_at)
  const observed = Date.parse(observedAt)
  if (!Number.isFinite(capturedAt) || !Number.isFinite(observed)) return false
  const maximumAgeMinutes = integer(
    process.env.EBAY_COMMERCIAL_LUNA_SUPPLY_MAX_AGE_MINUTES,
    DEFAULT_LUNA_SUPPLY_MAX_AGE_MINUTES,
    5,
    72 * 60,
  )
  const age = observed - capturedAt
  return age >= -60_000 && age <= maximumAgeMinutes * 60_000
}

async function loadPreviousSnapshots(
  supabase: SupabaseClient,
  accountKey: string,
  listingIds: string[],
) {
  if (!listingIds.length) return new Map<string, CommercialSnapshot>()
  const { data, error } = await supabase
    .from("listing_commercial_snapshots")
    .select("marketplace_account_key,listing_id,sku,listing_status,impressions,views,ctr,transactions,sales_conversion_rate,revenue,current_watchers,stock_available,supplier_cost,estimated_margin_percent,observed_at,window_start,window_end,completeness_status")
    .eq("marketplace_account_key", accountKey)
    .in("listing_id", listingIds)
    .order("observed_at", { ascending: false })
    .limit(2_000)
  if (error) throw new Error("COMMERCIAL_SNAPSHOT_HISTORY_READ_FAILED")
  const result = new Map<string, CommercialSnapshot>()
  for (const row of data ?? []) {
    const key = `${row.listing_id}:${row.sku ?? ""}`
    const candidate: CommercialSnapshot = {
      marketplaceAccountKey: row.marketplace_account_key,
      listingId: row.listing_id,
      sku: row.sku,
      listingStatus: row.listing_status,
      impressions: numeric(row.impressions),
      views: numeric(row.views),
      ctr: numeric(row.ctr),
      transactions: numeric(row.transactions),
      salesConversionRate: numeric(row.sales_conversion_rate),
      revenue: numeric(row.revenue),
      currentWatchers: numeric(row.current_watchers),
      stockAvailable: numeric(row.stock_available),
      supplierCost: numeric(row.supplier_cost),
      estimatedMarginPercent: numeric(row.estimated_margin_percent),
      observedAt: row.observed_at,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      completenessStatus: row.completeness_status,
    }
    result.set(key, mergePreviousCommercialSnapshot(result.get(key), candidate))
  }
  return result
}

async function latestOrderModifiedAt(supabase: SupabaseClient, accountKey: string, now: Date) {
  const { data } = await supabase
    .from("marketplace_order_snapshots")
    .select("order_modified_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .order("order_modified_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const lookbackHours = integer(process.env.EBAY_COMMERCIAL_ORDER_LOOKBACK_HOURS, 168, 1, 2_160)
  const oldest = now.getTime() - lookbackHours * 60 * 60 * 1_000
  const previous = data?.order_modified_at ? Date.parse(data.order_modified_at) - 5 * 60 * 1_000 : oldest
  return new Date(Math.max(oldest, Number.isFinite(previous) ? previous : oldest)).toISOString()
}

function verifiedListingForLine(
  listings: ListingRow[],
  line: SafeMarketplaceOrderLine,
  verifiedIdentities: Set<string>,
) {
  if (!line.sku) return null
  return listings.find((listing) =>
    listing.ebay_item_id === line.listingId &&
    listing.listing_status === "active" &&
    listing.ebay_sku === line.sku &&
    verifiedIdentities.has(`${line.listingId}:${line.sku}`)
  ) ?? null
}

async function insertEvent(supabase: SupabaseClient, accountKey: string, event: CommercialEvent & {
  marketplaceOrderId?: string | null
  marketplaceLineItemId?: string | null
}) {
  if (containsPrivateBuyerData(event.evidence)) {
    throw new Error("COMMERCIAL_EVENT_PRIVATE_BUYER_DATA_BLOCKED")
  }
  const { data, error } = await supabase
    .from("commercial_alert_events")
    .insert({
      marketplace_account_key: accountKey,
      marketplace: MARKETPLACE,
      event_type: event.eventType,
      severity: event.severity,
      evidence: event.evidence,
      threshold_config_version: event.thresholdConfigVersion,
      detected_at: event.detectedAt,
      listing_id: event.listingId,
      sku: event.sku,
      marketplace_order_id: event.marketplaceOrderId ?? null,
      marketplace_line_item_id: event.marketplaceLineItemId ?? null,
      deduplication_key: event.deduplicationKey,
      recommended_action: event.recommendedAction,
    })
    .select("id")
    .maybeSingle()
  if (error?.code === "23505") {
    const { data: existing, error: readError } = await supabase
      .from("commercial_alert_events")
      .select("id")
      .eq("deduplication_key", event.deduplicationKey)
      .maybeSingle()
    if (readError || !existing?.id) throw new Error("COMMERCIAL_EVENT_RECOVERY_READ_FAILED")
    return { id: existing.id as string, created: false }
  }
  if (error || !data?.id) throw new Error("COMMERCIAL_EVENT_CREATE_FAILED")
  return { id: data.id as string, created: true }
}

async function enqueueAlert(supabase: SupabaseClient, input: {
  accountKey: string
  eventId: string
  severity: CommercialEvent["severity"]
  deduplicationKey: string
  deliveryClass: "immediate" | "digest"
  channel?: "whatsapp" | "in_app"
  payload: Record<string, unknown>
}) {
  if (containsPrivateBuyerData(input.payload)) {
    throw new Error("COMMERCIAL_ALERT_PRIVATE_BUYER_DATA_BLOCKED")
  }
  const channel = input.channel ?? "whatsapp"
  const { error } = await supabase.from("alert_delivery_outbox").insert({
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    commercial_event_id: input.eventId,
    channel,
    delivery_class: input.deliveryClass,
    severity: input.severity,
    deduplication_key: `${channel}:${input.deduplicationKey}`,
    status: "pending",
    payload: input.payload,
    due_at: new Date().toISOString(),
  })
  if (error && error.code !== "23505") throw new Error("COMMERCIAL_ALERT_ENQUEUE_FAILED")
  return !error
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url.toString().replace(/\/$/, "") : null
  } catch {
    return null
  }
}

function sellerOrderUrl(orderId: string) {
  const base = safeHttpsUrl(process.env.EBAY_SELLER_COMMAND_CENTER_URL)
  return base ? `${base}?section=fulfillment&order=${encodeURIComponent(orderId)}` : null
}

function eventPayload(event: CommercialEvent) {
  const labels: Record<string, string> = {
    GOOD_TRAFFIC_LOW_CTR: "Tráfico eBay con CTR bajo",
    GOOD_CTR_LOW_CONVERSION: "Interés sin conversión",
    ACCELERATED_SALES: "Ventas aceleradas",
    LOW_STOCK: "Stock Luna bajo",
    ACTIVE_LISTING_OUT_OF_STOCK: "Listing activo sin stock Luna",
    MARGIN_RISK: "Margen estimado en riesgo",
    WATCHER_MILESTONE: "Hito de watchers",
    WATCHER_INCREASE: "Aumento de watchers",
    LISTING_ZERO_VISIBILITY_REVIEW: "Listing sin visibilidad suficiente",
    LISTING_IMPRESSIONS_NO_ENGAGEMENT_REVIEW: "Impresiones sin interacción",
    LISTING_ENGAGEMENT_NO_CONVERSION_REVIEW: "Interés sin conversión",
    LISTING_WATCHERS_NO_SALE_REVIEW: "Watchers sin venta confirmada",
    LISTING_SALE_MARGIN_OR_STOCK_RISK: "Venta con stock o margen en riesgo",
    LUNA_SUPPLY_RECHECK_REQUIRED: "Reconfirmar costo y stock en Luna",
  }
  return {
    title: labels[event.eventType] ?? event.eventType,
    summary: `Listing ${event.listingId} · SKU ${event.sku ?? "pendiente"}. Evidencia: ${JSON.stringify(event.evidence)}`,
    action: event.recommendedAction,
    classification: event.eventType.startsWith("WATCHER_")
      ? "INTEREST_SIGNAL_NOT_SALE"
      : "COMMERCIAL_MONITOR_EVENT",
  }
}

async function persistLunaSupplyRecheckAlert(input: {
  supabase: SupabaseClient
  accountKey: string
  listing: ListingRow
  supply: SupplyRow | null
  thresholds: CommercialThresholds
  observedAt: string
}) {
  const deduplicationKey = stableCommercialKey(
    input.accountKey,
    "LUNA_SUPPLY_RECHECK_REQUIRED",
    input.listing.ebay_item_id,
    input.listing.supplier_sku,
    input.supply?.captured_at ?? "MISSING",
  )
  const event: CommercialEvent = {
    eventType: "LUNA_SUPPLY_RECHECK_REQUIRED",
    severity: "high",
    evidence: {
      source: "LUNA_MARKET_RADAR_LATEST_VARIANT_LOCAL_SNAPSHOT",
      supplyObservedAt: input.supply?.captured_at ?? null,
      exactLunaLinkAvailable: isAllowedLunaProductUrl(input.supply?.product_url),
      staleValuesUsedAsCurrent: false,
      stockTreatedAsConfirmed: false,
      costTreatedAsConfirmed: false,
    },
    thresholdConfigVersion: input.thresholds.version,
    detectedAt: input.observedAt,
    listingId: input.listing.ebay_item_id,
    sku: input.listing.supplier_sku ?? input.listing.ebay_sku,
    deduplicationKey,
    recommendedAction: "Abrir el producto exacto en Luna y reconfirmar costo y disponibilidad antes de comprar.",
  }
  const persisted = await insertEvent(input.supabase, input.accountKey, event)
  const alertCreated = await enqueueAlert(input.supabase, {
    accountKey: input.accountKey,
    eventId: persisted.id,
    severity: event.severity,
    deduplicationKey,
    deliveryClass: "immediate",
    payload: {
      ...eventPayload(event),
      lunaProductUrl: isAllowedLunaProductUrl(input.supply?.product_url)
        ? input.supply?.product_url
        : null,
      staleStockForwardedAsCurrent: false,
      staleCostForwardedAsCurrent: false,
    },
  })
  return { eventCreated: persisted.created, alertCreated }
}

function postPublicationCommercialEvent(
  diagnostic: PostPublicationDiagnostic,
): CommercialEvent {
  return {
    eventType: diagnostic.eventType,
    severity: diagnostic.severity,
    evidence: {
      classification: diagnostic.classification,
      notificationTitle: diagnostic.notificationTitle,
      whyItNeedsAttention: diagnostic.whyItNeedsAttention,
      reviewSequence: diagnostic.reviewSequence,
      experiment: diagnostic.experiment,
      listingAgeHours: diagnostic.listingAgeHours,
      listingAgeEvidence: diagnostic.listingAgeEvidence,
      completeAnalyticsDays: diagnostic.completeAnalyticsDays,
      cooldownHours: diagnostic.cooldownHours,
      nextEligibleAt: diagnostic.nextEligibleAt,
      rulesetVersion: diagnostic.rulesetVersion,
      evidence: diagnostic.evidence,
      safety: diagnostic.safety,
      taskChannel: "IN_APP",
      whatsappEnqueued: false,
      operatorApprovalRequired: true,
      changeApplied: false,
    },
    thresholdConfigVersion: diagnostic.rulesetVersion,
    detectedAt: diagnostic.detectedAt,
    listingId: diagnostic.listingId,
    sku: diagnostic.sku,
    deduplicationKey: diagnostic.deduplicationKey,
    recommendedAction: diagnostic.recommendedAction,
  }
}

async function persistSellerInboxMessageAlerts(input: {
  supabase: SupabaseClient
  accountKey: string
  listings: ListingRow[]
  headers: EbaySellerMessageHeader[]
  observedAt: string
}) {
  let eventsCreated = 0
  let alertsGenerated = 0
  let duplicatesAvoided = 0
  for (const header of input.headers) {
    const listing = header.listingId
      ? input.listings.find((row) => row.ebay_item_id === header.listingId) ?? null
      : null
    const eventKey = stableCommercialKey(
      input.accountKey,
      "SELLER_HUB_MESSAGE_RECEIVED",
      header.messageKeyHash,
    )
    const event: CommercialEvent = {
      eventType: "SELLER_HUB_MESSAGE_RECEIVED",
      severity: header.priority === "HIGH" ? "high" : "medium",
      evidence: {
        source: "EBAY_TRADING_GET_MEMBER_MESSAGES_HEADERS_ONLY",
        messageKeyHash: header.messageKeyHash,
        messageType: header.messageType,
        messageStatus: header.messageStatus,
        messageCreatedAt: header.createdAt,
        messageLastModifiedAt: header.lastModifiedAt,
        schemaVersion: EBAY_SELLER_MESSAGE_ALERT_SCHEMA_VERSION,
        contentStored: false,
        rawXmlStored: false,
        buyerPiiStored: false,
        ebayReadOnly: true,
        ebayWrites: 0,
      },
      thresholdConfigVersion: EBAY_SELLER_MESSAGE_ALERT_SCHEMA_VERSION,
      detectedAt: header.lastModifiedAt ?? header.createdAt ?? input.observedAt,
      listingId: header.listingId ?? "SELLER_HUB_INBOX",
      sku: listing?.supplier_sku ?? listing?.ebay_sku ?? null,
      deduplicationKey: eventKey,
      recommendedAction: "Abrir Seller Hub, leer el mensaje protegido y responder manualmente si corresponde.",
    }
    const persisted = await insertEvent(input.supabase, input.accountKey, event)
    if (persisted.created) eventsCreated += 1
    else duplicatesAvoided += 1
    if (await enqueueAlert(input.supabase, {
      accountKey: input.accountKey,
      eventId: persisted.id,
      severity: event.severity,
      deduplicationKey: eventKey,
      deliveryClass: "immediate",
      payload: sellerMessageAlertPayload(header),
    })) alertsGenerated += 1
  }
  return { eventsCreated, alertsGenerated, duplicatesAvoided }
}

async function persistOrdersAndSales(input: {
  supabase: SupabaseClient
  accountKey: string
  orders: SafeMarketplaceOrder[]
  listings: ListingRow[]
  supplies: SupplyRow[]
  thresholds: CommercialThresholds
  observedAt: string
  verifiedIdentities: Set<string>
}) {
  const {
    supabase, accountKey, orders, listings, supplies, thresholds, observedAt,
    verifiedIdentities,
  } = input
  let newSales = 0
  let tasksCreated = 0
  let alertsGenerated = 0
  let eventsCreated = 0
  let duplicatesAvoided = 0
  let estimatedProfit = 0
  const errors: RunError[] = []

  for (const order of orders) {
    const { error: orderError } = await supabase
      .from("marketplace_order_snapshots")
      .upsert({
        marketplace_account_key: accountKey,
        marketplace: MARKETPLACE,
        marketplace_order_id: order.ebayOrderId,
        order_created_at: order.creationDate,
        order_modified_at: order.lastModifiedDate,
        payment_status: order.orderPaymentStatus,
        fulfillment_status: order.orderFulfillmentStatus,
        total_amount: order.totalAmount,
        currency: order.currency,
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        observed_at: observedAt,
        updated_at: observedAt,
      }, { onConflict: "marketplace_account_key,marketplace,marketplace_order_id" })
    if (orderError) throw new Error("COMMERCIAL_ORDER_SNAPSHOT_WRITE_FAILED")

    for (const line of order.lineItems) {
      const packQuantity = extractPackQuantity(line.title)
      const { error: lineError } = await supabase
        .from("marketplace_order_line_items")
        .upsert({
          marketplace_account_key: accountKey,
          marketplace: MARKETPLACE,
          marketplace_order_id: order.ebayOrderId,
          marketplace_line_item_id: line.lineItemId,
          listing_id: line.listingId,
          sku: line.sku,
          product_title: line.title,
          pack_quantity: packQuantity,
          quantity: line.quantity,
          line_item_amount: line.lineItemAmount,
          currency: line.currency,
          ship_by_at: line.shipByDate,
          source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
          last_observed_at: observedAt,
          updated_at: observedAt,
        }, { onConflict: "marketplace_account_key,marketplace,marketplace_order_id,marketplace_line_item_id" })
      if (lineError) throw new Error("COMMERCIAL_ORDER_LINE_WRITE_FAILED")

      const listing = verifiedListingForLine(listings, line, verifiedIdentities)
      if (!listing) {
        errors.push({
          reader: "orders",
          code: "SALE_LISTING_ITEM_ID_OR_SKU_VERIFICATION_FAILED",
          retryable: false,
        })
        continue
      }
      const supply = supplyForListing(listing, supplies)
      if (!listing.supplier_sku || !listing.supplier_variant_id || !supply ||
        supply.sku !== listing.supplier_sku ||
        supply.supplier_variant_id !== listing.supplier_variant_id ||
        !isAllowedLunaProductUrl(supply.product_url)) {
        errors.push({
          reader: "orders",
          code: "SALE_EXACT_LUNA_IDENTITY_LINK_REQUIRED",
          retryable: false,
        })
        continue
      }
      const fulfillmentSku = listing.supplier_sku
      const marketplaceListingSku = line.sku
      if (!marketplaceListingSku) {
        errors.push({ reader: "orders", code: "SALE_CUSTOM_LABEL_REQUIRED", retryable: false })
        continue
      }
      const supplyFresh = isFreshLunaSupplyEvidence(supply, observedAt)
      if (!supplyFresh) {
        errors.push({
          reader: "luna_supply",
          code: "SALE_LUNA_SUPPLY_STALE_RECHECK_REQUIRED",
          retryable: true,
        })
        const recheck = await persistLunaSupplyRecheckAlert({
          supabase,
          accountKey,
          listing,
          supply,
          thresholds,
          observedAt,
        })
        if (recheck.eventCreated) eventsCreated += 1
        if (recheck.alertCreated) alertsGenerated += 1
      }
      const identityFingerprint = fulfillmentIdentityFingerprint({
        marketplaceAccountKey: accountKey,
        marketplace: MARKETPLACE,
        orderId: order.ebayOrderId,
        lineItemId: line.lineItemId,
        listingId: line.listingId,
        marketplaceListingSku,
        supplierSku: fulfillmentSku,
        supplierVariantId: listing.supplier_variant_id,
        quantity: line.quantity,
      })
      const supplierUnitCost = supplyFresh ? numeric(supply.price) : null
      const estimatedSupplierCost = supplierUnitCost === null
        ? null
        : Number((supplierUnitCost * packQuantity * line.quantity).toFixed(2))
      const economics = calculateEbayUnitEconomics({
        salePrice: line.lineItemAmount,
        supplierCost: estimatedSupplierCost,
      })
      const profit = economics.estimatedNetProfit
      if (profit !== null) estimatedProfit += profit
      const stockAvailable = supplyFresh
        ? supply.available === false
          ? 0
          : supply.inventory_quantity ?? null
        : null
      const statusHistory = ["SALE_DETECTED", "VALIDATING_ORDER", "PENDING_MANUAL_PURCHASE"]
        .map((status) => ({ status, at: observedAt, actor: "commercial_monitor" }))
      const { data: task, error: taskError } = await supabase
        .from("fulfillment_tasks")
        .insert({
          marketplace_account_key: accountKey,
          marketplace: MARKETPLACE,
          marketplace_order_id: order.ebayOrderId,
          marketplace_line_item_id: line.lineItemId,
          listing_id: line.listingId,
          sku: fulfillmentSku,
          marketplace_listing_sku: marketplaceListingSku,
          supplier_sku: fulfillmentSku,
          supplier_variant_id: listing.supplier_variant_id,
          identity_fingerprint: identityFingerprint,
          identity_verified_at: observedAt,
          product_title: line.title,
          pack_quantity: packQuantity,
          quantity: line.quantity,
          status: "PENDING_MANUAL_PURCHASE",
          workflow_state: "PENDING_MANUAL_PURCHASE",
          status_history: statusHistory,
          source_product_url: supply?.product_url ?? null,
          seller_order_url: sellerOrderUrl(order.ebayOrderId),
          supplier_unit_cost: supplierUnitCost,
          estimated_supplier_cost: estimatedSupplierCost,
          estimated_profit: profit,
          stock_available: stockAvailable,
          ship_by_at: line.shipByDate,
          priority: line.shipByDate
            ? Math.max(0, Math.min(10_000, Math.floor((Date.parse(line.shipByDate) - Date.now()) / 60_000)))
            : 10_000,
          next_action_at: observedAt,
        })
        .select("id")
        .maybeSingle()
      if (taskError && taskError.code !== "23505") throw new Error("FULFILLMENT_TASK_CREATE_FAILED")
      if (task?.id) tasksCreated += 1
      else if (taskError?.code === "23505") duplicatesAvoided += 1

      const saleKey = stableCommercialKey(accountKey, "SALE_DETECTED", order.ebayOrderId, line.lineItemId)
      const saleEvent: CommercialEvent & { marketplaceOrderId: string; marketplaceLineItemId: string } = {
        eventType: "SALE_DETECTED",
        severity: "critical",
        evidence: {
          source: "OFFICIAL_COMPLETED_CHECKOUT_ORDER",
          orderPaymentStatus: order.orderPaymentStatus,
          orderFulfillmentStatus: order.orderFulfillmentStatus,
          quantity: line.quantity,
          amount: line.lineItemAmount,
          currency: line.currency,
          packQuantity,
          supplierUnitCost,
          estimatedSupplierCost,
          estimatedProfit: profit,
          stockAvailable,
          lunaSupplyFresh: supplyFresh,
          lunaSupplyObservedAt: supply.captured_at,
          staleLunaValuesUsedAsCurrent: false,
          itemIdVerified: true,
          ebayCustomLabelVerified: line.sku === listing.ebay_sku,
          supplierSkuVerified: fulfillmentSku === listing.supplier_sku,
          ebayCustomLabel: listing.ebay_sku,
          supplierSku: fulfillmentSku,
        },
        thresholdConfigVersion: thresholds.version,
        detectedAt: observedAt,
        listingId: line.listingId,
        sku: fulfillmentSku,
        deduplicationKey: saleKey,
        recommendedAction: supplyFresh
          ? "Comprar manualmente en Luna Portex y luego pegar el tracking en Seller OS."
          : "Reconfirmar costo y disponibilidad en Luna, comprar manualmente y luego pegar el tracking en Seller OS.",
        marketplaceOrderId: order.ebayOrderId,
        marketplaceLineItemId: line.lineItemId,
      }
      const saleEventResult = await insertEvent(supabase, accountKey, saleEvent)
      if (saleEventResult.created) {
        newSales += line.quantity
        eventsCreated += 1
      }
      const message = renderSaleDetectedMessage({
        product: line.title,
        sku: fulfillmentSku ?? "pendiente",
        quantity: line.quantity,
        amount: line.lineItemAmount,
        currency: line.currency ?? order.currency ?? "USD",
        shipByDate: line.shipByDate,
        estimatedLunaCost: estimatedSupplierCost,
        estimatedProfit: profit,
        stockAvailable,
        sellerOrderUrl: sellerOrderUrl(order.ebayOrderId),
        lunaProductUrl: supply?.product_url ?? null,
      })
      const messageLines = message.split("\n")
      if (await enqueueAlert(supabase, {
        accountKey,
        eventId: saleEventResult.id,
        severity: "critical",
        deduplicationKey: saleKey,
        deliveryClass: "immediate",
        payload: {
          title: messageLines[0],
          summary: messageLines.slice(2, 11).join(" · "),
          action: `${supplyFresh ? "" : "Antes de comprar, reconfirma costo y disponibilidad en Luna. "}${messageLines.slice(11).join(" ")}`,
          sellerOrderUrl: sellerOrderUrl(order.ebayOrderId),
          lunaProductUrl: supply?.product_url ?? null,
          lunaSupplyFresh: supplyFresh,
          staleLunaValuesForwardedAsCurrent: false,
        },
      })) alertsGenerated += 1

      const firstSaleIdentity = line.listingId || fulfillmentSku || "unknown"
      const firstSaleKey = stableCommercialKey(accountKey, "FIRST_SALE_CONFIRMED", firstSaleIdentity)
      const firstEventResult = await insertEvent(supabase, accountKey, {
        ...saleEvent,
        eventType: "FIRST_SALE_CONFIRMED",
        severity: "high",
        evidence: {
          source: "OFFICIAL_COMPLETED_CHECKOUT_ORDER",
          firstSaleIdentity,
          itemIdVerified: true,
          ebayCustomLabelVerified: line.sku === listing.ebay_sku,
          supplierSkuVerified: fulfillmentSku === listing.supplier_sku,
        },
        deduplicationKey: firstSaleKey,
        recommendedAction: "Conservar esta confirmación y priorizar el fulfillment manual de la primera venta.",
      })
      if (firstEventResult.created) eventsCreated += 1
      // FIRST_SALE_CONFIRMED is companion audit evidence for the same sale.
      // SALE_DETECTED already queued the immediate message, so a second
      // WhatsApp here would be a duplicate operator notification.
      void firstEventResult
    }
  }
  return {
    newSales,
    tasksCreated,
    eventsCreated,
    alertsGenerated,
    duplicatesAvoided,
    estimatedProfit,
    errors,
  }
}

async function confirmedUnitsSoldByListing24h(
  supabase: SupabaseClient,
  accountKey: string,
  now: Date,
) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const { data: orders, error: orderError } = await supabase
    .from("marketplace_order_snapshots")
    .select("marketplace_order_id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .gte("order_created_at", cutoff)
    .lte("order_created_at", now.toISOString())
    .limit(2_000)
  if (orderError) throw new Error("COMMERCIAL_ACCELERATED_SALES_READ_FAILED")
  const counts = new Map<string, number>()
  const orderIds = (orders ?? []).map((order) => order.marketplace_order_id)
  for (let index = 0; index < orderIds.length; index += 100) {
    const { data, error } = await supabase
      .from("marketplace_order_line_items")
      .select("listing_id,quantity")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .in("marketplace_order_id", orderIds.slice(index, index + 100))
    if (error) throw new Error("COMMERCIAL_ACCELERATED_SALES_READ_FAILED")
    for (const line of data ?? []) {
      counts.set(line.listing_id, (counts.get(line.listing_id) ?? 0) + Number(line.quantity ?? 0))
    }
  }
  return counts
}

async function persistSnapshotsAndRules(input: {
  supabase: SupabaseClient
  accountKey: string
  runId: string
  listings: ListingRow[]
  supplies: SupplyRow[]
  previous: Map<string, CommercialSnapshot>
  thresholds: CommercialThresholds
  analytics: Awaited<ReturnType<typeof getComparableEbayTrafficAnalytics>> | null
  watchers: Awaited<ReturnType<typeof getEbayListingWatchers>> | null
  units24h: Map<string, number>
  analyticsRulesSuspendedListingIds: Set<string>
  observedAt: string
}) {
  const analyticsByListing = new Map(input.analytics?.observations.map((row) => [row.listingId, row]) ?? [])
  const watchersByListing = new Map(input.watchers?.observations.map((row) => [row.listingId, row]) ?? [])
  const listingIds = [...new Set(input.listings.map((listing) => listing.ebay_item_id))]
  const { data: priorOptimizationEvents, error: priorOptimizationError } = listingIds.length
    ? await input.supabase
        .from("commercial_alert_events")
        .select("event_type,listing_id,sku,detected_at")
        .eq("marketplace_account_key", input.accountKey)
        .eq("marketplace", MARKETPLACE)
        .in("listing_id", listingIds)
        .in("event_type", [...POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES])
        .order("detected_at", { ascending: false })
        .limit(2_000)
    : { data: [], error: null }
  if (priorOptimizationError) {
    throw new Error("COMMERCIAL_OPTIMIZATION_COOLDOWN_READ_FAILED")
  }
  const latestOptimizationByListing = new Map<string, string>()
  const latestSaleRiskByListing = new Map<string, string>()
  for (const row of priorOptimizationEvents ?? []) {
    const key = `${row.listing_id}:${row.sku ?? ""}`
    const detectedAt = Date.parse(row.detected_at)
    if (!Number.isFinite(detectedAt)) continue
    const target = row.event_type === "LISTING_SALE_MARGIN_OR_STOCK_RISK"
      ? latestSaleRiskByListing
      : latestOptimizationByListing
    if (!target.has(key)) target.set(key, new Date(detectedAt).toISOString())
  }
  const snapshots: CommercialSnapshot[] = []
  let alertsGenerated = 0
  let eventsGenerated = 0
  for (const listing of input.listings) {
    const analytics = analyticsByListing.get(listing.ebay_item_id)
    const watcher = watchersByListing.get(listing.ebay_item_id)
    const supply = supplyForListing(listing, input.supplies)
    const supplyFresh = isFreshLunaSupplyEvidence(supply, input.observedAt)
    const supplierCost = supplyFresh ? numeric(supply?.price) : null
    if (!supplyFresh) {
      const recheck = await persistLunaSupplyRecheckAlert({
        supabase: input.supabase,
        accountKey: input.accountKey,
        listing,
        supply,
        thresholds: input.thresholds,
        observedAt: input.observedAt,
      })
      if (recheck.eventCreated) eventsGenerated += 1
      if (recheck.alertCreated) alertsGenerated += 1
    }
    const packQuantity = extractPackQuantity(listing.title)
    const totalSupplierCost = supplierCost === null ? null : supplierCost * packQuantity
    const economics = calculateEbayUnitEconomics({
      salePrice: listing.ebay_price,
      supplierCost: totalSupplierCost,
    })
    const previous = input.previous.get(`${listing.ebay_item_id}:${listing.supplier_sku ?? listing.ebay_sku ?? ""}`) ??
      input.previous.get(`${listing.ebay_item_id}:${listing.ebay_sku ?? listing.supplier_sku ?? ""}`)
    const currentWatchers = watcher?.currentWatchers ?? null
    const analyticsMatched = Boolean(
      analytics && input.analytics?.completenessStatus === "complete" &&
      input.analytics.matchedListingIds.includes(listing.ebay_item_id)
    )
    const snapshot: CommercialSnapshot = {
      marketplaceAccountKey: input.accountKey,
      listingId: listing.ebay_item_id,
      sku: listing.supplier_sku ?? listing.ebay_sku,
      listingStatus: listing.listing_status,
      impressions: analytics?.impressions ?? null,
      views: analytics?.views ?? null,
      ctr: analytics?.ctr ?? null,
      transactions: analytics?.transactions ?? null,
      salesConversionRate: analytics?.salesConversionRate ?? null,
      revenue: analytics?.revenue ?? null,
      currentWatchers,
      stockAvailable: supplyFresh
        ? supply?.available === false
          ? 0
          : supply?.inventory_quantity ?? null
        : null,
      supplierCost,
      estimatedMarginPercent: economics.estimatedNetMarginPercent,
      observedAt: input.observedAt,
      windowStart: input.analytics?.windowStart ?? null,
      windowEnd: input.analytics?.windowEnd ?? null,
      completenessStatus: analyticsMatched ? "complete" : analytics ? "incomplete" : "unavailable",
    }
    const { error } = await input.supabase
      .from("listing_commercial_snapshots")
      .insert({
        monitor_run_id: input.runId,
        marketplace_account_key: input.accountKey,
        marketplace: MARKETPLACE,
        listing_id: snapshot.listingId,
        sku: snapshot.sku,
        listing_status: snapshot.listingStatus,
        impressions: snapshot.impressions,
        views: snapshot.views,
        ctr: snapshot.ctr,
        transactions: snapshot.transactions,
        sales_conversion_rate: snapshot.salesConversionRate,
        revenue: snapshot.revenue,
        current_watchers: snapshot.currentWatchers,
        previous_watchers: previous?.currentWatchers ?? null,
        delta_watchers: snapshot.currentWatchers === null
          ? null
          : snapshot.currentWatchers - (previous?.currentWatchers ?? 0),
        stock_available: snapshot.stockAvailable,
        supplier_cost: snapshot.supplierCost,
        estimated_margin_percent: snapshot.estimatedMarginPercent,
        observed_at: snapshot.observedAt,
        window_start: snapshot.windowStart,
        window_end: snapshot.windowEnd,
        source: {
          analytics: input.analytics?.source ?? null,
          ebayCustomLabel: listing.ebay_sku,
          supplierSku: listing.supplier_sku,
          analyticsHealthFlag: input.analyticsRulesSuspendedListingIds.has(snapshot.listingId)
            ? ANALYTICS_SOURCE_DIVERGENCE
            : null,
          analyticsRulesSuspended: input.analyticsRulesSuspendedListingIds.has(snapshot.listingId),
          watchers: watcher?.source ?? null,
          stock: supplyFresh
            ? "LUNA_PORTEX_MARKET_RADAR_LATEST_VARIANT"
            : supply
              ? "LUNA_PORTEX_STALE_SNAPSHOT_NOT_USED_AS_CURRENT"
              : null,
          lunaSupplyObservedAt: supply?.captured_at ?? null,
          lunaSupplyFresh: supplyFresh,
          staleLunaValuesUsedAsCurrent: false,
          price: listing.ebay_price_source ??
            (listing.ebay_price === null ? null : "SELLER_OS_LISTING_LINK"),
          transactionsClassification: "ANALYTICS_NOT_CONFIRMED_ORDER",
          watchersClassification: "INTEREST_SIGNAL_NOT_SALE",
        },
        completeness_status: snapshot.completenessStatus,
      })
    if (error) throw new Error("COMMERCIAL_SNAPSHOT_WRITE_FAILED")
    snapshots.push(snapshot)

    const legacyEvents = evaluateCommercialRules({
      current: snapshot,
      previous,
      unitsSold24h: input.units24h.get(listing.ebay_item_id) ?? 0,
      thresholds: input.thresholds,
      analyticsRulesSuspended: input.analyticsRulesSuspendedListingIds.has(listing.ebay_item_id),
    }).filter((event) => ![
      "GOOD_TRAFFIC_LOW_CTR",
      "GOOD_CTR_LOW_CONVERSION",
    ].includes(event.eventType))

    for (const event of legacyEvents) {
      const eventResult = await insertEvent(input.supabase, input.accountKey, event)
      if (eventResult.created) eventsGenerated += 1
      const deliveryClass = event.eventType.startsWith("WATCHER_") ? "digest" : "immediate"
      if (await enqueueAlert(input.supabase, {
        accountKey: input.accountKey,
        eventId: eventResult.id,
        severity: event.severity,
        deduplicationKey: event.deduplicationKey,
        deliveryClass,
        payload: eventPayload(event),
      })) alertsGenerated += 1
    }

    const listingAgeStart = listingAgeEvidenceStart(listing)
    const postPublicationDiagnostic = diagnosePostPublicationListing({
      marketplaceAccountKey: input.accountKey,
      listingId: snapshot.listingId,
      sku: snapshot.sku,
      listingStatus: snapshot.listingStatus,
      listingEvidenceStartedAt: listingAgeStart?.timestamp ?? null,
      listingEvidenceStartSource: listingAgeStart?.source ?? null,
      observedAt: snapshot.observedAt,
      analytics: {
        source: input.analytics?.source ?? null,
        completenessStatus: snapshot.completenessStatus,
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        impressions: snapshot.impressions,
        views: snapshot.views,
        transactions: snapshot.transactions,
        sourceDivergenceOpen:
          input.analyticsRulesSuspendedListingIds.has(listing.ebay_item_id),
      },
      currentWatchers: snapshot.currentWatchers,
      confirmedUnitsSold: input.units24h.get(listing.ebay_item_id) ?? 0,
      stockAvailable: snapshot.stockAvailable,
      stockEvidenceFresh: supplyFresh,
      estimatedMarginPercent: snapshot.estimatedMarginPercent,
    })
    if (postPublicationDiagnostic) {
      const cooldownKey = `${postPublicationDiagnostic.listingId}:${postPublicationDiagnostic.sku ?? ""}`
      const cooldownSource = postPublicationDiagnostic.eventType ===
        "LISTING_SALE_MARGIN_OR_STOCK_RISK"
        ? latestSaleRiskByListing
        : latestOptimizationByListing
      const cooldownElapsed = postPublicationCooldownElapsed({
        previousDetectedAt: cooldownSource.get(cooldownKey) ?? null,
        currentDetectedAt: postPublicationDiagnostic.detectedAt,
        cooldownHours: postPublicationDiagnostic.cooldownHours,
      })
      if (!cooldownElapsed) continue
      const event = postPublicationCommercialEvent(postPublicationDiagnostic)
      const eventResult = await insertEvent(input.supabase, input.accountKey, event)
      if (eventResult.created) {
        eventsGenerated += 1
        cooldownSource.set(cooldownKey, postPublicationDiagnostic.detectedAt)
      }
      if (await enqueueAlert(input.supabase, {
        accountKey: input.accountKey,
        eventId: eventResult.id,
        severity: event.severity,
        deduplicationKey: event.deduplicationKey,
        deliveryClass: "immediate",
        channel: "in_app",
        payload: {
          ...eventPayload(event),
          taskStatus: "AWAITING_HUMAN_APPROVAL",
          experiment: postPublicationDiagnostic.experiment,
          whyItNeedsAttention: postPublicationDiagnostic.whyItNeedsAttention,
          whatsappEnqueued: false,
          changeApplied: false,
        },
      })) alertsGenerated += 1
    }
  }
  return { snapshots, eventsGenerated, alertsGenerated }
}

async function generateDailySummary(input: {
  supabase: SupabaseClient
  accountKey: string
  thresholds: CommercialThresholds
  snapshots: CommercialSnapshot[]
  orders: SafeMarketplaceOrder[]
  estimatedProfit: number
  observedAt: string
}) {
  const day = input.observedAt.slice(0, 10)
  const dayStart = `${day}T00:00:00.000Z`
  const dayEndDate = new Date(dayStart)
  dayEndDate.setUTCDate(dayEndDate.getUTCDate() + 1)
  const dayEnd = dayEndDate.toISOString()
  const previousDay = new Date(`${day}T00:00:00Z`)
  previousDay.setUTCDate(previousDay.getUTCDate() - 1)
  const [taskResult, priorResult, orderResult] = await Promise.all([
    input.supabase
      .from("fulfillment_tasks")
      .select("status,marketplace_order_id,estimated_profit,created_at")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false })
      .limit(2_000),
    input.supabase
      .from("commercial_daily_summaries")
      .select("window_complete")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("summary_day", isoDay(previousDay))
      .maybeSingle(),
    input.supabase
      .from("marketplace_order_snapshots")
      .select("marketplace_order_id,total_amount")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .gte("order_created_at", dayStart)
      .lt("order_created_at", dayEnd),
  ])
  if (taskResult.error || priorResult.error || orderResult.error) {
    throw new Error("COMMERCIAL_DAILY_SUMMARY_READ_FAILED")
  }
  const tasks = taskResult.data ?? []
  const dailyOrderIds = (orderResult.data ?? []).map((order) => order.marketplace_order_id)
  let confirmedSales = 0
  for (let index = 0; index < dailyOrderIds.length; index += 100) {
    const { data, error } = await input.supabase
      .from("marketplace_order_line_items")
      .select("quantity")
      .eq("marketplace_account_key", input.accountKey)
      .eq("marketplace", MARKETPLACE)
      .in("marketplace_order_id", dailyOrderIds.slice(index, index + 100))
    if (error) throw new Error("COMMERCIAL_DAILY_SUMMARY_READ_FAILED")
    confirmedSales += (data ?? []).reduce((sum, line) => sum + Number(line.quantity ?? 0), 0)
  }
  const revenue = (orderResult.data ?? []).reduce(
    (total, order) => total + Number(order.total_amount ?? 0),
    0,
  )
  const estimatedProfit = tasks
    .filter((task) => task.created_at >= dayStart && task.created_at < dayEnd)
    .reduce((total, task) => total + Number(task.estimated_profit ?? 0), 0)
  const summary = buildDailyCommercialSummary({
    snapshots: input.snapshots,
    confirmedSales,
    revenue,
    estimatedProfit,
    pendingPurchaseOrders: tasks.filter((task) => task.status === "PENDING_MANUAL_PURCHASE").length,
    awaitingTrackingOrders: tasks.filter((task) => task.status === "PURCHASED_AWAITING_TRACKING").length,
    previousDayComplete: priorResult.data?.window_complete === true,
  })
  const rendered = renderDailyCommercialSummary(summary)
  const { error } = await input.supabase.from("commercial_daily_summaries").upsert({
    marketplace_account_key: input.accountKey,
    marketplace: MARKETPLACE,
    summary_day: day,
    window_complete: summary.complete,
    comparable_to_previous_day: summary.comparableToPreviousDay,
    metrics: summary,
    rendered_summary: rendered,
    updated_at: input.observedAt,
  }, { onConflict: "marketplace_account_key,marketplace,summary_day" })
  if (error) throw new Error("COMMERCIAL_DAILY_SUMMARY_WRITE_FAILED")

  const event: CommercialEvent = {
    eventType: "DAILY_COMMERCIAL_SUMMARY",
    severity: "low",
    evidence: {
      ...summary,
      comparisonIncluded: summary.comparableToPreviousDay,
      transactionsClassification: "CONFIRMED_COMPLETED_CHECKOUT_ORDERS_ONLY",
    },
    thresholdConfigVersion: input.thresholds.version,
    detectedAt: input.observedAt,
    listingId: "ACCOUNT_SUMMARY",
    sku: null,
    deduplicationKey: stableCommercialKey(input.accountKey, "DAILY_COMMERCIAL_SUMMARY", day),
    recommendedAction: "Revisar órdenes pendientes, stock bajo y alertas críticas en Seller OS.",
  }
  const eventResult = await insertEvent(input.supabase, input.accountKey, event)
  await enqueueAlert(input.supabase, {
    accountKey: input.accountKey,
    eventId: eventResult.id,
    severity: "low",
    deduplicationKey: event.deduplicationKey,
    deliveryClass: "digest",
    payload: {
      title: "📊 RESUMEN DIARIO EBAY",
      summary: rendered.replace("📊 RESUMEN DIARIO EBAY\n\n", "").replaceAll("\n", " · "),
      action: event.recommendedAction,
    },
  })
  return { summary, rendered, alertGenerated: eventResult.created }
}

async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  workerId: string,
  status: "completed" | "partial" | "failed" | "cancelled",
  readers: Record<string, ReaderState>,
  metrics: Record<string, unknown>,
  errors: RunError[],
  nextAction: string,
) {
  const { data, error } = await supabase.rpc("finish_commercial_monitor_run", {
    p_run_id: runId,
    p_worker_id: workerId,
    p_status: status,
    p_readers: readers,
    p_metrics: metrics,
    p_errors: errors,
    p_next_action: nextAction,
  })
  if (error || data !== true) throw new Error("COMMERCIAL_MONITOR_RUN_FINISH_FAILED")
}

export async function runEbayCommercialMonitor(
  supabase: SupabaseClient,
  input: {
    triggerSource: "manual" | "schedule" | "recovery" | "dry_run"
    lanes?: CommercialMonitorLane[]
    workerId?: string
    dispatchWhatsApp?: boolean
    dryRunWhatsApp?: boolean
    authorizedDryRunId?: string
    now?: Date
  },
) {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  if (!accountScope.accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
  const accountKey = accountScope.accountKey
  const lanes = normalizedLanes(input.lanes)
  const workerId = input.workerId ?? `commercial-monitor:${input.triggerSource}:${randomUUID()}`
  const claim = input.triggerSource === "manual"
    ? await supabase.rpc("start_authorized_commercial_monitor_run", {
        p_marketplace_account_key: accountKey,
        p_marketplace: MARKETPLACE,
        p_requested_lanes: lanes,
        p_worker_id: workerId,
        p_dry_run_id: input.authorizedDryRunId ?? null,
        p_lease_seconds: MONITOR_LEASE_SECONDS,
        p_max_dry_run_age_seconds: 1_800,
      })
    : input.triggerSource === "schedule"
      ? await supabase.rpc("start_authorized_commercial_monitor_scheduled_run", {
          p_marketplace_account_key: accountKey,
          p_marketplace: MARKETPLACE,
          p_requested_lanes: lanes,
          p_worker_id: workerId,
          p_lease_seconds: MONITOR_LEASE_SECONDS,
        })
      : await supabase.rpc("start_commercial_monitor_run", {
        p_marketplace_account_key: accountKey,
        p_marketplace: MARKETPLACE,
        p_trigger_source: input.triggerSource,
        p_requested_lanes: lanes,
        p_worker_id: workerId,
        p_lease_seconds: MONITOR_LEASE_SECONDS,
      })
  const { data: claimed, error: claimError } = claim
  if (claimError) {
    const schedulerGateCode = claimError.message.match(
      /COMMERCIAL_MONITOR_SCHEDULER_(?:GATE_REQUIRED|DRY_RUN_REQUIRED|DRY_RUN_NOT_SATISFIED)/,
    )?.[0]
    throw new Error(schedulerGateCode ?? "COMMERCIAL_MONITOR_RUN_CLAIM_FAILED")
  }
  const run = Array.isArray(claimed) ? claimed[0] : claimed
  if (!run?.id) {
    return {
      success: true,
      status: "already_running" as const,
      error: "COMMERCIAL_MONITOR_ALREADY_RUNNING",
      safety: { ebayReadOnly: true, ebayWriteUsed: false, canPublish: false },
    }
  }

  const runId = run.id as string
  const now = input.now ?? new Date()
  const observedAt = now.toISOString()
  const readers: Record<string, ReaderState> = {}
  const errors: RunError[] = []
  try {
    const [listings, thresholds] = await Promise.all([
      loadActiveListings(supabase, accountKey),
      loadThresholds(supabase, accountKey, input.triggerSource !== "dry_run"),
    ])
    const supplies = await loadSupplyRows(supabase, listings)
    const previous = await loadPreviousSnapshots(
      supabase,
      accountKey,
      listings.map((row) => row.ebay_item_id),
    )
    const window = analyticsWindow(now)
    const orderFrom = await latestOrderModifiedAt(supabase, accountKey, now)
    const orderPromise = lanes.includes("orders")
      ? quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "ORDERS_REFRESH_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "TRADING", operation: "GET_USER", endpoint: "/ws/api.dll" },
            { apiFamily: "SELL_FULFILLMENT", operation: "GET_ORDERS", endpoint: "/sell/fulfillment/v1/order" },
          ],
          lane: "P0_ORDERS",
          checkpoint: { runId, reader: "orders", modifiedFrom: orderFrom, modifiedTo: observedAt },
        }, () => getEbayCompletedCheckoutOrders({ modifiedFrom: orderFrom, modifiedTo: observedAt }))
      : Promise.resolve(null)
    const analyticsPromise = lanes.includes("analytics")
      ? quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "ANALYTICS_REFRESH_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "TRADING", operation: "GET_USER", endpoint: "/ws/api.dll" },
            { apiFamily: "SELL_ANALYTICS", operation: "GET_TRAFFIC_REPORT", endpoint: "/sell/analytics/v1/traffic_report" },
          ],
          lane: "P0_COMMERCIAL_MONITOR",
          checkpoint: { runId, reader: "analytics", dateFrom: window.dateFrom, dateTo: window.dateTo },
        }, () => getComparableEbayTrafficAnalytics({
            listingIds: listings.map((row) => row.ebay_item_id),
            dateFrom: window.dateFrom,
            dateTo: window.dateTo,
            timeZone: "UTC",
          }))
      : Promise.resolve(null)
    const watchersPromise = lanes.includes("watchers")
      ? quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "TRADING_REFRESH_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "TRADING", operation: "GET_USER", endpoint: "/ws/api.dll" },
            { apiFamily: "TRADING", operation: "GET_ITEM_WATCHCOUNT", endpoint: "/ws/api.dll" },
          ],
          lane: "P0_PROTECTION",
          checkpoint: { runId, reader: "watchers", listingCount: listings.length },
        }, () => getEbayListingWatchers({ listingIds: listings.map((row) => row.ebay_item_id) }))
      : Promise.resolve(null)
    const messageLookbackHours = integer(
      process.env.EBAY_COMMERCIAL_MESSAGE_LOOKBACK_HOURS,
      48,
      1,
      7 * 24,
    )
    const messagesPromise = lanes.includes("messages")
      ? quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "TRADING_REFRESH_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "TRADING", operation: "GET_USER", endpoint: "/ws/api.dll" },
            { apiFamily: "TRADING", operation: "GET_MEMBER_MESSAGES", endpoint: "/ws/api.dll" },
          ],
          lane: "P0_COMMERCIAL_MONITOR",
          checkpoint: { runId, reader: "messages", createdTo: observedAt },
        }, () => getEbaySellerInboxMessageHeaders({
            accountKey,
            createdFrom: new Date(now.getTime() - messageLookbackHours * 60 * 60 * 1_000).toISOString(),
            createdTo: observedAt,
          }))
      : Promise.resolve(null)
    const [coreReaderResults, [messagesResult]] = await Promise.all([
      settleEbayCommercialReaderPromises({
        orders: orderPromise,
        analytics: analyticsPromise,
        watchers: watchersPromise,
      }),
      Promise.allSettled([messagesPromise]),
    ])
    const {
      orders: orderResult,
      analytics: analyticsResult,
      watchers: watchersResult,
    } = coreReaderResults

    let orders: SafeMarketplaceOrder[] = []
    let analytics: Awaited<ReturnType<typeof getComparableEbayTrafficAnalytics>> | null = null
    let watchers: Awaited<ReturnType<typeof getEbayListingWatchers>> | null = null
    let sellerMessages: Awaited<ReturnType<typeof getEbaySellerInboxMessageHeaders>> | null = null
    const ordersResponseAvailable = orderResult.status === "fulfilled" && Boolean(orderResult.value)
    if (orderResult.status === "fulfilled" && orderResult.value) {
      orders = orderResult.value.orders
      readers.orders = {
        status: "available",
        source: orderResult.value.source,
        observedAt: orderResult.value.observedAt,
        metrics: { orders: orders.length, pagesRead: orderResult.value.pagesRead },
        auth: getEbayCommercialReaderAuthState("orders"),
      }
    } else if (lanes.includes("orders")) {
      const readerFailure = orderResult.status === "rejected" ? orderResult.reason : null
      const code = safeCode(readerFailure, "EBAY_ORDERS_READ_FAILED")
      readers.orders = {
        status: "unavailable",
        source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
        observedAt,
        error: code,
        metrics: quotaReaderMetrics(readerFailure),
        auth: getEbayCommercialReaderAuthState("orders", code),
      }
      errors.push({ reader: "orders", code, retryable: true })
    } else readers.orders = { status: "skipped", source: "schedule", observedAt: null }

    if (analyticsResult.status === "fulfilled" && analyticsResult.value) {
      analytics = analyticsResult.value
      readers.analytics = {
        status: analytics.status === "AVAILABLE" ? "available" : "incomplete",
        source: analytics.source,
        observedAt: analytics.observedAt,
        metrics: {
          listings: analytics.observations.length,
          windowStart: analytics.windowStart,
          windowEnd: analytics.windowEnd,
          completenessStatus: analytics.completenessStatus,
          dataFreshnessStatus: analytics.dataFreshnessStatus,
          queryDimension: analytics.queryDimension,
          queryTimeZone: analytics.queryTimeZone,
          requestedListingIds: analytics.requestedListingIds,
          returnedListingDimensions: analytics.returnedListingDimensions,
          matchedListingIds: analytics.matchedListingIds,
          unmatchedRequestedListingIds: analytics.unmatchedRequestedListingIds,
          unexpectedDimensions: analytics.unexpectedDimensions,
          reportStartDate: analytics.reportCoverage.reportStartDay,
          reportEndDate: analytics.reportCoverage.reportEndDay,
          lastUpdatedDate: analytics.reportCoverage.lastUpdatedDay,
          warnings: analytics.reportCoverage.warnings,
        },
        auth: getEbayCommercialReaderAuthState("analytics"),
      }
      if (analytics.status !== "AVAILABLE") {
        errors.push({ reader: "analytics", code: "EBAY_ANALYTICS_WINDOW_INCOMPLETE", retryable: true })
      }
    } else if (lanes.includes("analytics")) {
      const readerFailure = analyticsResult.status === "rejected" ? analyticsResult.reason : null
      const code = safeCode(readerFailure, "EBAY_ANALYTICS_READ_FAILED")
      readers.analytics = {
        status: "unavailable",
        source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
        observedAt,
        error: code,
        metrics: quotaReaderMetrics(readerFailure),
        auth: getEbayCommercialReaderAuthState("analytics", code),
      }
      errors.push({ reader: "analytics", code, retryable: true })
    } else readers.analytics = { status: "skipped", source: "schedule", observedAt: null }

    if (watchersResult.status === "fulfilled" && watchersResult.value) {
      watchers = watchersResult.value
      readers.watchers = {
        status: watchers.status === "AVAILABLE" ? "available" : watchers.status === "PARTIAL" ? "partial" : "unavailable",
        source: watchers.source,
        observedAt,
        metrics: { listings: watchers.observations.length, errors: watchers.errors.length },
        auth: getEbayCommercialReaderAuthState("watchers"),
      }
      for (const error of watchers.errors) {
        errors.push({ reader: "watchers", code: error.code, retryable: true })
      }
    } else if (lanes.includes("watchers")) {
      const readerFailure = watchersResult.status === "rejected" ? watchersResult.reason : null
      const code = safeCode(readerFailure, "EBAY_WATCHERS_READ_FAILED")
      readers.watchers = {
        status: "unavailable",
        source: "EBAY_TRADING_GET_ITEM_WATCHCOUNT",
        observedAt,
        error: code,
        metrics: quotaReaderMetrics(readerFailure),
        auth: getEbayCommercialReaderAuthState("watchers", code),
      }
      errors.push({ reader: "watchers", code, retryable: true })
    } else readers.watchers = { status: "skipped", source: "schedule", observedAt: null }

    if (messagesResult.status === "fulfilled" && messagesResult.value) {
      sellerMessages = messagesResult.value
      readers.messages = {
        status: sellerMessages.status === "AVAILABLE" ? "available" : "partial",
        source: sellerMessages.source,
        observedAt: sellerMessages.observedAt,
        metrics: {
          unreadHeaders: sellerMessages.headers.length,
          pagesRead: sellerMessages.pagesRead,
          rawRowsSeen: sellerMessages.rawRowsSeen,
          rejectedRows: sellerMessages.rejectedRows,
          truncated: sellerMessages.truncated,
          contentReturned: false,
          buyerPiiReturned: false,
          rawXmlPersisted: false,
          ebayWrites: 0,
        },
        auth: getEbayCommercialReaderAuthState("messages"),
      }
      if (sellerMessages.status === "PARTIAL") {
        errors.push({
          reader: "messages",
          code: "EBAY_SELLER_MESSAGES_PAGE_LIMIT_REACHED",
          retryable: true,
        })
      }
    } else if (lanes.includes("messages")) {
      const readerFailure = messagesResult.status === "rejected" ? messagesResult.reason : null
      const code = safeCode(
        readerFailure,
        "EBAY_SELLER_MESSAGES_READ_FAILED",
      )
      readers.messages = {
        status: "unavailable",
        source: "EBAY_TRADING_GET_MEMBER_MESSAGES_HEADERS_ONLY",
        observedAt,
        error: code,
        metrics: quotaReaderMetrics(readerFailure),
        auth: getEbayCommercialReaderAuthState("messages", code),
      }
      errors.push({ reader: "messages", code, retryable: true })
    } else readers.messages = { status: "skipped", source: "schedule", observedAt: null }

    const expectedIdentityRows = new Map<string, { listingId: string; sku: string }>()
    for (const listing of listings) {
      if (listing.ebay_sku) expectedIdentityRows.set(
        `${listing.ebay_item_id}:${listing.ebay_sku}`,
        { listingId: listing.ebay_item_id, sku: listing.ebay_sku },
      )
    }
    for (const order of orders) {
      for (const line of order.lineItems) {
        if (line.sku) expectedIdentityRows.set(`${line.listingId}:${line.sku}`, {
          listingId: line.listingId,
          sku: line.sku,
        })
      }
    }
    const verifiedIdentities = new Set<string>()
    const activeListingIdentityLinksComplete = listings.length > 0 &&
      listings.every((listing) => Boolean(listing.ebay_sku && listing.supplier_sku))
    if (!activeListingIdentityLinksComplete) {
      errors.push({
        reader: "listing_identity",
        code: "COMMERCIAL_LISTING_ITEM_ID_OR_CUSTOM_LABEL_MISMATCH",
        retryable: false,
      })
    }
    if (expectedIdentityRows.size) {
      try {
        const identityResult = await quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "TRADING_REFRESH_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "TRADING", operation: "GET_USER", endpoint: "/ws/api.dll" },
            { apiFamily: "TRADING", operation: "GET_ITEM_IDENTITY", endpoint: "/ws/api.dll" },
          ],
          lane: "P0_PROTECTION",
          checkpoint: { runId, reader: "listing_identity", listingCount: expectedIdentityRows.size },
        }, () => verifyEbayActiveListingIdentities({
            listings: [...expectedIdentityRows.values()],
          }))
        for (const identity of identityResult.observations) {
          if (identity.activeListingConfirmed) {
            verifiedIdentities.add(`${identity.listingId}:${identity.expectedSku}`)
            const verifiedListing = listings.find((row) =>
              row.ebay_item_id === identity.listingId &&
              row.ebay_sku === identity.expectedSku
            )
            if (verifiedListing && identity.currentPrice !== null) {
              verifiedListing.ebay_price = identity.currentPrice
              verifiedListing.currency = identity.currency ?? verifiedListing.currency
              verifiedListing.ebay_price_source = "EBAY_TRADING_GET_ITEM_CURRENT_PRICE"
            }
          } else {
            errors.push({
              reader: "listing_identity",
              code: "COMMERCIAL_LISTING_ITEM_ID_OR_CUSTOM_LABEL_MISMATCH",
              retryable: false,
            })
          }
          if (input.triggerSource !== "dry_run") {
            await persistListingIdentityVerification(supabase, accountKey, identity)
          }
        }
        for (const identityError of identityResult.errors) {
          errors.push({
            reader: "listing_identity",
            code: identityError.code,
            retryable: true,
          })
          if (input.triggerSource !== "dry_run") {
            await persistListingIdentityVerification(supabase, accountKey, {
              listingId: identityError.listingId,
              expectedSku: identityError.expectedSku,
              errorCode: identityError.code,
            })
          }
        }
        readers.listing_identity = {
          status: identityResult.status === "AVAILABLE"
            ? identityResult.observations.every((row) => row.activeListingConfirmed)
              ? "available"
              : "unavailable"
            : identityResult.status === "PARTIAL" ? "partial" : "unavailable",
          source: identityResult.source,
          observedAt,
          metrics: {
            checked: expectedIdentityRows.size,
            verified: verifiedIdentities.size,
            itemIdAndCustomLabelExact: listings.length > 0 && listings.every((listing) =>
              Boolean(listing.ebay_sku) &&
              verifiedIdentities.has(`${listing.ebay_item_id}:${listing.ebay_sku}`)
            ),
            supplierSkuLinked: listings.length > 0 &&
              listings.every((listing) => Boolean(listing.supplier_sku)),
          },
        }
      } catch (error) {
        const code = safeCode(error, "EBAY_LISTING_IDENTITY_READ_FAILED")
        readers.listing_identity = {
          status: "unavailable",
          source: "EBAY_TRADING_GET_ITEM_READONLY",
          observedAt,
          error: code,
          metrics: quotaReaderMetrics(error),
        }
        errors.push({ reader: "listing_identity", code, retryable: true })
      }
    } else readers.listing_identity = {
      status: "unavailable",
      source: "EBAY_TRADING_GET_ITEM_READONLY",
      observedAt,
      error: "COMMERCIAL_LISTING_IDENTITY_EXPECTATION_MISSING",
    }

    let divergence = {
      openListingIds: new Set<string>(),
      rechecked: 0,
      resolved: 0,
      error: null as string | null,
    }
    try {
      divergence = input.triggerSource !== "dry_run" && lanes.includes("analytics")
        ? await reconcileOpenAnalyticsDivergences(supabase, accountKey, now)
        : {
            openListingIds: new Set((await loadOpenAnalyticsDivergences(supabase, accountKey))
              .map((row) => row.listing_id as string)),
            rechecked: 0,
            resolved: 0,
            error: null,
          }
    } catch (error) {
      divergence.error = safeCode(error, "COMMERCIAL_ANALYTICS_DIVERGENCE_READ_FAILED")
    }
    if (readers.analytics.metrics) {
      readers.analytics.metrics.healthFlag = divergence.openListingIds.size
        ? ANALYTICS_SOURCE_DIVERGENCE
        : null
      readers.analytics.metrics.analyticsRulesSuspendedListingIds = [
        ...divergence.openListingIds,
      ]
      readers.analytics.metrics.divergenceRechecked = divergence.rechecked
      readers.analytics.metrics.divergenceResolved = divergence.resolved
      readers.analytics.metrics.divergenceRecheckError = divergence.error
    }

    let competitorWork: Awaited<ReturnType<typeof monitorEbayListingCompetitors>> | null = null
    if (lanes.includes("competitors")) {
      const competitorListings = listings.flatMap((listing) => {
        if (!listing.ebay_sku ||
          !verifiedIdentities.has(`${listing.ebay_item_id}:${listing.ebay_sku}`)) return []
        const supply = supplyForListing(listing, supplies)
        if (!supply || !listing.supplier_variant_id) return []
        const supplyFresh = isFreshLunaSupplyEvidence(supply, observedAt)
        return [{
          listingId: listing.ebay_item_id,
          sku: listing.ebay_sku,
          title: listing.title,
          price: numeric(listing.ebay_price),
          currency: listing.currency,
          supplierVariantId: listing.supplier_variant_id,
          supplierSku: listing.supplier_sku,
          rawPayload: listing.raw_payload,
          supply: {
            title: supply.title,
            variantTitle: supply.variant_title,
            sku: supply.sku,
            barcode: supply.barcode,
            vendor: supply.vendor,
            productType: supply.product_type,
            metadata: supply.metadata,
            unitCost: supplyFresh && supply.available === true
              ? numeric(supply.price) : null,
            costFresh: supplyFresh,
            available: supply.available,
          },
        }]
      })
      try {
        competitorWork = await quotaProtectedCommercialRead(supabase, {
          dependencies: [
            { apiFamily: "OAUTH", operation: "BROWSE_APPLICATION_TOKEN", endpoint: "/identity/v1/oauth2/token" },
            { apiFamily: "BROWSE", operation: "SEARCH_ACTIVE_COMPETITORS", endpoint: "/buy/browse/v1/item_summary/search" },
          ],
          lane: "P0_COMMERCIAL_MONITOR",
          checkpoint: { runId, reader: "competitors", listingCount: competitorListings.length },
        }, () => monitorEbayListingCompetitors({
          supabase,
          accountKey,
          monitorRunId: runId,
          listings: competitorListings,
          ownSellerUsername: accountScope.identity.expectedUserId || null,
          observedAt,
          persist: input.triggerSource !== "dry_run",
        }))
        readers.competitors = {
          status: competitorWork.status === "AVAILABLE"
            ? "available"
            : competitorWork.status === "PARTIAL" ? "partial" : "unavailable",
          source: competitorWork.source,
          observedAt,
          metrics: {
            eligibleListings: competitorWork.eligibleListings,
            scannedListings: competitorWork.scannedListings,
            baselineListings: competitorWork.baselineListings,
            activeOffers: competitorWork.activeOffers,
            activeSellers: competitorWork.activeSellers,
            newSellers: competitorWork.newSellers,
            potentialSellers: competitorWork.potentialSellers,
            researchRefreshRecommendations: competitorWork.researchRefreshRecommendations,
            confirmedSoldPriceRecommendations:
              competitorWork.confirmedSoldPriceRecommendations,
            activeOfferTreatedAsConfirmedSale: false,
            confirmedSoldPriceRequired: true,
            ownCostFloorRequired: true,
            rawCompetitorContentStored: false,
            ebayWrites: 0,
          },
        }
        for (const competitorError of competitorWork.errors) {
          errors.push({ reader: "competitors", code: competitorError.code, retryable: true })
        }
      } catch (error) {
        const code = safeCode(error, "EBAY_COMPETITOR_WATCH_READ_FAILED")
        readers.competitors = {
          status: "unavailable",
          source: "EBAY_BROWSE_ACTIVE_COMPETITOR_READONLY",
          observedAt,
          error: code,
          metrics: quotaReaderMetrics(error),
        }
        errors.push({ reader: "competitors", code, retryable: true })
      }
    } else readers.competitors = { status: "skipped", source: "schedule", observedAt: null }

    if (input.triggerSource === "dry_run") {
      const lunaMaxAgeMinutes = integer(
        process.env.EBAY_COMMERCIAL_LUNA_SUPPLY_MAX_AGE_MINUTES,
        DEFAULT_LUNA_SUPPLY_MAX_AGE_MINUTES,
        5,
        72 * 60,
      )
      const lunaSupplyChecks = listings.map((listing) => {
        const supply = supplyForListing(listing, supplies)
        const exact = Boolean(
          listing.market_radar_product_id &&
          listing.supplier_variant_id &&
          listing.supplier_sku &&
          supply &&
          supply.product_id === listing.market_radar_product_id &&
          supply.supplier_variant_id === listing.supplier_variant_id &&
          supply.sku === listing.supplier_sku
        )
        return {
          supply,
          exact,
          fresh: exact && isFreshLunaSupplyEvidence(supply, now.toISOString()),
        }
      })
      const lunaExactSupplyLinked = lunaSupplyChecks.length > 0 &&
        lunaSupplyChecks.every((check) => check.exact)
      const lunaSupplyFresh = lunaExactSupplyLinked &&
        lunaSupplyChecks.every((check) => check.fresh)
      const lunaSupplyObservedAt = lunaSupplyChecks
        .map((check) => check.supply?.captured_at ?? null)
        .filter((capturedAt): capturedAt is string => Boolean(capturedAt))
        .sort()[0] ?? null
      readers.luna_supply = {
        status: lunaExactSupplyLinked && lunaSupplyFresh ? "available" : "unavailable",
        source: "LUNA_MARKET_RADAR_LATEST_VARIANT_LOCAL_SNAPSHOT",
        observedAt: lunaSupplyObservedAt,
        metrics: {
          exactProductVariantAndSku: lunaExactSupplyLinked,
          fresh: lunaSupplyFresh,
          maximumAgeMinutes: lunaMaxAgeMinutes,
          activeListingsEvaluated: lunaSupplyChecks.length,
          exactSupplyLinks: lunaSupplyChecks.filter((check) => check.exact).length,
          freshSupplyLinks: lunaSupplyChecks.filter((check) => check.fresh).length,
        },
        ...(!lunaExactSupplyLinked
          ? { error: "COMMERCIAL_LUNA_EXACT_SUPPLY_LINK_MISSING" }
          : !lunaSupplyFresh
            ? { error: "COMMERCIAL_LUNA_SUPPLY_STALE" }
            : {}),
      }
      if (!lunaExactSupplyLinked || !lunaSupplyFresh) {
        errors.push({
          reader: "luna_supply",
          code: !lunaExactSupplyLinked
            ? "COMMERCIAL_LUNA_EXACT_SUPPLY_LINK_MISSING"
            : "COMMERCIAL_LUNA_SUPPLY_STALE",
          retryable: true,
        })
      }
      readers.whatsapp = {
        status: "skipped",
        source: "DRY_RUN_NO_OUTBOX_CLAIM",
        observedAt: null,
      }
      const authentication = {
        ordersOAuth: readers.orders.auth?.status ?? "NOT_RUN",
        watchersAuth: readers.watchers.auth?.status ?? "NOT_RUN",
        analyticsAuth: readers.analytics.auth?.status ?? "NOT_RUN",
        messagesAuth: readers.messages.auth?.status ?? "NOT_RUN",
        fulfillmentScopeConfirmed: readers.orders.auth?.scopeConfirmed === true,
        officialIdentityMatch: Object.values(readers)
          .some((reader) => reader.auth?.identityMatch === false)
          ? false
          : Object.values(readers).some((reader) => reader.auth?.identityMatch === true)
            ? true
            : null,
        actionRequired: [readers.orders, readers.messages, readers.watchers, readers.analytics]
          .find((reader) => reader.auth?.status && reader.auth.status !== "READY")
          ?.auth?.actionRequired ?? "Sin acción de autenticación; continuar con el dry run read-only.",
      }
      const metrics = {
        dryRun: true,
        activeListings: listings.length,
        officialOrdersRead: ordersResponseAvailable ? orders.length : null,
        completedCheckoutLineItems: ordersResponseAvailable
          ? orders.reduce((total, order) => total + order.lineItems.length, 0)
          : null,
        analyticsListingsRead: analytics ? analytics.observations.length : null,
        watcherListingsRead: watchers ? watchers.observations.length : null,
        competitorListingsRead: competitorWork?.scannedListings ?? null,
        competitorActiveSellers: competitorWork?.activeSellers ?? null,
        competitorResearchRefreshRecommendations:
          competitorWork?.researchRefreshRecommendations ?? null,
        competitorConfirmedSoldPriceRecommendations:
          competitorWork?.confirmedSoldPriceRecommendations ?? null,
        sellerHubMessageHeadersRead: sellerMessages?.headers.length ?? null,
        sellerHubMessageContentReturned: false,
        sellerHubMessageRawXmlPersisted: false,
        healthFlags: divergence.openListingIds.size ? [ANALYTICS_SOURCE_DIVERGENCE] : [],
        analyticsRulesSuspendedListingIds: [...divergence.openListingIds],
        listingIdentityVerified: listings.length > 0 && listings.every((listing) =>
          Boolean(listing.ebay_sku && listing.supplier_sku) &&
          verifiedIdentities.has(`${listing.ebay_item_id}:${listing.ebay_sku}`)
        ),
        lunaExactSupplyLinked,
        lunaSupplyFresh,
        lunaSupplyObservedAt,
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
        authentication,
        thresholdConfigVersion: thresholds.version,
      }
      const status = errors.length ? "partial" as const : "completed" as const
      const nextAction = errors.length
        ? authentication.actionRequired
        : "Dry run correcto; ejecutar una actualización manual controlada para persistir snapshots."
      await finishRun(supabase, runId, workerId, status, readers, metrics, errors, nextAction)
      const completedAt = new Date().toISOString()
      const result = {
        success: true,
        status,
        runId,
        startedAt: run.started_at,
        completedAt,
        readers,
        metrics,
        errors,
        nextAction,
        safety: {
          dryRun: true,
          commercialDataPersistencePerformed: false,
          runAuditPersisted: true,
          alertDeliveryAttempted: false,
          ebayReadOnly: true,
          ebayWriteUsed: false,
          canPublish: false,
          buyerPiiReturned: false,
        },
      }
      const satisfactory = isSatisfactoryCommercialDryRun(result, Date.parse(completedAt))
      const { error: gateError } = await supabase
        .from("commercial_monitor_runs")
        .update({ dry_run_satisfactory: satisfactory })
        .eq("id", runId)
        .eq("worker_id", workerId)
        .eq("trigger_source", "dry_run")
      if (gateError) throw new Error("COMMERCIAL_DRY_RUN_GATE_RECORD_FAILED")
      return { ...result, satisfactory }
    }

    const messageWork = lanes.includes("messages") && sellerMessages
      ? await persistSellerInboxMessageAlerts({
          supabase,
          accountKey,
          listings,
          headers: sellerMessages.headers,
          observedAt,
        })
      : { eventsCreated: 0, alertsGenerated: 0, duplicatesAvoided: 0 }

    const orderWork = lanes.includes("orders") && orders.length
      ? await persistOrdersAndSales({
          supabase, accountKey, orders, listings, supplies, thresholds, observedAt,
          verifiedIdentities,
        })
      : {
          newSales: 0,
          tasksCreated: 0,
          eventsCreated: 0,
          alertsGenerated: 0,
          duplicatesAvoided: 0,
          estimatedProfit: 0,
          errors: [],
        }
    errors.push(...orderWork.errors)
    const confirmedUnits24h = await confirmedUnitsSoldByListing24h(
      supabase,
      accountKey,
      now,
    )

    const snapshotWork = lanes.some((lane) => ["analytics", "watchers", "rules"].includes(lane))
      ? await persistSnapshotsAndRules({
          supabase,
          accountKey,
          runId,
          listings,
          supplies,
          previous,
          thresholds,
          analytics,
          watchers,
          units24h: confirmedUnits24h,
          analyticsRulesSuspendedListingIds: divergence.openListingIds,
          observedAt,
        })
      : { snapshots: [], eventsGenerated: 0, alertsGenerated: 0 }

    const daily = lanes.includes("daily_summary")
      ? await generateDailySummary({
          supabase,
          accountKey,
          thresholds,
          snapshots: snapshotWork.snapshots,
          orders,
          estimatedProfit: orderWork.estimatedProfit,
          observedAt,
        })
      : null

    let delivery: Awaited<ReturnType<typeof dispatchCommercialAlertOutbox>> | null = null
    if (lanes.includes("whatsapp") && input.dispatchWhatsApp !== false) {
      delivery = await dispatchCommercialAlertOutbox(supabase, {
        marketplaceAccountKey: accountKey,
        workerId: `commercial-dispatch:${runId}`,
        limit: 1,
        dryRun: input.dryRunWhatsApp !== false,
      })
      readers.whatsapp = {
        status: delivery.mode === "delivery" && delivery.failed > 0 ? "partial" : "available",
        source: "META_WHATSAPP_APPROVED_TEMPLATE",
        observedAt,
        metrics: {
          mode: delivery.mode,
          metaAccepted: delivery.metaAccepted,
          deliveryConfirmed: delivery.delivered,
          failed: delivery.failed,
        },
      }
    } else readers.whatsapp = { status: "skipped", source: "schedule", observedAt: null }

    const metrics = {
      activeListings: listings.length,
      listingIdentity: {
        activeListingsEvaluated: listings.length,
        supplierSkusLinked: listings.filter((row) => Boolean(row.supplier_sku)).length,
        activeListingsVerified: listings.filter((row) =>
          Boolean(row.ebay_sku) &&
          verifiedIdentities.has(`${row.ebay_item_id}:${row.ebay_sku}`)
        ).length,
        allActiveListingsVerified: listings.length > 0 && listings.every((row) =>
          Boolean(row.ebay_sku && row.supplier_sku) &&
          verifiedIdentities.has(`${row.ebay_item_id}:${row.ebay_sku}`)
        ),
      },
      officialOrdersRead: ordersResponseAvailable ? orders.length : null,
      newSales: orderWork.newSales,
      fulfillmentTasksCreated: orderWork.tasksCreated,
      snapshotsCreated: snapshotWork.snapshots.length,
      commercialEventsCreated: snapshotWork.eventsGenerated + orderWork.eventsCreated +
        messageWork.eventsCreated + (competitorWork?.eventsCreated ?? 0),
      eventsCreated: snapshotWork.eventsGenerated + orderWork.eventsCreated +
        messageWork.eventsCreated + (competitorWork?.eventsCreated ?? 0),
      alertsGenerated: orderWork.alertsGenerated + snapshotWork.alertsGenerated +
        messageWork.alertsGenerated + (competitorWork?.alertsGenerated ?? 0) +
        (daily?.alertGenerated ? 1 : 0),
      duplicatesAvoided: orderWork.duplicatesAvoided + messageWork.duplicatesAvoided +
        (competitorWork?.duplicatesAvoided ?? 0),
      competitors: competitorWork ? {
        listingsScanned: competitorWork.scannedListings,
        activeOffers: competitorWork.activeOffers,
        activeSellers: competitorWork.activeSellers,
        newSellers: competitorWork.newSellers,
        potentialSellers: competitorWork.potentialSellers,
        researchRefreshRecommendations: competitorWork.researchRefreshRecommendations,
        confirmedSoldPriceRecommendations:
          competitorWork.confirmedSoldPriceRecommendations,
        eventsCreated: competitorWork.eventsCreated,
        alertsEnqueued: competitorWork.alertsGenerated,
        activeOfferTreatedAsConfirmedSale: false,
        confirmedSoldPriceRequired: true,
        ownCostFloorRequired: true,
        automaticProductResearchImport: false,
        automaticEbayMutation: false,
        ebayWrites: 0,
      } : null,
      sellerHubMessages: {
        headersRead: sellerMessages?.headers.length ?? null,
        eventsCreated: messageWork.eventsCreated,
        alertsEnqueued: messageWork.alertsGenerated,
        duplicatesAvoided: messageWork.duplicatesAvoided,
        contentStored: false,
        buyerPiiStored: false,
        rawXmlStored: false,
        ebayWrites: 0,
      },
      analytics: {
        impressions: sumAvailableSnapshotMetric(snapshotWork.snapshots, "impressions"),
        views: sumAvailableSnapshotMetric(snapshotWork.snapshots, "views"),
        transactions: sumAvailableSnapshotMetric(snapshotWork.snapshots, "transactions"),
        watchers: sumAvailableSnapshotMetric(snapshotWork.snapshots, "currentWatchers"),
        healthFlag: divergence.openListingIds.size ? ANALYTICS_SOURCE_DIVERGENCE : null,
        rulesSuspendedListingIds: [...divergence.openListingIds],
      },
      dailySummary: daily?.summary ?? null,
      whatsapp: delivery ? {
        mode: delivery.mode,
        metaAccepted: delivery.metaAccepted,
        deliveryConfirmed: delivery.delivered,
        failed: delivery.failed,
      } : null,
      whatsappMetaAccepted: delivery?.metaAccepted ?? 0,
      whatsappDelivered: delivery?.delivered ?? 0,
      ebayWrites: 0,
      thresholdConfigVersion: thresholds.version,
    }
    const unavailable = Object.values(readers).some((reader) => reader.status === "unavailable")
    const status = unavailable || errors.length ? "partial" as const : "completed" as const
    const nextAction = orderWork.newSales > 0
      ? "Comprar manualmente en Luna las ventas nuevas y continuar fulfillment en Seller OS."
      : errors.length
        ? "Revisar errores del lector y dejar que el scheduler aplique backoff."
        : "Sin acción urgente; esperar la próxima ejecución automática."
    await finishRun(supabase, runId, workerId, status, readers, metrics, errors, nextAction)
    return {
      success: true,
      status,
      runId,
      startedAt: run.started_at,
      completedAt: new Date().toISOString(),
      readers,
      metrics,
      errors,
      nextAction,
      safety: {
        ebayReadOnly: true,
        ebayResourceMethods: ["GET", "Trading API read calls"],
        ebayWriteUsed: false,
        listingMutationUsed: false,
        inventoryMutationUsed: false,
        orderMutationUsed: false,
        canPublish: false,
        buyerPiiStored: false,
      },
    }
  } catch (error) {
    const code = safeCode(error, "COMMERCIAL_MONITOR_FAILED")
    errors.push({ reader: "monitor", code, retryable: true })
    await finishRun(
      supabase,
      runId,
      workerId,
      "failed",
      readers,
      {},
      errors,
      "Revisar el fallo terminal y reintentar desde Seller Command Center.",
    ).catch(() => undefined)
    throw new Error(code)
  }
}

export function getCommercialMonitorScheduleConfiguration() {
  const pilot = currentCommercialPreviewPilotConfiguration()
  return {
    enabled: pilot.enabled,
    pilot,
    previewOnly: true,
    currentEnvironment: process.env.VERCEL_ENV ?? "development",
    orderIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_ORDERS_INTERVAL_MINUTES, 5, 5, 1_440),
    messageIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_MESSAGES_INTERVAL_MINUTES, 10, 5, 1_440),
    analyticsIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_ANALYTICS_INTERVAL_MINUTES, 360, 60, 1_440),
    watchersIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_WATCHERS_INTERVAL_MINUTES, 240, 15, 1_440),
    competitorsIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_COMPETITORS_INTERVAL_MINUTES, 1_440, 60, 10_080),
    dailySummaryHourUtc: integer(process.env.EBAY_COMMERCIAL_DAILY_SUMMARY_HOUR_UTC, 14, 0, 23),
    dispatcherIntervalMinutes: integer(process.env.EBAY_COMMERCIAL_DISPATCHER_INTERVAL_MINUTES, 5, 5, 60),
  }
}

async function getCommercialPilotReport(
  supabase: SupabaseClient,
  accountKey: string,
  schedule: ReturnType<typeof getCommercialMonitorScheduleConfiguration>,
  divergenceStatus: string | null,
) {
  const startedAt = schedule.pilot.startedAt
  const expiresAt = schedule.pilot.expiresAt
  if (!startedAt || !expiresAt) return null
  const [runResult, attemptResult, deadLetterResult] = await Promise.all([
    supabase.from("commercial_monitor_runs")
      .select("status,metrics")
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("trigger_source", "schedule")
      .gte("started_at", startedAt)
      .lt("started_at", expiresAt)
      .order("started_at", { ascending: true })
      .limit(500),
    supabase.from("alert_delivery_attempts")
      .select("status,attempt_number,alert_delivery_outbox!inner(marketplace_account_key,marketplace)")
      .eq("alert_delivery_outbox.marketplace_account_key", accountKey)
      .eq("alert_delivery_outbox.marketplace", MARKETPLACE)
      .gte("attempted_at", startedAt)
      .lt("attempted_at", expiresAt)
      .limit(500),
    supabase.from("alert_delivery_outbox")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_account_key", accountKey)
      .eq("marketplace", MARKETPLACE)
      .eq("status", "dead_letter")
      .gte("updated_at", startedAt)
      .lt("updated_at", expiresAt),
  ])
  if (runResult.error || attemptResult.error || deadLetterResult.error) {
    throw new Error("COMMERCIAL_PILOT_REPORT_READ_FAILED")
  }
  return {
    status: schedule.pilot.status,
    startedAt,
    expiresAt,
    ...summarizeCommercialPilotRuns({
      runs: runResult.data ?? [],
      deliveryAttempts: attemptResult.data ?? [],
      deadLetterCount: deadLetterResult.count ?? 0,
      divergenceStatus,
    }),
  }
}

export async function getDueCommercialMonitorLanes(
  supabase: SupabaseClient,
  accountKey: string,
  now = new Date(),
) {
  const schedule = getCommercialMonitorScheduleConfiguration()
  const { data, error } = await supabase
    .from("commercial_monitor_runs")
    .select("started_at,readers")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .in("status", ["completed", "partial"])
    .order("started_at", { ascending: false })
    .limit(READER_HISTORY_LIMIT)
  if (error) throw new Error("COMMERCIAL_MONITOR_SCHEDULE_READ_FAILED")
  const lastByReader = new Map<string, string>()
  const lastAttemptByReader = new Map<string, string>()
  const lastStatusByReader = new Map<string, string>()
  for (const run of data ?? []) {
    const readers = run.readers && typeof run.readers === "object"
      ? run.readers as Record<string, { status?: string }>
      : {}
    for (const name of ["orders", "messages", "analytics", "watchers", "competitors"]) {
      if (
        !lastAttemptByReader.has(name) &&
        readers[name]?.status && readers[name]?.status !== "skipped"
      ) {
        lastAttemptByReader.set(name, run.started_at)
        lastStatusByReader.set(name, readers[name]?.status ?? "")
      }
      if (!lastByReader.has(name) && ["available", "partial", "incomplete"].includes(readers[name]?.status ?? "")) {
        lastByReader.set(name, run.started_at)
      }
    }
  }
  const { data: openDivergences, error: divergenceError } = await supabase
    .from("listing_analytics_source_divergences")
    .select("next_check_at")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("status", "open")
    .limit(500)
  if (divergenceError) throw new Error("COMMERCIAL_ANALYTICS_DIVERGENCE_SCHEDULE_READ_FAILED")
  const lanes: CommercialMonitorLane[] = []
  if (commercialScheduleLaneDue(lastByReader.get("orders"), schedule.orderIntervalMinutes, now)) lanes.push("orders", "rules")
  if (commercialScheduleLaneDue(lastByReader.get("messages"), schedule.messageIntervalMinutes, now)) lanes.push("messages")
  const analyticsDue = commercialScheduleLaneDue(
    lastByReader.get("analytics"),
    schedule.analyticsIntervalMinutes,
    now,
  ) || commercialAnalyticsDivergenceRecheckDue({
    nextCheckAt: (openDivergences ?? []).map((row) => row.next_check_at),
    lastAnalyticsAttemptAt: lastAttemptByReader.get("analytics"),
    now,
  })
  if (analyticsDue) lanes.push("analytics", "rules")
  if (commercialScheduleLaneDue(lastByReader.get("watchers"), schedule.watchersIntervalMinutes, now)) lanes.push("watchers", "rules")
  const competitorRegularlyDue = commercialScheduleLaneDue(
    lastByReader.get("competitors"),
    schedule.competitorsIntervalMinutes,
    now,
  )
  const competitorPartialRetryDue = lastStatusByReader.get("competitors") === "partial" &&
    commercialScheduleLaneDue(
      lastAttemptByReader.get("competitors"),
      COMPETITOR_PARTIAL_RETRY_MINUTES,
      now,
    )
  if (competitorRegularlyDue || competitorPartialRetryDue) lanes.push("competitors")
  const { data: todaySummary } = await supabase
    .from("commercial_daily_summaries")
    .select("id")
    .eq("marketplace_account_key", accountKey)
    .eq("marketplace", MARKETPLACE)
    .eq("summary_day", isoDay(now))
    .maybeSingle()
  if (!todaySummary && now.getUTCHours() >= schedule.dailySummaryHourUtc) {
    lanes.push("orders", "messages", "analytics", "watchers", "competitors", "rules", "daily_summary")
  }
  lanes.push("whatsapp")
  return [...new Set(lanes)]
}

function nextRunAt(lastRun: string | null, minutes: number, now = new Date()) {
  if (!lastRun) return now.toISOString()
  const next = Date.parse(lastRun) + minutes * 60_000
  return new Date(Math.max(now.getTime(), Number.isFinite(next) ? next : now.getTime())).toISOString()
}

export async function getEbayCommercialMonitorDashboard(
  supabase: SupabaseClient,
) {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  const accountKey = accountScope.accountKey
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (!accountKey) return {
    status: "not_configured",
    accountScope: { configured: false, reason: accountScope.reason },
    readersConfiguration: getEbayCommercialReadersConfiguration(),
    schedule,
    latestRun: null,
    health: null,
  }
  const [
    latestRun, latestDryRun, latestPersistentRun, latestCompleted, taskRows,
    outboxRows, divergenceRows, manualEvidenceRows, identityRows,
    schedulerAuthorizationRow, optimizationEventRows, competitorPriceEventRows,
    competitorProfileRows, competitorScanRows,
  ] = await Promise.all([
    supabase.from("commercial_monitor_runs").select("*")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_monitor_runs").select("*")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .eq("trigger_source", "dry_run")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_monitor_runs").select("*")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .neq("trigger_source", "dry_run")
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_monitor_runs").select("started_at,readers")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .in("status", ["completed", "partial"]).order("started_at", { ascending: false }).limit(READER_HISTORY_LIMIT),
    supabase.from("fulfillment_tasks").select("id,status,listing_id,sku,product_title,quantity,ship_by_at,estimated_profit,stock_available,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false }).limit(20),
    supabase.from("alert_delivery_outbox").select("id,status,severity,attempts,last_error_code,due_at,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("created_at", { ascending: false }).limit(100),
    supabase.from("listing_analytics_source_divergences")
      .select("id,listing_id,sku,manual_evidence_id,classification,health_flag,status,official_source,official_metrics,official_window_start,official_window_end,official_last_updated_date,comparison_details,opened_at,last_checked_at,next_check_at,resolved_at,resolution_code,updated_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("updated_at", { ascending: false }).limit(20),
    supabase.from("listing_commercial_manual_evidence")
      .select("id,listing_id,sku,source,entity_scope,impressions_metric,views_metric,transactions_metric,ctr_metric,ctr_unit,window_start,window_end,time_zone,observed_on,impressions,views,transactions,ctr,created_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("observed_on", { ascending: false }).limit(20),
    supabase.from("marketplace_listing_identity_verifications")
      .select("listing_id,expected_sku,observed_listing_id,observed_sku,observed_listing_status,item_id_matches,sku_matches,active_listing_confirmed,source,error_code,observed_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_monitor_scheduler_authorizations")
      .select("authorized_at,expires_at,revoked_at,last_used_at,use_count")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .is("revoked_at", null)
      .order("authorized_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("commercial_alert_events")
      .select("id,event_type,severity,evidence,detected_at,listing_id,sku,recommended_action")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .in("event_type", [...POST_PUBLICATION_OPTIMIZATION_EVENT_TYPES])
      .order("detected_at", { ascending: false }).limit(20),
    supabase.from("commercial_alert_events")
      .select("id,event_type,severity,evidence,detected_at,listing_id,sku,recommended_action")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .eq("event_type", "COMPETITOR_CONFIRMED_SOLD_PRICE_RECOMMENDATION")
      .order("detected_at", { ascending: false }).limit(20),
    supabase.from("ebay_listing_competitor_watch_profiles")
      .select("listing_id,sku,last_scanned_at,baseline_completed_at,latest_active_offer_count,latest_active_seller_count,latest_estimated_activity_seller_count,latest_confirmed_sold_seller_count,latest_median_landed_price,latest_free_shipping_ratio,latest_returns_accepted_ratio,latest_multi_image_ratio,latest_evidence_class,latest_suggestion_codes,latest_suggested_terms,research_refresh_recommended,research_refresh_reason_codes,last_research_refresh_recommended_at")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .eq("status", "ACTIVE").order("last_scanned_at", { ascending: false }).limit(100),
    supabase.from("ebay_listing_competitor_scans")
      .select("listing_id,observed_at,baseline_established,new_offer_count,new_seller_count,potential_seller_count,research_refresh_recommended,evidence_class,suggestion_codes")
      .eq("marketplace_account_key", accountKey).eq("marketplace", MARKETPLACE)
      .order("observed_at", { ascending: false }).limit(100),
  ])
  const firstError = latestRun.error ?? latestDryRun.error ?? latestPersistentRun.error ??
    latestCompleted.error ?? taskRows.error ?? outboxRows.error ?? divergenceRows.error ??
    manualEvidenceRows.error ?? identityRows.error ?? schedulerAuthorizationRow.error ??
    optimizationEventRows.error ?? competitorPriceEventRows.error ??
    competitorProfileRows.error ?? competitorScanRows.error
  if (firstError) throw new Error("COMMERCIAL_MONITOR_DASHBOARD_READ_FAILED")
  const readerLast = new Map<string, string>()
  for (const run of latestCompleted.data ?? []) {
    const readers = run.readers && typeof run.readers === "object"
      ? run.readers as Record<string, { status?: string }>
      : {}
    for (const name of ["orders", "messages", "analytics", "watchers", "competitors"]) {
      if (!readerLast.has(name) && ["available", "partial", "incomplete"].includes(readers[name]?.status ?? "")) {
        readerLast.set(name, run.started_at)
      }
    }
  }
  const outbox = outboxRows.data ?? []
  const tasks = taskRows.data ?? []
  const dryRun = latestDryRun.data
  const persistentRun = latestPersistentRun.data
  const legacySatisfactory = dryRun
    ? isSatisfactoryCommercialDryRun(dryRun, Date.parse(dryRun.completed_at ?? ""))
    : false
  const persistentStarted = Date.parse(persistentRun?.started_at ?? "")
  const dryCompleted = Date.parse(dryRun?.completed_at ?? "")
  const legacyConsumed = Boolean(
    dryRun && persistentRun && !dryRun.dry_run_consumed_at &&
    Number.isFinite(persistentStarted) && Number.isFinite(dryCompleted) &&
    persistentStarted >= dryCompleted && persistentStarted - dryCompleted <= 30 * 60_000
  )
  const lastDryRun = dryRun ? {
    ...dryRun,
    satisfactory: dryRun.dry_run_satisfactory === true || legacySatisfactory,
    consumedAt: dryRun.dry_run_consumed_at ?? (legacyConsumed ? persistentRun?.started_at : null),
    authorizedPersistentRunId: dryRun.authorized_persistent_run_id ??
      (legacyConsumed ? persistentRun?.id : null),
  } : null
  const openDivergences = (divergenceRows.data ?? []).filter((row) => row.status === "open")
  const divergence = openDivergences[0] ?? divergenceRows.data?.[0] ?? null
  const manualEvidence = divergence
    ? (manualEvidenceRows.data ?? []).find((row) => row.id === divergence.manual_evidence_id) ?? null
    : manualEvidenceRows.data?.[0] ?? null
  const identity = identityRows.data ?? null
  const schedulerAuthorization = schedulerAuthorizationRow.data ?? null
  const schedulerAuthorizationExpiresAt = Date.parse(
    schedulerAuthorization?.expires_at ?? "",
  )
  const schedulerAuthorizationActive = Boolean(
    schedulerAuthorization &&
    Number.isFinite(schedulerAuthorizationExpiresAt) &&
    schedulerAuthorizationExpiresAt > Date.now()
  )
  const divergenceOpen = openDivergences.length > 0
  const pilot24h = await getCommercialPilotReport(
    supabase,
    accountKey,
    schedule,
    divergence?.status ?? null,
  )
  return {
    status: latestRun.data?.status ?? "never_run",
    accountScope: { configured: true, accountAlias: accountScope.accountAlias },
    readersConfiguration: getEbayCommercialReadersConfiguration(),
    schedule: {
      ...schedule,
      effectivelyEnabled: schedule.enabled && schedulerAuthorizationActive,
    },
    schedulerAuthorization: schedulerAuthorization ? {
      status: schedulerAuthorizationActive ? "ACTIVE" : "EXPIRED",
      authorizedAt: schedulerAuthorization.authorized_at,
      expiresAt: schedulerAuthorization.expires_at,
      lastUsedAt: schedulerAuthorization.last_used_at,
      useCount: schedulerAuthorization.use_count,
    } : {
      status: "MISSING",
      authorizedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      useCount: 0,
    },
    pilot24h,
    competitorWatch: {
      status: (competitorProfileRows.data ?? []).length ? "ACTIVE" : "WAITING_BASELINE",
      profiles: competitorProfileRows.data ?? [],
      latestScans: competitorScanRows.data ?? [],
      priceRecommendations: (competitorPriceEventRows.data ?? []).map((row) => ({
        id: row.id,
        eventType: row.event_type,
        severity: row.severity,
        listingId: row.listing_id,
        sku: row.sku,
        detectedAt: row.detected_at,
        recommendedAction: row.recommended_action,
        priceRecommendation: jsonRecord(jsonRecord(row.evidence).priceRecommendation),
        status: "AWAITING_HUMAN_APPROVAL",
        changeApplied: false,
        whatsappEnqueued: true,
      })),
      definitions: {
        activeOffer: "Oferta actualmente visible; no demuestra una venta.",
        estimatedActivity: "Señal estimada de eBay; no equivale a venta confirmada.",
        confirmedSoldHistory: "Venta histórica confirmada por una captura oficial de Product Research.",
      },
      automaticActiveSellerDiscovery: true,
      productResearchRefreshIsSelective: true,
      automaticProductResearchImport: false,
      humanReviewRequired: true,
      ebayWrites: 0,
    },
    optimizationTasks: (optimizationEventRows.data ?? []).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      severity: row.severity,
      listingId: row.listing_id,
      sku: row.sku,
      detectedAt: row.detected_at,
      recommendedAction: row.recommended_action,
      evidence: row.evidence,
      status: "AWAITING_HUMAN_APPROVAL",
      changeApplied: false,
      whatsappEnqueued: false,
    })),
    latestRun: latestRun.data ?? null,
    lastDryRun,
    lastPersistentRun: persistentRun ?? null,
    health: {
      fulfillmentTasks: tasks.length,
      pendingManualPurchase: tasks.filter((task) => task.status === "PENDING_MANUAL_PURCHASE").length,
      awaitingTracking: tasks.filter((task) => task.status === "PURCHASED_AWAITING_TRACKING").length,
      alertsPending: outbox.filter((row) => row.status === "pending").length,
      alertsFailed: outbox.filter((row) => row.status === "failed").length,
      alertsDeadLetter: outbox.filter((row) => row.status === "dead_letter").length,
      retries: outbox.reduce((sum, row) => sum + Number(row.attempts ?? 0), 0),
      flags: divergenceOpen ? [ANALYTICS_SOURCE_DIVERGENCE] : [],
      analyticsRulesSuspended: divergenceOpen,
      analyticsRulesSuspendedListingIds: openDivergences.map((row) => row.listing_id),
      continuingLanes: ["orders", "messages", "watchers", "competitors", "stock", "fulfillment", "whatsapp"],
    },
    analyticsSourceDivergence: divergence ? {
      classification: divergence.classification,
      healthFlag: divergenceOpen ? ANALYTICS_SOURCE_DIVERGENCE : null,
      status: divergence.status,
      listingId: divergence.listing_id,
      sku: divergence.sku,
      manualSource: manualEvidence ? {
        source: manualEvidence.source,
        entityScope: manualEvidence.entity_scope,
        impressionsMetric: manualEvidence.impressions_metric,
        viewsMetric: manualEvidence.views_metric,
        transactionsMetric: manualEvidence.transactions_metric,
        ctrMetric: manualEvidence.ctr_metric,
        ctrUnit: manualEvidence.ctr_unit,
        windowStart: manualEvidence.window_start,
        windowEnd: manualEvidence.window_end,
        timeZone: manualEvidence.time_zone,
        observedOn: manualEvidence.observed_on,
        metrics: {
          impressions: numeric(manualEvidence.impressions),
          views: numeric(manualEvidence.views),
          transactions: numeric(manualEvidence.transactions),
          ctr: numeric(manualEvidence.ctr),
        },
      } : null,
      officialSource: {
        source: divergence.official_source,
        impressionsMetric: "TOTAL_IMPRESSION_TOTAL",
        viewsMetric: "LISTING_VIEWS_TOTAL",
        transactionsMetric: "TRANSACTION",
        ctrMetric: "CLICK_THROUGH_RATE",
        ctrUnit: "PERCENT",
        entityScope: "LISTING",
        timeZone: "UTC",
        observedAt: divergence.last_checked_at,
        windowStart: divergence.official_window_start,
        windowEnd: divergence.official_window_end,
        lastUpdatedDate: divergence.official_last_updated_date,
        metrics: divergence.official_metrics,
      },
      openedAt: divergence.opened_at,
      lastCheckedAt: divergence.last_checked_at,
      nextCheckAt: divergence.next_check_at,
      resolvedAt: divergence.resolved_at,
      resolutionCode: divergence.resolution_code,
      comparison: divergence.comparison_details,
      manualEvidenceUsedAsApiMetric: false,
    } : null,
    listingIdentity: identity ? {
      listingId: identity.listing_id,
      expectedSku: identity.expected_sku,
      supplierSku: null,
      observedListingId: identity.observed_listing_id,
      observedSku: identity.observed_sku,
      observedListingStatus: identity.observed_listing_status,
      itemIdMatches: identity.item_id_matches,
      skuMatches: identity.sku_matches,
      activeListingConfirmed: identity.active_listing_confirmed,
      source: identity.source,
      error: identity.error_code,
      observedAt: identity.observed_at,
      salesProcessingBlocked: identity.active_listing_confirmed !== true,
    } : {
      listingId: null,
      supplierSku: null,
      activeListingConfirmed: false,
      salesProcessingBlocked: true,
      error: "COMMERCIAL_LISTING_IDENTITY_NOT_VERIFIED",
    },
    fulfillmentTasks: tasks,
    nextAutomaticRunAt: schedule.enabled && schedulerAuthorizationActive
      ? [
          nextRunAt(readerLast.get("orders") ?? null, schedule.orderIntervalMinutes),
          nextRunAt(readerLast.get("messages") ?? null, schedule.messageIntervalMinutes),
          nextRunAt(readerLast.get("analytics") ?? null, schedule.analyticsIntervalMinutes),
          nextRunAt(readerLast.get("watchers") ?? null, schedule.watchersIntervalMinutes),
          nextRunAt(readerLast.get("competitors") ?? null, schedule.competitorsIntervalMinutes),
        ].sort()[0]
      : null,
    safety: {
      ebayReadOnly: true,
      productionAutomaticMonitorEnabled: false,
      radarOwnsCommercialMonitoring: false,
      buyerPiiReturned: false,
      canPublish: false,
    },
  }
}
