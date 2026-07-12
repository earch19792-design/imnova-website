import {
  buildEbaySellerTrafficReportUrl,
  type EbaySellerTrafficPerformanceInput,
} from "./ebay-seller-traffic-report"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
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

export async function getEbaySellerTrafficPerformance(
  input: EbaySellerTrafficPerformanceInput,
) {
  const { url, listingIds } = buildEbaySellerTrafficReportUrl(input)
  let token = ""
  try {
    token = await getSellerAnalyticsAccessToken()
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
      requestedListingIds: listingIds,
      header: record(payload.header),
      dimensionMetadata: array(payload.dimensionMetadata),
      records: array(payload.records),
      startDate: text(payload.startDate) || null,
      endDate: text(payload.endDate) || null,
      lastUpdatedDate: text(payload.lastUpdatedDate) || null,
      warnings: array(payload.warnings),
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
