import {
  getEbaySellerTrafficPerformance,
} from "./ebay-seller-analytics-readonly-gateway"
import { normalizeEbaySellerTrafficReport } from "./ebay-seller-traffic-report"
import { reconcileEbayTrafficAnalyticsReport } from "./ebay-commercial-analytics-domain"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"
import {
  normalizeCompletedEbayOrders,
  type SafeMarketplaceOrder,
} from "../marketplace/commercial-monitor-domain"
import {
  clearEbayCommercialOrdersAccessToken,
  getEbayCommercialOrdersAccessToken,
  getEbayCommercialOrdersOAuthConfiguration,
} from "./ebay-commercial-oauth"
import {
  getEbayTradingReadOnlyAccessToken,
} from "./ebay-manual-listing-trading-readonly"
import {
  normalizeEbayFulfillmentOrderGuard,
  type EbayFulfillmentGuardExpectedLine,
} from "../marketplace/fulfillment-v1a-domain"

const EBAY_API_ORIGIN = "https://api.ebay.com"
const ORDERS_ENDPOINT = `${EBAY_API_ORIGIN}/sell/fulfillment/v1/order`
const TRADING_ENDPOINT = `${EBAY_API_ORIGIN}/ws/api.dll`
const TRADING_COMPATIBILITY_LEVEL = "1423"
const MARKETPLACE_ID = "EBAY_US"
const REQUEST_TIMEOUT_MS = 12_000
const MAX_RETRIES = 3
const MAX_ORDER_PAGES = 20
const WATCHER_CONCURRENCY = 4

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

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

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function escapedXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function xmlValue(xml: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
    "i",
  ))
  return match?.[1]
    ?.replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim() || null
}

function retryable(status: number) {
  return [429, 500, 502, 503, 504].includes(status)
}

async function wait(attempt: number) {
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.min(400 * (2 ** attempt), 3_000) + Math.floor(Math.random() * 150),
  ))
}

export async function verifyEbayCommercialOfficialAccount(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
) {
  const identity = getEbayProductionIdentityBindingConfiguration()
  if (!identity.bound) throw new Error("EBAY_COMMERCIAL_ACCOUNT_IDENTITY_REQUIRED")
  const response = await fetchImpl(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetUser",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "</GetUserRequest>",
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const xml = await response.text()
  const ack = xmlValue(xml, "Ack")?.toLowerCase()
  const userId = xmlValue(xml, "UserID")
  if (!response.ok || !["success", "warning"].includes(ack ?? "") || !userId) {
    throw new Error("EBAY_COMMERCIAL_ACCOUNT_IDENTITY_UNAVAILABLE")
  }
  const userMatches = !identity.expectedUserId ||
    identity.expectedUserId.toLocaleLowerCase("en-US") === userId.toLocaleLowerCase("en-US")
  const fingerprintMatches = ebayProductionAccountFingerprint(userId) === identity.expectedAccountFingerprint
  if (!userMatches || !fingerprintMatches) {
    throw new Error("EBAY_COMMERCIAL_ACCOUNT_IDENTITY_MISMATCH")
  }
  return {
    identityMatch: true as const,
    fingerprintMatches: true as const,
    userIdReturned: false as const,
  }
}

async function ordersPage(url: URL, token: string, fetchImpl: FetchLike) {
  if (url.origin !== EBAY_API_ORIGIN || url.pathname !== "/sell/fulfillment/v1/order") {
    throw new Error("BLOCKED_NON_READONLY_EBAY_ORDER_REQUEST")
  }
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.ok) return record(await response.json())
    if (response.status === 401) clearEbayCommercialOrdersAccessToken()
    if (!retryable(response.status) || attempt === MAX_RETRIES - 1) {
      throw new Error(`EBAY_ORDERS_READ_${response.status}`)
    }
    await wait(attempt)
  }
  throw new Error("EBAY_ORDERS_READ_FAILED")
}

