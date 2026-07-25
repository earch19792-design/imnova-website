type NormalizedTrafficRow = {
  dimension: string
  metrics: Record<string, number | null>
  applicability: Record<string, boolean>
}

type NormalizedTrafficReport = {
  dimension: "DAY" | "LISTING"
  rows: NormalizedTrafficRow[]
  startDate: string | null
  endDate: string | null
  lastUpdatedDate: string | null
  warnings: string[]
}

export type SellerHubComparisonClassification =
  | "MATCH_EXACT"
  | "MATCH_DIFFERENT_WINDOW"
  | "SELLER_HUB_LISTING_API_DISCREPANCY"
  | "REPORT_NOT_UPDATED_YET"
  | "LISTING_DIMENSION_MISMATCH"
  | "SELLER_HUB_ACCOUNT_LEVEL_NOT_LISTING_LEVEL"
  | "METRIC_MAPPING_ERROR"
  | "INSUFFICIENT_EVIDENCE"

export type SellerHubEvidence = {
  impressions: number
  views: number
  transactions: number
  ctr: number
  scope: "LISTING" | "ACCOUNT" | "UNKNOWN"
}

function metric(
  row: NormalizedTrafficRow,
  key: string,
) {
  const value = row.metrics[key]
  return row.applicability[key] !== false && typeof value === "number" ? value : null
}

function derivedRate(numerator: number | null, denominator: number | null) {
  return numerator !== null && denominator !== null && denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(2))
    : null
}

export function normalizeEbayTrafficListingDimension(value: string) {
  const trimmed = value.trim()
  if (/^\d{9,20}$/.test(trimmed)) return trimmed
  const legacyBrowseId = trimmed.match(/^v1\|(\d{9,20})\|\d+$/i)
  return legacyBrowseId?.[1] ?? null
}

function analyticsFreshness(input: {
  reportStartDay: string | null
  reportEndDay: string | null
  lastUpdatedDay: string | null
  requestedStartDay: string
  requestedEndDay: string
  warningsPresent: boolean
  listingDimensionMatched: boolean
}) {
  if (!input.listingDimensionMatched) return "LISTING_DIMENSION_MISMATCH" as const
  if (!input.lastUpdatedDay || input.lastUpdatedDay < input.requestedEndDay) {
    return "REPORT_NOT_UPDATED_YET" as const
  }
  if (
    !input.reportStartDay || !input.reportEndDay ||
    input.reportStartDay > input.requestedStartDay ||
    input.reportEndDay < input.requestedEndDay ||
    input.warningsPresent
  ) return "INCOMPLETE_WINDOW" as const
  return "CURRENT" as const
}

