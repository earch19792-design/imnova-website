export const SELLER_HUB_TRAFFIC_MAPPING_V1 = Object.freeze({
  impressions: {
    sellerHubLabel: "Impressions",
    apiMetric: "TOTAL_IMPRESSION_TOTAL",
    equivalence: "WINDOW_SCOPE_TIMEZONE_MUST_MATCH",
  },
  listingViews: {
    sellerHubLabel: "Listing views",
    apiMetric: "LISTING_VIEWS_TOTAL",
    equivalence: "NOT_ON_EBAY_VIEWS_ONLY",
  },
  quantitySold: {
    sellerHubLabel: "Quantity sold",
    apiMetric: "TRANSACTION",
    equivalence: "QUANTITY_SOLD_NOT_ORDER_COUNT",
  },
  ctr: {
    sellerHubLabel: "Click-through rate",
    apiMetric: "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE / LISTING_IMPRESSION_SEARCH_RESULTS_PAGE * 100",
    equivalence: "WEIGHTED_SEARCH_RESULT_RATE_NOT_LISTING_AVERAGE",
  },
})

export type AccountTrafficEvidenceV1 = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE"
  scope: "ACCOUNT_TRAFFIC"
  scopeId: string
  scopeType: "ACCOUNT_TRAFFIC_SCOPE"
  scopeCount: number | null
  grain: "ACCOUNT_DAY_AGGREGATE"
  entityType: "ACCOUNT_TRAFFIC_DAY_BUCKET"
  source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
  windowStart: string | null
  windowEnd: string | null
  timeZone: "UTC"
  observedAt: string | null
  sourceUpdatedAt: string | null
  completeness: "COMPLETE" | "PARTIAL" | "UNPROVEN"
  impressions: number | null
  listingViews: number | null
  quantitySold: number | null
  ctr: number | null
  accountTrafficSnapshotId: string | null
  auditSpanId: string
  metadataValidationStatus: "VALID" | "INVALID" | "NOT_ATTEMPTED"
  metadataValidationReasonCode: string | null
  upstreamSnapshotAcquisitionCount: number
  cumulativeAcquisitionCount: number
  cacheHitCount: number
  retryCount: number
  retryPolicy: "ONE_RETRY_ON_DATE_METADATA_INVALID" | "NO_RETRY"
  gapCodes: string[]
}

export type AccountTrafficMetricRowV1 = {
  metrics: Record<string, number | null>
  applicability: Record<string, boolean>
}

function completeTotal(rows: AccountTrafficMetricRowV1[], key: string) {
  if (!rows.length) return null
  const values = rows.map((row) => row.applicability[key] === true &&
      typeof row.metrics[key] === "number" && Number.isFinite(row.metrics[key])
    ? row.metrics[key]
    : null)
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null
}

export function unavailableAccountTrafficV1(
  gapCode: string,
  upstreamSnapshotAcquisitionCount = 0,
  telemetry: Partial<Pick<AccountTrafficEvidenceV1,
    "scopeId" | "scopeCount" | "accountTrafficSnapshotId" | "auditSpanId" |
    "metadataValidationStatus" | "metadataValidationReasonCode" |
    "cumulativeAcquisitionCount" | "cacheHitCount" | "retryCount" |
    "retryPolicy">> = {},
): AccountTrafficEvidenceV1 {
  return {
    status: "UNAVAILABLE",
    scope: "ACCOUNT_TRAFFIC",
    scopeId: telemetry.scopeId ?? "account-traffic:unproven",
    scopeType: "ACCOUNT_TRAFFIC_SCOPE",
    scopeCount: telemetry.scopeCount ?? null,
    grain: "ACCOUNT_DAY_AGGREGATE",
    entityType: "ACCOUNT_TRAFFIC_DAY_BUCKET",
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    windowStart: null,
    windowEnd: null,
    timeZone: "UTC",
    observedAt: null,
    sourceUpdatedAt: null,
    completeness: "UNPROVEN",
    impressions: null,
    listingViews: null,
    quantitySold: null,
    ctr: null,
    accountTrafficSnapshotId: telemetry.accountTrafficSnapshotId ?? null,
    auditSpanId: telemetry.auditSpanId ?? "account-traffic-audit:not-attempted",
    metadataValidationStatus: telemetry.metadataValidationStatus ?? "NOT_ATTEMPTED",
    metadataValidationReasonCode:
      telemetry.metadataValidationReasonCode ?? null,
    upstreamSnapshotAcquisitionCount,
    cumulativeAcquisitionCount: telemetry.cumulativeAcquisitionCount ??
      upstreamSnapshotAcquisitionCount,
    cacheHitCount: typeof telemetry.cacheHitCount === "number"
      ? telemetry.cacheHitCount
      : 0,
    retryCount: typeof telemetry.retryCount === "number"
      ? telemetry.retryCount
      : 0,
    retryPolicy: telemetry.retryPolicy ?? "NO_RETRY",
    gapCodes: [gapCode],
  }
}

