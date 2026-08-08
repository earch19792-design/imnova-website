import type { SupabaseClient } from "@supabase/supabase-js"

import {
  canonicalizeActiveListingProtectionRows,
} from "./ebay-active-listing-protection-domain"
import {
  assertCommercialMonitorAssistantDtoSafe,
  COMMERCIAL_MONITOR_ASSISTANT_OPERATION,
  COMMERCIAL_MONITOR_METRIC_KEYS,
  COMMERCIAL_MONITOR_READONLY_CONTRACT_VERSION,
  createAlertCandidate,
  createCalculatedNumericObservation,
  createDiscoveryCoverage,
  createObservation,
  resolveExperiment,
  resolveProductCaseLink,
  resolveStockEvidence,
  sanitizeMonitorText,
  unavailableObservation,
  unprovenComposition,
  type AlertCandidate,
  type CalculatedNumericObservation,
  type CommercialListingReadModel,
  type CommercialLearningReadModel,
  type CommercialMetricKey,
  type CommercialMetrics,
  type CommercialMonitorGetDto,
  type DataQualityCode,
  type DataQualityIssue,
  type DiscoveryCoverage,
  type EvidenceFreshness,
  type EvidenceReference,
  type InformationalNextAction,
  type ListingEvidenceIdentity,
  type ListingOfferType,
  type MarketplaceContext,
  type Observation,
  type ObservationAvailability,
  type ObservationSource,
  type ReportingWindow,
  type SourceReaderStatus,
  type SupplyEvidence,
  type TimelineEntry,
} from "./commercial-monitor-readonly-contract"
import {
  readCommercialMonitorReadonlySources,
  type CommercialMonitorReadonlySources,
  type ReadonlyCommercialSnapshotRow,
  type ReadonlyIdentityVerificationRow,
  type ReadonlyLearningAdjustmentRow,
  type ReadonlyOrderLineRow,
  type ReadonlyOrderRow,
  type ReadonlyRegistryListingRow,
  type ReadonlySourceResult,
  type ReadonlySyncStateRow,
  type ReadonlySupplySourceRow,
  type ReadonlySupplyRow,
} from "./commercial-monitor-readonly-repository"
import {
  classifyStoredAnalyticsEvidence,
  classifyTargetedLunaSnapshotContract,
  isAuthoritativeReadonlyOrderSource,
  oldestRequiredEvidenceTimestamp,
} from "./commercial-monitor-readonly-utilities.mjs"

type AccountScope = {
  accountKey: string | null
  accountAlias: string | null
  configurationReason?: string | null
}

type ListingProjectionInput = {
  key: string
  row: ReadonlyRegistryListingRow | null
  itemId: string
  ebaySku: string | null
  registryObservations: Array<{
    source: string
    listingStatus: string
    observedAt: string | null
    evidenceReference: string
  }>
  identityVerification: ReadonlyIdentityVerificationRow | null
  registryStatus: "REGISTERED" | "UNREGISTERED_DISCOVERY"
  duplicateIdentity: boolean
}

type TargetedLunaListingCoverage = {
  listingStatus: string | null
  listingUpdatedAt: string | null
  productId: string | null
  supplierVariantId: string | null
  supplierSku: string | null
}

type OrderProjection = {
  orders: Observation<number>
  units: Observation<number>
  revenue: Observation<number>
  matchingPaidOrderCount: number
  stalePotentialOrderCount: number
  untrustedEvidenceCount: number
  evidenceReferences: EvidenceReference[]
}

const METRIC_MAXIMUM_AGE_SECONDS = 48 * 60 * 60
const LUNA_MAXIMUM_AGE_SECONDS = 36 * 60 * 60
const ORDER_MAXIMUM_AGE_SECONDS = 48 * 60 * 60
const ORDER_CALCULATION_VERSION = "OPEN_PAID_UNFULFILLED_ORDER_WINDOW_V1"

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonNegativeNumber(value: unknown) {
  const parsed = numeric(value)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = numeric(value)
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : null
}

function currencyCode(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null
}

function validIso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null
}

