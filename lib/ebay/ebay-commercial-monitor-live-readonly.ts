import { createHash } from "node:crypto"

import {
  reconcileEbayTrafficAnalyticsReport,
} from "./ebay-commercial-analytics-domain"
import {
  assertEbayMonitorReadonlyRequest,
  EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
  normalizeLiveDiscoveryCoverage,
  parseEbayTradingGetItemMarketplace,
  parseEbayTradingGetMyeBaySellingPage,
  parseEbayTradingGetUser,
  sanitizeLiveEbayOrders,
  type EbayLiveListing,
  type EbayItemMarketplaceCertificationStatus,
  type EbayMonitorReadonlyCallEvidence,
  type EbayMonitorReadonlyOperation,
  type SafeLiveEbayOrder,
} from "./ebay-commercial-monitor-live-readonly-domain"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
  normalizeEbaySellerAccountAlias,
} from "./ebay-seller-account-scope"
import {
  buildEbaySellerTrafficReportUrl,
  EBAY_SELLER_TRAFFIC_METRICS,
  normalizeEbaySellerTrafficRows,
} from "./ebay-seller-traffic-report"

const EBAY_API_ORIGIN = "https://api.ebay.com"
const OAUTH_ENDPOINT = `${EBAY_API_ORIGIN}/identity/v1/oauth2/token`
const TRADING_ENDPOINT = `${EBAY_API_ORIGIN}/ws/api.dll`
const INVENTORY_ITEMS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/inventory/v1/inventory_item`
const INVENTORY_OFFERS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/inventory/v1/offer`
const FULFILLMENT_ORDERS_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/fulfillment/v1/order`
const MARKETPLACE_ID = "EBAY_US"
const TRADING_COMPATIBILITY_LEVEL = "1423"
const REQUEST_TIMEOUT_MS = 7_500
const REQUEST_BUDGET_MS = 24_000
const REQUEST_MAX_CALLS = 60
const SELLER_WIDE_PAGE_SIZE = 200
const SELLER_WIDE_MAX_PAGES = 125
const INVENTORY_MAX_SKUS = 100
const ANALYTICS_MAX_LISTINGS = 400
const FULFILLMENT_MAX_PAGES = 10
const GET_ITEM_DOWNSTREAM_CALL_RESERVE = 9
const GET_ITEM_DOWNSTREAM_TIME_RESERVE_MS = 6_000
const GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS = 32
const GET_ITEM_MARKETPLACE_CONCURRENCY = 4

const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const INVENTORY_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly"
const ANALYTICS_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly"
const FULFILLMENT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch
type Clock = () => Date
type RequestBudget = { deadlineAt: number; callsRemaining: number }

const requestBudgets = new WeakMap<
  EbayMonitorReadonlyCallEvidence[],
  RequestBudget
>()
const callEvidenceByResponse = new WeakMap<
  Response,
  EbayMonitorReadonlyCallEvidence
>()

export type EbayMonitorScopeClassification =
  | "READ_REQUIRED"
  | "READ_AVAILABLE"
  | "WRITE_CAPABLE_BUT_NOT_USED"
  | "MISSING"

export type EbayMonitorScopeEvidence = {
  scope: string
  classifications: EbayMonitorScopeClassification[]
  evidenceOperation: string | null
}

export type EbayLiveAnalyticsObservation = {
  itemId: string
  impressions: number | null
  totalListingViews: number | null
  externalViews: number | null
  transactions: number | null
  reportedCtr: number | null
  calculatedCtr: number | null
  calculatedCtrNumerator: number | null
  calculatedCtrDenominator: number | null
  reportedConversion: number | null
  applicable: {
    impressions: boolean
    totalListingViews: boolean
    externalViews: boolean
    transactions: boolean
    reportedCtr: boolean
    calculatedCtr: boolean
    reportedConversion: boolean
  }
  windowStart: string
  windowEnd: string
  observedAt: string
  sourceUpdatedAt: string | null
  lastUpdatedDate: string | null
  completeness: "COMPLETE" | "PARTIAL"
  freshnessStatus: string
  source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT"
}

export type EbayLiveInventoryResult = {
  status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
  observedAt: string | null
  inventorySkuCount: number | null
  publishedListingIds: string[]
  publishedOffers: Array<{ itemId: string; sku: string }>
  gapCodes: string[]
}

export type EbaySellerWideEnumerationIdentity = {
  itemId: string
  sku: string | null
  variationKey: string | null
  identityAmbiguous: boolean
  representationEligible: false
  analyticsEligible: false
}

export type EbayMarketplaceCertificationCounters = {
  sellerWideItemsReported: number | null
  sellerWideItemsParsed: number | null
  sellerWideItemsMarketplaceCertifiedUs: number | null
  sellerWideItemsMarketplaceCertifiedNonUs: number | null
  sellerWideItemsMarketplaceUnresolved: number | null
  sellerWideItemsMarketplaceError: number | null
  sellerWideItemsMarketplaceBudgetExhausted: number | null
  sellerWideItemsMarketplaceItemIdMismatch: number | null
  sellerWideItemsRepresented: number | null
}

export type EbayMonitorOAuthSafeErrorCategory =
  | "INVALID_SCOPE"
  | "INVALID_GRANT"
  | "INVALID_CLIENT"
  | "INVALID_REQUEST"
  | "UNSUPPORTED_GRANT_TYPE"
  | "OAUTH_ERROR_UNCLASSIFIED"

export type EbayCommercialMonitorLiveReadonlyResult = {
  contractVersion: typeof EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION
  mode: "READ_ONLY"
  environment: "PRODUCTION"
  marketplaceId: "EBAY_US"
  account: {
    status: "CERTIFIED" | "PARTIAL" | "BLOCKED"
    accountAlias: string | null
    bindingConfigured: boolean
    bindingMatched: boolean
    observedAt: string | null
    source: "EBAY_TRADING_GET_USER" | "LOCAL_CONFIGURATION"
    limitationCode: string | null
  }
  oauth: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
    tokenReceived: boolean
    tokenPersisted: false
    tokenReturned: false
    expiryKnown: boolean
    earliestAccessTokenExpiryAt: string | null
    scopes: EbayMonitorScopeEvidence[]
  }
  discovery: {
    status: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "ERROR"
    coverage: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    observedAt: string | null
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING"
    sellerWideEnumeration: {
      identities: EbaySellerWideEnumerationIdentity[]
      itemSetComplete: boolean
      identitySetComplete: boolean
    }
    listings: EbayLiveListing[]
    pagesRead: number
    totalPages: number | null
    totalEntries: number | null
    marketplaceCertification: EbayMarketplaceCertificationCounters
    gapCodes: string[]
    inventory: EbayLiveInventoryResult
  }
  analytics: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    analyticsRequestedItemCount: number | null
    analyticsRepresentedItemCount: number | null
    analyticsMissingItemCount: number | null
    analyticsCoverageStatus: "COMPLETE" | "PARTIAL" | "UNPROVEN"
    observations: EbayLiveAnalyticsObservation[]
    gapCodes: string[]
  }
  orders: {
    status: "CERTIFIED" | "PARTIAL" | "UNAVAILABLE"
    observedAt: string | null
    windowStart: string | null
    windowEnd: string | null
    orders: SafeLiveEbayOrder[]
    pagesRead: number
    rawOrdersDiscardedAfterSanitization: number
    observedOrderEvidenceKeys: string[]
    gapCodes: string[]
  }
  calls: EbayMonitorReadonlyCallEvidence[]
  safety: {
    marketplaceWrites: 0
    databaseWrites: 0
    inventoryWrites: 0
    listingRevisions: 0
    listingEnds: 0
    fulfillmentWrites: 0
    buyerMessages: 0
    whatsappCalls: 0
    tokensReturned: false
    rawPayloadsReturned: false
    buyerPiiReturned: false
  }
}

type TokenResult = {
  value: string
  expiresAt: string
  returnedScopes: string[]
  scopeListReturned: boolean
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, maximum = 200) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
}

function listingIdentityComponent(value: string | null, maximum: number) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function itemSkuIdentityKey(itemId: string, sku: string | null) {
  return JSON.stringify([
    itemId,
    listingIdentityComponent(sku, 120),
  ])
}

function number(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function analyticsMetricNumber(value: unknown) {
  let candidate = value
  for (let depth = 0; depth < 4; depth += 1) {
    const nested = record(candidate)
    if (!Object.hasOwn(nested, "value")) break
    candidate = nested.value
  }
  const parsed = number(candidate)
  return parsed !== null && parsed >= 0 ? parsed : null
}

function nonNegativeInteger(value: unknown) {
  const parsed = number(value)
  return parsed !== null && parsed >= 0 && Number.isSafeInteger(parsed)
    ? parsed
    : null
}

function safeCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback
}

function monitorOAuthFailureCategory(
  payload: unknown,
): EbayMonitorOAuthSafeErrorCategory {
  const rawError = text(record(payload).error, 80).toLowerCase()
  if (rawError === "invalid_scope") return "INVALID_SCOPE"
  if (rawError === "invalid_grant") return "INVALID_GRANT"
  if (rawError === "invalid_client") return "INVALID_CLIENT"
  if (rawError === "invalid_request") return "INVALID_REQUEST"
  if (rawError === "unsupported_grant_type") return "UNSUPPORTED_GRANT_TYPE"
  return "OAUTH_ERROR_UNCLASSIFIED"
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function escapedXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;")
}

function emptyInventory(
  status: EbayLiveInventoryResult["status"] = "UNAVAILABLE",
  code = "INVENTORY_READ_NOT_ATTEMPTED",
): EbayLiveInventoryResult {
  return {
    status,
    observedAt: null,
    inventorySkuCount: null,
    publishedListingIds: [],
    publishedOffers: [],
    gapCodes: [code],
  }
}

function unavailableResult(input: {
  accountAlias: string | null
  limitationCode: string
  bindingConfigured: boolean
}): EbayCommercialMonitorLiveReadonlyResult {
  return {
    contractVersion: EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
    mode: "READ_ONLY",
    environment: "PRODUCTION",
    marketplaceId: MARKETPLACE_ID,
    account: {
      status: "BLOCKED",
      accountAlias: input.accountAlias,
      bindingConfigured: input.bindingConfigured,
      bindingMatched: false,
      observedAt: null,
      source: "LOCAL_CONFIGURATION",
      limitationCode: input.limitationCode,
    },
    oauth: {
      status: "UNAVAILABLE",
      tokenReceived: false,
      tokenPersisted: false,
      tokenReturned: false,
      expiryKnown: false,
      earliestAccessTokenExpiryAt: null,
      scopes: [
        BASE_SCOPE,
        INVENTORY_READONLY_SCOPE,
        ANALYTICS_READONLY_SCOPE,
        FULFILLMENT_READONLY_SCOPE,
      ].map((scope) => ({
        scope,
        classifications: ["READ_REQUIRED"],
        evidenceOperation: null,
      })),
    },
    discovery: {
      status: "UNAVAILABLE",
      coverage: "UNPROVEN",
      observedAt: null,
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      sellerWideEnumeration: {
        identities: [],
        itemSetComplete: false,
        identitySetComplete: false,
      },
      listings: [],
      pagesRead: 0,
      totalPages: null,
      totalEntries: null,
      marketplaceCertification: {
        sellerWideItemsReported: null,
        sellerWideItemsParsed: null,
        sellerWideItemsMarketplaceCertifiedUs: null,
        sellerWideItemsMarketplaceCertifiedNonUs: null,
        sellerWideItemsMarketplaceUnresolved: null,
        sellerWideItemsMarketplaceError: null,
        sellerWideItemsMarketplaceBudgetExhausted: null,
        sellerWideItemsMarketplaceItemIdMismatch: null,
        sellerWideItemsRepresented: null,
      },
      gapCodes: [
        input.limitationCode,
        "COVERAGE_GAP_DOES_NOT_PROVE_ZERO_LISTINGS",
      ],
      inventory: emptyInventory(),
    },
    analytics: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: null,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      observations: [],
      gapCodes: [input.limitationCode, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    orders: {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: [input.limitationCode, "NO_EVIDENCE_DOES_NOT_PROVE_ZERO"],
    },
    calls: [],
    safety: {
      marketplaceWrites: 0,
      databaseWrites: 0,
      inventoryWrites: 0,
      listingRevisions: 0,
      listingEnds: 0,
      fulfillmentWrites: 0,
      buyerMessages: 0,
      whatsappCalls: 0,
      tokensReturned: false,
      rawPayloadsReturned: false,
      buyerPiiReturned: false,
    },
  }
}

function generalCredentials(environment: NodeJS.ProcessEnv) {
  return {
    clientId: environment.EBAY_CLIENT_ID?.trim() ?? "",
    clientSecret: environment.EBAY_CLIENT_SECRET?.trim() ?? "",
    refreshToken: environment.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? "",
  }
}

function fulfillmentCredentials(environment: NodeJS.ProcessEnv) {
  const general = generalCredentials(environment)
  const dedicatedClientId =
    environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret =
    environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const dedicatedRefresh =
    environment.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN?.trim() ?? ""
  return {
    clientId: dedicatedClientId || general.clientId,
    clientSecret: dedicatedClientSecret || general.clientSecret,
    refreshToken: dedicatedRefresh,
    partialDedicatedClient:
      Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret),
  }
}

function callEvidence(input: {
  operation: EbayMonitorReadonlyOperation
  method: "GET" | "POST"
  endpoint: string
  status: "SUCCEEDED" | "FAILED"
  httpStatus: number | null
  observedAt: string
}): EbayMonitorReadonlyCallEvidence {
  return {
    ...input,
    marketplaceMutation: false,
    persisted: false,
  }
}

async function allowlistedFetch(input: {
  operation: EbayMonitorReadonlyOperation
  method: "GET" | "POST"
  url: URL | string
  tradingCallName?: "GetUser" | "GetMyeBaySelling" | "GetItem"
  headers?: HeadersInit
  body?: BodyInit
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const tradingHeaders = new Headers(input.headers)
  const tradingBody = typeof input.body === "string" ? input.body : null
  assertEbayMonitorReadonlyRequest({
    operation: input.operation,
    method: input.method,
    url: input.url,
    tradingCallName: input.tradingCallName,
    tradingHeaderCallName: tradingHeaders.get("X-EBAY-API-CALL-NAME"),
    tradingBody,
  })
  const budget = requestBudgets.get(input.calls)
  const remainingMs = budget ? budget.deadlineAt - Date.now() : REQUEST_TIMEOUT_MS
  if (budget && (budget.callsRemaining <= 0 || remainingMs < 250)) {
    throw new Error("EBAY_MONITOR_REQUEST_BUDGET_EXHAUSTED")
  }
  if (budget) budget.callsRemaining -= 1
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(
        1,
        Math.min(REQUEST_TIMEOUT_MS, remainingMs),
      )),
    })
    const evidence = callEvidence({
      operation: input.operation,
      method: input.method,
      endpoint: new URL(input.url).pathname,
      status: response.ok ? "SUCCEEDED" : "FAILED",
      httpStatus: response.status,
      observedAt: input.clock().toISOString(),
    })
    input.calls.push(evidence)
    callEvidenceByResponse.set(response, evidence)
    return response
  } catch (error) {
    input.calls.push(callEvidence({
      operation: input.operation,
      method: input.method,
      endpoint: new URL(input.url).pathname,
      status: "FAILED",
      httpStatus: null,
      observedAt: input.clock().toISOString(),
    }))
    throw new Error(error instanceof DOMException && error.name === "TimeoutError"
      ? "EBAY_MONITOR_READ_TIMEOUT"
      : "EBAY_MONITOR_READ_NETWORK_ERROR")
  }
}

function markResponseCallFailed(response: Response) {
  const call = callEvidenceByResponse.get(response)
  if (call) call.status = "FAILED"
}

async function readJsonResponse(input: {
  response: Response
  calls: EbayMonitorReadonlyCallEvidence[]
  operation: EbayMonitorReadonlyOperation
  errorCode: string
}) {
  try {
    return await input.response.json() as unknown
  } catch {
    markResponseCallFailed(input.response)
    throw new Error(input.errorCode)
  }
}

async function readTextResponse(
  response: Response,
  errorCode: string,
) {
  try {
    return await response.text()
  } catch {
    markResponseCallFailed(response)
    throw new Error(errorCode)
  }
}

type ScopeGrantEvidence = {
  granted: Set<string>
  missing: Set<string>
  bindingVerified: boolean
}

function scopeGrantEvidence(): ScopeGrantEvidence {
  return {
    granted: new Set<string>(),
    missing: new Set<string>(),
    bindingVerified: false,
  }
}

function registerScopeEvidence(input: {
  ledger: ScopeGrantEvidence
  token: TokenResult
  requestedScopes: string[]
}) {
  for (const scope of input.token.returnedScopes) {
    input.ledger.granted.add(scope)
  }
  if (!input.token.scopeListReturned) return []
  const missing = input.requestedScopes.filter((scope) =>
    !input.token.returnedScopes.includes(scope))
  for (const scope of missing) {
    if (!input.ledger.granted.has(scope)) input.ledger.missing.add(scope)
  }
  return missing
}

async function accessToken(input: {
  operation: "OAUTH_REFRESH_TRADING" | "OAUTH_REFRESH_INVENTORY" |
    "OAUTH_REFRESH_ANALYTICS" | "OAUTH_REFRESH_FULFILLMENT"
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  scopes: string[]
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) : Promise<TokenResult> {
  if (!input.credentials.clientId || !input.credentials.clientSecret ||
      !input.credentials.refreshToken) {
    throw new Error("EBAY_MONITOR_OAUTH_CONFIGURATION_MISSING")
  }
  const basic = Buffer.from(
    `${input.credentials.clientId}:${input.credentials.clientSecret}`,
    "utf8",
  ).toString("base64")
  const response = await allowlistedFetch({
    operation: input.operation,
    method: "POST",
    url: OAUTH_ENDPOINT,
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.credentials.refreshToken,
      scope: input.scopes.join(" "),
    }),
    fetchImpl: input.fetchImpl,
    calls: input.calls,
    clock: input.clock,
  })
  if (!response.ok) {
    let failurePayload: unknown = {}
    try {
      failurePayload = await response.json() as unknown
    } catch {
      failurePayload = {}
    }
    const category = monitorOAuthFailureCategory(failurePayload)
    failurePayload = null
    throw new Error(`EBAY_MONITOR_${input.operation}_${category}`)
  }
  const payload = record(await readJsonResponse({
    response,
    calls: input.calls,
    operation: input.operation,
    errorCode: "EBAY_MONITOR_OAUTH_RESPONSE_INVALID",
  }))
  const value = text(payload.access_token, 20_000)
  const expiresIn = nonNegativeInteger(payload.expires_in)
  if (!value || expiresIn === null || expiresIn < 60) {
    markResponseCallFailed(response)
    throw new Error("EBAY_MONITOR_OAUTH_RESPONSE_INVALID")
  }
  const scopeText = text(payload.scope, 4_000)
  const returnedScopes = scopeText
    .split(/\s+/)
    .filter((scope) => scope.startsWith("https://api.ebay.com/oauth/api_scope"))
  return {
    value,
    expiresAt: new Date(
      input.clock().getTime() + expiresIn * 1_000,
    ).toISOString(),
    returnedScopes,
    scopeListReturned: scopeText.length > 0,
  }
}

function tradingHeaders(token: string, callName: string) {
  return {
    "Content-Type": "text/xml",
    "X-EBAY-API-CALL-NAME": callName,
    "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
    "X-EBAY-API-SITEID": "0",
    "X-EBAY-API-IAF-TOKEN": token,
  }
}

async function verifyAccount(input: {
  token: string
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const response = await allowlistedFetch({
    operation: "TRADING_GET_USER",
    method: "POST",
    url: TRADING_ENDPOINT,
    tradingCallName: "GetUser",
    headers: tradingHeaders(input.token, "GetUser"),
    body: "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
      "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
      "<OutputSelector>User.UserID</OutputSelector>" +
      "<OutputSelector>User.Site</OutputSelector>" +
      "</GetUserRequest>",
    fetchImpl: input.fetchImpl,
    calls: input.calls,
    clock: input.clock,
  })
  const xml = await readTextResponse(
    response,
    "EBAY_MONITOR_ACCOUNT_IDENTITY_RESPONSE_INVALID",
  )
  const parsed = parseEbayTradingGetUser(xml)
  if (!response.ok || !parsed.accepted || !parsed.userId) {
    markResponseCallFailed(response)
    throw new Error("EBAY_MONITOR_ACCOUNT_IDENTITY_UNAVAILABLE")
  }
  const fingerprintMatch = ebayProductionAccountFingerprint(parsed.userId) ===
    input.expectedFingerprint
  const userMatch = !input.expectedUserId ||
    parsed.userId.toLocaleLowerCase("en-US") ===
      input.expectedUserId.toLocaleLowerCase("en-US")
  if (!fingerprintMatch || !userMatch) {
    throw new Error("EBAY_MONITOR_ACCOUNT_IDENTITY_MISMATCH")
  }
  return {
    observedAt: input.clock().toISOString(),
    fingerprintMatch: true,
    site: parsed.site,
  }
}

function getMyeBaySellingBody(page: number) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetMyeBaySellingRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    "<ActiveList><Include>true</Include><IncludeNotes>false</IncludeNotes>" +
    "<Pagination>" +
    `<EntriesPerPage>${SELLER_WIDE_PAGE_SIZE}</EntriesPerPage>` +
    `<PageNumber>${page}</PageNumber>` +
    "</Pagination></ActiveList>" +
    "<HideVariations>false</HideVariations>" +
    "<DetailLevel>ReturnAll</DetailLevel>" +
    "</GetMyeBaySellingRequest>"
}

function getItemMarketplaceBody(itemId: string) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<GetItemRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
    `<ItemID>${escapedXml(itemId)}</ItemID>` +
    "<OutputSelector>Item.ItemID</OutputSelector>" +
    "<OutputSelector>Item.Site</OutputSelector>" +
    "</GetItemRequest>"
}

async function sellerWideDiscovery(input: {
  token: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const listings: EbayLiveListing[] = []
  let totalPages: number | null = null
  let totalEntries: number | null = null
  let pagesRead = 0
  let reachedPageLimit = false
  let pageFailed = false
  let limitationCode: string | null = null
  let paginationMetadataConflict = false
  let ambiguousVariationIdentity = false
  let sourceIdentityConflict = false
  for (let page = 1; page <= SELLER_WIDE_MAX_PAGES; page += 1) {
    try {
      const response = await allowlistedFetch({
        operation: "TRADING_GET_MY_EBAY_SELLING",
        method: "POST",
        url: TRADING_ENDPOINT,
        tradingCallName: "GetMyeBaySelling",
        headers: tradingHeaders(input.token, "GetMyeBaySelling"),
        body: getMyeBaySellingBody(page),
        fetchImpl: input.fetchImpl,
        calls: input.calls,
        clock: input.clock,
      })
      const observedAt = input.clock().toISOString()
      const parsed = parseEbayTradingGetMyeBaySellingPage(
        await readTextResponse(
          response,
          "EBAY_MONITOR_SELLER_DISCOVERY_RESPONSE_INVALID",
        ),
        observedAt,
      )
      if (!response.ok || !parsed.accepted) {
        markResponseCallFailed(response)
        throw new Error(`EBAY_MONITOR_SELLER_DISCOVERY_${response.status}`)
      }
      pagesRead += 1
      const parsedTotalPages = parsed.totalPages === 0 &&
          parsed.totalEntries === 0
        ? 1
        : parsed.totalPages
      if (totalPages !== null && parsedTotalPages !== null &&
          totalPages !== parsedTotalPages) {
        paginationMetadataConflict = true
      }
      if (totalEntries !== null && parsed.totalEntries !== null &&
          totalEntries !== parsed.totalEntries) {
        paginationMetadataConflict = true
      }
      totalPages = parsedTotalPages
      totalEntries = parsed.totalEntries
      sourceIdentityConflict = sourceIdentityConflict ||
        parsed.sourceIdentityConflict
      paginationMetadataConflict = paginationMetadataConflict ||
        parsed.paginationMetadataConflict
      listings.push(...parsed.listings)
      const reachedReportedEnd = totalPages !== null && page >= totalPages
      if (parsed.hasMoreItems === true && reachedReportedEnd) {
        paginationMetadataConflict = true
      }
      if (parsed.hasMoreItems === false && totalPages !== null &&
          page < totalPages) {
        paginationMetadataConflict = true
      }
      const done = parsed.hasMoreItems === false ||
        (parsed.hasMoreItems !== true && reachedReportedEnd)
      if (done) break
      if (page === SELLER_WIDE_MAX_PAGES) reachedPageLimit = true
    } catch (error) {
      if (pagesRead === 0) throw error
      pageFailed = true
      limitationCode = safeCode(error, "SELLER_WIDE_DISCOVERY_PAGE_FAILED")
      break
    }
  }
  const uniqueMap = new Map(listings.map((listing) => [
    JSON.stringify([
      listing.itemId,
      listing.variationKey,
      listing.sku,
    ]),
    listing,
  ]))
  const uniqueBeforeItemCheck = [...uniqueMap.values()]
  const itemMultiplicity = new Map<string, number>()
  for (const listing of uniqueBeforeItemCheck) {
    const previous = itemMultiplicity.get(listing.itemId)
    itemMultiplicity.set(
      listing.itemId,
      previous === undefined ? 1 : previous + 1,
    )
  }
  const ambiguousItems = new Set(uniqueBeforeItemCheck
    .filter((listing) =>
      listing.variationKey === null &&
      (itemMultiplicity.get(listing.itemId) || 1) > 1)
    .map((listing) => listing.itemId))
  const unique = uniqueBeforeItemCheck.map((listing) => ({
    ...listing,
    identityAmbiguous: listing.identityAmbiguous ||
      ambiguousItems.has(listing.itemId),
  }))
  ambiguousVariationIdentity = uniqueMap.size !== listings.length ||
    unique.some((listing) => listing.identityAmbiguous)
  return {
    listings: unique,
    pagesRead,
    totalPages,
    totalEntries,
    reachedPageLimit,
    pageFailed,
    limitationCode,
    paginationMetadataConflict,
    ambiguousVariationIdentity,
    sourceIdentityConflict,
    observedAt: unique
      .map((listing) => listing.observedAt)
      .sort()
      .at(-1) ?? input.clock().toISOString(),
  }
}

type ItemMarketplaceCertification = {
  status: EbayItemMarketplaceCertificationStatus
  marketplaceSite: string | null
  source:
    | "EBAY_TRADING_GET_MY_EBAY_SELLING"
    | "EBAY_TRADING_GET_ITEM"
    | null
  observedAt: string | null
  limitationCode: string | null
}

function marketplaceVerificationBudgetAvailable(
  calls: EbayMonitorReadonlyCallEvidence[],
  batchSize: number,
) {
  const budget = requestBudgets.get(calls)
  if (!budget) return true
  return batchSize > 0 &&
    budget.callsRemaining - batchSize >= GET_ITEM_DOWNSTREAM_CALL_RESERVE &&
    budget.deadlineAt - Date.now() >=
      GET_ITEM_DOWNSTREAM_TIME_RESERVE_MS + REQUEST_TIMEOUT_MS
}

function exhaustedMarketplaceCertification(): ItemMarketplaceCertification {
  return {
    status: "BUDGET_EXHAUSTED",
    marketplaceSite: null,
    source: null,
    observedAt: null,
    limitationCode:
      "SELLER_WIDE_MARKETPLACE_CERTIFICATION_BUDGET_EXHAUSTED",
  }
}

async function getItemMarketplaceCertification(input: {
  token: string
  itemId: string
  sellerWideMarketplaceSite: string | null
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}): Promise<ItemMarketplaceCertification> {
  let response: Response | null = null
  try {
    response = await allowlistedFetch({
      operation: "TRADING_GET_ITEM_MARKETPLACE",
      method: "POST",
      url: TRADING_ENDPOINT,
      tradingCallName: "GetItem",
      headers: tradingHeaders(input.token, "GetItem"),
      body: getItemMarketplaceBody(input.itemId),
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    const observedAt = input.clock().toISOString()
    if (!response.ok) {
      return {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_ITEM",
        observedAt,
        limitationCode: "TRADING_GET_ITEM_MARKETPLACE_HTTP_FAILED",
      }
    }
    const parsed = parseEbayTradingGetItemMarketplace(
      await readTextResponse(
        response,
        "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID",
      ),
      input.itemId,
    )
    if (parsed.status !== "US_CERTIFIED" &&
        parsed.status !== "NON_US_CERTIFIED") {
      markResponseCallFailed(response)
    }
    if ((parsed.status === "US_CERTIFIED" ||
        parsed.status === "NON_US_CERTIFIED") &&
        input.sellerWideMarketplaceSite !== null &&
        parsed.marketplaceSite !== input.sellerWideMarketplaceSite) {
      markResponseCallFailed(response)
      return {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_ITEM",
        observedAt,
        limitationCode: "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT",
      }
    }
    return {
      status: parsed.status,
      marketplaceSite: parsed.marketplaceSite,
      source: "EBAY_TRADING_GET_ITEM",
      observedAt,
      limitationCode: parsed.status === "ITEM_ID_MISMATCH"
        ? "TRADING_GET_ITEM_IDENTITY_MISMATCH"
        : parsed.status === "UNRESOLVED" || parsed.status === "ERROR"
          ? "TRADING_GET_ITEM_MARKETPLACE_RESPONSE_INVALID"
          : null,
    }
  } catch (error) {
    if (response) markResponseCallFailed(response)
    const code = safeCode(error, "TRADING_GET_ITEM_MARKETPLACE_READ_FAILED")
    if (code === "EBAY_MONITOR_REQUEST_BUDGET_EXHAUSTED") {
      return exhaustedMarketplaceCertification()
    }
    return {
      status: "ERROR",
      marketplaceSite: null,
      source: "EBAY_TRADING_GET_ITEM",
      observedAt: input.clock().toISOString(),
      limitationCode: "TRADING_GET_ITEM_MARKETPLACE_READ_FAILED",
    }
  }
}

async function certifySellerWideItemMarketplaces(input: {
  token: string
  listings: EbayLiveListing[]
  totalEntries: number | null
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
}) {
  const rowsByItem = new Map<string, EbayLiveListing[]>()
  for (const listing of input.listings) {
    const rows = rowsByItem.get(listing.itemId) ?? []
    rows.push(listing)
    rowsByItem.set(listing.itemId, rows)
  }
  const certifications = new Map<string, ItemMarketplaceCertification>()
  const pending: Array<{
    itemId: string
    sellerWideMarketplaceSite: string | null
  }> = []
  for (const itemId of [...rowsByItem.keys()].sort()) {
    const rows = rowsByItem.get(itemId) ?? []
    const explicitSites = new Set(rows
      .map((row) => row.marketplaceSite)
      .filter((site): site is string => Boolean(site)))
    if (explicitSites.size > 1) {
      certifications.set(itemId, {
        status: "ERROR",
        marketplaceSite: null,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        observedAt: rows.map((row) => row.observedAt).sort().at(-1) ?? null,
        limitationCode: "SELLER_WIDE_ITEM_MARKETPLACE_CONFLICT",
      })
      continue
    }
    pending.push({
      itemId,
      sellerWideMarketplaceSite: explicitSites.size === 1
        ? [...explicitSites][0]
        : null,
    })
  }
  const scheduled = pending.slice(0, GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS)
  for (const entry of pending.slice(GET_ITEM_MARKETPLACE_MAX_UNIQUE_ITEMS)) {
    certifications.set(entry.itemId, exhaustedMarketplaceCertification())
  }
  for (let offset = 0; offset < scheduled.length;
      offset += GET_ITEM_MARKETPLACE_CONCURRENCY) {
    const batch = scheduled.slice(
      offset,
      offset + GET_ITEM_MARKETPLACE_CONCURRENCY,
    )
    if (!marketplaceVerificationBudgetAvailable(input.calls, batch.length)) {
      for (const entry of scheduled.slice(offset)) {
        certifications.set(entry.itemId, exhaustedMarketplaceCertification())
      }
      break
    }
    const results = await Promise.all(batch.map(async (entry) => ({
      itemId: entry.itemId,
      certification: await getItemMarketplaceCertification({
        token: input.token,
        itemId: entry.itemId,
        sellerWideMarketplaceSite: entry.sellerWideMarketplaceSite,
        fetchImpl: input.fetchImpl,
        calls: input.calls,
        clock: input.clock,
      }),
    })))
    for (const result of results) {
      certifications.set(result.itemId, result.certification)
    }
    if (results.some((result) =>
        result.certification.status === "BUDGET_EXHAUSTED")) {
      for (const entry of scheduled.slice(offset + batch.length)) {
        certifications.set(entry.itemId, exhaustedMarketplaceCertification())
      }
      break
    }
  }
  for (const itemId of rowsByItem.keys()) {
    if (certifications.has(itemId)) continue
    certifications.set(itemId, {
      status: "ERROR",
      marketplaceSite: null,
      source: null,
      observedAt: null,
      limitationCode: "SELLER_WIDE_MARKETPLACE_PARTITION_INVARIANT_FAILED",
    })
  }
  const count = (status: EbayItemMarketplaceCertificationStatus) =>
    [...certifications.values()].filter((entry) => entry.status === status)
      .length
  const certifiedUs = count("US_CERTIFIED")
  const certifiedNonUs = count("NON_US_CERTIFIED")
  const unresolved = count("UNRESOLVED")
  const directErrors = count("ERROR")
  const itemIdMismatches = count("ITEM_ID_MISMATCH")
  const exhausted = count("BUDGET_EXHAUSTED")
  const partitionItemCount = certifiedUs + certifiedNonUs + unresolved +
    directErrors + itemIdMismatches + exhausted
  const certifiedListings = input.listings.flatMap((listing) => {
    const certification = certifications.get(listing.itemId)
    if (!certification || certification.status !== "US_CERTIFIED") return []
    return [{
      ...listing,
      marketplaceSite: "US",
      marketplaceCertification: {
        status: certification.status,
        source: certification.source,
        observedAt: certification.observedAt,
      },
    }]
  })
  const represented = new Set(certifiedListings.map((row) => row.itemId)).size
  const parsed = rowsByItem.size
  const terminal = certifiedUs + certifiedNonUs
  const incomplete = unresolved > 0 || directErrors > 0 ||
    itemIdMismatches > 0 || exhausted > 0 ||
    partitionItemCount !== parsed || input.totalEntries === null ||
    terminal !== input.totalEntries
  const gapCodes = [...new Set([
    ...(unresolved > 0 ? ["SELLER_WIDE_ITEM_MARKETPLACE_UNRESOLVED"] : []),
    ...[...certifications.values()].flatMap((certification) =>
      certification.limitationCode ? [certification.limitationCode] : []),
  ])]
  return {
    listings: certifiedListings,
    marketplaceCertification: {
      sellerWideItemsReported: input.totalEntries,
      sellerWideItemsParsed: parsed,
      sellerWideItemsMarketplaceCertifiedUs: certifiedUs,
      sellerWideItemsMarketplaceCertifiedNonUs: certifiedNonUs,
      sellerWideItemsMarketplaceUnresolved: unresolved,
      sellerWideItemsMarketplaceError: directErrors,
      sellerWideItemsMarketplaceBudgetExhausted: exhausted,
      sellerWideItemsMarketplaceItemIdMismatch: itemIdMismatches,
      sellerWideItemsRepresented: represented,
    } satisfies EbayMarketplaceCertificationCounters,
    terminalItemCount: terminal,
    incomplete,
    gapCodes,
  }
}

async function inventoryRead(input: {
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayLiveInventoryResult> {
  let token = ""
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_INVENTORY",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, INVENTORY_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(INVENTORY_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_INVENTORY_SCOPE_MISSING")
    }
    const inventoryItems: JsonRecord[] = []
    let offset = 0
    let total: number | null = null
    let itemEnumerationExhausted = false
    let inventoryEvidenceObserved = false
    const gapCodes: string[] = []
    while (inventoryItems.length < INVENTORY_MAX_SKUS) {
      try {
        const url = new URL(INVENTORY_ITEMS_ENDPOINT)
        url.searchParams.set("limit", "50")
        url.searchParams.set("offset", String(offset))
        const response = await allowlistedFetch({
          operation: "INVENTORY_GET_ITEMS",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_INVENTORY_${response.status}`)
        }
        const payload = record(await readJsonResponse({
          response,
          calls: input.calls,
          operation: "INVENTORY_GET_ITEMS",
          errorCode: "INVENTORY_SOURCE_FORMAT_CHANGED",
        }))
        if (!Array.isArray(payload.inventoryItems)) {
          markResponseCallFailed(response)
          throw new Error("INVENTORY_SOURCE_FORMAT_CHANGED")
        }
        const page = payload.inventoryItems.map(record)
        inventoryEvidenceObserved = true
        inventoryItems.push(...page)
        const reportedTotal = nonNegativeInteger(payload.total)
        if (reportedTotal === null) {
          gapCodes.push("INVENTORY_TOTAL_UNPROVEN")
        } else if (total !== null && total !== reportedTotal) {
          gapCodes.push("INVENTORY_TOTAL_CHANGED_DURING_READ")
        } else {
          total = reportedTotal
        }
        const nextUrl = text(payload.next, 2_000)
        const terminalByRows = !page.length || page.length < 50 ||
          (total !== null && inventoryItems.length >= total)
        if (nextUrl) {
          let nextValid = false
          try {
            const parsedNext = new URL(nextUrl, EBAY_API_ORIGIN)
            nextValid = parsedNext.origin === EBAY_API_ORIGIN &&
              parsedNext.pathname === "/sell/inventory/v1/inventory_item" &&
              nonNegativeInteger(parsedNext.searchParams.get("offset")) ===
                offset + page.length
          } catch {
            nextValid = false
          }
          if (!nextValid || terminalByRows) {
            gapCodes.push("INVENTORY_PAGINATION_METADATA_CONFLICT")
          }
        }
        if (terminalByRows) {
          itemEnumerationExhausted = true
          break
        }
        if (!nextUrl && total !== null && inventoryItems.length < total) {
          gapCodes.push("INVENTORY_PAGINATION_METADATA_CONFLICT")
        }
        offset += page.length
      } catch (error) {
        gapCodes.push(safeCode(error, "INVENTORY_PAGE_READ_FAILED"))
        break
      }
    }
    if (!inventoryEvidenceObserved) {
      return emptyInventory("UNAVAILABLE", gapCodes[0] ??
        "INVENTORY_READ_FAILED")
    }
    const skus = [...new Set(inventoryItems
      .map((entry) => text(entry.sku, 120))
      .filter(Boolean))].slice(0, INVENTORY_MAX_SKUS)
    const publishedListingIds: string[] = []
    const publishedOffers: Array<{ itemId: string; sku: string }> = []
    let offerEnumerationTruncated = false
    for (const group of chunks(skus, 5)) {
      const results = await Promise.allSettled(group.map(async (sku) => {
        const url = new URL(INVENTORY_OFFERS_ENDPOINT)
        url.searchParams.set("sku", sku)
        url.searchParams.set("limit", "100")
        const response = await allowlistedFetch({
          operation: "INVENTORY_GET_OFFERS",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_INVENTORY_OFFERS_${response.status}`)
        }
        const payload = record(await readJsonResponse({
          response,
          calls: input.calls,
          operation: "INVENTORY_GET_OFFERS",
          errorCode: "INVENTORY_OFFER_SOURCE_FORMAT_CHANGED",
        }))
        if (!Array.isArray(payload.offers)) {
          markResponseCallFailed(response)
          throw new Error("INVENTORY_OFFER_SOURCE_FORMAT_CHANGED")
        }
        const offers = payload.offers.map(record)
        const offerTotal = nonNegativeInteger(payload.total)
        if (offerTotal === null) offerEnumerationTruncated = true
        if (Boolean(payload.next) ||
            (offerTotal !== null && offerTotal !== offers.length)) {
          offerEnumerationTruncated = true
          gapCodes.push("INVENTORY_OFFER_TOTAL_COUNT_MISMATCH")
        }
        return { sku, offers }
      }))
      for (const result of results) {
        if (result.status === "rejected") {
          offerEnumerationTruncated = true
          gapCodes.push(safeCode(
            result.reason,
            "INVENTORY_OFFER_READ_FAILED",
          ))
          continue
        }
        for (const offer of result.value.offers) {
        const listingId = text(record(offer.listing).listingId, 20)
        const status = text(offer.status, 40).toUpperCase()
        const marketplaceId = text(offer.marketplaceId, 40).toUpperCase()
        const returnedSku = text(offer.sku, 120)
        if (status === "PUBLISHED" &&
            (!/^\d{9,20}$/.test(listingId) ||
              marketplaceId !== MARKETPLACE_ID ||
              returnedSku !== result.value.sku)) {
          offerEnumerationTruncated = true
          gapCodes.push("INVENTORY_PUBLISHED_OFFER_IDENTITY_UNPROVEN")
          continue
        }
        if (status === "PUBLISHED") {
          publishedListingIds.push(listingId)
          publishedOffers.push({ itemId: listingId, sku: returnedSku })
        }
        }
      }
    }
    if (itemEnumerationExhausted && total !== null &&
        total !== inventoryItems.length) {
      gapCodes.push("INVENTORY_TOTAL_COUNT_MISMATCH")
    }
    if (total !== null && total !== skus.length) {
      gapCodes.push("INVENTORY_DISTINCT_VALID_SKU_COUNT_MISMATCH")
    }
    const truncated = !itemEnumerationExhausted || offerEnumerationTruncated ||
      total === null || (total !== null && total !== inventoryItems.length) ||
      (total !== null && total !== skus.length) ||
      gapCodes.length > 0
    if (!itemEnumerationExhausted) gapCodes.push("INVENTORY_SKU_LIMIT_REACHED")
    if (offerEnumerationTruncated) {
      gapCodes.push("INVENTORY_OFFER_PAGINATION_INCOMPLETE")
    }
    return {
      status: truncated ? "PARTIAL" : "AVAILABLE",
      observedAt: input.clock().toISOString(),
      inventorySkuCount: total,
      publishedListingIds: [...new Set(publishedListingIds)].sort(),
      publishedOffers: [...new Map(publishedOffers.map((offer) => [
        JSON.stringify([offer.itemId, offer.sku]),
        offer,
      ])).values()].sort((left, right) =>
        JSON.stringify([left.itemId, left.sku]).localeCompare(
          JSON.stringify([right.itemId, right.sku]),
        )),
      gapCodes: truncated ? [...new Set(gapCodes)] : [],
    }
  } catch (error) {
    return emptyInventory("UNAVAILABLE", safeCode(
      error,
      "INVENTORY_READ_FAILED",
    ))
  } finally {
    token = ""
  }
}

function analyticsDayWindow(now: Date) {
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)
  end.setUTCDate(end.getUTCDate() - 1)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 29)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function analyticsCalendarDay(value: string | null) {
  const day = value?.slice(0, 10) ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day
    ? day
    : null
}

function analyticsItemId(value: string) {
  if (/^\d{9,20}$/.test(value)) return value
  return value.match(/^v1\|(\d{9,20})\|0$/i)?.[1] ?? null
}

async function analyticsRead(input: {
  credentials: { clientId: string; clientSecret: string; refreshToken: string }
  expectedUserId: string
  expectedFingerprint: string
  listingIds: string[]
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayCommercialMonitorLiveReadonlyResult["analytics"]> {
  const ids = [...new Set(input.listingIds)]
  const selected = ids.slice(0, ANALYTICS_MAX_LISTINGS)
  if (!input.listingIds.length) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: 0,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      observations: [],
      gapCodes: ["NO_DISCOVERED_LISTING_IDS_NO_ZERO_INFERENCE"],
    }
  }
  let token = ""
  const window = analyticsDayWindow(input.clock())
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_ANALYTICS",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, ANALYTICS_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, ANALYTICS_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(ANALYTICS_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_ANALYTICS_SCOPE_MISSING")
    }
    const observations: EbayLiveAnalyticsObservation[] = []
    const gapCodes = ids.length > selected.length
      ? ["ANALYTICS_LISTING_LIMIT_REACHED"]
      : []
    let observedAt: string | null = null
    let actualWindowStart: string | null = null
    let actualWindowEnd: string | null = null
    for (const listingChunk of chunks(selected, 200)) {
      try {
        const { url } = buildEbaySellerTrafficReportUrl({
          dateFrom: window.start,
          dateTo: window.end,
          listingIds: listingChunk,
          timeZone: "UTC",
        })
        const response = await allowlistedFetch({
          operation: "ANALYTICS_GET_TRAFFIC_REPORT",
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_ANALYTICS_${response.status}`)
        }
        const payload = await readJsonResponse({
          response,
          calls: input.calls,
          operation: "ANALYTICS_GET_TRAFFIC_REPORT",
          errorCode: "ANALYTICS_SOURCE_FORMAT_CHANGED",
        })
        if (!Array.isArray(record(payload).records)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_SOURCE_FORMAT_CHANGED")
        }
        const payloadRecord = record(payload)
        const rawWarnings = payloadRecord.warnings
        if (Object.prototype.hasOwnProperty.call(payloadRecord, "warnings") &&
            (!Array.isArray(rawWarnings) || rawWarnings.length > 0)) {
          gapCodes.push("ANALYTICS_SOURCE_WARNING_REPORTED")
        }
        const header = record(payloadRecord.header)
        const rawDimensionDefinitions = array(header.dimensionKeys)
        const rawDimensionKeys = rawDimensionDefinitions.map((definition) =>
          text(record(definition).key, 100).toUpperCase())
        const rawRecords = array(record(payload).records).map(record)
        if (rawDimensionKeys.length !== 1 ||
            !["LISTING", "LISTING_ID"].includes(rawDimensionKeys[0]) ||
            rawRecords.some((row) =>
              !Array.isArray(row.dimensionValues) ||
              row.dimensionValues.length !== 1)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DIMENSION_DEFINITIONS_AMBIGUOUS")
        }
        const normalized = normalizeEbaySellerTrafficRows(payload)
        if (normalized.warnings.length > 0) {
          gapCodes.push("ANALYTICS_SOURCE_WARNING_REPORTED")
        }
        if (normalized.dimension !== "LISTING") {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_GRAIN_MISMATCH")
        }
        const rawMetricDefinitions = array(
          header.metrics,
        )
        const rawMetricKeys = rawMetricDefinitions.map((definition) =>
          text(record(definition).key, 100).toUpperCase())
        const returnedMetricKeys = new Set(rawMetricKeys)
        if (rawMetricKeys.some((key) => !key) ||
            returnedMetricKeys.size !== rawMetricKeys.length) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_METRIC_DEFINITIONS_AMBIGUOUS")
        }
        if (EBAY_SELLER_TRAFFIC_METRICS.some((key) =>
            !returnedMetricKeys.has(key))) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_REQUIRED_METRICS_MISSING")
        }
        const invalidMetricCells = rawRecords.some((row) => {
          const metricValues = row.metricValues
          if (!Array.isArray(metricValues) ||
              metricValues.length !== rawMetricDefinitions.length) {
            return true
          }
          return rawMetricDefinitions.some((_, index) => {
            const cell = record(metricValues[index])
            if (typeof cell.applicable !== "boolean") return true
            return cell.applicable === true &&
              analyticsMetricNumber(cell.value) === null
          })
        })
        if (invalidMetricCells) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_METRIC_CELLS_INCOMPLETE")
        }
        const reportStartDay = analyticsCalendarDay(normalized.startDate)
        const reportEndDay = analyticsCalendarDay(normalized.endDate)
        const sourceUpdatedDay = analyticsCalendarDay(
          normalized.lastUpdatedDate,
        )
        const currentDay = input.clock().toISOString().slice(0, 10)
        if (!reportStartDay || !reportEndDay || !sourceUpdatedDay ||
            reportStartDay > reportEndDay || sourceUpdatedDay > currentDay) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DATE_METADATA_INVALID")
        }
        const responseWindowStart = `${reportStartDay}T00:00:00.000Z`
        const responseWindowEnd = `${reportEndDay}T23:59:59.999Z`
        if (actualWindowStart !== null &&
            (actualWindowStart !== responseWindowStart ||
              actualWindowEnd !== responseWindowEnd)) {
          gapCodes.push("ANALYTICS_RESPONSE_WINDOWS_CONFLICT")
        } else {
          actualWindowStart = responseWindowStart
          actualWindowEnd = responseWindowEnd
        }
        const exactRequestedWindow = reportStartDay === window.start &&
          reportEndDay === window.end
        if (!exactRequestedWindow) {
          gapCodes.push("ANALYTICS_RESPONSE_WINDOW_DIFFERS_FROM_REQUEST")
        }
        const normalizedItemIds = normalized.rows.map((row) =>
          analyticsItemId(row.dimension))
        if (normalizedItemIds.some((value) => value === null)) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_VARIATION_GRAIN_UNSUPPORTED")
        }
        const validReturnedItemIds = normalizedItemIds.filter(
          (value): value is string => Boolean(value),
        )
        if (new Set(validReturnedItemIds).size !==
            validReturnedItemIds.length) {
          markResponseCallFailed(response)
          throw new Error("ANALYTICS_DUPLICATE_LISTING_GRAIN")
        }
        const reconciled = reconcileEbayTrafficAnalyticsReport({
          listingIds: listingChunk,
          dateFrom: window.start,
          dateTo: window.end,
          timeZone: "UTC",
        }, normalized)
        observedAt = input.clock().toISOString()
        const sourceUpdatedAt = `${sourceUpdatedDay}T00:00:00.000Z`
        if (reconciled.status !== "AVAILABLE") {
          gapCodes.push(reconciled.dataFreshnessStatus)
        }
        if (!normalized.rows.length) {
          gapCodes.push("ANALYTICS_LISTINGS_WITHOUT_EXPLICIT_ROWS")
        }
        for (const row of normalized.rows) {
        const itemId = analyticsItemId(row.dimension) ?? ""
        if (!itemId || !listingChunk.includes(itemId)) continue
        const metric = (key: string) => row.applicability[key] === true &&
            typeof row.metrics[key] === "number"
          ? row.metrics[key]
          : null
        const searchImpressions = metric(
          "LISTING_IMPRESSION_SEARCH_RESULTS_PAGE",
        )
        const searchViews = metric(
          "LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE",
        )
        const calculatedCtr = searchImpressions !== null &&
            searchViews !== null && searchImpressions > 0
          ? Number(((searchViews / searchImpressions) * 100).toFixed(4))
          : null
          observations.push({
          itemId,
          impressions: metric("TOTAL_IMPRESSION_TOTAL"),
          totalListingViews: metric("LISTING_VIEWS_TOTAL"),
          externalViews: metric("LISTING_VIEWS_SOURCE_OFF_EBAY"),
          transactions: metric("TRANSACTION"),
          reportedCtr: metric("CLICK_THROUGH_RATE"),
          calculatedCtr,
          calculatedCtrNumerator: calculatedCtr === null ? null : searchViews,
          calculatedCtrDenominator:
            calculatedCtr === null ? null : searchImpressions,
          reportedConversion: metric("SALES_CONVERSION_RATE"),
          applicable: {
            impressions: row.applicability.TOTAL_IMPRESSION_TOTAL === true,
            totalListingViews: row.applicability.LISTING_VIEWS_TOTAL === true,
            externalViews:
              row.applicability.LISTING_VIEWS_SOURCE_OFF_EBAY === true,
            transactions: row.applicability.TRANSACTION === true,
            reportedCtr: row.applicability.CLICK_THROUGH_RATE === true,
            calculatedCtr: calculatedCtr !== null,
            reportedConversion:
              row.applicability.SALES_CONVERSION_RATE === true,
          },
          windowStart: responseWindowStart,
          windowEnd: responseWindowEnd,
          observedAt,
          sourceUpdatedAt,
          lastUpdatedDate: normalized.lastUpdatedDate,
          completeness: reconciled.status === "AVAILABLE" &&
              exactRequestedWindow
            ? "COMPLETE"
            : "PARTIAL",
          freshnessStatus: reconciled.dataFreshnessStatus,
          source: "EBAY_SELL_ANALYTICS_TRAFFIC_REPORT",
          })
        }
      } catch (error) {
        gapCodes.push(safeCode(error, "ANALYTICS_CHUNK_READ_FAILED"))
        break
      }
    }
    if (!observedAt) {
      return {
        status: "UNAVAILABLE",
        observedAt: null,
        windowStart: null,
        windowEnd: null,
        analyticsRequestedItemCount: selected.length,
        analyticsRepresentedItemCount: null,
        analyticsMissingItemCount: null,
        analyticsCoverageStatus: "UNPROVEN",
        observations: [],
        gapCodes: [...new Set(gapCodes.length
          ? gapCodes
          : ["ANALYTICS_READ_FAILED"])],
      }
    }
    const representedItemCount = new Set(observations.map((row) => row.itemId))
      .size
    const missingItemCount = Math.max(
      0,
      selected.length - representedItemCount,
    )
    const partial = gapCodes.length > 0 || missingItemCount > 0
    return {
      status: partial ? "PARTIAL" : "CERTIFIED",
      observedAt,
      windowStart: actualWindowStart,
      windowEnd: actualWindowEnd,
      analyticsRequestedItemCount: selected.length,
      analyticsRepresentedItemCount: representedItemCount,
      analyticsMissingItemCount: missingItemCount,
      analyticsCoverageStatus: partial ? "PARTIAL" : "COMPLETE",
      observations,
      gapCodes: [...new Set(gapCodes)],
    }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: null,
      windowEnd: null,
      analyticsRequestedItemCount: selected.length,
      analyticsRepresentedItemCount: null,
      analyticsMissingItemCount: null,
      analyticsCoverageStatus: "UNPROVEN",
      observations: [],
      gapCodes: [safeCode(error, "ANALYTICS_READ_FAILED")],
    }
  } finally {
    token = ""
  }
}

