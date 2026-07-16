export const ANALYTICS_SOURCE_DIVERGENCE = "ANALYTICS_SOURCE_DIVERGENCE"
export const SELLER_HUB_LISTING_API_DISCREPANCY = "SELLER_HUB_LISTING_API_DISCREPANCY"

export type CommercialAnalyticsMetrics = {
  impressions: number | null
  views: number | null
  transactions: number | null
  ctr: number | null
}

export type SellerHubListingEvidence = CommercialAnalyticsMetrics & {
  listingId: string
  sku: string
  observedOn: string
  source: "SELLER_HUB_MANUAL_LISTING_OBSERVATION"
  impressionsMetric: "ORGANIC_IMPRESSIONS"
  viewsMetric: "ORGANIC_LISTING_VIEWS"
  transactionsMetric: "QUANTITY_SOLD"
}

function finiteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonnegativeInteger(value: unknown, code: string) {
  const parsed = finiteNumber(value)
  if (parsed === null || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error(code)
  return parsed
}

function rate(value: unknown) {
  const parsed = finiteNumber(value)
  if (parsed === null || parsed < 0 || parsed > 100) {
    throw new Error("COMMERCIAL_MANUAL_EVIDENCE_CTR_INVALID")
  }
  return Number(parsed.toFixed(2))
}

export function normalizeSellerHubListingEvidence(input: Record<string, unknown>): SellerHubListingEvidence {
  const listingId = typeof input.listingId === "string" ? input.listingId.trim() : ""
  const sku = typeof input.sku === "string" ? input.sku.trim() : ""
  const observedOn = typeof input.observedOn === "string" ? input.observedOn.trim() : ""
  if (!/^\d{9,20}$/.test(listingId)) throw new Error("COMMERCIAL_MANUAL_EVIDENCE_LISTING_ID_INVALID")
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(sku)) throw new Error("COMMERCIAL_MANUAL_EVIDENCE_SKU_INVALID")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn) ||
      new Date(`${observedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== observedOn) {
    throw new Error("COMMERCIAL_MANUAL_EVIDENCE_DATE_INVALID")
  }
  const impressions = nonnegativeInteger(
    input.impressions,
    "COMMERCIAL_MANUAL_EVIDENCE_IMPRESSIONS_INVALID",
  )
  const views = nonnegativeInteger(input.views, "COMMERCIAL_MANUAL_EVIDENCE_VIEWS_INVALID")
  const transactions = nonnegativeInteger(
    input.transactions,
    "COMMERCIAL_MANUAL_EVIDENCE_TRANSACTIONS_INVALID",
  )
  const ctr = rate(input.ctr)
  const calculatedCtr = impressions > 0
    ? Number(((views / impressions) * 100).toFixed(2))
    : views === 0 ? 0 : null
  if (calculatedCtr === null || Math.abs(calculatedCtr - ctr) > 0.1) {
    throw new Error("COMMERCIAL_MANUAL_EVIDENCE_CTR_INCONSISTENT")
  }
  return {
    listingId,
    sku,
    observedOn,
    source: "SELLER_HUB_MANUAL_LISTING_OBSERVATION",
    impressionsMetric: "ORGANIC_IMPRESSIONS",
    viewsMetric: "ORGANIC_LISTING_VIEWS",
    transactionsMetric: "QUANTITY_SOLD",
    impressions,
    views,
    transactions,
    ctr,
  }
}

function equalNullable(left: number | null, right: number | null, tolerance = 0) {
  if (left === null || right === null) return left === right
  return Math.abs(left - right) <= tolerance
}

export function commercialAnalyticsSourcesMatch(
  manual: CommercialAnalyticsMetrics,
  official: CommercialAnalyticsMetrics,
) {
  return equalNullable(manual.impressions, official.impressions) &&
    equalNullable(manual.views, official.views) &&
    equalNullable(manual.transactions, official.transactions) &&
    equalNullable(manual.ctr, official.ctr, 0.1)
}

export function commercialAnalyticsDivergenceState(input: {
  manual: CommercialAnalyticsMetrics
  official: CommercialAnalyticsMetrics | null
  officialComparable: boolean
  verifiedExplanation?: string | null
}) {
  const explanation = input.verifiedExplanation?.trim() ?? ""
  if (explanation) return {
    status: "resolved" as const,
    healthFlag: null,
    classification: "VERIFIED_EXPLANATION" as const,
    analyticsRulesSuspended: false,
  }
  if (
    input.officialComparable && input.official &&
    commercialAnalyticsSourcesMatch(input.manual, input.official)
  ) return {
    status: "resolved" as const,
    healthFlag: null,
    classification: "SOURCES_MATCH" as const,
    analyticsRulesSuspended: false,
  }
  return {
    status: "open" as const,
    healthFlag: ANALYTICS_SOURCE_DIVERGENCE,
    classification: SELLER_HUB_LISTING_API_DISCREPANCY,
    analyticsRulesSuspended: true,
  }
}