export function summarizeAccountTrafficV1(input: {
  rows: AccountTrafficMetricRowV1[]
  windowStart: string | null
  windowEnd: string | null
  requestedWindowStart: string
  requestedWindowEnd: string
  observedAt: string
  sourceUpdatedAt: string | null
  warnings: string[]
  accountTrafficSnapshotId: string
  auditSpanId: string
  cumulativeAcquisitionCount?: number
  cacheHitCount?: number
  retryCount?: number
  retryPolicy?: AccountTrafficEvidenceV1["retryPolicy"]
  upstreamSnapshotAcquisitionCount?: number
}): AccountTrafficEvidenceV1 {
  const impressions = completeTotal(input.rows, "TOTAL_IMPRESSION_TOTAL")
  const listingViews = completeTotal(input.rows, "LISTING_VIEWS_TOTAL")
  const quantitySold = completeTotal(input.rows, "TRANSACTION")
  const searchImpressions = completeTotal(
    input.rows,
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
  )
  const searchViews = completeTotal(
    input.rows,
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
  )
  const ctr = searchImpressions !== null && searchViews !== null &&
      searchImpressions > 0
    ? Number(((searchViews / searchImpressions) * 100).toFixed(4))
    : searchImpressions === 0 && searchViews === 0
      ? 0
      : null
  const exactWindow = input.windowStart?.slice(0, 10) ===
      input.requestedWindowStart && input.windowEnd?.slice(0, 10) ===
      input.requestedWindowEnd
  const complete = exactWindow && input.warnings.length === 0 &&
    [impressions, listingViews, quantitySold, ctr].every((value) =>
      value !== null)
  const gapCodes = [
    ...input.warnings.map(() => "ANALYTICS_SOURCE_WARNING_REPORTED"),
    ...(!exactWindow ? ["ANALYTICS_RESPONSE_WINDOW_DIFFERS_FROM_REQUEST"] : []),
    ...(!input.rows.length ? ["ACCOUNT_TRAFFIC_ROWS_MISSING"] : []),
    ...([impressions, listingViews, quantitySold, ctr].some((value) =>
      value === null) ? ["ACCOUNT_TRAFFIC_METRIC_INCOMPLETE"] : []),
  ]
  return {
    status: complete ? "AVAILABLE" : input.rows.length ? "PARTIAL" : "UNAVAILABLE",
    scope: "ACCOUNT_TRAFFIC",
    scopeId: `account-traffic:UTC:${input.requestedWindowStart}:${input.requestedWindowEnd}`,
    scopeType: "ACCOUNT_TRAFFIC_SCOPE",
    scopeCount: input.rows.length,
    grain: "ACCOUNT_DAY_AGGREGATE",
    entityType: "ACCOUNT_TRAFFIC_DAY_BUCKET",
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    timeZone: "UTC",
    observedAt: input.observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    completeness: complete ? "COMPLETE" : input.rows.length ? "PARTIAL" : "UNPROVEN",
    impressions,
    listingViews,
    quantitySold,
    ctr,
    accountTrafficSnapshotId: input.accountTrafficSnapshotId,
    auditSpanId: input.auditSpanId,
    metadataValidationStatus: "VALID",
    metadataValidationReasonCode: null,
    upstreamSnapshotAcquisitionCount:
      input.upstreamSnapshotAcquisitionCount ?? 1,
    cumulativeAcquisitionCount: input.cumulativeAcquisitionCount ??
      input.upstreamSnapshotAcquisitionCount ?? 1,
    cacheHitCount: typeof input.cacheHitCount === "number"
      ? input.cacheHitCount
      : 0,
    retryCount: typeof input.retryCount === "number"
      ? input.retryCount
      : 0,
    retryPolicy: input.retryPolicy ?? "NO_RETRY",
    gapCodes: [...new Set(gapCodes)],
  }
}