function orderWindow(now: Date) {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - 30)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function ordersRead(input: {
  credentials: ReturnType<typeof fulfillmentCredentials>
  expectedUserId: string
  expectedFingerprint: string
  fetchImpl: FetchLike
  calls: EbayMonitorReadonlyCallEvidence[]
  clock: Clock
  expiries: string[]
  scopeGrant: ScopeGrantEvidence
}) : Promise<EbayCommercialMonitorLiveReadonlyResult["orders"]> {
  const window = orderWindow(input.clock())
  if (input.credentials.partialDedicatedClient) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: window.start,
      windowEnd: window.end,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: ["FULFILLMENT_DEDICATED_CLIENT_PAIR_INCOMPLETE"],
    }
  }
  let token = ""
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_FULFILLMENT",
      credentials: input.credentials,
      scopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    token = minted.value
    input.expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: input.scopeGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE, FULFILLMENT_READONLY_SCOPE],
    })
    await verifyAccount({
      token,
      expectedUserId: input.expectedUserId,
      expectedFingerprint: input.expectedFingerprint,
      fetchImpl: input.fetchImpl,
      calls: input.calls,
      clock: input.clock,
    })
    input.scopeGrant.bindingVerified = true
    if (missingRequestedScopes.includes(FULFILLMENT_READONLY_SCOPE)) {
      throw new Error("EBAY_MONITOR_FULFILLMENT_SCOPE_MISSING")
    }
    const orders: SafeLiveEbayOrder[] = []
    let rawCount = 0
    const rawOrderIds = new Set<string>()
    let reportedTotal: number | null = null
    let pagesRead = 0
    let evidenceObserved = false
    const gapCodes: string[] = []
    let next: URL | null = new URL(FULFILLMENT_ORDERS_ENDPOINT)
    const orderFilter = `lastmodifieddate:[${window.start}..${window.end}]`
    let currentOffset = 0
    next.searchParams.set(
      "filter",
      orderFilter,
    )
    next.searchParams.set("limit", "100")
    next.searchParams.set("offset", "0")
    while (next && pagesRead < FULFILLMENT_MAX_PAGES) {
      try {
        const response = await allowlistedFetch({
          operation: "FULFILLMENT_GET_ORDERS",
          method: "GET",
          url: next,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
          },
          fetchImpl: input.fetchImpl,
          calls: input.calls,
          clock: input.clock,
        })
        if (!response.ok) {
          throw new Error(`EBAY_MONITOR_ORDERS_${response.status}`)
        }
        const payload = record(await readJsonResponse({
          response,
          calls: input.calls,
          operation: "FULFILLMENT_GET_ORDERS",
          errorCode: "FULFILLMENT_SOURCE_FORMAT_CHANGED",
        }))
        if (!Array.isArray(payload.orders)) {
          markResponseCallFailed(response)
          throw new Error("FULFILLMENT_SOURCE_FORMAT_CHANGED")
        }
        const pageTotal = nonNegativeInteger(payload.total)
        if (pageTotal === null) {
          gapCodes.push("FULFILLMENT_TOTAL_UNPROVEN")
        } else if (reportedTotal !== null && reportedTotal !== pageTotal) {
          gapCodes.push("FULFILLMENT_TOTAL_CHANGED_DURING_READ")
        } else {
          reportedTotal = pageTotal
        }
        const rawOrders = payload.orders
        for (const rawOrder of rawOrders) {
          const rawOrderId = text(record(rawOrder).orderId, 100)
          if (rawOrderId && rawOrderIds.has(rawOrderId)) {
            gapCodes.push("FULFILLMENT_DUPLICATE_ORDER_ACROSS_PAGES")
          }
          if (rawOrderId) rawOrderIds.add(rawOrderId)
        }
        const sanitizedPayload = sanitizeLiveEbayOrders(payload)
        const sanitized = sanitizedPayload.filter((order) =>
          order.lastModifiedDate >= window.start &&
          order.lastModifiedDate <= window.end)
        if (sanitized.length !== sanitizedPayload.length) {
          gapCodes.push("FULFILLMENT_ORDER_OUTSIDE_REQUESTED_WINDOW")
        }
        const rawLineCount = rawOrders.reduce((count, order) => {
          const lines = record(order).lineItems
          return count + (Array.isArray(lines) ? lines.length : 0)
        }, 0)
        const sanitizedLineCount = sanitized.reduce((count, order) =>
          count + order.lineItems.length, 0)
        evidenceObserved = true
        rawCount += rawOrders.length
        orders.push(...sanitized)
        if (sanitized.length < rawOrders.length) {
          gapCodes.push("FULFILLMENT_ROWS_DISCARDED_AFTER_SANITIZATION")
        }
        if (sanitizedLineCount < rawLineCount) {
          gapCodes.push("FULFILLMENT_LINES_DISCARDED_AFTER_SANITIZATION")
        }
        pagesRead += 1
        const nextUrl = text(payload.next, 2_000)
        next = nextUrl ? new URL(nextUrl, EBAY_API_ORIGIN) : null
        if (next) {
          const nextOffset = nonNegativeInteger(
            next.searchParams.get("offset"),
          )
          const continuationValid = next.origin === EBAY_API_ORIGIN &&
            next.pathname === "/sell/fulfillment/v1/order" &&
            next.searchParams.get("filter") === orderFilter &&
            next.searchParams.get("limit") === "100" &&
            nextOffset === currentOffset + 100
          if (!continuationValid) {
            gapCodes.push("EBAY_MONITOR_ORDERS_PAGINATION_BLOCKED")
            next = null
          } else {
            currentOffset = nextOffset
          }
        }
      } catch (error) {
        gapCodes.push(safeCode(error, "FULFILLMENT_ORDER_PAGE_FAILED"))
        break
      }
    }
    if (!evidenceObserved) {
      return {
        status: "UNAVAILABLE",
        observedAt: null,
        windowStart: window.start,
        windowEnd: window.end,
        orders: [],
        pagesRead: 0,
        rawOrdersDiscardedAfterSanitization: 0,
        observedOrderEvidenceKeys: [],
        gapCodes: [...new Set(gapCodes.length
          ? gapCodes
          : ["FULFILLMENT_ORDER_READ_FAILED"])],
      }
    }
    const truncated = Boolean(next)
    if (truncated) gapCodes.push("FULFILLMENT_ORDER_PAGE_LIMIT_REACHED")
    if (!truncated && reportedTotal !== null &&
        rawOrderIds.size !== reportedTotal) {
      gapCodes.push("FULFILLMENT_PAGINATION_UNPROVEN")
    }
    const dedupedOrders = [...new Map(orders.map((order) => [
      order.ebayOrderId,
      {
        ...order,
        lineItems: [...new Map(order.lineItems.map((line) => [
          line.lineItemId,
          line,
        ])).values()],
      },
    ])).values()]
    if (dedupedOrders.length !== orders.length || dedupedOrders.some(
      (order) => order.lineItems.length !==
        orders.find((candidate) =>
          candidate.ebayOrderId === order.ebayOrderId)?.lineItems.length,
    )) gapCodes.push("FULFILLMENT_DUPLICATE_EVIDENCE_DEDUPED")
    gapCodes.push("ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY")
    return {
      status: truncated || gapCodes.some((code) =>
        code !== "ORDERS_WINDOW_CHECKOUT_COMPLETE_ONLY")
        ? "PARTIAL"
        : "CERTIFIED",
      observedAt: input.clock().toISOString(),
      windowStart: window.start,
      windowEnd: window.end,
      orders: dedupedOrders,
      pagesRead,
      rawOrdersDiscardedAfterSanitization: Math.max(
        0,
        rawCount - dedupedOrders.length,
      ),
      observedOrderEvidenceKeys: [...rawOrderIds]
        .map(hashEbayMonitorEvidenceIdentifier).sort(),
      gapCodes: [...new Set(gapCodes)],
    }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      observedAt: null,
      windowStart: window.start,
      windowEnd: window.end,
      orders: [],
      pagesRead: 0,
      rawOrdersDiscardedAfterSanitization: 0,
      observedOrderEvidenceKeys: [],
      gapCodes: [safeCode(error, "FULFILLMENT_ORDER_READ_FAILED")],
    }
  } finally {
    token = ""
  }
}

