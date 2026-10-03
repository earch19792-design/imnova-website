import { goldenNumber, goldenRecord, type GoldenRecord } from "./commercial-golden-path-domain-v1"

/** Exact, completed UTC windows. Missing cells and missing windows remain null. */
export function projectGoldenMonitoringV1(input: { accountKey: string; itemId: string; now: Date; snapshots: GoldenRecord[]; readAvailable: boolean; stock: GoldenRecord }) {
  const end = new Date(input.now); end.setUTCHours(0, 0, 0, 0)
  const endDate = new Date(+end - 86400000).toISOString().slice(0, 10)
  const windows = Object.fromEntries(([['24H', 1], ['7D', 7], ['30D', 30]] as const).map(([name, days]) => {
    const startDate = new Date(+end - days * 86400000).toISOString().slice(0, 10)
    const dayMatches = (value: unknown, day: string) => value === day || typeof value === 'string' && Date.parse(value) === Date.parse(`${day}T00:00:00Z`)
    const row = input.snapshots.filter(r => r.marketplace_account_key === input.accountKey && r.listing_id === input.itemId && r.marketplace === 'EBAY_US' && dayMatches(r.window_start, startDate) && dayMatches(r.window_end, endDate) && goldenRecord(r.source).queryTimeZone === 'UTC').sort((a, b) => Date.parse(String(b.observed_at)) - Date.parse(String(a.observed_at)))[0]
    const source = goldenRecord(row?.source), observedAt = row?.observed_at ?? null
    const fresh = observedAt != null && Date.parse(String(observedAt)) <= +input.now && +input.now - Date.parse(String(observedAt)) < 86400000
    const authority = Boolean(input.readAvailable && row && fresh && row.completeness_status === 'complete' && source.analytics === 'EBAY_SELL_ANALYTICS_TRAFFIC_REPORT' && source.syntheticFallbackUsed === false && source.fixtureEvidenceUsed === false)
    const metric = (key: string) => authority ? goldenNumber(row?.[key]) : null
    const impressions = metric('impressions'), totalViews = metric('views'), external = metric('external_views') ?? (authority && source.externalViewsApplicable === true ? goldenNumber(source.externalViews) : null)
    const ebayViews = totalViews !== null && external !== null && totalViews >= external ? totalViews - external : null
    const searchViews = authority && source.calculatedCtrApplicable === true ? goldenNumber(source.calculatedCtrNumerator) : null, searchImpressions = authority && source.calculatedCtrApplicable === true ? goldenNumber(source.calculatedCtrDenominator) : null
    const pct = (n: number | null, d: number | null) => n !== null && d !== null && d > 0 ? Math.round(n / d * 10000) / 100 : null
    const unitsSold = metric('transactions') // eBay TRANSACTION means quantity sold, never order count.
    const complete = [impressions, totalViews, external, unitsSold].every(v => v !== null)
    return [name, { status: authority && complete ? 'AVAILABLE_TRAFFIC_PARTIAL_ECONOMICS' : 'UNPROVEN', windowStart: startDate, windowEnd: endDate, windowDefinition: 'LAST_COMPLETE_UTC_DAYS', observedAt, sourceReceiptId: authority ? row.id : null,
      impressions, totalListingViews: totalViews, ebayViews, externalViews: external, ctr: pct(searchViews, searchImpressions), ctrBasis: 'SEARCH_VIEWS_DIVIDED_BY_SEARCH_IMPRESSIONS_PERCENT', watchers: metric('current_watchers'), orders: null, unitsSold, conversion: pct(unitsSold, totalViews), revenue: null, fees: null, promotedFees: null, cost: null, supplierShipping: null, netProfit: null, margin: null, roi: null,
      stockState: input.stock.stockGuardState ?? 'UNPROVEN', freshness: fresh ? 'FRESH' : observedAt ? 'STALE' : 'UNKNOWN',
      dataQuality: authority ? ['ORDER_AND_REALIZED_ECONOMICS_AUTHORITY_REQUIRED'] : [input.readAvailable ? 'EXACT_FRESH_UTC_WINDOW_AUTHORITY_REQUIRED' : 'SOURCE_READ_UNAVAILABLE'] }]
  }))
  const stockRisk = input.stock.supplierLinkage === 'CERTIFIED' && input.stock.stockFreshness === 'FRESH' && ['OUT_OF_STOCK', 'LOW_STOCK'].includes(String(input.stock.supplierAvailability))
  return { windows, state: stockRisk ? 'STOCK_RISK' : 'UNPROVEN', automaticEndAllowed: false, marketplaceWrites: 0 }
}
