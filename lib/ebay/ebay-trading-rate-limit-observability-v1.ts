import { getEbayBaseApplicationTokenV1 } from
  "./ebay-seller-keyword-demand-gateway"
import { getEbaySellerOAuthReauthRuntimeCredentialMatch } from
  "./ebay-seller-oauth-reauth-domain"

export const SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_VERSION =
  "SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_V1" as const

export const SELLER_OS_EBAY_TRADING_RATE_LIMIT_RESOURCE_V1 = Object.freeze({
  id: "seller-os://phase-2/ebay-trading-rate-limit",
  title: "Seller OS eBay Trading API rate-limit evidence",
  description: "Bounded application-level eBay Developer Analytics evidence for the canonical production Trading API quota gate.",
})

export const EBAY_TRADING_RATE_LIMIT_API_CONTEXT = "tradingapi" as const
export const EBAY_TRADING_RATE_LIMIT_API_NAME = "tradingapi" as const

const DEVELOPER_ANALYTICS_ENDPOINT =
  "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/"
const REQUEST_TIMEOUT_MS = 8_000
const MAX_RESPONSE_BYTES = 256_000
const MAX_RATE_ENTRIES = 100
const CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_TIME_WINDOW_SECONDS = 31 * 24 * 60 * 60

type JsonRecord = Record<string, unknown>

export type SellerOsEbayTradingQuotaGateV1 =
  | "OPEN"
  | "BLOCKED"
  | "UNPROVEN"

export type SellerOsEbayTradingRateV1 = Readonly<{
  apiContext: typeof EBAY_TRADING_RATE_LIMIT_API_CONTEXT
  apiName: typeof EBAY_TRADING_RATE_LIMIT_API_NAME
  apiVersion: string | null
  resource: string
  count: number
  limit: number
  remaining: number
  resetAt: string
  timeWindow: number
  limitScope: "APPLICATION"
}>

export type SellerOsEbayTradingRateLimitStatusV1 = Readonly<{
  contractVersion: typeof SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_VERSION
  status: "AVAILABLE" | "UNAVAILABLE"
  sourceStatus: "AVAILABLE" | "UNAVAILABLE"
  source: "EBAY_DEVELOPER_ANALYTICS_GET_RATE_LIMITS"
  observedAt: string
  bounded: true
  ebayEnvironment: "PRODUCTION"
  ebayMarketplace: "EBAY_US"
  ebayAppIdentityMatch: boolean
  tradingApiRateLimitFound: boolean
  gateState: SellerOsEbayTradingQuotaGateV1
  rates: readonly SellerOsEbayTradingRateV1[]
  rateCount: number
  truncated: boolean
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "NONE"
  ebay518BucketIdentity: "PROVEN" | "UNPROVEN"
  ebay518LimitScope: "APPLICATION" | "UNPROVEN"
  ebay518Rate: SellerOsEbayTradingRateV1 | null
  blockingRates: readonly SellerOsEbayTradingRateV1[]
  nextSafeTradingProbeAt: string | null
  retryPolicy: Readonly<{
    tradingProbeWhileBlockedAllowed: false
    certificationProbesAfterProvenResetMaximum: 1
    automaticPolling: false
    p2ActivationAuthorized: false
  }>
  limitationCodes: readonly string[]
  acquisition: Readonly<{
    method: "EBAY_DEVELOPER_ANALYTICS_CLIENT_CREDENTIALS"
    apiContextFilter: typeof EBAY_TRADING_RATE_LIMIT_API_CONTEXT
    apiNameFilter: typeof EBAY_TRADING_RATE_LIMIT_API_NAME
    cacheStatus: "HIT" | "MISS" | "NOT_APPLICABLE"
    developerAnalyticsCallsByThisRead: 0 | 1
  }>
  safety: Readonly<{
    readOnlySurface: true
    callerProvidedApiContextAllowed: false
    arbitraryUrlAllowed: false
    tradingLiveCallsByThisRead: 0
    getMyeBaySellingCallsByThisRead: 0
    getSellerListCallsByThisRead: 0
    getItemCallsByThisRead: 0
    ebayWritesByThisRead: 0
    listingWritesByThisRead: 0
    inventoryWritesByThisRead: 0
    oauthUserChangesByThisRead: 0
    credentialsIncluded: false
    environmentValuesIncluded: false
    buyerPiiIncluded: false
    lunaPollingByThisRead: 0
    vaultWritesByThisRead: 0
    messageSendsByThisRead: 0
    paymentTransactionsByThisRead: 0
  }>
}>