function scopeEvidence(input: {
  baseAvailable: boolean
  inventoryAvailable: boolean
  analyticsAvailable: boolean
  fulfillmentAvailable: boolean
  tradingGrant: ScopeGrantEvidence
  inventoryGrant: ScopeGrantEvidence
  analyticsGrant: ScopeGrantEvidence
  fulfillmentGrant: ScopeGrantEvidence
  calls: EbayMonitorReadonlyCallEvidence[]
}) : EbayMonitorScopeEvidence[] {
  const succeeded = new Set(input.calls
    .filter((call) => call.status === "SUCCEEDED")
    .map((call) => call.operation))
  const evidenceOperation = (...operations: EbayMonitorReadonlyOperation[]) => {
    const proven = operations.filter((operation) => succeeded.has(operation))
    return proven.length ? proven.join("+") : null
  }
  const classifications = (
    scope: string,
    readerAvailable: boolean,
    grant: ScopeGrantEvidence,
    writeCapable = false,
  ): EbayMonitorScopeClassification[] => [
    "READ_REQUIRED",
    ...(readerAvailable ||
        (grant.bindingVerified && grant.granted.has(scope))
      ? ["READ_AVAILABLE" as const]
      : []),
    ...(!readerAvailable && grant.bindingVerified &&
        !(grant.bindingVerified && grant.granted.has(scope)) &&
        grant.missing.has(scope)
      ? ["MISSING" as const]
      : []),
    ...(writeCapable && (readerAvailable ||
        (grant.bindingVerified && grant.granted.has(scope)))
      ? ["WRITE_CAPABLE_BUT_NOT_USED" as const]
      : []),
  ]
  return [
    {
      scope: BASE_SCOPE,
      classifications: classifications(
        BASE_SCOPE,
        input.baseAvailable,
        input.tradingGrant,
        true,
      ),
      evidenceOperation: evidenceOperation(
        "TRADING_GET_USER",
        "TRADING_GET_MY_EBAY_SELLING",
        "TRADING_GET_ITEM_MARKETPLACE",
      ),
    },
    {
      scope: INVENTORY_READONLY_SCOPE,
      classifications: classifications(
        INVENTORY_READONLY_SCOPE,
        input.inventoryAvailable,
        input.inventoryGrant,
      ),
      evidenceOperation: evidenceOperation(
        "INVENTORY_GET_ITEMS",
        "INVENTORY_GET_OFFERS",
      ),
    },
    {
      scope: ANALYTICS_READONLY_SCOPE,
      classifications: classifications(
        ANALYTICS_READONLY_SCOPE,
        input.analyticsAvailable,
        input.analyticsGrant,
      ),
      evidenceOperation: evidenceOperation("ANALYTICS_GET_TRAFFIC_REPORT"),
    },
    {
      scope: FULFILLMENT_READONLY_SCOPE,
      classifications: classifications(
        FULFILLMENT_READONLY_SCOPE,
        input.fulfillmentAvailable,
        input.fulfillmentGrant,
      ),
      evidenceOperation: evidenceOperation("FULFILLMENT_GET_ORDERS"),
    },
  ]
}

