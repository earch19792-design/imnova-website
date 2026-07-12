const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const TRAFFIC_REPORT_ENDPOINT = "https://api.ebay.com/sell/analytics/v1/traffic_report"
const ANALYTICS_SCOPE = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly",
].join(" ")
const EBAY_REQUEST_TIMEOUT_MS = 10_000

type JsonRecord = Record<string, unknown>

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
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())
}

function assertReadonlyAnalyticsUrl(url: URL) {
  if (
    url.origin !== "https://api.ebay.com" ||
    url.pathname !== "/sell/analytics/v1/traffic_report"
  ) {
    throw new Error("BLOCKED_NON_READONLY_EBAY_ANALYTICS_REQUEST")
  }
}

async function getSellerAnalyticsAccessToken() {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  if (!clientId || !clientSecret) throw new Error("EBAY_READONLY_ENV_MISSING")
  if (!refreshToken) throw new Error("EBAY_SELLER_OAUTH_NOT_CONFIGURED")
  const credentials = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: ANALYTICS_SCOPE,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`EBAY_SELLER_OAUTH_${response.status}`)
  const accessToken = text(record(await response.json()).access_token)
  if (!accessToken) throw new Error("EBAY_SELLER_OAUTH_TOKEN_MISSING")
  return accessToken
}

export async function getEbaySellerTrafficPerformance(input: {
  dateFrom: string
  dateTo: string
  listingIds?: string[]
}) {
  if (!validDate(input.dateFrom) || !validDate(input.dateTo)) {
    throw new Error("EBAY_ANALYTICS_DATE_RANGE_INVALID")
  }
  const days = Math.round(
    (new Date(`${input.dateTo}T00:00:00Z`).getTime() -
      new Date(`${input.dateFrom}T00:00:00Z`).getTime()) / 86_400_000
  )
  if (days < 0 || days > 90) throw new Error("EBAY_ANALYTICS_DATE_RANGE_INVALID")
  const listingIds = [...new Set((input.listingIds ?? [])
    .filter((entry) => /^\d+$/.test(entry)))]
    .slice(0, 200)
  let token = ""
  try {
    token = await getSellerAnalyticsAccessToken()
    const url = new URL(TRAFFIC_REPORT_ENDPOINT)
    url.searchParams.set("dimension", listingIds.length ? "LISTING" : "DAY")
    const filters = [
      "marketplace_ids:{EBAY_US}",
      `date_range:[${input.dateFrom}..${input.dateTo}]`,
      listingIds.length ? `listing_ids:{${listingIds.join("|")}}` : "",
    ].filter(Boolean).join(",")
    url.searchParams.set("filter", filters)
    url.searchParams.set(
      "metric",
      "TOTAL_IMPRESSION_TOTAL,LISTING_VIEWS_TOTAL,CLICK_THROUGH_RATE,TRANSACTION,SALES_CONVERSION_RATE"
    )
    assertReadonlyAnalyticsUrl(url)
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(EBAY_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`EBAY_ANALYTICS_READ_${response.status}`)
    const payload = record(await response.json())
    return {
      status: "AVAILABLE",
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      dimension: listingIds.length ? "LISTING" : "DAY",
      records: array(payload.records),
      lastUpdatedDate: text(payload.lastUpdatedDate) || null,
      feedbackUse: {
        optimizeVisibilityWithImpressions: true,
        optimizeClickThroughWithViewsAndCtr: true,
        optimizeConversionWithTransactions: true,
        provesCompetitorSales: false,
        appliesOnlyToOurSellerAccount: true,
      },
      safety: {
        ebayMode: "SELL_ANALYTICS_READONLY",
        ebayWriteUsed: false,
        tokenReturned: false,
        tokenStoredByApplication: false,
        canPublish: false,
      },
    }
  } finally {
    token = ""
  }
}

export function getEbaySellerAnalyticsConfigurationState() {
  return {
    configured: Boolean(process.env.EBAY_SELLER_REFRESH_TOKEN?.trim()),
    requiredScope: "sell.analytics.readonly",
    refreshTokenReturnedToBrowser: false,
    refreshTokenLogged: false,
    ebayWriteUsed: false,
  }
}