export function reconcileEbayTrafficAnalyticsReport(input: {
  listingIds: string[]
  dateFrom: string
  dateTo: string
  timeZone?: "UTC"
}, normalized: NormalizedTrafficReport) {
  const reportStartDay = normalized.startDate?.slice(0, 10) ?? null
  const reportEndDay = normalized.endDate?.slice(0, 10) ?? null
  const updatedDay = normalized.lastUpdatedDate?.slice(0, 10) ?? null
  const requestedListingIds = [...new Set(input.listingIds
    .filter((listingId) => /^\d{9,20}$/.test(listingId)))]
  const returnedListingDimensions = normalized.rows.map((row) => row.dimension)
  const normalizedRows = normalized.rows.map((row) => ({
    row,
    listingId: normalizeEbayTrafficListingDimension(row.dimension),
  }))
  const requested = new Set(requestedListingIds)
  const matchedListingIds = [...new Set(normalizedRows
    .map(({ listingId }) => listingId)
    .filter((listingId): listingId is string => Boolean(listingId && requested.has(listingId))))]
  const matched = new Set(matchedListingIds)
  const unmatchedRequestedListingIds = requestedListingIds
    .filter((listingId) => !matched.has(listingId))
  const unexpectedDimensions = returnedListingDimensions.filter((dimension, index) => {
    const listingId = normalizedRows[index]?.listingId
    return !listingId || !requested.has(listingId)
  })
  const listingDimensionMatched = normalized.dimension === "LISTING" &&
    unmatchedRequestedListingIds.length === 0 && unexpectedDimensions.length === 0
  const dataFreshnessStatus = analyticsFreshness({
    reportStartDay,
    reportEndDay,
    lastUpdatedDay: updatedDay,
    requestedStartDay: input.dateFrom,
    requestedEndDay: input.dateTo,
    warningsPresent: normalized.warnings.length > 0,
    listingDimensionMatched,
  })
  const complete = dataFreshnessStatus === "CURRENT"
  return {
    status: complete ? "AVAILABLE" as const : "INCOMPLETE" as const,
    source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT" as const,
    observedAt: new Date().toISOString(),
    windowStart: input.dateFrom,
    windowEnd: input.dateTo,
    completenessStatus: complete ? "complete" as const : "incomplete" as const,
    dataFreshnessStatus,
    queryTimeZone: input.timeZone ?? "AMERICA_LOS_ANGELES",
    queryDimension: normalized.dimension,
    requestedListingIds,
    returnedListingDimensions,
    matchedListingIds,
    unmatchedRequestedListingIds,
    unexpectedDimensions,
    reportCoverage: {
      reportStartDay,
      reportEndDay,
      lastUpdatedDay: updatedDay,
      warnings: normalized.warnings.map(() => "EBAY_ANALYTICS_REPORT_WARNING"),
    },
    observations: normalizedRows.flatMap(({ row, listingId }) => {
      if (!listingId || !requested.has(listingId)) return []
      const impressions = metric(row, "TOTAL_IMPRESSION_TOTAL")
      const searchImpressions = metric(row, "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE")
      const searchViews = metric(row, "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE")
      const views = metric(row, "LISTING_VIEWS_TOTAL")
      const transactions = metric(row, "TRANSACTION")
      const reportedCtr = metric(row, "CLICK_THROUGH_RATE")
      const reportedSalesConversionRate = metric(row, "SALES_CONVERSION_RATE")
      const canonicalCtrPercent = derivedRate(searchViews, searchImpressions)
      const canonicalSalesConversionPercent = derivedRate(transactions, views)
      return [{
        listingId,
        returnedDimension: row.dimension,
        impressions,
        views,
        // The UI and rule engine use percentage points. Deriving from the
        // official numerator/denominator keeps that contract stable even when
        // eBay serializes a reported rate as a ratio.
        ctr: canonicalCtrPercent ?? reportedCtr,
        transactions,
        salesConversionRate: canonicalSalesConversionPercent ??
          reportedSalesConversionRate,
        revenue: null,
        applicability: {
          impressions: row.applicability.TOTAL_IMPRESSION_TOTAL === true,
          views: row.applicability.LISTING_VIEWS_TOTAL === true,
          ctr: row.applicability.CLICK_THROUGH_RATE === true ||
            (row.applicability.LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE === true &&
              row.applicability.LISTING_IMPRESSION_SEARCH_RESULTS_PAGE === true),
          transactions: row.applicability.TRANSACTION === true,
          salesConversionRate: row.applicability.SALES_CONVERSION_RATE === true ||
            (row.applicability.TRANSACTION === true && row.applicability.LISTING_VIEWS_TOTAL === true),
          revenue: false,
        },
      }]
    }),
  }
}

export type ComparableEbayTrafficAnalytics = ReturnType<typeof reconcileEbayTrafficAnalyticsReport>