export function getEbayCommercialMonitorLiveConfigurationState(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = generalCredentials(environment)
  const accountAlias = normalizeEbaySellerAccountAlias(
    environment.EBAY_SELLER_ACCOUNT_KEY,
  )
  const accountAliasValid = /^[A-Za-z0-9._-]{1,80}$/.test(accountAlias)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  return {
    configured: Boolean(
      credentials.clientId && credentials.clientSecret &&
      credentials.refreshToken && accountAliasValid && identity.bound,
    ),
    accountAlias: accountAliasValid ? accountAlias : null,
    identityBound: identity.bound,
    identityConsistent: identity.consistent,
    clientIdPresent: Boolean(credentials.clientId),
    clientSecretPresent: Boolean(credentials.clientSecret),
    refreshTokenPresent: Boolean(credentials.refreshToken),
    secretValuesReturned: false,
    missingConfiguration: [
      ...(!credentials.clientId ? ["EBAY_CLIENT_ID"] : []),
      ...(!credentials.clientSecret ? ["EBAY_CLIENT_SECRET"] : []),
      ...(!credentials.refreshToken ? ["EBAY_SELLER_REFRESH_TOKEN"] : []),
      ...(!accountAliasValid ? ["EBAY_SELLER_ACCOUNT_KEY"] : []),
      ...(!identity.bound ? ["EBAY_OFFICIAL_ACCOUNT_IDENTITY"] : []),
    ],
  }
}