type CollectorOptions = Readonly<{
  environment?: NodeJS.ProcessEnv
  fetcher?: typeof fetch
  tokenProvider?: () => Promise<string>
  appIdentityVerifier?: (clientId: string) => boolean
  now?: () => number
}>

let cache: {
  value: SellerOsEbayTradingRateLimitStatusV1
  expiresAt: number
} | null = null
let inFlight: Promise<SellerOsEbayTradingRateLimitStatusV1> | null = null

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function array(value: unknown) {
  return Array.isArray(value) ? value : []
}

function boundedText(value: unknown, maximum = 120) {
  const candidate = typeof value === "string" ? value.trim() : ""
  return candidate && candidate.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(candidate)
    ? candidate
    : ""
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null
}

function positiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && Number(value) > 0 &&
      Number(value) <= maximum
    ? Number(value)
    : null
}

function validReset(value: unknown, observedAtMs: number) {
  const candidate = boundedText(value, 48)
  const parsed = Date.parse(candidate)
  return candidate && Number.isFinite(parsed) && parsed > observedAtMs
    ? new Date(parsed).toISOString()
    : null
}

function safety() {
  return Object.freeze({
    readOnlySurface: true as const,
    callerProvidedApiContextAllowed: false as const,
    arbitraryUrlAllowed: false as const,
    tradingLiveCallsByThisRead: 0 as const,
    getMyeBaySellingCallsByThisRead: 0 as const,
    getSellerListCallsByThisRead: 0 as const,
    getItemCallsByThisRead: 0 as const,
    ebayWritesByThisRead: 0 as const,
    listingWritesByThisRead: 0 as const,
    inventoryWritesByThisRead: 0 as const,
    oauthUserChangesByThisRead: 0 as const,
    credentialsIncluded: false as const,
    environmentValuesIncluded: false as const,
    buyerPiiIncluded: false as const,
    lunaPollingByThisRead: 0 as const,
    vaultWritesByThisRead: 0 as const,
    messageSendsByThisRead: 0 as const,
    paymentTransactionsByThisRead: 0 as const,
  })
}

function acquisition(
  cacheStatus: "HIT" | "MISS" | "NOT_APPLICABLE",
  calls: 0 | 1,
) {
  return Object.freeze({
    method: "EBAY_DEVELOPER_ANALYTICS_CLIENT_CREDENTIALS" as const,
    apiContextFilter: EBAY_TRADING_RATE_LIMIT_API_CONTEXT,
    apiNameFilter: EBAY_TRADING_RATE_LIMIT_API_NAME,
    cacheStatus,
    developerAnalyticsCallsByThisRead: calls,
  })
}

function retryPolicy() {
  return Object.freeze({
    tradingProbeWhileBlockedAllowed: false as const,
    certificationProbesAfterProvenResetMaximum: 1 as const,
    automaticPolling: false as const,
    p2ActivationAuthorized: false as const,
  })
}

