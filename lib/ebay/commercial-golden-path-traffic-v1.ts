import { getEbaySellerTrafficPerformance } from "./ebay-seller-analytics-readonly-gateway"
import { normalizeEbaySellerTrafficRows, type EbaySellerTrafficPerformanceInput } from "./ebay-seller-traffic-report"
import { reconcileEbayTrafficAnalyticsReport, closedEbayAnalyticsWindow } from "./ebay-commercial-analytics-domain"
import { getEbaySellerAccountScopeConfiguration } from "./ebay-seller-account-scope"
import { goldenDigest, type GoldenRecord } from "./commercial-golden-path-domain-v1"

/** Three exact listing windows, authenticated official reads, no retry and no synthesized missing row. */
export async function readGoldenTrafficWindowsV1(input: { accountKey: string; itemId: string; now: Date }, reader: (request: EbaySellerTrafficPerformanceInput) => Promise<unknown> = getEbaySellerTrafficPerformance) {
  if (getEbaySellerAccountScopeConfiguration().accountKey !== input.accountKey) return { snapshots: [] as GoldenRecord[], limitations: ["ANALYTICS_CANONICAL_ACCOUNT_BINDING_REQUIRED"] }
  const settled = await Promise.allSettled(([1, 7, 30] as const).map(async days => {
    const window = closedEbayAnalyticsWindow(input.now, days)
    const request = { dateFrom: window.dateFrom, dateTo: window.dateTo, listingIds: [input.itemId], timeZone: "UTC" as const }
    const raw = await reader(request), normalized = normalizeEbaySellerTrafficRows(raw)
    const proof = reconcileEbayTrafficAnalyticsReport(request, normalized)
    if (proof.status !== "AVAILABLE" || proof.queryTimeZone !== "UTC" || proof.observations.length !== 1 || normalized.startDate?.slice(0, 10) !== window.dateFrom || normalized.endDate?.slice(0, 10) !== window.dateTo) throw Error("EXACT_FRESH_ANALYTICS_WINDOW_UNPROVEN")
    const row = normalized.rows[0]
    const observation = proof.observations[0]
    if (!row || observation.listingId !== input.itemId) throw Error("EXACT_ANALYTICS_LISTING_DIMENSION_REQUIRED")
    const metric = (key: string) => row.applicability[key] === true && typeof row.metrics[key] === "number" && row.metrics[key]! >= 0 ? row.metrics[key] : null
    const body = { marketplace_account_key: input.accountKey, marketplace: "EBAY_US", listing_id: input.itemId, window_start: window.dateFrom, window_end: window.dateTo, observed_at: new Date().toISOString(), completeness_status: "complete",
      impressions: metric("TOTAL_IMPRESSION_TOTAL"), views: metric("LISTING_VIEWS_TOTAL"), transactions: metric("TRANSACTION"), current_watchers: null,
      source: { analytics: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT", queryTimeZone: "UTC", externalViews: metric("LISTING_VIEWS_SOURCE_OFF_EBAY"), externalViewsApplicable: row.applicability.LISTING_VIEWS_SOURCE_OFF_EBAY === true, calculatedCtrNumerator: metric("LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE"), calculatedCtrDenominator: metric("LISTING_IMPRESSION_SEARCH_RESULTS_PAGE"), calculatedCtrApplicable: row.applicability.LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE === true && row.applicability.LISTING_IMPRESSION_SEARCH_RESULTS_PAGE === true, lastUpdatedDate: normalized.lastUpdatedDate, sourceEvidenceDigest: goldenDigest({ request, normalized, proof }), syntheticFallbackUsed: false, fixtureEvidenceUsed: false, accountBinding: "OFFICIAL_GET_USER_VERIFIED_BY_ANALYTICS_READER", marketplaceWrites: 0 } }
    return { ...body, id: goldenDigest(body) }
  }))
  return { snapshots: settled.flatMap(r => r.status === "fulfilled" ? [r.value] : []), limitations: settled.flatMap((r, i) => r.status === "rejected" ? [`${["24H", "7D", "30D"][i]}_ANALYTICS_SOURCE_OR_EXACT_WINDOW_UNPROVEN`] : []) }
}