export type ComparableEbayAccountTrafficAnalytics = {
  completenessStatus: "complete" | "incomplete"
  dataFreshnessStatus: "CURRENT" | "REPORT_NOT_UPDATED_YET" | "INCOMPLETE_WINDOW"
  metrics: Array<{
    impressions: number | null
    views: number | null
    transactions: number | null
    ctr: number | null
  }>
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function closedEbayAnalyticsWindow(now: Date, days: number) {
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  return { dateFrom: isoDay(start), dateTo: isoDay(end), days }
}

export function calculateSellerHubCtr(views: number, impressions: number) {
  return impressions > 0
    ? Number(((views / impressions) * 100).toFixed(2))
    : null
}

function matchedObservation(report: ComparableEbayTrafficAnalytics, listingId: string) {
  return report.observations.find((row) => row.listingId === listingId) ?? null
}

function exactMetricsMatch(
  report: ComparableEbayTrafficAnalytics,
  listingId: string,
  evidence: SellerHubEvidence,
) {
  const row = matchedObservation(report, listingId)
  if (!row) return false
  return row.impressions === evidence.impressions &&
    row.views === evidence.views &&
    row.transactions === evidence.transactions &&
    row.ctr !== null && Math.abs(row.ctr - evidence.ctr) <= 0.1
}

function hasMetricMappingConflict(
  report: ComparableEbayTrafficAnalytics,
  listingId: string,
  evidence: SellerHubEvidence,
) {
  const row = matchedObservation(report, listingId)
  if (!row || row.ctr === null) return false
  return row.impressions === evidence.impressions &&
    row.views === evidence.views &&
    Math.abs(row.ctr - evidence.ctr) > 0.1
}

export function classifySellerHubComparison(input: {
  listingId: string
  evidence: SellerHubEvidence
  operational: ComparableEbayTrafficAnalytics
  comparison: ComparableEbayTrafficAnalytics
  accountDiagnostic?: ComparableEbayAccountTrafficAnalytics | null
}): SellerHubComparisonClassification {
  const accountMetrics = input.accountDiagnostic?.metrics[0]
  if (input.evidence.scope === "ACCOUNT") return "SELLER_HUB_ACCOUNT_LEVEL_NOT_LISTING_LEVEL"
  if (exactMetricsMatch(input.operational, input.listingId, input.evidence)) return "MATCH_EXACT"
  if (exactMetricsMatch(input.comparison, input.listingId, input.evidence)) return "MATCH_DIFFERENT_WINDOW"
  if (
    input.accountDiagnostic?.completenessStatus === "complete" &&
    accountMetrics?.impressions === input.evidence.impressions &&
    accountMetrics.views === input.evidence.views &&
    accountMetrics.transactions === input.evidence.transactions &&
    accountMetrics.ctr !== null && accountMetrics.ctr !== undefined &&
    Math.abs(accountMetrics.ctr - input.evidence.ctr) <= 0.1
  ) return "SELLER_HUB_ACCOUNT_LEVEL_NOT_LISTING_LEVEL"
  if (
    input.operational.dataFreshnessStatus === "LISTING_DIMENSION_MISMATCH" ||
    input.comparison.dataFreshnessStatus === "LISTING_DIMENSION_MISMATCH"
  ) return "LISTING_DIMENSION_MISMATCH"
  if (
    input.operational.dataFreshnessStatus === "REPORT_NOT_UPDATED_YET" ||
    input.comparison.dataFreshnessStatus === "REPORT_NOT_UPDATED_YET"
  ) return "REPORT_NOT_UPDATED_YET"
  if (
    hasMetricMappingConflict(input.operational, input.listingId, input.evidence) ||
    hasMetricMappingConflict(input.comparison, input.listingId, input.evidence)
  ) return "METRIC_MAPPING_ERROR"
  if (
    input.evidence.scope === "LISTING" &&
    input.operational.completenessStatus === "complete" &&
    input.comparison.completenessStatus === "complete" &&
    input.operational.matchedListingIds.includes(input.listingId) &&
    input.comparison.matchedListingIds.includes(input.listingId)
  ) return "SELLER_HUB_LISTING_API_DISCREPANCY"
  return "INSUFFICIENT_EVIDENCE"
}