export function createUnavailableSellerOsEbayTradingRateLimitStatusV1(
  limitationCode = "EBAY_DEVELOPER_ANALYTICS_UNAVAILABLE",
  observedAt = new Date().toISOString(),
  ebayAppIdentityMatch = false,
): SellerOsEbayTradingRateLimitStatusV1 {
  return Object.freeze({
    contractVersion: SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_VERSION,
    status: "UNAVAILABLE",
    sourceStatus: "UNAVAILABLE",
    source: "EBAY_DEVELOPER_ANALYTICS_GET_RATE_LIMITS",
    observedAt,
    bounded: true,
    ebayEnvironment: "PRODUCTION",
    ebayMarketplace: "EBAY_US",
    ebayAppIdentityMatch,
    tradingApiRateLimitFound: false,
    gateState: "UNPROVEN",
    rates: Object.freeze([]),
    rateCount: 0,
    truncated: false,
    evidenceCompleteness: "NONE",
    ebay518BucketIdentity: "UNPROVEN",
    ebay518LimitScope: "UNPROVEN",
    ebay518Rate: null,
    blockingRates: Object.freeze([]),
    nextSafeTradingProbeAt: null,
    retryPolicy: retryPolicy(),
    limitationCodes: Object.freeze([limitationCode]),
    acquisition: acquisition("NOT_APPLICABLE", 0),
    safety: safety(),
  })
}

function provesKnown518Bucket(rates: readonly SellerOsEbayTradingRateV1[]) {
  const names = new Set(rates.map((entry) => entry.resource.toLowerCase()))
  return rates.length === 1 && ["api", "tradingapi", "trading_api"]
    .includes(rates[0].resource.toLowerCase()) ||
    names.has("getmyebayselling") && names.has("getsellerlist")
}