function latestIso(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(validIso(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
}

function freshness(
  capturedAt: string | null,
  now: Date,
  maximumAgeSeconds: number,
): EvidenceFreshness {
  const parsed = Date.parse(capturedAt ?? "")
  if (!Number.isFinite(parsed)) {
    return { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds }
  }
  const ageSeconds = Math.floor((now.getTime() - parsed) / 1_000)
  if (ageSeconds < -300) {
    return { status: "UNKNOWN", ageSeconds: null, maximumAgeSeconds }
  }
  return {
    status: ageSeconds <= maximumAgeSeconds ? "FRESH" : "STALE",
    ageSeconds: Math.max(0, ageSeconds),
    maximumAgeSeconds,
  }
}

function firstExplicitText(
  sources: Record<string, unknown>[],
  keys: string[],
  maximum = 120,
) {
  for (const source of sources) {
    for (const key of keys) {
      const value = sanitizeMonitorText(source[key], maximum)
      if (value) return value
    }
  }
  return null
}

function explicitListingFields(row: ReadonlyRegistryListingRow | null) {
  const raw = object(row?.raw_payload)
  const getItem = object(raw.getItemSnapshot)
  const item = object(raw.item)
  const offer = object(raw.offer)
  const product = object(raw.product)
  const sources = [getItem, item, offer, product, raw]
  const variationKey = firstExplicitText(
    sources,
    ["variationId", "variationID", "variationKey"],
    120,
  )
  const listingFormat = firstExplicitText(
    sources,
    ["listingFormat", "listingType", "ListingType"],
    60,
  )
  const rawOfferType = firstExplicitText(
    sources,
    ["compositionType", "offerPackType", "bundleType"],
    40,
  )?.toUpperCase()
  const listingType: ListingOfferType = ["INDIVIDUAL", "PACK", "BUNDLE", "KIT"]
      .includes(rawOfferType ?? "")
    ? rawOfferType as ListingOfferType
    : "UNKNOWN"
  const gtinCandidate = firstExplicitText(
    sources,
    ["gtin", "GTIN", "upc", "UPC", "ean", "EAN", "barcode"],
    24,
  )
  const gtin = gtinCandidate && /^\d{8,14}$/.test(gtinCandidate)
    ? gtinCandidate
    : null
  return {
    variationKey,
    customLabel: firstExplicitText(
      sources,
      ["customLabel", "CustomLabel", "sellerInventoryReference"],
      120,
    ),
    listingFormat,
    listingType,
    startTime: validIso(firstExplicitText(
      sources,
      ["startTime", "listingStartTime", "listing_start_time", "StartTime"],
      50,
    )),
    gtin,
    brand: firstExplicitText(sources, ["brand", "Brand"], 120),
    mpn: firstExplicitText(sources, ["mpn", "MPN", "manufacturerPartNumber"], 120),
  }
}

function trustedTitle(row: ReadonlyRegistryListingRow | null) {
  const value = sanitizeMonitorText(row?.title, 300)
  if (!value || /^eBay listing \d{9,20}$/i.test(value)) return null
  return value
}

function evidence(reference: string, source: string, capturedAt: string | null) {
  return { reference, source, capturedAt } satisfies EvidenceReference
}

function observationSource(
  system: string,
  operation: string,
  evidenceReference: string | null,
) {
  return { system, operation, evidenceReference } satisfies ObservationSource
}

export function metricFromSnapshot(input: {
  snapshot: ReadonlyCommercialSnapshotRow | null
  value: unknown
  key: string
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
}): Observation<number> {
  const snapshot = input.snapshot
  const itemIdentity = {
    itemId: input.identity.itemId,
    variationKey: null,
    sku: null,
  } satisfies ListingEvidenceIdentity
  const source = observationSource(
    "EBAY_SELL_ANALYTICS",
    input.key,
    snapshot ? `LISTING_COMMERCIAL_SNAPSHOT:${snapshot.id}` : null,
  )
  if (!snapshot) {
    return unavailableObservation<number>({
      availability: "UNKNOWN",
      source,
      marketplace: input.marketplace,
      identity: itemIdentity,
      grain: "ITEM",
      limitationCode: "COMMERCIAL_SNAPSHOT_NOT_AVAILABLE",
    })
  }
  const metricFreshness = freshness(
    snapshot.observed_at,
    input.now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  const windowStart = validIso(snapshot.window_start)
  const windowEnd = validIso(snapshot.window_end)
  const reportingWindow = windowStart && windowEnd &&
      Date.parse(windowStart) <= Date.parse(windowEnd)
    ? {
        start: windowStart,
        end: windowEnd,
        timeZone: "UTC",
      } satisfies ReportingWindow
    : null
  const value = nonNegativeNumber(input.value)
  const metadata = object(snapshot.source)
  const analyticsEnvelope = classifyStoredAnalyticsEvidence({
    sourceAnalytics: metadata.analytics,
    syntheticFallbackUsed: metadata.syntheticFallbackUsed,
    fixtureEvidenceUsed: metadata.fixtureEvidenceUsed === true ||
      metadata.testFixture === true || metadata.runtimeFixture === true,
    completenessStatus: snapshot.completeness_status,
    observedAt: snapshot.observed_at,
    windowStart: snapshot.window_start,
    windowEnd: snapshot.window_end,
    now: input.now,
    maximumAgeSeconds: METRIC_MAXIMUM_AGE_SECONDS,
  })
  if (!analyticsEnvelope.usable) {
    return unavailableObservation<number>({
      availability: "INSUFFICIENT_EVIDENCE",
      source,
      capturedAt: snapshot.observed_at,
      marketplace: input.marketplace,
      identity: itemIdentity,
      grain: "ITEM",
      reportingWindow,
      freshness: metricFreshness,
      limitationCode: analyticsEnvelope.limitationCode ??
        "ANALYTICS_EVIDENCE_UNPROVEN",
    })
  }
  const state = {
    availability: analyticsEnvelope.availability as
      "AVAILABLE" | "PARTIAL",
    completeness: analyticsEnvelope.completeness as
      "COMPLETE" | "PARTIAL",
  }
  if (value === null) {
    if (state.availability === "PARTIAL") {
      return createObservation<number>({
        value: null,
        availability: "PARTIAL",
        completeness: "PARTIAL",
        source,
        capturedAt: snapshot.observed_at,
        marketplace: input.marketplace,
        identity: itemIdentity,
        grain: "ITEM",
        reportingWindow,
        freshness: metricFreshness,
        limitationCode: "PARTIAL_REPORTING_WINDOW",
      })
    }
    return unavailableObservation<number>({
      source,
      capturedAt: snapshot.observed_at,
      marketplace: input.marketplace,
      identity: itemIdentity,
      grain: "ITEM",
      reportingWindow,
      freshness: metricFreshness,
      limitationCode: "METRIC_NOT_REPORTED",
    })
  }
  return createObservation<number>({
    value,
    availability: metadata.analyticsRulesSuspended === true
      ? "PARTIAL"
      : state.availability,
    completeness: metadata.analyticsRulesSuspended === true
      ? "PARTIAL"
      : state.completeness,
    source,
    capturedAt: snapshot.observed_at,
    marketplace: input.marketplace,
    identity: itemIdentity,
    grain: "ITEM",
    reportingWindow,
    unit: input.key.includes("RATE") || input.key.includes("CTR")
      ? "PERCENT"
      : "COUNT",
    freshness: metricFreshness,
    limitationCode: metadata.analyticsRulesSuspended === true
      ? "ANALYTICS_SOURCE_DIVERGENCE"
      : state.availability === "PARTIAL"
        ? "PARTIAL_REPORTING_WINDOW"
        : null,
    explicitAuthoritativeZero: value === 0,
  })
}

function unavailableMetric(input: {
  key: CommercialMetricKey
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  limitationCode: string
  availability?: "UNAVAILABLE" | "UNKNOWN" | "ERROR" |
    "MISSING" | "INSUFFICIENT_EVIDENCE"
  grain?: "ITEM" | "VARIATION" | "COMPONENT"
}) {
  return unavailableObservation<number>({
    availability: input.availability,
    source: observationSource(
      "SELLER_OS",
      `COMMERCIAL_METRIC_${input.key.toUpperCase()}`,
      null,
    ),
    marketplace: input.marketplace,
    identity: input.identity,
    grain: input.grain ?? "ITEM",
    limitationCode: input.limitationCode,
  })
}

function listingPriceMetric(input: {
  row: ReadonlyRegistryListingRow | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
}) {
  const value = nonNegativeNumber(input.row?.ebay_price)
  const currency = currencyCode(input.row?.currency)
  const source = observationSource(
    "EBAY_ACTIVE_LISTING_REGISTRY",
    "LISTING_PRICE",
    input.row ? `EBAY_ACTIVE_LISTING:${input.row.id}` : null,
  )
  if (value === null || !input.row) {
    return unavailableObservation<number>({
      availability: "UNKNOWN",
      source,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: input.identity.variationKey ? "VARIATION" : "ITEM",
      unit: currency,
      limitationCode: "LISTING_PRICE_NOT_REPORTED",
    })
  }
  const authoritativeSource = [
    "EBAY_SELL_INVENTORY_READONLY",
    "EBAY_TRADING_GET_ITEM_READONLY",
  ].includes(input.row.source)
  const capturedAt = validIso(input.row.last_ebay_sync_at)
  const priceFreshness = freshness(
    capturedAt,
    input.now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  if (!authoritativeSource || !capturedAt || priceFreshness.status === "UNKNOWN") {
    return unavailableObservation<number>({
      availability: "INSUFFICIENT_EVIDENCE",
      source,
      capturedAt,
      marketplace: input.marketplace,
      identity: input.identity,
      grain: input.identity.variationKey ? "VARIATION" : "ITEM",
      unit: currency,
      freshness: priceFreshness,
      limitationCode: !authoritativeSource
        ? "LISTING_PRICE_SOURCE_PROVENANCE_UNAVAILABLE"
        : "LISTING_PRICE_CAPTURE_TIMESTAMP_UNPROVEN",
    })
  }
  return createObservation<number>({
    value,
    availability: currency ? "AVAILABLE" : "PARTIAL",
    completeness: currency ? "COMPLETE" : "PARTIAL",
    source,
    capturedAt,
    marketplace: input.marketplace,
    identity: input.identity,
    grain: input.identity.variationKey ? "VARIATION" : "ITEM",
    reportingWindow: null,
    unit: currency,
    freshness: priceFreshness,
    limitationCode: currency ? null : "LISTING_PRICE_CURRENCY_UNPROVEN",
    explicitAuthoritativeZero: value === 0,
  })
}

function watcherMetric(input: {
  snapshot: ReadonlyCommercialSnapshotRow | null
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
}) {
  const itemIdentity = {
    itemId: input.identity.itemId,
    variationKey: null,
    sku: null,
  } satisfies ListingEvidenceIdentity
  const metadata = object(input.snapshot?.source)
  const source = observationSource(
    "EBAY_TRADING_GET_ITEM",
    "WATCH_COUNT",
    input.snapshot ? `LISTING_COMMERCIAL_SNAPSHOT:${input.snapshot.id}` : null,
  )
  const value = nonNegativeInteger(input.snapshot?.current_watchers)
  const capturedAt = validIso(input.snapshot?.observed_at)
  const watcherFreshness = freshness(
    capturedAt,
    input.now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  if (!input.snapshot || metadata.watchersValueAvailable !== true ||
      metadata.watchers !== "EBAY_TRADING_GET_ITEM_WATCHCOUNT" ||
      value === null || !capturedAt || watcherFreshness.status === "UNKNOWN") {
    return unavailableObservation<number>({
      availability: "INSUFFICIENT_EVIDENCE",
      source,
      capturedAt,
      marketplace: input.marketplace,
      identity: itemIdentity,
      grain: "ITEM",
      unit: "COUNT",
      freshness: watcherFreshness,
      limitationCode: metadata.watchersValueAvailable !== true || value === null
        ? "WATCH_COUNT_FIELD_PRESENCE_UNPROVEN"
        : metadata.watchers !== "EBAY_TRADING_GET_ITEM_WATCHCOUNT"
          ? "WATCH_COUNT_SOURCE_PROVENANCE_UNAVAILABLE"
          : "WATCH_COUNT_CAPTURE_TIMESTAMP_UNPROVEN",
    })
  }
  return createObservation<number>({
    value,
    availability: "AVAILABLE",
    completeness: "COMPLETE",
    source,
    capturedAt,
    marketplace: input.marketplace,
    identity: itemIdentity,
    grain: "ITEM",
    reportingWindow: null,
    unit: "COUNT",
    freshness: watcherFreshness,
    limitationCode: "WATCHERS_ARE_INTEREST_NOT_SALES",
    explicitAuthoritativeZero: value === 0,
  })
}

export function orderProjection(input: {
  itemId: string
  sku: string | null
  ordersResult: ReadonlySourceResult<ReadonlyOrderRow>
  linesResult: ReadonlySourceResult<ReadonlyOrderLineRow>
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
}) : OrderProjection {
  const source = observationSource(
    "EBAY_SELL_FULFILLMENT",
    "STORED_PAID_UNFULFILLED_ORDER_WINDOW",
    null,
  )
  const unavailable = (key: "orders" | "units_sold" | "revenue") =>
    unavailableMetric({
      key,
      marketplace: input.marketplace,
      identity: input.identity,
      availability: input.ordersResult.status === "ERROR" ||
          input.linesResult.status === "ERROR"
        ? "ERROR"
        : "INSUFFICIENT_EVIDENCE",
      limitationCode: input.ordersResult.status === "ERROR" ||
          input.linesResult.status === "ERROR"
        ? "ORDER_READ_MODEL_ERROR"
        : "OPEN_ORDER_WINDOW_DOES_NOT_PROVE_ZERO",
      grain: input.sku ? "VARIATION" : "ITEM",
    })
  if (input.ordersResult.status === "ERROR" || input.linesResult.status === "ERROR") {
    return {
      orders: unavailable("orders"),
      units: unavailable("units_sold"),
      revenue: unavailable("revenue"),
      matchingPaidOrderCount: 0,
      stalePotentialOrderCount: 0,
      untrustedEvidenceCount: 0,
      evidenceReferences: [],
    }
  }
  const relevantOrderRows = input.ordersResult.rows.filter((order) =>
    order.payment_status.toUpperCase() === "PAID" &&
      ["NOT_STARTED", "IN_PROGRESS"].includes(order.fulfillment_status.toUpperCase()))
  const relevantLineRows = input.linesResult.rows.filter((line) =>
    line.listing_id === input.itemId && (!input.sku || line.sku === input.sku))
  const untrustedEvidenceCount = relevantOrderRows.filter((order) =>
    !isAuthoritativeReadonlyOrderSource(order.source)).length +
    relevantLineRows.filter((line) =>
      !isAuthoritativeReadonlyOrderSource(line.source)).length
  const candidatePaidOrders = relevantOrderRows.filter((order) =>
    isAuthoritativeReadonlyOrderSource(order.source))
  const freshPaidOrders = candidatePaidOrders.filter((order) =>
    freshness(order.observed_at, input.now, ORDER_MAXIMUM_AGE_SECONDS).status === "FRESH")
  const openPaidOrders = new Map(freshPaidOrders
    .map((order) => [order.marketplace_order_id, order]))
  const staleOrderIds = new Set(candidatePaidOrders
    .filter((order) => !openPaidOrders.has(order.marketplace_order_id))
    .map((order) => order.marketplace_order_id))
  const authoritativeLineRows = relevantLineRows.filter((line) =>
    isAuthoritativeReadonlyOrderSource(line.source))
  const freshLineRows = authoritativeLineRows.filter((line) =>
    freshness(line.last_observed_at, input.now, ORDER_MAXIMUM_AGE_SECONDS)
      .status === "FRESH")
  const candidateOrderIds = new Set(candidatePaidOrders
    .map((order) => order.marketplace_order_id))
  const stalePotentialOrderCount = new Set([
    ...authoritativeLineRows.filter((line) =>
      staleOrderIds.has(line.marketplace_order_id) &&
      (!input.sku || line.sku === input.sku))
      .map((line) => line.marketplace_order_id),
    ...authoritativeLineRows.filter((line) =>
      candidateOrderIds.has(line.marketplace_order_id) &&
      freshness(line.last_observed_at, input.now, ORDER_MAXIMUM_AGE_SECONDS)
        .status !== "FRESH")
      .map((line) => line.marketplace_order_id),
  ]).size
  const lines = freshLineRows.filter((line) =>
    openPaidOrders.has(line.marketplace_order_id) &&
    (!input.sku || line.sku === input.sku)
  )
  const orderIds = [...new Set(lines.map((line) => line.marketplace_order_id))]
  if (!orderIds.length) {
    return {
      orders: unavailable("orders"),
      units: unavailable("units_sold"),
      revenue: unavailable("revenue"),
      matchingPaidOrderCount: 0,
      stalePotentialOrderCount,
      untrustedEvidenceCount,
      evidenceReferences: [],
    }
  }
  const quantities = lines.map((line) => nonNegativeInteger(line.quantity))
  const amounts = lines.map((line) => nonNegativeNumber(line.line_item_amount))
  const lineEvidenceReferences = lines.map((line) => evidence(
    `MARKETPLACE_ORDER_LINE:${line.marketplace_order_id}:${line.marketplace_line_item_id}`,
    "SANITIZED_ORDER_LINE_ITEMS",
    line.last_observed_at,
  ))
  const orderEvidenceReferences = orderIds.flatMap((orderId) => {
    const order = openPaidOrders.get(orderId)
    return order ? [evidence(
      `MARKETPLACE_ORDER_SNAPSHOT:${order.marketplace_order_id}`,
      "SANITIZED_ORDER_SNAPSHOTS",
      order.observed_at,
    )] : []
  })
  const evidenceReferences = [
    ...orderEvidenceReferences,
    ...lineEvidenceReferences,
  ]
  const timestamps = lines.map((line) => line.last_observed_at)
  const created = orderIds
    .map((orderId) => openPaidOrders.get(orderId)?.order_created_at ?? null)
    .filter((value): value is string => Boolean(validIso(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))
  const reportingWindow = created.length && timestamps.length
    ? {
        start: created[0],
        end: latestIso(timestamps) as string,
        timeZone: "UTC",
      } satisfies ReportingWindow
    : null
  const requiredEvidenceTimestamps = [
    ...timestamps,
    ...orderIds.map((orderId) =>
      openPaidOrders.get(orderId)?.observed_at ?? null),
  ]
  const capturedAt = oldestRequiredEvidenceTimestamp(
    ...requiredEvidenceTimestamps,
  )
  const orderFreshness = freshness(
    capturedAt,
    input.now,
    ORDER_MAXIMUM_AGE_SECONDS,
  )
  const orderCalculationInputs = orderIds.flatMap((orderId, index) => {
    const order = openPaidOrders.get(orderId)
    return order ? [{
      name: `paid_unfulfilled_order_${index + 1}`,
      value: 1,
      unit: "ORDER",
      source: {
        system: "EBAY_SELL_FULFILLMENT",
        operation: "PAID_UNFULFILLED_ORDER_MEMBERSHIP",
        evidenceReference: `MARKETPLACE_ORDER_SNAPSHOT:${orderId}`,
      },
      capturedAt: order.observed_at,
    }] : []
  })
  const unitCalculationInputs = lines.flatMap((line, index) => {
    const value = quantities[index]
    return value === null ? [] : [{
      name: `order_line_quantity_${index + 1}`,
      value,
      unit: "UNIT",
      source: {
        system: "EBAY_SELL_FULFILLMENT",
        operation: "ORDER_LINE_QUANTITY",
        evidenceReference:
          `MARKETPLACE_ORDER_LINE:${line.marketplace_order_id}:${line.marketplace_line_item_id}`,
      },
      capturedAt: line.last_observed_at,
    }]
  })
  const revenueCalculationInputs = lines.flatMap((line, index) => {
    const value = amounts[index]
    const unit = currencyCode(line.currency)
    return value === null || !unit ? [] : [{
      name: `order_line_amount_${index + 1}`,
      value,
      unit,
      source: {
        system: "EBAY_SELL_FULFILLMENT",
        operation: "ORDER_LINE_AMOUNT",
        evidenceReference:
          `MARKETPLACE_ORDER_LINE:${line.marketplace_order_id}:${line.marketplace_line_item_id}`,
      },
      capturedAt: line.last_observed_at,
    }]
  })
  const partialNumber = (
    value: number,
    operation: string,
    unit: string | null,
    formula: string,
    calculationInputs: CalculatedNumericObservation["calculation"]["inputs"],
  ) => createCalculatedNumericObservation(
    createObservation<number>({
        value,
        unit,
        availability: "PARTIAL",
        completeness: "PARTIAL",
        source: {
          ...source,
          operation,
          evidenceReference: evidenceReferences[0]?.reference ?? null,
        },
        capturedAt,
        marketplace: input.marketplace,
        identity: input.identity,
        grain: input.sku ? "VARIATION" : "ITEM",
        reportingWindow,
        freshness: orderFreshness,
        limitationCode: "OPEN_PAID_UNFULFILLED_ORDER_WINDOW_ONLY",
        explicitAuthoritativeZero: value === 0,
      }), {
      formula,
      version: ORDER_CALCULATION_VERSION,
      inputEvidenceReferences: evidenceReferences.map((entry) => entry.reference),
      inputs: calculationInputs,
    },
  )
  if (!reportingWindow || !capturedAt) {
    return {
      orders: unavailable("orders"),
      units: unavailable("units_sold"),
      revenue: unavailable("revenue"),
      matchingPaidOrderCount: orderIds.length,
      stalePotentialOrderCount,
      untrustedEvidenceCount,
      evidenceReferences,
    }
  }
  const units = quantities.every((value): value is number => value !== null)
    ? partialNumber(
        quantities.reduce((total, value) => total + value, 0),
        "OPEN_ORDER_UNITS",
        "UNIT",
        "SUM(marketplace_order_line_items.quantity)",
        unitCalculationInputs,
      )
    : unavailable("units_sold")
  const currencies = new Set(lines.map((line) => line.currency).filter(Boolean))
  const revenue = amounts.every((value): value is number => value !== null) &&
      currencies.size === 1 && currencyCode([...currencies][0]) !== null
    ? partialNumber(
        amounts.reduce((total, value) => total + value, 0),
        "OPEN_ORDER_REVENUE",
        currencyCode([...currencies][0]),
        "SUM(marketplace_order_line_items.line_item_amount)",
        revenueCalculationInputs,
      )
    : unavailable("revenue")
  return {
    orders: partialNumber(
      orderIds.length,
      "OPEN_ORDER_COUNT",
      "COUNT",
      "COUNT(DISTINCT marketplace_order_id)",
      orderCalculationInputs,
    ),
    units,
    revenue,
    matchingPaidOrderCount: orderIds.length,
    stalePotentialOrderCount,
    untrustedEvidenceCount,
    evidenceReferences,
  }
}

function emptyMetrics(input: {
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
}) {
  return Object.fromEntries(COMMERCIAL_MONITOR_METRIC_KEYS.map((key) => [
    key,
    unavailableMetric({
      key,
      marketplace: input.marketplace,
      identity: input.identity,
      limitationCode: "AUTHORITATIVE_METRIC_SOURCE_UNAVAILABLE",
    }),
  ])) as CommercialMetrics
}

function buildMetrics(input: {
  row: ReadonlyRegistryListingRow | null
  snapshot: ReadonlyCommercialSnapshotRow | null
  stock: ReturnType<typeof resolveStockEvidence>
  orderProjection: OrderProjection
  marketplace: MarketplaceContext
  identity: ListingEvidenceIdentity
  now: Date
}) {
  const metrics = emptyMetrics(input)
  const itemMetricIdentity = {
    itemId: input.identity.itemId,
    variationKey: null,
    sku: null,
  } satisfies ListingEvidenceIdentity
  metrics.listing_price = listingPriceMetric(input)
  metrics.impressions = metricFromSnapshot({
    ...input,
    value: input.snapshot?.impressions,
    key: "TOTAL_IMPRESSION_TOTAL",
  })
  metrics.ebay_views = metricFromSnapshot({
    ...input,
    value: input.snapshot?.views,
    key: "LISTING_VIEWS_TOTAL",
  })
  metrics.ctr_reported = unavailableMetric({
    key: "ctr_reported",
    marketplace: input.marketplace,
    identity: itemMetricIdentity,
    limitationCode: "CTR_REPORTED_ORIGIN_NOT_PERSISTED",
    availability: "INSUFFICIENT_EVIDENCE",
  })
  metrics.transactions = metricFromSnapshot({
    ...input,
    value: input.snapshot?.transactions,
    key: "TRANSACTION",
  })
  metrics.conversion = unavailableMetric({
    key: "conversion",
    marketplace: input.marketplace,
    identity: itemMetricIdentity,
    limitationCode: "CONVERSION_FORMULA_INPUTS_NOT_PERSISTED",
    availability: "INSUFFICIENT_EVIDENCE",
  })
  metrics.watchers = watcherMetric(input)
  metrics.orders = input.orderProjection.orders
  metrics.units_sold = input.orderProjection.units
  metrics.revenue = input.orderProjection.revenue
  metrics.supplier_cost = input.stock.currentSupplierCost
  metrics.external_views = unavailableMetric({
    key: "external_views",
    marketplace: input.marketplace,
    identity: itemMetricIdentity,
    limitationCode: "EXTERNAL_VIEWS_READER_UNAVAILABLE",
  })
  metrics.ctr_calculated = unavailableMetric({
    key: "ctr_calculated",
    marketplace: input.marketplace,
    identity: itemMetricIdentity,
    limitationCode: "CTR_FORMULA_INPUTS_AND_ORIGIN_NOT_PERSISTED",
    availability: "INSUFFICIENT_EVIDENCE",
  })
  for (const key of [
    "fees",
    "promoted_fees",
    "shipping",
    "contribution",
    "net_profit",
    "margin",
    "roi",
  ] as const) {
    metrics[key] = unavailableMetric({
      key,
      marketplace: input.marketplace,
      identity: input.identity,
      limitationCode: "ECONOMICS_INPUT_PROVENANCE_INCOMPLETE",
      availability: "INSUFFICIENT_EVIDENCE",
    })
  }
  return metrics
}

function issue(input: {
  code: DataQualityCode
  domain: DataQualityIssue["domain"]
  severity: DataQualityIssue["severity"]
  blocking: boolean
  source: string
  evidenceReferences?: string[]
  detectedAt: string
}) : DataQualityIssue {
  return {
    ...input,
    evidenceReferences: input.evidenceReferences ?? [],
    sanitizedReasonCode: input.code,
  }
}

function uniqueIssues(issues: DataQualityIssue[]) {
  return [...new Map(issues.map((entry) => [
    `${entry.code}:${entry.source}:${entry.evidenceReferences.join("|")}`,
    entry,
  ])).values()]
}

function nextAction(
  issues: DataQualityIssue[],
  experiment: ReturnType<typeof resolveExperiment>,
): InformationalNextAction {
  if (experiment.status === "AVAILABLE" &&
      experiment.lifecycleState === "RUNNING") return "NO_TOCAR"
  const codes = new Set(issues.map((entry) => entry.code))
  if (codes.has("REGISTRY_RECONCILIATION_FAILED")) {
    return "RECONCILE_LISTING_REGISTRY"
  }
  if (codes.has("PRODUCT_CASE_LINK_MISSING") ||
      codes.has("PRODUCT_CASE_LINK_UNPROVEN")) {
    return "REVIEW_PRODUCT_CASE_LINK"
  }
  if (codes.has("MISSING_COMPOSITION") ||
      codes.has("COMPOSITION_UNPROVEN") ||
      codes.has("UNKNOWN_SHARED_ALLOCATION")) return "CONFIRM_COMPOSITION"
  if (codes.has("STALE_SUPPLIER_EVIDENCE") ||
      codes.has("SUPPLIER_IDENTITY_CONFLICT") ||
      codes.has("SOURCE_FORMAT_CHANGED")) return "REVIEW_STOCK_EVIDENCE"
  if (codes.has("PARTIAL_REPORTING_WINDOW") ||
      codes.has("METRIC_GRAIN_MISMATCH") ||
      codes.has("SOURCE_UNAVAILABLE")) return "REVIEW_METRIC_COVERAGE"
  if (codes.has("ECONOMICS_INCOMPLETE")) return "REVIEW_ECONOMICS_INPUTS"
  return issues.some((entry) => entry.blocking) ? "HUMAN_REVIEW_ONLY" : "NONE"
}

function sourceResultIssue(
  result: ReadonlySourceResult<unknown>,
  detectedAt: string,
) {
  if (result.status === "AVAILABLE") return null
  return issue({
    code: result.status === "ERROR" ? "COLLECTOR_ERROR" : "SOURCE_UNAVAILABLE",
    domain: "COLLECTOR",
    severity: result.status === "ERROR" ? "HIGH" : "MEDIUM",
    blocking: result.status === "ERROR",
    source: result.source,
    detectedAt,
  })
}

function latestSnapshot(
  sources: CommercialMonitorReadonlySources,
  itemId: string,
  ebaySku: string | null,
  supplierSku: string | null,
  itemIdentityCount: number,
) {
  const rows = sources.commercialSnapshots.rows
    .filter((row) => row.listing_id === itemId)
  const exact = rows.find((row) => Boolean(
    row.sku && (row.sku === ebaySku || row.sku === supplierSku)
  ))
  return exact ?? (itemIdentityCount === 1 ? rows[0] ?? null : null)
}

export function supplyEvidence(
  rows: ReadonlySupplyRow[],
  sourceResult: ReadonlySourceResult<ReadonlySupplySourceRow>,
  syncResult: ReadonlySourceResult<ReadonlySyncStateRow>,
  now: Date,
  listingCoverage: TargetedLunaListingCoverage,
) : SupplyEvidence[] {
  const sourceRows = sourceResult.rows.filter((row) => row.key === "lunaportex")
  const sourceHealth = sourceRows.length === 1 ? sourceRows[0] : null
  const syncState = syncResult.rows.length === 1 ? syncResult.rows[0] : null
  return rows.map((row) => {
    const rawPricePresent = row.price !== null && row.price !== ""
    const rawQuantityPresent = row.inventory_quantity !== null &&
      row.inventory_quantity !== ""
    const price = nonNegativeNumber(row.price)
    const inventoryQuantity = nonNegativeInteger(row.inventory_quantity)
    const numericParseFailed = (rawPricePresent && price === null) ||
      (rawQuantityPresent && inventoryQuantity === null)
    const contract = classifyTargetedLunaSnapshotContract({
      sourceStatus: sourceResult.status,
      syncStatus: syncResult.status,
      sourceActive: sourceHealth?.is_active,
      targetedSuccessAt: syncState?.targeted_luna_last_success_at,
      targetedErrorAt: syncState?.targeted_luna_last_error_at,
      targetedRunId: syncState?.targeted_luna_last_success_run_id,
      listingStatus: listingCoverage.listingStatus,
      listingUpdatedAt: listingCoverage.listingUpdatedAt,
      snapshotCapturedAt: row.captured_at,
      identityExact: row.product_id === listingCoverage.productId &&
        row.supplier_variant_id === listingCoverage.supplierVariantId &&
        row.sku === listingCoverage.supplierSku,
      now,
      maximumAgeSeconds: LUNA_MAXIMUM_AGE_SECONDS,
    })
    return {
      productId: row.product_id,
      supplierVariantId: row.supplier_variant_id,
      sku: row.sku,
      sourceKey: row.source_key,
      snapshotId: row.snapshot_id,
      available: row.available,
      inventoryQuantity,
      price,
      capturedAt: row.captured_at,
      parserHealth: numericParseFailed
        ? "PARSER_ERROR"
        : contract.status,
      sourceContractReference: contract.reference,
      sourceContractCapturedAt: contract.capturedAt,
    }
  })
}

function listingAlerts(input: {
  model: CommercialListingReadModel
  accountScopeKey: string
  orderProjection: OrderProjection
  listedQuantity: number | null
}) {
  const listing = input.model
  const common = {
    accountScopeKey: input.accountScopeKey,
    marketplace: listing.identity.marketplace,
    itemId: listing.identity.itemId,
    variationKey: listing.identity.variationKey,
    sku: listing.identity.sku,
  }
  const alerts: AlertCandidate[] = []
  const stockEvidence = listing.stock.evidenceReferences
  if (listing.stock.state === "OUT_OF_STOCK_SIGNAL" && stockEvidence.length) {
    alerts.push(createAlertCandidate({
      ...common,
      componentReference: listing.stock.supplierVariantId ? {
        componentId: listing.stock.supplierVariantId,
        sku: listing.stock.supplierSku,
      } : null,
      reasonCode: "COMPONENT_OUT_OF_STOCK_CONFIRMED",
      severity: "CRITICAL",
      supportingEvidence: stockEvidence,
      freshness: {
        status: listing.stock.freshness.status,
        capturedAt: stockEvidence[0]?.capturedAt ?? null,
      },
      recommendedHumanDestination: "SELLER_OS_MONITOR",
    }))
  }
  if (input.orderProjection.matchingPaidOrderCount > 0 &&
      listing.stock.state !== "IN_STOCK_SIGNAL") {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "PAID_ORDER_STOCK_RISK",
      severity: listing.stock.state === "OUT_OF_STOCK_SIGNAL" ? "CRITICAL" : "HIGH",
      supportingEvidence: [
        ...stockEvidence,
        ...input.orderProjection.evidenceReferences,
      ],
      freshness: {
        status: listing.stock.freshness.status,
        capturedAt: stockEvidence[0]?.capturedAt ?? null,
      },
      recommendedHumanDestination: "SELLER_OS_ORDERS",
    }))
  }
  const stockQuantity = listing.stock.quantity
  if (listing.stock.state === "STALE" || (
    stockQuantity.availability === "AVAILABLE" &&
    stockQuantity.value !== null &&
    stockQuantity.value > 0 &&
    stockQuantity.value <= 3
  )) {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "STOCK_STALE_OR_LOW",
      severity: "MEDIUM",
      supportingEvidence: stockEvidence,
      freshness: {
        status: listing.stock.freshness.status,
        capturedAt: stockEvidence[0]?.capturedAt ?? null,
      },
      recommendedHumanDestination: "SELLER_OS_MONITOR",
    }))
  }
  const compositionEvidence = listing.composition.components
    .flatMap((component) => component.evidenceReferences)
  if (compositionEvidence.length > 0 &&
      listing.composition.bundleCapacity.availability === "AVAILABLE" &&
      listing.composition.bundleCapacity.value !== null &&
      input.listedQuantity !== null &&
      input.listedQuantity > listing.composition.bundleCapacity.value) {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "OVERSELL_RISK",
      severity: "CRITICAL",
      supportingEvidence: compositionEvidence,
      freshness: { status: "UNKNOWN", capturedAt: null },
      recommendedHumanDestination: "SELLER_OS_ORDERS",
    }))
  }
  if (listing.discovery.registryStatus === "UNREGISTERED_DISCOVERY" ||
      listing.composition.status === "CONFLICTED") {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "LISTING_COMPOSITION_INTEGRITY_MISMATCH",
      severity: "HIGH",
      supportingEvidence: listing.evidenceReferences,
      freshness: {
        status: "UNKNOWN",
        capturedAt: listing.identity.lastObservedAt,
      },
      recommendedHumanDestination: "PRODUCT_CASE_REVIEW",
    }))
  }
  const impressions = listing.metrics.impressions
  const ctr = listing.metrics.ctr_reported
  if (impressions.availability === "AVAILABLE" &&
      impressions.completeness === "COMPLETE" &&
      impressions.freshness.status === "FRESH" &&
      impressions.value !== null && impressions.value >= 100 &&
      ctr.availability === "AVAILABLE" &&
      ctr.completeness === "COMPLETE" &&
      ctr.freshness.status === "FRESH" &&
      ctr.value !== null && ctr.value < 1.5) {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "HIGH_IMPRESSIONS_LOW_CTR_CHECKPOINT",
      severity: "MEDIUM",
      supportingEvidence: listing.evidenceReferences.filter((entry) =>
        entry.reference.startsWith("LISTING_COMMERCIAL_SNAPSHOT:")),
      freshness: {
        status: impressions.freshness.status,
        capturedAt: impressions.capturedAt,
      },
      recommendedHumanDestination: "EXPERIMENT_REVIEW",
    }))
  }
  if (listing.experiment.status === "AVAILABLE" &&
      listing.experiment.checkpointGate) {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "EXPERIMENT_CHECKPOINT_OR_COMPLETION",
      severity: "LOW",
      supportingEvidence: [listing.experiment.source],
      freshness: {
        status: "UNKNOWN",
        capturedAt: listing.experiment.evidenceTimestamp,
      },
      recommendedHumanDestination: "EXPERIMENT_REVIEW",
    }))
  }
  if (listing.discovery.coverage.status !== "COMPLETE" ||
      listing.dataQualityIssues.some((entry) =>
        entry.code === "COLLECTOR_ERROR" ||
        entry.code === "REGISTRY_RECONCILIATION_FAILED")) {
    alerts.push(createAlertCandidate({
      ...common,
      reasonCode: "DATA_COVERAGE_FAILURE",
      severity: "HIGH",
      supportingEvidence: listing.evidenceReferences,
      freshness: {
        status: "UNKNOWN",
        capturedAt: listing.identity.lastObservedAt,
      },
      recommendedHumanDestination: "SELLER_OS_MONITOR",
    }))
  }
  return [...new Map(alerts.map((alert) => [alert.eventKey, alert])).values()]
}