export async function getEbayCompletedCheckoutOrders(input: {
  modifiedFrom: string
  modifiedTo?: string
  fetchImpl?: FetchLike
}): Promise<{
  status: "AVAILABLE"
  source: "EBAY_SELL_FULFILLMENT_GET_ORDERS"
  orders: SafeMarketplaceOrder[]
  observedAt: string
  pagesRead: number
  rawOrdersDiscardedAfterSanitization: number
}> {
  const modifiedFrom = new Date(input.modifiedFrom)
  const modifiedTo = input.modifiedTo ? new Date(input.modifiedTo) : new Date()
  if (!Number.isFinite(modifiedFrom.getTime()) || !Number.isFinite(modifiedTo.getTime()) || modifiedFrom >= modifiedTo) {
    throw new Error("EBAY_ORDERS_DATE_RANGE_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const token = await getEbayCommercialOrdersAccessToken(fetchImpl)
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const initial = new URL(ORDERS_ENDPOINT)
  initial.searchParams.set(
    "filter",
    `lastmodifieddate:[${modifiedFrom.toISOString()}..${modifiedTo.toISOString()}]`,
  )
  initial.searchParams.set("limit", "50")
  initial.searchParams.set("offset", "0")
  const orders: SafeMarketplaceOrder[] = []
  let rawOrderCount = 0
  let next: URL | null = initial
  let pagesRead = 0
  while (next && pagesRead < MAX_ORDER_PAGES) {
    const payload = await ordersPage(next, token, fetchImpl)
    const rawOrders = array(payload.orders)
    rawOrderCount += rawOrders.length
    orders.push(...normalizeCompletedEbayOrders(payload))
    pagesRead += 1
    const nextUrl = text(payload.next)
    next = nextUrl ? new URL(nextUrl, EBAY_API_ORIGIN) : null
  }
  if (next) throw new Error("EBAY_ORDERS_PAGE_LIMIT_REACHED")
  return {
    status: "AVAILABLE",
    source: "EBAY_SELL_FULFILLMENT_GET_ORDERS",
    orders,
    observedAt: new Date().toISOString(),
    pagesRead,
    rawOrdersDiscardedAfterSanitization: Math.max(0, rawOrderCount - orders.length),
  }
}

export async function getEbayFulfillmentOrderGuard(input: {
  orderId: string
  expectedLines: EbayFulfillmentGuardExpectedLine[]
  fetchImpl?: FetchLike
}) {
  const orderId = input.orderId.trim()
  if (!/^[A-Za-z0-9-]{5,120}$/.test(orderId) || !input.expectedLines.length) {
    throw new Error("EBAY_FULFILLMENT_GUARD_INPUT_INVALID")
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const token = await getEbayCommercialOrdersAccessToken(fetchImpl)
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const url = new URL(`${ORDERS_ENDPOINT}/${encodeURIComponent(orderId)}`)
  let payload: JsonRecord | null = null
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.ok) {
      payload = record(await response.json())
      break
    }
    if (response.status === 401) clearEbayCommercialOrdersAccessToken()
    if (!retryable(response.status) || attempt === MAX_RETRIES - 1) {
      throw new Error(`EBAY_FULFILLMENT_GUARD_READ_${response.status}`)
    }
    await wait(attempt)
  }
  if (!payload) throw new Error("EBAY_FULFILLMENT_GUARD_READ_FAILED")
  const guard = normalizeEbayFulfillmentOrderGuard(payload, orderId, input.expectedLines)
  if (!guard.identityMatch) throw new Error("EBAY_FULFILLMENT_GUARD_IDENTITY_MISMATCH")
  return {
    ...guard,
    source: "EBAY_SELL_FULFILLMENT_GET_ORDER_READONLY" as const,
    identityVerified: true as const,
    ebayWrites: 0 as const,
  }
}

async function watcherRead(
  listingId: string,
  accessToken: string,
  fetchImpl: FetchLike,
) {
  if (!/^\d{9,20}$/.test(listingId)) throw new Error("EBAY_WATCHERS_LISTING_ID_INVALID")
  const body = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${escapedXml(listingId)}</ItemID>` +
    "<IncludeWatchCount>true</IncludeWatchCount>" +
    "<OutputSelector>Item.ItemID</OutputSelector>" +
    "<OutputSelector>Item.SKU</OutputSelector>" +
    "<OutputSelector>Item.SellingStatus.ListingStatus</OutputSelector>" +
    "<OutputSelector>Item.SellingStatus.CurrentPrice</OutputSelector>" +
    "<OutputSelector>Item.Currency</OutputSelector>" +
    "<OutputSelector>Item.WatchCount</OutputSelector>" +
    "</GetItemRequest>"
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const response = await fetchImpl(TRADING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const xml = await response.text()
    const ack = xmlValue(xml, "Ack")?.toLowerCase()
    if (response.ok && ["success", "warning"].includes(ack ?? "")) {
      const returnedItemId = xmlValue(xml, "ItemID")
      const returnedSku = xmlValue(xml, "SKU")
      const listingStatus = xmlValue(xml, "ListingStatus")
      const currentPrice = numeric(xmlValue(xml, "CurrentPrice"))
      const currency = xmlValue(xml, "Currency")
      const count = numeric(xmlValue(xml, "WatchCount"))
      if (returnedItemId !== listingId) throw new Error("EBAY_WATCHERS_ITEM_ID_MISMATCH")
      return {
        listingId,
        returnedSku,
        listingStatus,
        currentPrice,
        currency,
        currentWatchers: count === null ? 0 : Math.max(0, Math.trunc(count)),
        source: "EBAY_TRADING_GET_ITEM_WATCHCOUNT" as const,
        observedAt: new Date().toISOString(),
      }
    }
    if (!retryable(response.status) || attempt === MAX_RETRIES - 1) {
      throw new Error(`EBAY_WATCHERS_READ_${response.status}`)
    }
    await wait(attempt)
  }
  throw new Error("EBAY_WATCHERS_READ_FAILED")
}

export async function verifyEbayActiveListingIdentities(input: {
  listings: Array<{ listingId: string; sku: string }>
  fetchImpl?: FetchLike
}) {
  const listings = [...new Map(input.listings
    .filter((row) => /^\d{9,20}$/.test(row.listingId) && row.sku.trim().length > 0)
    .map((row) => [`${row.listingId}:${row.sku}`, {
      listingId: row.listingId,
      sku: row.sku.trim().slice(0, 100),
    }])).values()].slice(0, 200)
  if (!listings.length) return {
    status: "UNAVAILABLE" as const,
    source: "EBAY_TRADING_GET_ITEM_READONLY" as const,
    observations: [],
    errors: [],
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const token = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const observations: Array<{
    listingId: string
    expectedSku: string
    observedListingId: string
    observedSku: string | null
    observedListingStatus: string | null
    currentPrice: number | null
    currency: string | null
    itemIdMatches: boolean
    skuMatches: boolean
    activeListingConfirmed: boolean
    source: "EBAY_TRADING_GET_ITEM_READONLY"
    observedAt: string
  }> = []
  const errors: Array<{ listingId: string; expectedSku: string; code: string }> = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(WATCHER_CONCURRENCY, listings.length) }, async () => {
    while (cursor < listings.length) {
      const expected = listings[cursor++]
      try {
        const result = await watcherRead(expected.listingId, token, fetchImpl)
        const itemIdMatches = result.listingId === expected.listingId
        const skuMatches = result.returnedSku === expected.sku
        const activeListingConfirmed = itemIdMatches && skuMatches &&
          result.listingStatus?.toLocaleLowerCase("en-US") === "active"
        observations.push({
          listingId: expected.listingId,
          expectedSku: expected.sku,
          observedListingId: result.listingId,
          observedSku: result.returnedSku,
          observedListingStatus: result.listingStatus,
          currentPrice: result.currentPrice,
          currency: result.currency,
          itemIdMatches,
          skuMatches,
          activeListingConfirmed,
          source: "EBAY_TRADING_GET_ITEM_READONLY",
          observedAt: result.observedAt,
        })
      } catch (error) {
        errors.push({
          listingId: expected.listingId,
          expectedSku: expected.sku,
          code: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
            ? error.message
            : "EBAY_LISTING_IDENTITY_READ_FAILED",
        })
      }
    }
  }))
  return {
    status: observations.length === listings.length
      ? "AVAILABLE" as const
      : observations.length ? "PARTIAL" as const : "UNAVAILABLE" as const,
    source: "EBAY_TRADING_GET_ITEM_READONLY" as const,
    observations,
    errors,
  }
}

export async function getEbayListingWatchers(input: {
  listingIds: string[]
  fetchImpl?: FetchLike
}) {
  const listingIds = [...new Set(input.listingIds.filter((id) => /^\d{9,20}$/.test(id)))].slice(0, 200)
  const fetchImpl = input.fetchImpl ?? fetch
  if (!listingIds.length) return {
    status: "UNAVAILABLE" as const,
    source: "EBAY_TRADING_GET_ITEM_WATCHCOUNT" as const,
    observations: [],
    errors: [],
  }
  const token = await getEbayTradingReadOnlyAccessToken(fetchImpl)
  await verifyEbayCommercialOfficialAccount(token, fetchImpl)
  const observations: Awaited<ReturnType<typeof watcherRead>>[] = []
  const errors: Array<{ listingId: string; code: string }> = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(WATCHER_CONCURRENCY, listingIds.length) }, async () => {
    while (cursor < listingIds.length) {
      const listingId = listingIds[cursor++]
      try {
        observations.push(await watcherRead(listingId, token, fetchImpl))
      } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "EBAY_WATCHERS_READ_FAILED"
        errors.push({ listingId, code })
      }
    }
  }))
  return {
    status: observations.length === listingIds.length
      ? "AVAILABLE" as const
      : observations.length
        ? "PARTIAL" as const
        : "UNAVAILABLE" as const,
    source: "EBAY_TRADING_GET_ITEM_WATCHCOUNT" as const,
    observations,
    errors,
  }
}

export async function getComparableEbayTrafficAnalytics(input: {
  listingIds: string[]
  dateFrom: string
  dateTo: string
  timeZone?: "UTC"
}) {
  const report = await getEbaySellerTrafficPerformance(input)
  return reconcileEbayTrafficAnalyticsReport(
    input,
    normalizeEbaySellerTrafficReport(report),
  )
}

export function getEbayCommercialReadersConfiguration() {
  const account = getEbaySellerAccountScopeConfiguration()
  const orders = getEbayCommercialOrdersOAuthConfiguration()
  return {
    configured: Boolean(
      process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim() &&
      process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() &&
      orders.configured &&
      account.configured
    ),
    ordersConfigured: orders.configured,
    ordersRefreshTokenSource: orders.refreshTokenSource,
    ordersGeneralRefreshTokenFallbackAllowed: false,
    watchersConfigured: Boolean(
      process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim() &&
      process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() &&
      account.configured
    ),
    accountScopeConfigured: account.configured,
    accountScopeReason: account.reason,
    orderScope: "sell.fulfillment.readonly",
    analyticsScope: "sell.analytics.readonly",
    watchersSource: "Trading GetItem IncludeWatchCount",
    officialReadMethods: ["Fulfillment getOrders", "Analytics getTrafficReport", "Trading GetItem"],
    ebayWriteUsed: false,
    canPublish: false,
  }
}