export function buildSellerOsEbayTradingRateLimitStatusV1(input: {
  payload: unknown
  observedAt?: string
  ebayAppIdentityMatch: boolean
  sourceStatus?: "AVAILABLE" | "UNAVAILABLE"
}): SellerOsEbayTradingRateLimitStatusV1 {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const observedAtMs = Date.parse(observedAt)
  if (input.sourceStatus === "UNAVAILABLE" ||
      !Number.isFinite(observedAtMs) || !input.ebayAppIdentityMatch) {
    return createUnavailableSellerOsEbayTradingRateLimitStatusV1(
      !input.ebayAppIdentityMatch
        ? "EBAY_CANONICAL_APP_IDENTITY_UNMATCHED"
        : "EBAY_DEVELOPER_ANALYTICS_UNAVAILABLE",
      observedAt,
      input.ebayAppIdentityMatch,
    )
  }

  const tradingLimits = array(record(input.payload).rateLimits)
    .map(record)
    .filter((entry) =>
      boundedText(entry.apiContext).toLowerCase() ===
        EBAY_TRADING_RATE_LIMIT_API_CONTEXT &&
      boundedText(entry.apiName).toLowerCase() ===
        EBAY_TRADING_RATE_LIMIT_API_NAME)
  let invalidRateCount = 0
  const candidates: SellerOsEbayTradingRateV1[] = []
  for (const limitEntry of tradingLimits) {
    const apiVersion = boundedText(limitEntry.apiVersion, 40) || null
    for (const resourceEntry of array(limitEntry.resources).map(record)) {
      const resource = boundedText(resourceEntry.name)
      for (const rateEntry of array(resourceEntry.rates).map(record)) {
        const count = nonNegativeInteger(rateEntry.count)
        const limit = positiveInteger(rateEntry.limit)
        const remaining = nonNegativeInteger(rateEntry.remaining)
        const resetAt = validReset(rateEntry.reset, observedAtMs)
        const timeWindow = positiveInteger(
          rateEntry.timeWindow,
          MAX_TIME_WINDOW_SECONDS,
        )
        if (!resource || count === null || limit === null ||
            remaining === null || remaining > limit || !resetAt ||
            timeWindow === null) {
          invalidRateCount += 1
          continue
        }
        candidates.push(Object.freeze({
          apiContext: EBAY_TRADING_RATE_LIMIT_API_CONTEXT,
          apiName: EBAY_TRADING_RATE_LIMIT_API_NAME,
          apiVersion,
          resource,
          count,
          limit,
          remaining,
          resetAt,
          timeWindow,
          limitScope: "APPLICATION" as const,
        }))
      }
    }
  }
  const truncated = candidates.length > MAX_RATE_ENTRIES
  const rates = Object.freeze(candidates.slice(0, MAX_RATE_ENTRIES))
  const blockingRates = Object.freeze(rates.filter((entry) =>
    entry.remaining === 0))
  const complete = rates.length > 0 && invalidRateCount === 0 && !truncated
  const gateState: SellerOsEbayTradingQuotaGateV1 = blockingRates.length > 0
    ? "BLOCKED"
    : complete && rates.every((entry) => entry.remaining > 0)
      ? "OPEN"
      : "UNPROVEN"
  const bucketProven = gateState === "BLOCKED" &&
    provesKnown518Bucket(blockingRates)
  const latestBlockingReset = blockingRates.map((entry) => entry.resetAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null
  const limitationCodes = [
    ...(tradingLimits.length === 0
      ? ["TRADING_API_RATE_LIMIT_NOT_RETURNED"] : []),
    ...(invalidRateCount > 0
      ? ["TRADING_API_RATE_LIMIT_CONTRACT_INCOMPLETE"] : []),
    ...(truncated ? ["TRADING_API_RATE_LIMIT_RESPONSE_TRUNCATED"] : []),
    ...(gateState === "UNPROVEN" ? ["TRADING_QUOTA_GATE_UNPROVEN"] : []),
    ...(gateState === "OPEN" && !bucketProven
      ? ["HISTORICAL_518_BUCKET_NOT_EXHAUSTED_IN_CURRENT_APPLICATION_WINDOW"]
      : []),
    ...(gateState === "BLOCKED" && !bucketProven
      ? ["EXHAUSTED_TRADING_RATE_NOT_SUFFICIENT_TO_IDENTIFY_518_BUCKET"]
      : []),
  ]
  return Object.freeze({
    contractVersion: SELLER_OS_EBAY_TRADING_RATE_LIMIT_STATUS_VERSION,
    status: rates.length > 0 ? "AVAILABLE" : "UNAVAILABLE",
    sourceStatus: "AVAILABLE",
    source: "EBAY_DEVELOPER_ANALYTICS_GET_RATE_LIMITS",
    observedAt,
    bounded: true,
    ebayEnvironment: "PRODUCTION",
    ebayMarketplace: "EBAY_US",
    ebayAppIdentityMatch: input.ebayAppIdentityMatch,
    tradingApiRateLimitFound: rates.length > 0,
    gateState,
    rates,
    rateCount: candidates.length,
    truncated,
    evidenceCompleteness: complete ? "COMPLETE" : rates.length
      ? "PARTIAL" : "NONE",
    ebay518BucketIdentity: bucketProven ? "PROVEN" : "UNPROVEN",
    ebay518LimitScope: bucketProven ? "APPLICATION" : "UNPROVEN",
    ebay518Rate: bucketProven && blockingRates.length === 1
      ? blockingRates[0] : null,
    blockingRates,
    nextSafeTradingProbeAt: gateState === "BLOCKED"
      ? latestBlockingReset : null,
    retryPolicy: retryPolicy(),
    limitationCodes: Object.freeze(limitationCodes),
    acquisition: acquisition("NOT_APPLICABLE", 0),
    safety: safety(),
  })
}

function withAcquisition(
  value: SellerOsEbayTradingRateLimitStatusV1,
  cacheStatus: "HIT" | "MISS",
  calls: 0 | 1,
) {
  return Object.freeze({ ...value, acquisition: acquisition(cacheStatus, calls) })
}

export function resetSellerOsEbayTradingRateLimitCacheForTestsV1() {
  cache = null
  inFlight = null
}

export async function collectSellerOsEbayTradingRateLimitStatusV1(
  options: CollectorOptions = {},
): Promise<SellerOsEbayTradingRateLimitStatusV1> {
  const environment = options.environment ?? process.env
  const now = options.now ?? Date.now
  const nowMs = now()
  if (cache && cache.expiresAt > nowMs) {
    return withAcquisition(cache.value, "HIT", 0)
  }
  if (inFlight) return inFlight
  const clientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecretPresent = Boolean(environment.EBAY_CLIENT_SECRET?.trim())
  const appIdentityMatch = options.appIdentityVerifier
    ? options.appIdentityVerifier(clientId)
    : getEbaySellerOAuthReauthRuntimeCredentialMatch({
      clientId,
      runame: environment.EBAY_RuName?.trim() ?? "",
    }).APP_ID_PORTAL_RUNTIME_MATCH
  if (!appIdentityMatch || !clientSecretPresent) {
    return createUnavailableSellerOsEbayTradingRateLimitStatusV1(
      appIdentityMatch
        ? "EBAY_CANONICAL_APP_SECRET_UNAVAILABLE"
        : "EBAY_CANONICAL_APP_IDENTITY_UNMATCHED",
      new Date(nowMs).toISOString(),
      appIdentityMatch,
    )
  }
  const fetcher = options.fetcher ?? fetch
  const tokenProvider = options.tokenProvider ?? getEbayBaseApplicationTokenV1
  inFlight = (async () => {
    const observedAt = new Date(nowMs).toISOString()
    let token = ""
    let analyticsCalls: 0 | 1 = 0
    try {
      token = await tokenProvider()
      if (!token || token.length > 8_192) {
        return createUnavailableSellerOsEbayTradingRateLimitStatusV1(
          "EBAY_DEVELOPER_ANALYTICS_APP_TOKEN_UNAVAILABLE",
          observedAt,
          true,
        )
      }
      const endpoint = new URL(DEVELOPER_ANALYTICS_ENDPOINT)
      endpoint.searchParams.set("api_context",
        EBAY_TRADING_RATE_LIMIT_API_CONTEXT)
      endpoint.searchParams.set("api_name", EBAY_TRADING_RATE_LIMIT_API_NAME)
      analyticsCalls = 1
      const response = await fetcher(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        return withAcquisition(
          createUnavailableSellerOsEbayTradingRateLimitStatusV1(
            "EBAY_DEVELOPER_ANALYTICS_READ_FAILED_CLOSED",
            observedAt,
            true,
          ),
          "MISS",
          1,
        )
      }
      const responseText = await response.text()
      if (!responseText || Buffer.byteLength(responseText, "utf8") >
          MAX_RESPONSE_BYTES) {
        return withAcquisition(
          createUnavailableSellerOsEbayTradingRateLimitStatusV1(
            "EBAY_DEVELOPER_ANALYTICS_RESPONSE_NOT_BOUNDED",
            observedAt,
            true,
          ),
          "MISS",
          1,
        )
      }
      let payload: unknown
      try {
        payload = JSON.parse(responseText)
      } catch {
        return withAcquisition(
          createUnavailableSellerOsEbayTradingRateLimitStatusV1(
            "EBAY_DEVELOPER_ANALYTICS_RESPONSE_INVALID",
            observedAt,
            true,
          ),
          "MISS",
          1,
        )
      }
      const value = withAcquisition(
        buildSellerOsEbayTradingRateLimitStatusV1({
          payload,
          observedAt,
          ebayAppIdentityMatch: true,
        }),
        "MISS",
        1,
      )
      cache = { value, expiresAt: nowMs + CACHE_TTL_MS }
      return value
    } catch {
      return withAcquisition(
        createUnavailableSellerOsEbayTradingRateLimitStatusV1(
          "EBAY_DEVELOPER_ANALYTICS_READ_FAILED_CLOSED",
          observedAt,
          true,
        ),
        "MISS",
        analyticsCalls,
      )
    } finally {
      token = ""
    }
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