function projectListing(input: {
  listing: ListingProjectionInput
  sources: CommercialMonitorReadonlySources
  marketplace: MarketplaceContext
  discoveryCoverage: DiscoveryCoverage
  itemIdentityCount: number
  accountScopeKey: string
  generatedAt: string
  now: Date
}) {
  const { listing } = input
  const row = listing.row
  const rawFields = explicitListingFields(row)
  const identityEvidence: ListingEvidenceIdentity = {
    itemId: listing.itemId,
    variationKey: rawFields.variationKey,
    sku: listing.ebaySku,
  }
  const snapshot = latestSnapshot(
    input.sources,
    listing.itemId,
    listing.ebaySku,
    row?.supplier_sku ?? null,
    input.itemIdentityCount,
  )
  const supplies = supplyEvidence(
    input.sources.supplies.rows,
    input.sources.supplySources,
    input.sources.syncState,
    input.now,
    {
      listingStatus: row?.listing_status ?? null,
      listingUpdatedAt: row?.updated_at ?? null,
      productId: row?.market_radar_product_id ?? null,
      supplierVariantId: row?.supplier_variant_id ?? null,
      supplierSku: row?.supplier_sku ?? null,
    },
  )
  const stock = resolveStockEvidence({
    productId: row?.market_radar_product_id ?? null,
    supplierVariantId: row?.supplier_variant_id ?? null,
    supplierSku: row?.supplier_sku ?? null,
    supplies,
    marketplace: input.marketplace,
    identity: identityEvidence,
    now: input.now,
    maximumAgeSeconds: LUNA_MAXIMUM_AGE_SECONDS,
  })
  const composition = unprovenComposition({
    marketplace: input.marketplace,
    identity: identityEvidence,
    listingType: rawFields.listingType,
  })
  const productCase = resolveProductCaseLink()
  const experiment = resolveExperiment()
  const orders = orderProjection({
    itemId: listing.itemId,
    sku: listing.ebaySku,
    ordersResult: input.sources.orders,
    linesResult: input.sources.orderLines,
    marketplace: input.marketplace,
    identity: identityEvidence,
    now: input.now,
  })
  const metrics = buildMetrics({
    row,
    snapshot,
    stock,
    orderProjection: orders,
    marketplace: input.marketplace,
    identity: identityEvidence,
    now: input.now,
  })
  const listingEvidence = listing.registryObservations.map((entry) => evidence(
    entry.evidenceReference,
    entry.source,
    entry.observedAt,
  ))
  if (listing.identityVerification) {
    listingEvidence.push(evidence(
      `LISTING_IDENTITY_VERIFICATION:${listing.identityVerification.id}`,
      listing.identityVerification.source,
      listing.identityVerification.observed_at,
    ))
  }
  if (snapshot) {
    listingEvidence.push(evidence(
      `LISTING_COMMERCIAL_SNAPSHOT:${snapshot.id}`,
      "COMMERCIAL_SNAPSHOT_REGISTRY",
      snapshot.observed_at,
    ))
  }
  listingEvidence.push(...stock.evidenceReferences, ...orders.evidenceReferences)
  const lastObservedAt = latestIso([
    row?.last_ebay_sync_at,
    listing.identityVerification?.observed_at,
  ])
  const identityFreshness = freshness(
    lastObservedAt,
    input.now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  const discoveryObservations = listing.registryObservations.map((entry) => ({
    ...entry,
    source: sanitizeMonitorText(entry.source, 100) ?? "UNKNOWN",
    freshness: freshness(
      entry.observedAt,
      input.now,
      METRIC_MAXIMUM_AGE_SECONDS,
    ),
  }))
  const issues: DataQualityIssue[] = [
    issue({
      code: "LISTING_DISCOVERY_INCOMPLETE",
      domain: "DISCOVERY",
      severity: "MEDIUM",
      blocking: false,
      source: "EBAY_ACTIVE_LISTING_REGISTRY",
      evidenceReferences: listingEvidence.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }),
    issue({
      code: "COMPOSITION_UNPROVEN",
      domain: "COMPOSITION",
      severity: "HIGH",
      blocking: true,
      source: "COMPOSITION_REGISTRY",
      detectedAt: input.generatedAt,
    }),
    issue({
      code: "UNKNOWN_SHARED_ALLOCATION",
      domain: "COMPOSITION",
      severity: "HIGH",
      blocking: true,
      source: "COMPOSITION_REGISTRY",
      detectedAt: input.generatedAt,
    }),
    issue({
      code: "ECONOMICS_INCOMPLETE",
      domain: "ECONOMICS",
      severity: "HIGH",
      blocking: true,
      source: "COMMERCIAL_ECONOMICS_PROVENANCE_GATE",
      detectedAt: input.generatedAt,
    }),
  ]
  if (productCase.status !== "AVAILABLE") {
    issues.push(issue({
      code: productCase.status === "MISSING"
        ? "PRODUCT_CASE_LINK_MISSING"
        : "PRODUCT_CASE_LINK_UNPROVEN",
      domain: "PRODUCT_CASE",
      severity: "HIGH",
      blocking: true,
      source: typeof productCase.source === "string"
        ? productCase.source
        : productCase.source.source,
      detectedAt: input.generatedAt,
    }))
  }
  if (experiment.status === "UNPROVEN") {
    issues.push(issue({
      code: "EXPERIMENT_STATE_UNPROVEN",
      domain: "EXPERIMENT",
      severity: "MEDIUM",
      blocking: true,
      source: "EXPERIMENT_REGISTRY",
      detectedAt: input.generatedAt,
    }))
  } else if (experiment.status === "AVAILABLE" &&
      experiment.lifecycleState === "RUNNING") {
    issues.push(issue({
      code: "ACTIVE_EXPERIMENT_CONFLICT",
      domain: "EXPERIMENT",
      severity: "HIGH",
      blocking: true,
      source: experiment.source.source,
      evidenceReferences: [experiment.source.reference],
      detectedAt: input.generatedAt,
    }))
  }
  if (listing.registryStatus === "UNREGISTERED_DISCOVERY") {
    issues.push(issue({
      code: "REGISTRY_RECONCILIATION_FAILED",
      domain: "DISCOVERY",
      severity: "HIGH",
      blocking: true,
      source: "EBAY_TRADING_LISTING_IDENTITY",
      evidenceReferences: listingEvidence.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  const verificationFreshness = freshness(
    listing.identityVerification?.observed_at ?? null,
    input.now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  if (!listing.identityVerification?.active_listing_confirmed ||
      verificationFreshness.status !== "FRESH") {
    issues.push(issue({
      code: "LISTING_IDENTITY_UNPROVEN",
      domain: "IDENTITY",
      severity: "HIGH",
      blocking: true,
      source: "EBAY_TRADING_LISTING_IDENTITY",
      detectedAt: input.generatedAt,
    }))
  }
  if (identityFreshness.status !== "FRESH") {
    issues.push(issue({
      code: "REPORT_NOT_UPDATED_YET",
      domain: "DISCOVERY",
      severity: "HIGH",
      blocking: true,
      source: "EBAY_ACTIVE_LISTING_REGISTRY",
      evidenceReferences: listingEvidence.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  if (listing.duplicateIdentity) {
    issues.push(issue({
      code: "DUPLICATE_LISTING_IDENTITY",
      domain: "IDENTITY",
      severity: "HIGH",
      blocking: true,
      source: "EBAY_ACTIVE_LISTING_REGISTRY",
      detectedAt: input.generatedAt,
    }))
  }
  if (rawFields.variationKey && [
    metrics.impressions,
    metrics.ebay_views,
    metrics.ctr_reported,
  ].some((metric) => metric.value !== null && metric.grain === "ITEM")) {
    issues.push(issue({
      code: "METRIC_GRAIN_MISMATCH",
      domain: "METRICS",
      severity: "MEDIUM",
      blocking: true,
      source: "EBAY_SELL_ANALYTICS",
      detectedAt: input.generatedAt,
    }))
  }
  if (snapshot?.completeness_status === "incomplete") {
    issues.push(issue({
      code: "PARTIAL_REPORTING_WINDOW",
      domain: "METRICS",
      severity: "MEDIUM",
      blocking: true,
      source: "COMMERCIAL_SNAPSHOT_REGISTRY",
      evidenceReferences: [`LISTING_COMMERCIAL_SNAPSHOT:${snapshot.id}`],
      detectedAt: input.generatedAt,
    }))
  }
  if ([metrics.impressions, metrics.ebay_views]
      .some((metric) => !["AVAILABLE", "PARTIAL"]
        .includes(metric.availability))) {
    issues.push(issue({
      code: "SOURCE_UNAVAILABLE",
      domain: "METRICS",
      severity: "MEDIUM",
      blocking: true,
      source: "EBAY_SELL_ANALYTICS",
      evidenceReferences: snapshot
        ? [`LISTING_COMMERCIAL_SNAPSHOT:${snapshot.id}`]
        : [],
      detectedAt: input.generatedAt,
    }))
  }
  if (stock.state === "STALE") {
    issues.push(issue({
      code: "STALE_SUPPLIER_EVIDENCE",
      domain: "STOCK",
      severity: "HIGH",
      blocking: true,
      source: "LUNA_PORTEX_MARKET_RADAR",
      evidenceReferences: stock.evidenceReferences.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  if (stock.state === "SOURCE_FORMAT_CHANGED") {
    issues.push(issue({
      code: "SOURCE_FORMAT_CHANGED",
      domain: "STOCK",
      severity: "HIGH",
      blocking: true,
      source: "LUNA_PORTEX_MARKET_RADAR",
      evidenceReferences: stock.evidenceReferences.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  if (stock.state === "STOCK_CONFLICTED") {
    issues.push(issue({
      code: "SUPPLIER_IDENTITY_CONFLICT",
      domain: "STOCK",
      severity: "HIGH",
      blocking: true,
      source: "LUNA_PORTEX_MARKET_RADAR",
      evidenceReferences: stock.evidenceReferences.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  if (stock.state === "STOCK_UNKNOWN") {
    issues.push(issue({
      code: "SOURCE_UNAVAILABLE",
      domain: "STOCK",
      severity: "HIGH",
      blocking: true,
      source: "LUNA_PORTEX_MARKET_RADAR",
      evidenceReferences: stock.evidenceReferences.map((entry) => entry.reference),
      detectedAt: input.generatedAt,
    }))
  }
  if (orders.stalePotentialOrderCount > 0) {
    issues.push(issue({
      code: "REPORT_NOT_UPDATED_YET",
      domain: "METRICS",
      severity: "HIGH",
      blocking: true,
      source: "SANITIZED_ORDER_SNAPSHOTS",
      detectedAt: input.generatedAt,
    }))
  }
  if (orders.untrustedEvidenceCount > 0) {
    issues.push(issue({
      code: "SOURCE_UNAVAILABLE",
      domain: "METRICS",
      severity: "HIGH",
      blocking: true,
      source: "ORDER_SOURCE_PROVENANCE_GATE",
      detectedAt: input.generatedAt,
    }))
  }
  for (const result of [
    input.sources.registry,
    input.sources.syncState,
    input.sources.identityVerifications,
    input.sources.commercialSnapshots,
    input.sources.supplies,
    input.sources.supplySources,
    input.sources.orders,
    input.sources.orderLines,
  ]) {
    const sourceIssue = sourceResultIssue(result, input.generatedAt)
    if (sourceIssue) issues.push(sourceIssue)
  }
  if (input.sources.registry.truncated) {
    issues.push(issue({
      code: "REGISTRY_RESULT_LIMIT_REACHED",
      domain: "DISCOVERY",
      severity: "HIGH",
      blocking: true,
      source: "EBAY_ACTIVE_LISTING_REGISTRY",
      detectedAt: input.generatedAt,
    }))
  }
  const finalIssues = uniqueIssues(issues)
  const listedQuantity = nonNegativeInteger(row?.ebay_quantity)
  const model: CommercialListingReadModel = {
    key: listing.key,
    identity: {
      marketplace: input.marketplace,
      itemId: listing.itemId,
      variationKey: rawFields.variationKey,
      sku: sanitizeMonitorText(listing.ebaySku, 120),
      customLabel: rawFields.customLabel,
      supplierSku: sanitizeMonitorText(row?.supplier_sku, 120),
      title: trustedTitle(row),
      listingState: row?.listing_status ??
        listing.identityVerification?.observed_listing_status ?? "unknown",
      listingType: rawFields.listingType,
      listingFormat: rawFields.listingFormat,
      startTime: rawFields.startTime,
      gtin: rawFields.gtin,
      brand: rawFields.brand,
      mpn: rawFields.mpn,
      listedQuantity,
      currency: currencyCode(row?.currency),
      source: sanitizeMonitorText(
        row?.source ?? listing.identityVerification?.source,
        100,
      ) ?? "UNKNOWN",
      lastObservedAt,
      freshness: identityFreshness,
    },
    discovery: {
      registryStatus: listing.registryStatus,
      coverage: input.discoveryCoverage,
      observations: discoveryObservations,
    },
    productCase,
    composition,
    stock,
    metrics,
    experiment,
    dataQualityIssues: finalIssues,
    blockers: finalIssues.filter((entry) => entry.blocking),
    informationalNextAction: nextAction(finalIssues, experiment),
    evidenceReferences: [...new Map(listingEvidence.map((entry) => [
      entry.reference,
      entry,
    ])).values()],
    alertCandidateKeys: [],
  }
  const alerts = listingAlerts({
    model,
    accountScopeKey: input.accountScopeKey,
    orderProjection: orders,
    listedQuantity,
  })
  model.alertCandidateKeys = alerts.map((alert) => alert.eventKey)
  return { model, alerts }
}

function readerStatus(
  result: ReadonlySourceResult<Record<string, unknown>>,
  observedAt: string | null,
): SourceReaderStatus {
  return {
    source: result.source,
    status: result.status,
    observedAt,
    limitationCode: result.limitationCode,
  }
}

function readerStatuses(sources: CommercialMonitorReadonlySources) {
  const statuses: SourceReaderStatus[] = [
    readerStatus(
      sources.registry as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.registry.rows.map((row) => row.last_ebay_sync_at)),
    ),
    readerStatus(
      sources.syncState as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.syncState.rows.map((row) => row.latest_committed_at)),
    ),
    readerStatus(
      sources.identityVerifications as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.identityVerifications.rows.map((row) => row.observed_at)),
    ),
    readerStatus(
      sources.commercialSnapshots as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.commercialSnapshots.rows.map((row) => row.observed_at)),
    ),
    readerStatus(
      sources.supplies as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.supplies.rows.map((row) => row.captured_at)),
    ),
    readerStatus(
      sources.supplySources as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.supplySources.rows.map((row) => row.last_success_at)),
    ),
    readerStatus(
      sources.orders as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.orders.rows.map((row) => row.observed_at)),
    ),
    readerStatus(
      sources.orderLines as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.orderLines.rows.map((row) => row.last_observed_at)),
    ),
    readerStatus(
      sources.learning as unknown as ReadonlySourceResult<Record<string, unknown>>,
      latestIso(sources.learning.rows.map((row) => row.computed_at)),
    ),
  ]
  statuses.push({
    source: "EBAY_RUNTIME_LIVE_CONNECTION",
    status: "UNKNOWN",
    observedAt: null,
    limitationCode: "LIVE_CONNECTIVITY_NOT_INVOKED_BY_STORED_READ_MODEL",
  })
  return statuses
}

function discoveryCoverage(
  sources: CommercialMonitorReadonlySources,
  now: Date,
): DiscoveryCoverage {
  const committed = sources.syncState.rows.some((row) => {
    const generation = nonNegativeInteger(row.latest_committed_generation)
    return generation !== null && generation > 0 && Boolean(row.latest_committed_at)
  })
  const storedEvidence = sources.registry.rows.length > 0 ||
    sources.identityVerifications.rows.length > 0
  const observedAt = latestIso([
    ...sources.registry.rows.map((row) => row.last_ebay_sync_at),
    ...sources.identityVerifications.rows.map((row) => row.observed_at),
    ...sources.syncState.rows.map((row) => row.latest_committed_at),
  ])
  const coverageFreshness = freshness(
    observedAt,
    now,
    METRIC_MAXIMUM_AGE_SECONDS,
  )
  const knownGapCodes = [
    "UNIVERSAL_ACCOUNT_LISTING_DISCOVERY_UNPROVEN",
    "MANUAL_LISTINGS_REQUIRE_KNOWN_ITEM_ID",
  ]
  if (sources.registry.truncated) knownGapCodes.push("REGISTRY_RESULT_LIMIT_REACHED")
  if (sources.registry.status === "ERROR") knownGapCodes.push("REGISTRY_SOURCE_UNAVAILABLE")
  if (sources.registry.rows.some((row) => !/^\d{9,20}$/.test(row.ebay_item_id))) {
    knownGapCodes.push("INVALID_REGISTRY_ITEM_ID")
  }
  if (sources.identityVerifications.rows.some((row) =>
      ![row.observed_listing_id, row.listing_id]
        .some((value) => typeof value === "string" && /^\d{9,20}$/.test(value)))) {
    knownGapCodes.push("INVALID_DISCOVERY_ITEM_ID")
  }
  if ((committed || storedEvidence) && coverageFreshness.status !== "FRESH") {
    knownGapCodes.push("DISCOVERY_EVIDENCE_STALE_OR_INVALID")
  }
  return createDiscoveryCoverage({
    universalCoverageProven: false,
    sourceCoverageAvailable: sources.registry.status !== "ERROR" &&
      (committed || storedEvidence) && coverageFreshness.status === "FRESH",
    sources: [...new Set([
      ...sources.registry.rows.map((row) =>
        sanitizeMonitorText(row.source, 100) ?? "UNKNOWN"),
      ...sources.identityVerifications.rows.map((row) =>
        sanitizeMonitorText(row.source, 100) ?? "UNKNOWN"),
    ])].sort(),
    observedAt,
    knownGapCodes,
  })
}

function listingInputs(sources: CommercialMonitorReadonlySources) {
  const groups = canonicalizeActiveListingProtectionRows(sources.registry.rows)
    .filter((group) => /^\d{9,20}$/.test(group.ebayItemId))
  const identities = sources.identityVerifications.rows
  const result: ListingProjectionInput[] = groups.map((group) => {
    const matchingVerification = identities.find((verification) =>
      verification.listing_id === group.ebayItemId &&
      (!group.ebaySku || verification.expected_sku === group.ebaySku ||
        verification.observed_sku === group.ebaySku)
    ) ?? null
    const sourcesInGroup = group.observations.map((entry) => entry.source)
    return {
      key: `${group.ebayItemId}:${group.ebaySku ?? "NO_SKU"}`,
      row: group.listing,
      itemId: group.ebayItemId,
      ebaySku: group.ebaySku,
      registryObservations: group.observations.map((entry) => ({
        source: entry.source,
        listingStatus: entry.listingStatus,
        observedAt: entry.observedAt,
        evidenceReference: `EBAY_ACTIVE_LISTING:${entry.listingId}`,
      })),
      identityVerification: matchingVerification,
      registryStatus: "REGISTERED" as const,
      duplicateIdentity: new Set(sourcesInGroup).size !== sourcesInGroup.length,
    }
  })
  const represented = new Set(result.map((listing) =>
    `${listing.itemId}:${listing.ebaySku ?? "NO_SKU"}`))
  for (const verification of identities) {
    const observedItemId = /^\d{9,20}$/.test(
      verification.observed_listing_id ?? "",
    ) ? verification.observed_listing_id : null
    const requestedItemId = /^\d{9,20}$/.test(verification.listing_id)
      ? verification.listing_id
      : null
    const itemId = observedItemId ?? requestedItemId
    if (!itemId) continue
    const sku = verification.observed_sku ?? verification.expected_sku ?? null
    const key = `${itemId}:${sku ?? "NO_SKU"}`
    if (represented.has(key)) continue
    represented.add(key)
    result.push({
      key,
      row: null,
      itemId,
      ebaySku: sku,
      registryObservations: [{
        source: verification.source,
        listingStatus: verification.observed_listing_status ?? "unknown",
        observedAt: verification.observed_at,
        evidenceReference: `LISTING_IDENTITY_VERIFICATION:${verification.id}`,
      }],
      identityVerification: verification,
      registryStatus: "UNREGISTERED_DISCOVERY",
      duplicateIdentity: false,
    })
  }
  return result.sort((left, right) => left.key.localeCompare(right.key))
}

function learningProjection(
  result: ReadonlySourceResult<ReadonlyLearningAdjustmentRow>,
): CommercialLearningReadModel {
  if (result.status === "ERROR") {
    return {
      status: "ERROR" as const,
      source: result.source,
      evidenceTimestamp: null,
      modelVersions: [],
      categoryAdjustments: [],
      limitationCode: result.limitationCode,
    }
  }
  const adjustments = result.rows.flatMap((row) => {
    const adjustmentPoints = numeric(row.adjustment_points)
    const sampleListingCount = nonNegativeInteger(row.sample_listing_count)
    const totalImpressions = nonNegativeInteger(row.total_impressions)
    const minimumObservationDays = nonNegativeInteger(row.minimum_observation_days)
    if (adjustmentPoints === null || sampleListingCount === null ||
        totalImpressions === null || minimumObservationDays === null ||
        !validIso(row.computed_at) || !/^\d{1,20}$/.test(row.category_id) ||
        !["COLLECTING", "ELIGIBLE_APPLIED"].includes(row.status) ||
        row.source !== "EBAY_SELL_ANALYTICS_READONLY") return []
    const complete = row.status === "ELIGIBLE_APPLIED" && row.eligible === true
    return [{
      categoryId: row.category_id,
      status: row.status,
      eligible: row.eligible,
      completeness: complete ? "COMPLETE" as const : "PARTIAL" as const,
      adjustmentPoints,
      sampleListingCount,
      totalImpressions,
      minimumObservationDays,
      computedAt: row.computed_at,
      source: row.source,
      evidenceReference: `EBAY_CATEGORY_LEARNING_ADJUSTMENT:${row.id}`,
    }]
  })
  const allComplete = adjustments.length === result.rows.length &&
    adjustments.every((row) => row.completeness === "COMPLETE")
  return {
    status: result.rows.length
      ? allComplete && result.status === "AVAILABLE"
        ? "AVAILABLE" as const
        : "PARTIAL" as const
      : "UNAVAILABLE" as const,
    source: result.source,
    evidenceTimestamp: latestIso(adjustments.map((row) => row.computedAt)),
    modelVersions: [...new Set(result.rows
      .filter((row) => adjustments.some((adjustment) =>
        adjustment.evidenceReference.endsWith(row.id)))
      .flatMap((row) => [
      row.model_version,
      row.prediction_engine_version,
    ]).filter(Boolean))],
    categoryAdjustments: adjustments,
    limitationCode: result.rows.length
      ? adjustments.length === result.rows.length
        ? allComplete
          ? result.limitationCode
          : "LEARNING_COLLECTION_INCOMPLETE"
        : "LEARNING_ROWS_PARTIALLY_INVALID"
      : "NO_STORED_CATEGORY_LEARNING",
  }
}

function timeline(
  listings: CommercialListingReadModel[],
  learning: CommercialLearningReadModel,
  alertCandidates: AlertCandidate[],
  generatedAt: string,
) {
  const entries: TimelineEntry[] = []
  for (const listing of listings) {
    for (const observation of listing.discovery.observations) {
      if (!validIso(observation.observedAt)) continue
      entries.push({
        at: observation.observedAt as string,
        kind: "DISCOVERY",
        listingReference: {
          itemId: listing.identity.itemId,
          variationKey: listing.identity.variationKey,
        },
        evidenceReferences: [observation.evidenceReference],
        sanitizedReasonCode: null,
      })
    }
    for (const entry of listing.evidenceReferences) {
      if (!validIso(entry.capturedAt)) continue
      const kind = entry.reference.startsWith("LISTING_IDENTITY_VERIFICATION:")
        ? "IDENTITY" as const
        : entry.reference.startsWith("LISTING_COMMERCIAL_SNAPSHOT:")
          ? "METRICS" as const
          : entry.reference.startsWith("MARKET_RADAR_SNAPSHOT:")
            ? "SUPPLIER" as const
            : entry.reference.startsWith("MARKETPLACE_ORDER_")
              ? "ORDER" as const
              : null
      if (!kind) continue
      entries.push({
        at: entry.capturedAt as string,
        kind,
        listingReference: {
          itemId: listing.identity.itemId,
          variationKey: listing.identity.variationKey,
        },
        evidenceReferences: [entry.reference],
        sanitizedReasonCode: null,
      })
    }
  }
  if (learning.evidenceTimestamp) {
    entries.push({
      at: learning.evidenceTimestamp,
      kind: "LEARNING",
      listingReference: { itemId: null, variationKey: null },
      evidenceReferences: [],
      sanitizedReasonCode: null,
    })
  }
  for (const alert of alertCandidates) {
    entries.push({
      at: generatedAt,
      kind: "ALERT",
      listingReference: {
        itemId: alert.listingReference.itemId,
        variationKey: alert.listingReference.variationKey,
      },
      evidenceReferences: alert.supportingEvidence
        .map((entry) => entry.reference),
      sanitizedReasonCode: alert.reasonCode,
    })
  }
  return [...new Map(entries.map((entry) => [
    [
      entry.at,
      entry.kind,
      entry.listingReference.itemId ?? "ACCOUNT",
      entry.listingReference.variationKey ?? "NO_VARIATION",
      ...entry.evidenceReferences,
    ].join(":"),
    entry,
  ])).values()]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 500)
}

function accountDataQualityIssues(input: {
  readers: SourceReaderStatus[]
  coverage: DiscoveryCoverage
  generatedAt: string
}) {
  const issues: DataQualityIssue[] = []
  if (input.coverage.status !== "COMPLETE") {
    issues.push(issue({
      code: "LISTING_DISCOVERY_INCOMPLETE",
      domain: "DISCOVERY",
      severity: input.coverage.status === "UNPROVEN" ? "HIGH" : "MEDIUM",
      blocking: input.coverage.status === "UNPROVEN",
      source: "ACCOUNT_DISCOVERY_COVERAGE",
      detectedAt: input.generatedAt,
    }))
  }
  for (const reader of input.readers) {
    if (["AVAILABLE", "UNKNOWN"].includes(reader.status)) continue
    issues.push(issue({
      code: reader.status === "ERROR" ? "COLLECTOR_ERROR" : "SOURCE_UNAVAILABLE",
      domain: "COLLECTOR",
      severity: reader.status === "ERROR" ? "HIGH" : "MEDIUM",
      blocking: reader.status === "ERROR",
      source: reader.source,
      detectedAt: input.generatedAt,
    }))
  }
  if (input.coverage.knownGapCodes.some((code) =>
      code === "INVALID_REGISTRY_ITEM_ID" ||
      code === "INVALID_DISCOVERY_ITEM_ID")) {
    issues.push(issue({
      code: "LISTING_IDENTITY_UNPROVEN",
      domain: "IDENTITY",
      severity: "HIGH",
      blocking: true,
      source: "ACCOUNT_LISTING_IDENTITY_VALIDATION",
      detectedAt: input.generatedAt,
    }))
  }
  return uniqueIssues(issues)
}

function accountCoverageAlert(input: {
  accountScopeKey: string
  marketplace: MarketplaceContext
  coverage: DiscoveryCoverage
}) {
  if (input.coverage.status === "COMPLETE") return null
  const coverageReference = [
    "ACCOUNT_DISCOVERY_COVERAGE",
    input.coverage.status,
    ...input.coverage.knownGapCodes,
  ].join(":")
  return createAlertCandidate({
    accountScopeKey: input.accountScopeKey,
    marketplace: input.marketplace,
    itemId: null,
    variationKey: null,
    sku: null,
    reasonCode: "DATA_COVERAGE_FAILURE",
    severity: input.coverage.status === "UNPROVEN" ? "HIGH" : "MEDIUM",
    supportingEvidence: [evidence(
      coverageReference,
      "SELLER_OS_DISCOVERY_COVERAGE",
      input.coverage.observedAt,
    )],
    freshness: {
      status: "UNKNOWN",
      capturedAt: input.coverage.observedAt,
    },
    recommendedHumanDestination: "SELLER_OS_MONITOR",
  })
}

function baseReport(input: {
  marketplace: MarketplaceContext
  generatedAt: string
  connectionStatus: ObservationAvailability
  readers: SourceReaderStatus[]
  coverage: DiscoveryCoverage
  listings: CommercialListingReadModel[]
  alertCandidates: AlertCandidate[]
  accountDataQualityIssues: DataQualityIssue[]
  learning: CommercialLearningReadModel
  timeline: TimelineEntry[]
}) : CommercialMonitorGetDto {
  return {
    contractVersion: COMMERCIAL_MONITOR_READONLY_CONTRACT_VERSION,
    operation: COMMERCIAL_MONITOR_ASSISTANT_OPERATION,
    mode: "READ_ONLY",
    generatedAt: input.generatedAt,
    marketplace: input.marketplace,
    connection: {
      status: input.connectionStatus,
      readers: input.readers,
    },
    discoveryCoverage: input.coverage,
    listings: input.listings,
    alertCandidates: input.alertCandidates,
    accountDataQualityIssues: input.accountDataQualityIssues,
    learning: input.learning,
    timeline: input.timeline,
    productCaseOperatingState: {
      status: "PAUSED_FOR_MONITORING_MILESTONE",
      reset: false,
      resumePolicy: "RESUME_FROM_LAST_VERIFIED_GATE",
      manualGoldenPath: "PRESERVE",
    },
    capabilities: {
      canPublishAutomatically: false,
      canReviseInventoryAutomatically: false,
      canPauseListingAutomatically: false,
      canReactivateListingAutomatically: false,
      ebayBuyerMessageAutoSend: false,
      ebayTrackingWriteEnabled: false,
      whatsappSaleAlertEnabled: false,
      postSaleShadowMode: true,
    },
    safety: {
      marketplaceWritesAllowed: false,
      dispatchAllowed: false,
      whatsappCalled: false,
      buyerMessagesAllowed: false,
      sanitized: true,
      containsSecrets: false,
      containsTokens: false,
      containsAuthorizationHeaders: false,
      containsCookies: false,
      buyerPiiIncluded: false,
    },
  }
}

function unconfiguredReport(scope: AccountScope, now: Date) {
  const generatedAt = now.toISOString()
  const marketplace = {
    marketplaceId: "EBAY_US",
    accountAlias: scope.accountAlias,
  } satisfies MarketplaceContext
  return assertCommercialMonitorAssistantDtoSafe(baseReport({
    marketplace,
    generatedAt,
    connectionStatus: "UNAVAILABLE",
    readers: [{
      source: "SELLER_ACCOUNT_SCOPE",
      status: "UNAVAILABLE",
      observedAt: null,
      limitationCode: scope.configurationReason ?? "ACCOUNT_SCOPE_NOT_CONFIGURED",
    }],
    coverage: {
      status: "UNPROVEN",
      sources: [],
      observedAt: null,
      knownGapCodes: [
        "SELLER_ACCOUNT_SCOPE_NOT_CONFIGURED",
        "UNIVERSAL_ACCOUNT_LISTING_DISCOVERY_UNPROVEN",
      ],
    },
    listings: [],
    alertCandidates: [accountCoverageAlert({
      accountScopeKey: "ACCOUNT_SCOPE_UNCONFIGURED",
      marketplace,
      coverage: {
        status: "UNPROVEN",
        sources: [],
        observedAt: null,
        knownGapCodes: ["SELLER_ACCOUNT_SCOPE_NOT_CONFIGURED"],
      },
    })].filter((entry): entry is AlertCandidate => Boolean(entry)),
    accountDataQualityIssues: [issue({
      code: "LISTING_DISCOVERY_INCOMPLETE",
      domain: "DISCOVERY",
      severity: "HIGH",
      blocking: true,
      source: "SELLER_ACCOUNT_SCOPE",
      detectedAt: generatedAt,
    })],
    learning: {
      status: "UNAVAILABLE",
      source: "EBAY_CATEGORY_LEARNING",
      evidenceTimestamp: null,
      modelVersions: [],
      categoryAdjustments: [],
      limitationCode: "ACCOUNT_SCOPE_NOT_CONFIGURED",
    },
    timeline: [],
  }))
}

export async function getCommercialMonitorReadonly(
  supabase: SupabaseClient,
  scope: AccountScope,
  now = new Date(),
) {
  if (!scope.accountKey) return unconfiguredReport(scope, now)
  const generatedAt = now.toISOString()
  const marketplace = {
    marketplaceId: "EBAY_US",
    accountAlias: scope.accountAlias,
  } satisfies MarketplaceContext
  const sources = await readCommercialMonitorReadonlySources(
    supabase,
    scope.accountKey,
  )
  const coverage = discoveryCoverage(sources, now)
  const inputs = listingInputs(sources)
  const countByItem = new Map<string, number>()
  for (const listing of inputs) {
    const currentCount = countByItem.get(listing.itemId)
    countByItem.set(listing.itemId, currentCount === undefined ? 1 : currentCount + 1)
  }
  const projected = inputs.map((listing) => projectListing({
    listing,
    sources,
    marketplace,
    discoveryCoverage: coverage,
    itemIdentityCount: countByItem.get(listing.itemId) ?? 1,
    accountScopeKey: scope.accountKey as string,
    generatedAt,
    now,
  }))
  const listings = projected.map((entry) => entry.model)
  const accountAlert = accountCoverageAlert({
    accountScopeKey: scope.accountKey,
    marketplace,
    coverage,
  })
  const alertCandidates = [...new Map([
    ...projected.flatMap((entry) => entry.alerts),
    ...(accountAlert ? [accountAlert] : []),
  ]
    .map((alert) => [alert.eventKey, alert])).values()]
  const learning = learningProjection(sources.learning)
  const readers = readerStatuses(sources)
  const persistedReaders = readers.filter((reader) =>
    reader.source !== "EBAY_RUNTIME_LIVE_CONNECTION")
  const connectionStatus: ObservationAvailability = persistedReaders.every((reader) =>
      reader.status === "ERROR")
    ? "ERROR"
    : readers.every((reader) => reader.status === "AVAILABLE")
      ? "AVAILABLE"
      : "PARTIAL"
  const accountIssues = accountDataQualityIssues({
    readers,
    coverage,
    generatedAt,
  })
  return assertCommercialMonitorAssistantDtoSafe(baseReport({
    marketplace,
    generatedAt,
    connectionStatus,
    readers,
    coverage,
    listings,
    alertCandidates,
    accountDataQualityIssues: accountIssues,
    learning,
    timeline: timeline(listings, learning, alertCandidates, generatedAt),
  }))
}