export async function getEbayCommercialMonitorLiveReadonly(input: {
  accountKey: string | null
  accountAlias: string | null
  environment?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  clock?: Clock
  readLimits?: {
    maximumCalls?: number
    budgetMs?: number
  }
}): Promise<EbayCommercialMonitorLiveReadonlyResult> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? (() => new Date())
  const configuration = getEbayCommercialMonitorLiveConfigurationState(
    environment,
  )
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const expectedAccountKey = configuration.accountAlias && identity.bound
    ? `${configuration.accountAlias}:${identity.expectedAccountFingerprint}`
    : null
  if (!configuration.configured || !input.accountKey ||
      input.accountKey !== expectedAccountKey ||
      input.accountAlias !== configuration.accountAlias) {
    return unavailableResult({
      accountAlias: configuration.accountAlias,
      bindingConfigured: identity.bound,
      limitationCode: !configuration.configured
        ? "LOCAL_EBAY_AUTH_CONTEXT_UNAVAILABLE"
        : "EBAY_MONITOR_ACCOUNT_SCOPE_CONFIGURATION_MISMATCH",
    })
  }

  const calls: EbayMonitorReadonlyCallEvidence[] = []
  const requestedBudgetMs = input.readLimits?.budgetMs
  const requestedMaximumCalls = input.readLimits?.maximumCalls
  requestBudgets.set(calls, {
    deadlineAt: Date.now() + Math.min(
      REQUEST_BUDGET_MS,
      Math.max(250, requestedBudgetMs ?? REQUEST_BUDGET_MS),
    ),
    callsRemaining: Math.min(
      REQUEST_MAX_CALLS,
      Math.max(1, requestedMaximumCalls ?? REQUEST_MAX_CALLS),
    ),
  })
  const expiries: string[] = []
  const tradingGrant = scopeGrantEvidence()
  const inventoryGrant = scopeGrantEvidence()
  const analyticsGrant = scopeGrantEvidence()
  const fulfillmentGrant = scopeGrantEvidence()
  const credentials = generalCredentials(environment)
  let tradingToken = ""
  let verifiedAccount: {
    observedAt: string
    fingerprintMatch: boolean
    site: string | null
  } | null = null
  try {
    const minted = await accessToken({
      operation: "OAUTH_REFRESH_TRADING",
      credentials,
      scopes: [BASE_SCOPE],
      fetchImpl,
      calls,
      clock,
    })
    tradingToken = minted.value
    expiries.push(minted.expiresAt)
    const missingRequestedScopes = registerScopeEvidence({
      ledger: tradingGrant,
      token: minted,
      requestedScopes: [BASE_SCOPE],
    })
    const account = await verifyAccount({
      token: tradingToken,
      expectedUserId: identity.expectedUserId,
      expectedFingerprint: identity.expectedAccountFingerprint,
      fetchImpl,
      calls,
      clock,
    })
    verifiedAccount = account
    tradingGrant.bindingVerified = true
    if (missingRequestedScopes.includes(BASE_SCOPE)) {
      throw new Error("EBAY_MONITOR_BASE_SCOPE_MISSING")
    }
    const sellerWide = await sellerWideDiscovery({
      token: tradingToken,
      fetchImpl,
      calls,
      clock,
    })
    const marketplace = await certifySellerWideItemMarketplaces({
      token: tradingToken,
      listings: sellerWide.listings,
      totalEntries: sellerWide.totalEntries,
      fetchImpl,
      calls,
      clock,
    })
    const parsedSellerWideItemCount =
      marketplace.marketplaceCertification.sellerWideItemsParsed
    const sellerWideItemSetComplete =
      parsedSellerWideItemCount !== null &&
      sellerWide.totalEntries !== null &&
      parsedSellerWideItemCount === sellerWide.totalEntries &&
      sellerWide.totalEntries < 25_000 &&
      sellerWide.totalPages !== null &&
      sellerWide.pagesRead === sellerWide.totalPages &&
      !sellerWide.reachedPageLimit &&
      !sellerWide.pageFailed &&
      !sellerWide.paginationMetadataConflict &&
      !sellerWide.sourceIdentityConflict
    const sellerWideEnumeration = {
      identities: sellerWide.listings.map((listing) => ({
        itemId: listing.itemId,
        sku: listing.sku,
        variationKey: listing.variationKey,
        identityAmbiguous: listing.identityAmbiguous,
        representationEligible: false as const,
        analyticsEligible: false as const,
      })),
      itemSetComplete: sellerWideItemSetComplete,
      identitySetComplete: sellerWideItemSetComplete &&
        !sellerWide.ambiguousVariationIdentity,
    }
    const discovery = {
      ...sellerWide,
      sellerWideEnumeration,
      listings: marketplace.listings,
      marketplaceCertification: marketplace.marketplaceCertification,
      marketplaceScopeConflict: marketplace.incomplete ||
        sellerWide.sourceIdentityConflict,
      marketplaceGapCodes: [
        ...marketplace.gapCodes,
        ...(sellerWide.sourceIdentityConflict
          ? ["SELLER_WIDE_SOURCE_IDENTITY_CONFLICT"]
          : []),
      ],
      marketplaceTerminalItemCount: marketplace.terminalItemCount,
    }
    tradingToken = ""
    const marketplaceProven = account.site === "US"
    const listingIds = [...new Set(discovery.listings
      .map((listing) => listing.itemId))]
    const [inventory, analyticsReadResult, orders] = await Promise.all([
      inventoryRead({
        credentials,
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: inventoryGrant,
      }),
      analyticsRead({
        credentials,
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        listingIds,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: analyticsGrant,
      }),
      ordersRead({
        credentials: fulfillmentCredentials(environment),
        expectedUserId: identity.expectedUserId,
        expectedFingerprint: identity.expectedAccountFingerprint,
        fetchImpl,
        calls,
        clock,
        expiries,
        scopeGrant: fulfillmentGrant,
      }),
    ])
    const analytics = marketplace.incomplete &&
        analyticsReadResult.status !== "UNAVAILABLE"
      ? {
          ...analyticsReadResult,
          status: "PARTIAL" as const,
          analyticsCoverageStatus: "PARTIAL" as const,
          gapCodes: [...new Set([
            ...analyticsReadResult.gapCodes,
            "ANALYTICS_LISTING_SCOPE_PARTIAL_DUE_TO_MARKETPLACE_UNPROVEN",
          ])],
        }
      : analyticsReadResult
    const sellerIdentityKeys = new Set(
      discovery.sellerWideEnumeration.identities.map((listing) =>
        itemSkuIdentityKey(listing.itemId, listing.sku)))
    const inventoryIdentityKeys = new Set(inventory.publishedOffers.map(
      (offer) => itemSkuIdentityKey(offer.itemId, offer.sku)))
    const inventoryOnly = discovery.sellerWideEnumeration.identitySetComplete &&
        inventory.status === "AVAILABLE"
      ? inventory.publishedOffers.filter((offer) =>
          !sellerIdentityKeys.has(itemSkuIdentityKey(offer.itemId, offer.sku)))
      : null
    const tradingOnly = inventory.status === "AVAILABLE"
      ? discovery.listings.filter((listing) =>
          !inventoryIdentityKeys.has(itemSkuIdentityKey(
            listing.itemId,
            listing.sku,
          )))
      : []
    const certification = discovery.marketplaceCertification
    const certificationCounts = [
      certification.sellerWideItemsMarketplaceCertifiedUs,
      certification.sellerWideItemsMarketplaceCertifiedNonUs,
      certification.sellerWideItemsMarketplaceUnresolved,
      certification.sellerWideItemsMarketplaceError,
      certification.sellerWideItemsMarketplaceItemIdMismatch,
      certification.sellerWideItemsMarketplaceBudgetExhausted,
    ]
    const certificationPartitionItemCount = certificationCounts.every(
        (value) => typeof value === "number")
      ? certificationCounts.reduce((total, value) => total + Number(value), 0)
      : null
    const sellerWideCountMismatch = discovery.totalEntries !== null &&
      certification.sellerWideItemsParsed !== discovery.totalEntries
    const marketplacePartitionMismatch =
      certification.sellerWideItemsParsed !== null &&
      (certificationPartitionItemCount === null ||
        certificationPartitionItemCount !== certification.sellerWideItemsParsed)
    const coverage = normalizeLiveDiscoveryCoverage({
      pagesRead: discovery.pagesRead,
      totalPages: discovery.totalPages,
      totalEntries: discovery.totalEntries,
      reachedPageLimit: discovery.reachedPageLimit,
      pageFailed: discovery.pageFailed,
      paginationMetadataConflict: discovery.paginationMetadataConflict,
      ambiguousVariationIdentity: discovery.ambiguousVariationIdentity,
      marketplaceScopeConflict: discovery.marketplaceScopeConflict,
      inventoryCompared: inventory.status === "AVAILABLE",
      registryCompared: false,
      unexplainedDifferenceCount: inventoryOnly ? inventoryOnly.length : 0,
    })
    const oauthAvailable = calls.some((entry) =>
      entry.operation.startsWith("OAUTH_REFRESH_") &&
      entry.status === "SUCCEEDED")
    const failedOAuth = calls.some((entry) =>
      entry.operation.startsWith("OAUTH_REFRESH_") && entry.status === "FAILED")
    const inventoryScopeAvailable = inventory.status === "AVAILABLE" ||
      inventory.status === "PARTIAL" ||
      (inventoryGrant.bindingVerified &&
        inventoryGrant.granted.has(INVENTORY_READONLY_SCOPE))
    const analyticsScopeAvailable = analytics.status === "CERTIFIED" ||
      analytics.status === "PARTIAL" ||
      (analyticsGrant.bindingVerified &&
        analyticsGrant.granted.has(ANALYTICS_READONLY_SCOPE))
    const fulfillmentScopeAvailable = orders.status === "CERTIFIED" ||
      orders.status === "PARTIAL" ||
      (fulfillmentGrant.bindingVerified &&
        fulfillmentGrant.granted.has(FULFILLMENT_READONLY_SCOPE))
    const anyMissingScope = [
      tradingGrant,
      inventoryGrant,
      analyticsGrant,
      fulfillmentGrant,
    ].some((grant) => grant.missing.size > 0)
    const allRequiredScopesAvailable = inventoryScopeAvailable &&
      analyticsScopeAvailable && fulfillmentScopeAvailable
    return {
      contractVersion: EBAY_MONITOR_LIVE_READONLY_CONTRACT_VERSION,
      mode: "READ_ONLY",
      environment: "PRODUCTION",
      marketplaceId: MARKETPLACE_ID,
      account: {
        status: marketplaceProven ? "CERTIFIED" : "PARTIAL",
        accountAlias: configuration.accountAlias,
        bindingConfigured: true,
        bindingMatched: account.fingerprintMatch,
        observedAt: account.observedAt,
        source: "EBAY_TRADING_GET_USER",
        limitationCode: marketplaceProven
          ? null
          : "EBAY_US_MARKETPLACE_BINDING_UNPROVEN",
      },
      oauth: {
        status: oauthAvailable
          ? failedOAuth || anyMissingScope || !allRequiredScopesAvailable
            ? "PARTIAL"
            : "AVAILABLE"
          : "UNAVAILABLE",
        tokenReceived: oauthAvailable,
        tokenPersisted: false,
        tokenReturned: false,
        expiryKnown: expiries.length > 0,
        earliestAccessTokenExpiryAt: expiries.sort()[0] ?? null,
        scopes: scopeEvidence({
          baseAvailable: true,
          inventoryAvailable: inventoryScopeAvailable,
          analyticsAvailable: analyticsScopeAvailable,
          fulfillmentAvailable: fulfillmentScopeAvailable,
          tradingGrant,
          inventoryGrant,
          analyticsGrant,
          fulfillmentGrant,
          calls,
        }),
      },
      discovery: {
        status: coverage.status === "COMPLETE" ? "AVAILABLE" : "PARTIAL",
        coverage: coverage.status,
        observedAt: discovery.observedAt,
        source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
        sellerWideEnumeration: discovery.sellerWideEnumeration,
        listings: discovery.listings,
        pagesRead: discovery.pagesRead,
        totalPages: discovery.totalPages,
        totalEntries: discovery.totalEntries,
        marketplaceCertification: discovery.marketplaceCertification,
        gapCodes: [
          ...coverage.gapCodes,
          ...(discovery.limitationCode ? [discovery.limitationCode] : []),
          ...discovery.marketplaceGapCodes,
          ...(!marketplaceProven
            ? ["EBAY_US_MARKETPLACE_BINDING_UNPROVEN"]
            : []),
          ...(inventoryOnly && inventoryOnly.length
            ? ["INVENTORY_PUBLISHED_LISTING_NOT_IN_SELLER_WIDE_RESULT"]
            : []),
          ...(tradingOnly.length
            ? ["TRADING_LISTING_NOT_IN_INVENTORY_API_EXPECTED_MODEL_GAP"]
            : []),
          ...(sellerWideCountMismatch
            ? ["SELLER_WIDE_ITEM_COUNT_RECONCILIATION_FAILED"]
            : []),
          ...(marketplacePartitionMismatch
            ? ["SELLER_WIDE_MARKETPLACE_PARTITION_INVARIANT_FAILED"]
            : []),
          ...(inventory.status === "PARTIAL" ? inventory.gapCodes : []),
        ],
        inventory,
      },
      analytics,
      orders,
      calls: [...calls].sort((left, right) =>
        Date.parse(left.observedAt) - Date.parse(right.observedAt)),
      safety: {
        marketplaceWrites: 0,
        databaseWrites: 0,
        inventoryWrites: 0,
        listingRevisions: 0,
        listingEnds: 0,
        fulfillmentWrites: 0,
        buyerMessages: 0,
        whatsappCalls: 0,
        tokensReturned: false,
        rawPayloadsReturned: false,
        buyerPiiReturned: false,
      },
    }
  } catch (error) {
    tradingToken = ""
    const result = unavailableResult({
      accountAlias: configuration.accountAlias,
      bindingConfigured: identity.bound,
      limitationCode: safeCode(error, "EBAY_MONITOR_LIVE_READ_FAILED"),
    })
    result.calls = calls
    if (verifiedAccount) {
      result.account = {
        status: verifiedAccount.site === "US" ? "CERTIFIED" : "PARTIAL",
        accountAlias: configuration.accountAlias,
        bindingConfigured: true,
        bindingMatched: true,
        observedAt: verifiedAccount.observedAt,
        source: "EBAY_TRADING_GET_USER",
        limitationCode: verifiedAccount.site === "US"
          ? null
          : "EBAY_US_MARKETPLACE_BINDING_UNPROVEN",
      }
    } else {
      result.account.status = "BLOCKED"
    }
    result.oauth.status = expiries.length > 0 ? "PARTIAL" : "ERROR"
    result.oauth.tokenReceived = expiries.length > 0
    result.oauth.expiryKnown = expiries.length > 0
    result.oauth.earliestAccessTokenExpiryAt = expiries.sort()[0] ?? null
    result.oauth.scopes = scopeEvidence({
      baseAvailable: Boolean(verifiedAccount),
      inventoryAvailable: false,
      analyticsAvailable: false,
      fulfillmentAvailable: false,
      tradingGrant,
      inventoryGrant,
      analyticsGrant,
      fulfillmentGrant,
      calls,
    })
    return result
  } finally {
    tradingToken = ""
  }
}

export function hashEbayMonitorEvidenceIdentifier(value: string) {
  return createHash("sha256")
    .update(`EBAY_MONITOR_EVIDENCE:${value}`)
    .digest("hex")
}
