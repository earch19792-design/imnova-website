export const EBAY_SELLER_TRAFFIC_METRICS = [
  "TOTAL_IMPRESSION_TOTAL",
  "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
  "LISTING_IMPRESSION_STORE",
  "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
  "LISTING_VIEWS_SOURCE_DIRECT",
  "LISTING_VIEWS_SOURCE_OFF_EBAY",
  "LISTING_VIEWS_SOURCE_OTHER_EBAY",
  "LISTING_VIEWS_SOURCE_STORE",
  "LISTING_VIEWS_TOTAL",
  "CLICK_THROUGH_RATE",
  "TRANSACTION",
  "SALES_CONVERSION_RATE",
] as const

export type EbaySellerTrafficMetric =
  typeof EBAY_SELLER_TRAFFIC_METRICS[number]

export type EbaySellerTrafficPerformanceInput = {
  dateFrom: string
  dateTo: string
  listingIds?: string[]
  timeZone?: "UTC" | "AMERICA_LOS_ANGELES"
}

const TRAFFIC_REPORT_ENDPOINT =
  "https://api.ebay.com/sell/analytics/v1/traffic_report"

type JsonRecord = Record<string, unknown>

export type EbaySellerTrafficRow = {
  dimension: string
  metrics: Record<string, number | null>
  applicability: Record<string, boolean>
}

export type EbaySellerTrafficDashboard = {
  dimension: "DAY" | "LISTING"
  dimensionLabel: string
  metricLabels: Record<string, string>
  rows: EbaySellerTrafficRow[]
  summary: {
    totalImpressions: number
    totalViews: number
    transactions: number
    clickThroughRate: number | null
    salesConversionRate: number | null
  }
  startDate: string | null
  endDate: string | null
  lastUpdatedDate: string | null
  warnings: string[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function buildEbaySellerTrafficReportUrl(
  input: EbaySellerTrafficPerformanceInput,
) {
  if (!validDate(input.dateFrom) || !validDate(input.dateTo)) {
    throw new Error("EBAY_ANALYTICS_DATE_RANGE_INVALID")
  }
  const days = Math.round(
    (new Date(`${input.dateTo}T00:00:00Z`).getTime() -
      new Date(`${input.dateFrom}T00:00:00Z`).getTime()) / 86_400_000,
  )
  // eBay's 90-day maximum is inclusive of both endpoints.
  if (days < 0 || days > 89) throw new Error("EBAY_ANALYTICS_DATE_RANGE_INVALID")
  const listingIds = [...new Set((input.listingIds ?? [])
    .filter((entry) => /^\d{9,20}$/.test(entry)))]
    .slice(0, 200)
  const url = new URL(TRAFFIC_REPORT_ENDPOINT)
  url.searchParams.set("dimension", listingIds.length ? "LISTING" : "DAY")
  const filters = [
    "marketplace_ids:{EBAY_US}",
    input.timeZone === "UTC"
      ? `date_range:[${input.dateFrom}T00:00:00.000Z..${input.dateTo}T23:59:59.999Z]`
      : `date_range:[${input.dateFrom.replaceAll("-", "")}..${input.dateTo.replaceAll("-", "")}]`,
    listingIds.length ? `listing_ids:{${listingIds.join("|")}}` : "",
  ].filter(Boolean).join(",")
  url.searchParams.set("filter", filters)
  url.searchParams.set("metric", EBAY_SELLER_TRAFFIC_METRICS.join(","))
  return {
    url,
    listingIds,
    timeZone: input.timeZone === "UTC" ? "UTC" as const : "AMERICA_LOS_ANGELES" as const,
  }
}

function reportValue(value: unknown): unknown {
  const nested = record(value)
  return Object.hasOwn(nested, "value")
    ? reportValue(nested.value)
    : value
}

function numericValue(value: unknown) {
  const normalized = reportValue(value)
  if (typeof normalized === "number") {
    return Number.isFinite(normalized) ? normalized : null
  }
  if (typeof normalized !== "string") return null
  const parsed = Number(normalized.replaceAll(",", "").replace(/%$/, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function stringValue(value: unknown) {
  const normalized = reportValue(value)
  return typeof normalized === "string" || typeof normalized === "number"
    ? String(normalized).trim()
    : ""
}

function metricTotal(rows: EbaySellerTrafficRow[], metric: EbaySellerTrafficMetric) {
  return rows.reduce((total, row) => {
    const value = row.metrics[metric]
    return total + (row.applicability[metric] && typeof value === "number" ? value : 0)
  }, 0)
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(2))
    : null
}

export function normalizeEbaySellerTrafficReport(
  input: unknown,
): EbaySellerTrafficDashboard {
  const report = record(input)
  const header = record(report.header)
  const dimensionDefinitions = array(header.dimensionKeys).map(record)
  const metricDefinitions = array(header.metrics).map(record)
  const dimensionKey = text(dimensionDefinitions[0]?.key).toUpperCase()
  // eBay documents LISTING for the request dimension, while some report
  // payloads describe the returned key as LISTING_ID. Both are listing scoped.
  const dimension = ["LISTING", "LISTING_ID"].includes(dimensionKey)
    ? "LISTING"
    : "DAY"
  const dimensionLabel = text(dimensionDefinitions[0]?.localizedName) ||
    (dimension === "LISTING" ? "Listing" : "Día")

  const metricLabels: Record<string, string> = {}
  const metricKeys = metricDefinitions.map((definition) => {
    const key = text(definition.key).toUpperCase()
    if (key) {
      metricLabels[key] = text(definition.localizedName) || key
    }
    return key
  })

  const rows = array(report.records).map((entry): EbaySellerTrafficRow => {
    const row = record(entry)
    const dimensionEntry = record(array(row.dimensionValues)[0])
    const metricValues = array(row.metricValues).map(record)
    const metrics: Record<string, number | null> = {}
    const applicability: Record<string, boolean> = {}

    metricKeys.forEach((key, index) => {
      if (!key) return
      const value = metricValues[index] ?? {}
      metrics[key] = numericValue(value.value)
      applicability[key] = value.applicable !== false
    })

    return {
      dimension: stringValue(dimensionEntry.value),
      metrics,
      applicability,
    }
  }).filter((row) => row.dimension.length > 0)

  const totalImpressions = metricTotal(rows, "TOTAL_IMPRESSION_TOTAL")
  const searchImpressions = metricTotal(
    rows,
    "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
  )
  const searchViews = metricTotal(
    rows,
    "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
  )
  const totalViews = metricTotal(rows, "LISTING_VIEWS_TOTAL")
  const transactions = metricTotal(rows, "TRANSACTION")

  const warnings = array(report.warnings).map((warning) => {
    const value = record(warning)
    return text(value.longMessage) || text(value.message)
  }).filter(Boolean)

  return {
    dimension,
    dimensionLabel,
    metricLabels,
    rows,
    summary: {
      totalImpressions,
      totalViews,
      transactions,
      clickThroughRate: safeRate(searchViews, searchImpressions),
      salesConversionRate: safeRate(transactions, totalViews),
    },
    startDate: text(report.startDate) || null,
    endDate: text(report.endDate) || null,
    lastUpdatedDate: text(report.lastUpdatedDate) || null,
    warnings,
  }
}