export type CommercialSeriesSnapshotV1 = {
  id: string
  listingId: string
  impressions: number | string | null
  views: number | string | null
  transactions: number | string | null
  ctr: number | string | null
  observedAt: string
  windowStart: string | null
  windowEnd: string | null
  source: unknown
  completenessStatus: string
}

export type CanonicalCommercialTimeSeriesPointV1 = {
  observedAt: string
  windowStart: string
  windowEnd: string
  scope: "CURRENT_LIVE_PORTFOLIO"
  grain: "PORTFOLIO_WINDOW"
  source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
  metricDefinitionVersion: "EBAY_TRAFFIC_REPORT_V1"
  completeness: "COMPLETE" | "PARTIAL"
  representedListingCount: number
  impressions: number | null
  listingViews: number | null
  quantitySold: number | null
  ctr: number | null
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finite(value: number | string | null) {
  if (value === null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function buildCanonicalCommercialTimeSeriesV1(input: {
  snapshots: CommercialSeriesSnapshotV1[]
  currentLiveItemIds: string[]
}) {
  const liveIds = new Set(input.currentLiveItemIds)
  const compatible = input.snapshots.filter((row) => {
    const source = object(row.source)
    return liveIds.has(row.listingId) && row.windowStart && row.windowEnd &&
      Number.isFinite(Date.parse(row.observedAt)) &&
      source.analytics === "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" &&
      source.syntheticFallbackUsed === false
  })
  const groups = new Map<string, CommercialSeriesSnapshotV1[]>()
  for (const row of compatible) {
    const key = JSON.stringify([row.windowStart, row.windowEnd, row.observedAt])
    const current = groups.get(key) ?? []
    current.push(row)
    groups.set(key, current)
  }
  const points: CanonicalCommercialTimeSeriesPointV1[] = []
  for (const rows of groups.values()) {
    const uniqueRows = [...new Map(rows.map((row) => [row.listingId, row])).values()]
    const total = (field: "impressions" | "views" | "transactions") => {
      const values = uniqueRows.map((row) => finite(row[field]))
      return values.every((value): value is number => value !== null)
        ? values.reduce((sum, value) => sum + value, 0)
        : null
    }
    const sourceRows = uniqueRows.map((row) => object(row.source))
    const numerators = sourceRows.map((source) => finite(
      source.calculatedCtrNumerator as number | string | null,
    ))
    const denominators = sourceRows.map((source) => finite(
      source.calculatedCtrDenominator as number | string | null,
    ))
    const ctrComparable = numerators.every((value): value is number =>
      value !== null) && denominators.every((value): value is number =>
      value !== null)
    const numerator = ctrComparable
      ? numerators.reduce((sum, value) => sum + value, 0)
      : null
    const denominator = ctrComparable
      ? denominators.reduce((sum, value) => sum + value, 0)
      : null
    const allLiveRepresented = uniqueRows.length === liveIds.size &&
      uniqueRows.every((row) => row.completenessStatus === "complete")
    points.push({
      observedAt: uniqueRows[0].observedAt,
      windowStart: uniqueRows[0].windowStart as string,
      windowEnd: uniqueRows[0].windowEnd as string,
      scope: "CURRENT_LIVE_PORTFOLIO",
      grain: "PORTFOLIO_WINDOW",
      source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
      metricDefinitionVersion: "EBAY_TRAFFIC_REPORT_V1",
      completeness: allLiveRepresented ? "COMPLETE" : "PARTIAL",
      representedListingCount: uniqueRows.length,
      impressions: total("impressions"),
      listingViews: total("views"),
      quantitySold: total("transactions"),
      ctr: numerator !== null && denominator !== null && denominator > 0
        ? Number(((numerator / denominator) * 100).toFixed(4))
        : null,
    })
  }
  points.sort((left, right) => Date.parse(left.observedAt) -
    Date.parse(right.observedAt))
  return {
    status: points.length >= 2
      ? points.every((point) => point.completeness === "COMPLETE")
        ? "AVAILABLE" as const
        : "PARTIAL" as const
      : points.length === 1
        ? "PARTIAL" as const
        : "MISSING" as const,
    points,
    limitationCode: points.length >= 2
      ? points.some((point) => point.completeness === "PARTIAL")
        ? "HISTORICAL_SERIES_PARTIAL_COVERAGE" as const
        : null
      : points.length === 1
        ? "HISTORICAL_SERIES_SINGLE_COMPARABLE_WINDOW" as const
        : "NO_CANONICAL_TIME_SERIES" as const,
  }
}
