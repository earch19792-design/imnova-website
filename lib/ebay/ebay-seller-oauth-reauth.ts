import {
  ebayProductionAccountFingerprint,
} from "./ebay-seller-account-scope"
import {
  assertEbayMonitorReadonlyRequest,
  parseEbayTradingGetUser,
} from "./ebay-commercial-monitor-live-readonly-domain"
import {
  buildEbaySellerTrafficReportUrl,
  EBAY_SELLER_TRAFFIC_METRICS,
} from "./ebay-seller-traffic-report"
import {
  buildEbaySellerOAuthReauthAuthorizationUrl,
  buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl,
  createEbaySellerOAuthReauthCookie,
  createEbaySellerOAuthReauthState,
  EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_ENDPOINT,
  EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS,
  EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS,
  EBAY_SELLER_OAUTH_REAUTH_SCOPES,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  EbaySellerOAuthReauthError,
  exactEbaySellerOAuthReauthReturnedScopes,
  hashEbaySellerOAuthReauthState,
  type EbaySellerOAuthCallbackInput,
  type EbaySellerOAuthReauthConfiguration,
  type EbaySellerOAuthReauthPreflightPhase,
  type EbaySellerOAuthReauthScopeEncoding,
} from "./ebay-seller-oauth-reauth-domain"
import type {
  EbaySellerOAuthReauthStateLedger,
} from "./ebay-seller-oauth-reauth-ledger"

const EBAY_API_ORIGIN = "https://api.ebay.com"
const EBAY_TOKEN_ENDPOINT = `${EBAY_API_ORIGIN}/identity/v1/oauth2/token`
const EBAY_TRADING_ENDPOINT = `${EBAY_API_ORIGIN}/ws/api.dll`
const EBAY_INVENTORY_LOCATION_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/inventory/v1/location?limit=1&offset=0`
const EBAY_ACCOUNT_PRIVILEGE_ENDPOINT =
  `${EBAY_API_ORIGIN}/sell/account/v1/privilege`
const EBAY_MARKETPLACE_ID = "EBAY_US"
const TRADING_COMPATIBILITY_LEVEL = "1423"
const SEQUENTIAL_REQUEST_TIMEOUT_MS = 5_000
const PARALLEL_PROBE_TIMEOUT_MS = 6_000
const AUTHORIZATION_PREFLIGHT_TIMEOUT_MS = 3_000
const AUTHORIZATION_PREFLIGHT_BODY_LIMIT = 16_384
const AUTHORIZATION_PREFLIGHT_CONCURRENCY = 1
const AUTHORIZATION_PREFLIGHT_MAX_TESTS = 6
const AUTHORIZATION_PREFLIGHT_MAX_NETWORK_CALLS = 12

const GET_USER_BODY = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
  "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
  "<OutputSelector>User.UserID</OutputSelector>" +
  "<OutputSelector>User.Site</OutputSelector>" +
  "</GetUserRequest>"

type Clock = () => number
type FetchLike = typeof fetch

export type EbaySellerOAuthReauthCallOperation =
  | "OAUTH_AUTHORIZATION_CODE_EXCHANGE"
  | "OAUTH_EXACT_UNION_REFRESH"
  | "TRADING_GET_USER"
  | "INVENTORY_GET_LOCATIONS_SCOPE_PROBE"
  | "ANALYTICS_TRAFFIC_REPORT_SCOPE_PROBE"
  | "ACCOUNT_PRIVILEGE_SCOPE_PROBE"

export type EbaySellerOAuthReauthCallEvidence = {
  operation: EbaySellerOAuthReauthCallOperation
  method: "GET" | "POST"
  endpoint: string
  status: "SUCCEEDED" | "FAILED"
  httpStatus: number | null
  marketplaceMutation: false
  persisted: false
}

type CandidateVerificationResult = {
  refreshToken: string
  credentialSource: "NEW_OAUTH_CANDIDATE_ONLY"
  genericEnvironmentTokenFallback: false
  capabilities: {
    tradingBase: "AVAILABLE"
    inventoryReadonly: "AVAILABLE"
    analyticsReadonly: "AVAILABLE"
    accountReadonly: "AVAILABLE"
  }
  calls: EbaySellerOAuthReauthCallEvidence[]
  safety: {
    tokenPersisted: false
    oauthCodePersisted: false
    rawStatePersisted: false
    ebayWrites: 0
    inventoryWrites: 0
    listingWrites: 0
    promotionWrites: 0
    fulfillmentWrites: 0
    buyerMessageWrites: 0
    whatsappDispatches: 0
    businessDataMutations: 0
    productCaseMutations: 0
    registryMutations: 0
    vaultMutations: 0
    vercelMutations: 0
  }
}

type JsonRecord = Record<string, unknown>

export type EbaySellerOAuthReauthAuthorizationPreflightResult = {
  acceptedByAuthEndpoint: "YES" | "NO"
  safeErrorCategory:
    | "NONE"
    | "INVALID_REQUEST"
    | "AUTH_ENDPOINT_REJECTED"
    | "AUTH_ENDPOINT_UNAVAILABLE"
    | "AUTH_ENDPOINT_RESPONSE_UNPROVEN"
}

export type EbaySellerOAuthReauthAuthorizationDiagnosis = {
  rootCause:
    | "CLIENT_ID_RUNAME_BINDING"
    | "SCOPE_ACCOUNT_REJECTED"
    | "SCOPE_INVENTORY_REJECTED"
    | "SCOPE_ANALYTICS_REJECTED"
    | "URL_SERIALIZATION"
    | "STATE_PARAMETER"
    | "STILL_UNPROVEN"
  testBase: EbaySellerOAuthReauthAuthorizationPreflightResult
  testBaseAccount: EbaySellerOAuthReauthAuthorizationPreflightResult
  testBaseAccountInventory: EbaySellerOAuthReauthAuthorizationPreflightResult
  testFullFourScopes: EbaySellerOAuthReauthAuthorizationPreflightResult
  canonicalWithState: EbaySellerOAuthReauthAuthorizationPreflightResult
  previousPlusEncodingWithState:
    EbaySellerOAuthReauthAuthorizationPreflightResult
  runameSource: "EBAY_RuName"
  runameAppBinding: "PASS" | "FAIL" | "UNPROVEN"
  currentScopeEncoding: "RFC3986_PERCENT20"
  previousScopeEncoding: "FORM_URLENCODED_PLUS"
  encodingCausesInvalidRequest: "YES" | "NO" | "UNPROVEN"
  stateCausesInvalidRequest: "YES" | "NO" | "UNPROVEN"
  stateFormatValid: true
  scopeCount: 4
  parameterNames: readonly [
    "client_id",
    "response_type",
    "redirect_uri",
    "scope",
    "state",
  ]
  externalCalls: number
  ledgerRowsCreated: 0
  cookiesSet: 0
  humanRedirects: 0
  oauthConsentLaunched: false
  authorizationCodeExchangeCalls: 0
  secretsReturned: false
  startAllowed: boolean
}

async function boundedLedgerOperation<T>(
  operation: Promise<T>,
  timeoutMs = EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      timeoutMs > EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT",
    )
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(
          new EbaySellerOAuthReauthError(
            "EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT",
          ),
        ), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

async function boundedAuthorizationPreflightBody(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > AUTHORIZATION_PREFLIGHT_BODY_LIMIT) {
        await reader.cancel().catch(() => undefined)
        throw new EbaySellerOAuthReauthError(
          "EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_RESPONSE_UNPROVEN",
        )
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

function authorizationPreflightUrlAllowed(url: URL, stateExpected: boolean) {
  const expectedKeys = stateExpected
    ? "client_id,redirect_uri,response_type,scope,state"
    : "client_id,redirect_uri,response_type,scope"
  const keys = [...url.searchParams.keys()]
  return url.origin === "https://auth.ebay.com" &&
    url.pathname === "/oauth2/authorize" &&
    url.port === "" && !url.username && !url.password && !url.hash &&
    keys.length === new Set(keys).size &&
    keys.sort().join(",") === expectedKeys &&
    url.searchParams.get("response_type") === "code" &&
    Boolean(credential(url.searchParams.get("client_id"), 512)) &&
    Boolean(credential(url.searchParams.get("redirect_uri"), 512)) &&
    Boolean(url.searchParams.get("scope")) &&
    (!stateExpected || /^[A-Za-z0-9_-]{43}$/.test(
      url.searchParams.get("state") ?? "",
    ))
}

function authorizationRedirectResult(
  response: Response,
  source: URL,
): EbaySellerOAuthReauthAuthorizationPreflightResult | null {
  if (![302, 303].includes(response.status)) return null
  const location = response.headers.get("location") ?? ""
  if (!location || location.length > 4_096 ||
      /[\u0000-\u001f\u007f]/.test(location)) {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    }
  }
  let target: URL
  try {
    target = new URL(location, source)
  } catch {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    }
  }
  const parameterNames = new Set(
    [...target.searchParams.keys()].map((key) => key.toLowerCase()),
  )
  const errorMarker = [
    target.pathname,
    target.searchParams.get("error") ?? "",
    target.searchParams.get("error_id") ?? "",
    target.searchParams.get("errorId") ?? "",
  ].join(" ").toLowerCase()
  const trustedErrorOrigin = [
    "https://auth.ebay.com",
    "https://auth2.ebay.com",
  ].includes(target.origin) && !target.port && !target.username &&
    !target.password && !target.hash
  if (trustedErrorOrigin &&
      (errorMarker.includes("invalid_request") ||
        target.pathname.toLowerCase() === "/oauth2/erroroauth")) {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "INVALID_REQUEST",
    }
  }
  if (target.protocol !== "https:" || target.port || target.username ||
      target.password || target.hash || parameterNames.has("code") ||
      parameterNames.has("error") || parameterNames.has("error_description") ||
      parameterNames.has("error_id") || parameterNames.has("errorid")) {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_REJECTED",
    }
  }
  const interactiveSignin = target.origin === "https://signin.ebay.com" &&
    (target.pathname === "/ws/eBayISAPI.dll" ||
      target.pathname.toLowerCase().startsWith("/signin"))
  const interactiveAuthorization = target.origin === "https://auth2.ebay.com" &&
    target.pathname.replace(/\/$/, "") === "/oauth2/consents"
  return interactiveSignin || interactiveAuthorization
    ? { acceptedByAuthEndpoint: "YES", safeErrorCategory: "NONE" }
    : {
        acceptedByAuthEndpoint: "NO",
        safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
      }
}

function exactAuth2AuthorizationHop(response: Response, source: URL) {
  if (![302, 303].includes(response.status)) return null
  const location = response.headers.get("location") ?? ""
  if (!location || location.length > 4_096 ||
      /[\u0000-\u001f\u007f]/.test(location)) return null
  let target: URL
  try {
    target = new URL(location, source)
  } catch {
    return null
  }
  const sourceKeys = [...source.searchParams.keys()].sort()
  const targetKeys = [...target.searchParams.keys()].sort()
  const exactParameters = sourceKeys.length === targetKeys.length &&
    target.search === source.search &&
    sourceKeys.every((key, index) => key === targetKeys[index] &&
      source.searchParams.getAll(key).length === 1 &&
      target.searchParams.getAll(key).length === 1 &&
      source.searchParams.get(key) === target.searchParams.get(key))
  return target.origin === "https://auth2.ebay.com" &&
    target.pathname.replace(/\/$/, "") === "/oauth2/authorize" &&
    !target.port && !target.username && !target.password && !target.hash &&
    exactParameters
    ? target
    : null
}

export async function preflightEbaySellerOAuthReauthAuthorizationRequest(input: {
  authorizationUrl: string
  stateExpected: boolean
  fetchImpl: FetchLike
}): Promise<EbaySellerOAuthReauthAuthorizationPreflightResult> {
  let url: URL
  try {
    url = new URL(input.authorizationUrl)
  } catch {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_SERIALIZATION_INVALID",
    )
  }
  if (!authorizationPreflightUrlAllowed(url, input.stateExpected)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_AUTHORIZATION_SERIALIZATION_INVALID",
    )
  }
  const startedAt = Date.now()
  const request = async (target: URL) => {
    const remaining = AUTHORIZATION_PREFLIGHT_TIMEOUT_MS -
      (Date.now() - startedAt)
    if (remaining < 250) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_ENDPOINT_UNAVAILABLE",
      )
    }
    return input.fetchImpl(target, {
      method: "GET",
      headers: { Accept: "text/html,application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(remaining),
    })
  }
  let response: Response
  let responseSource = url
  try {
    response = await request(url)
    const auth2Hop = exactAuth2AuthorizationHop(response, url)
    if (auth2Hop) {
      responseSource = auth2Hop
      response = await request(auth2Hop)
    }
  } catch {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_UNAVAILABLE",
    }
  }
  const redirectResult = authorizationRedirectResult(response, responseSource)
  if (redirectResult) return redirectResult
  if (response.status !== 200) {
    let explicitInvalidRequest = false
    if (response.status === 400) {
      try {
        const body = await boundedAuthorizationPreflightBody(response)
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
        if (contentType.includes("json")) {
          const payload = record(JSON.parse(body))
          explicitInvalidRequest = [
            payload.error,
            payload.error_id,
            payload.errorId,
          ].some((value) => typeof value === "string" &&
            value.trim().toLowerCase() === "invalid_request")
        } else {
          const normalized = body.toLowerCase()
          explicitInvalidRequest = normalized.includes("invalid_request") ||
            normalized.includes("/oauth2/erroroauth")
        }
      } catch {
        explicitInvalidRequest = false
      }
    }
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: explicitInvalidRequest
        ? "INVALID_REQUEST"
        : "AUTH_ENDPOINT_REJECTED",
    }
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (!contentType.includes("text/html")) {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    }
  }
  let body = ""
  try {
    body = (await boundedAuthorizationPreflightBody(response)).toLowerCase()
  } catch {
    return {
      acceptedByAuthEndpoint: "NO",
      safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
    }
  }
  const invalidRequest = body.includes("invalid_request") ||
    body.includes("/oauth2/erroroauth")
  body = ""
  return invalidRequest
    ? { acceptedByAuthEndpoint: "NO", safeErrorCategory: "INVALID_REQUEST" }
    : {
        acceptedByAuthEndpoint: "NO",
        safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
      }
}

function deniedPreflight() : EbaySellerOAuthReauthAuthorizationPreflightResult {
  return {
    acceptedByAuthEndpoint: "NO",
    safeErrorCategory: "AUTH_ENDPOINT_RESPONSE_UNPROVEN",
  }
}

export async function diagnoseEbaySellerOAuthReauthAuthorization(input: {
  configuration: EbaySellerOAuthReauthConfiguration
  fetchImpl?: FetchLike
  stateFactory?: () => string
}): Promise<EbaySellerOAuthReauthAuthorizationDiagnosis> {
  if (!input.configuration.ready) {
    throw new EbaySellerOAuthReauthError(
      input.configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
    )
  }
  const fetchImpl = input.fetchImpl ?? fetch
  let state = (input.stateFactory ?? createEbaySellerOAuthReauthState)()
  const cases: Array<{
    key:
      | "testBase"
      | "testBaseAccount"
      | "testBaseAccountInventory"
      | "testFullFourScopes"
      | "canonicalWithState"
      | "previousPlusEncodingWithState"
    phase: EbaySellerOAuthReauthPreflightPhase
    state?: string
    encoding: EbaySellerOAuthReauthScopeEncoding
  }> = [
    { key: "testBase", phase: "BASE", encoding: "RFC3986_PERCENT20" },
    { key: "testBaseAccount", phase: "BASE_ACCOUNT", encoding: "RFC3986_PERCENT20" },
    { key: "testBaseAccountInventory", phase: "BASE_ACCOUNT_INVENTORY", encoding: "RFC3986_PERCENT20" },
    { key: "testFullFourScopes", phase: "FULL_FOUR_SCOPES", encoding: "RFC3986_PERCENT20" },
    { key: "canonicalWithState", phase: "FULL_FOUR_SCOPES", state, encoding: "RFC3986_PERCENT20" },
    { key: "previousPlusEncodingWithState", phase: "FULL_FOUR_SCOPES", state, encoding: "FORM_URLENCODED_PLUS" },
  ]
  const results: Partial<Record<typeof cases[number]["key"],
    EbaySellerOAuthReauthAuthorizationPreflightResult>> = {}
  let externalCalls = 0
  for (let index = 0; index < cases.length;
       index += AUTHORIZATION_PREFLIGHT_CONCURRENCY) {
    const batch = cases.slice(index, index + AUTHORIZATION_PREFLIGHT_CONCURRENCY)
    await Promise.all(batch.map(async (candidate) => {
      if (externalCalls >= AUTHORIZATION_PREFLIGHT_MAX_NETWORK_CALLS) return
      const authorizationUrl =
        buildEbaySellerOAuthReauthDiagnosticAuthorizationUrl({
          clientId: input.configuration.clientId,
          runame: input.configuration.runame,
          phase: candidate.phase,
          state: candidate.state,
          encoding: candidate.encoding,
        })
      results[candidate.key] =
        await preflightEbaySellerOAuthReauthAuthorizationRequest({
          authorizationUrl,
          stateExpected: candidate.state !== undefined,
          fetchImpl: async (...arguments_) => {
            if (externalCalls >= AUTHORIZATION_PREFLIGHT_MAX_NETWORK_CALLS) {
              throw new EbaySellerOAuthReauthError(
                "EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_CALL_BUDGET_EXHAUSTED",
              )
            }
            externalCalls += 1
            return fetchImpl(...arguments_)
          },
        })
    }))
  }
  if (cases.length !== AUTHORIZATION_PREFLIGHT_MAX_TESTS) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_CALL_BUDGET_EXHAUSTED",
    )
  }
  state = ""
  const testBase = results.testBase ?? deniedPreflight()
  const testBaseAccount = results.testBaseAccount ?? deniedPreflight()
  const testBaseAccountInventory =
    results.testBaseAccountInventory ?? deniedPreflight()
  const testFullFourScopes = results.testFullFourScopes ?? deniedPreflight()
  const canonicalWithState = results.canonicalWithState ?? deniedPreflight()
  const previousPlusEncodingWithState =
    results.previousPlusEncodingWithState ?? deniedPreflight()
  const accepted = (result: EbaySellerOAuthReauthAuthorizationPreflightResult) =>
    result.acceptedByAuthEndpoint === "YES"
  const invalid = (result: EbaySellerOAuthReauthAuthorizationPreflightResult) =>
    result.safeErrorCategory === "INVALID_REQUEST"
  const rootCause = invalid(testBase)
    ? "CLIENT_ID_RUNAME_BINDING" as const
    : accepted(testBase) && invalid(testBaseAccount)
      ? "SCOPE_ACCOUNT_REJECTED" as const
      : accepted(testBaseAccount) && invalid(testBaseAccountInventory)
        ? "SCOPE_INVENTORY_REJECTED" as const
        : accepted(testBaseAccountInventory) && invalid(testFullFourScopes)
          ? "SCOPE_ANALYTICS_REJECTED" as const
          : accepted(testFullFourScopes) && invalid(canonicalWithState)
            ? "STATE_PARAMETER" as const
            : accepted(canonicalWithState) &&
                invalid(previousPlusEncodingWithState)
              ? "URL_SERIALIZATION" as const
              : "STILL_UNPROVEN" as const
  const canonicalAccepted = accepted(testBase) && accepted(testBaseAccount) &&
    accepted(testBaseAccountInventory) && accepted(testFullFourScopes) &&
    accepted(canonicalWithState)
  return {
    rootCause,
    testBase,
    testBaseAccount,
    testBaseAccountInventory,
    testFullFourScopes,
    canonicalWithState,
    previousPlusEncodingWithState,
    runameSource: "EBAY_RuName",
    runameAppBinding: accepted(testBase)
      ? "PASS"
      : invalid(testBase)
        ? "FAIL"
        : "UNPROVEN",
    currentScopeEncoding: "RFC3986_PERCENT20",
    previousScopeEncoding: "FORM_URLENCODED_PLUS",
    encodingCausesInvalidRequest: accepted(canonicalWithState) &&
        invalid(previousPlusEncodingWithState)
      ? "YES"
      : accepted(canonicalWithState) &&
          accepted(previousPlusEncodingWithState)
        ? "NO"
        : "UNPROVEN",
    stateCausesInvalidRequest: accepted(testFullFourScopes) &&
        invalid(canonicalWithState)
      ? "YES"
      : accepted(testFullFourScopes) && accepted(canonicalWithState)
        ? "NO"
        : "UNPROVEN",
    stateFormatValid: true,
    scopeCount: EBAY_SELLER_OAUTH_REAUTH_SCOPES.length,
    parameterNames: [
      "client_id",
      "response_type",
      "redirect_uri",
      "scope",
      "state",
    ],
    externalCalls,
    ledgerRowsCreated: 0,
    cookiesSet: 0,
    humanRedirects: 0,
    oauthConsentLaunched: false,
    authorizationCodeExchangeCalls: 0,
    secretsReturned: false,
    startAllowed: canonicalAccepted && rootCause === "URL_SERIALIZATION",
  }
}

function credential(value: unknown, maximum = 8_192) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && normalized.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : ""
}

function positiveExpiry(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 7_200
    ? parsed
    : null
}

function previousCompleteUtcDate(now: number) {
  const date = new Date(now - 2 * 86_400_000)
  return date.toISOString().slice(0, 10)
}

function oauthSafeCategory(payload: unknown) {
  const error = typeof record(payload).error === "string"
    ? String(record(payload).error).trim().toLowerCase()
    : ""
  const categories: Record<string, string> = {
    invalid_scope: "INVALID_SCOPE",
    invalid_grant: "INVALID_GRANT",
    invalid_client: "INVALID_CLIENT",
    invalid_request: "INVALID_REQUEST",
    unsupported_grant_type: "UNSUPPORTED_GRANT_TYPE",
  }
  return categories[error] ?? "OAUTH_ERROR_UNCLASSIFIED"
}

function exactTokenScopes(payload: JsonRecord) {
  const result = exactEbaySellerOAuthReauthReturnedScopes(payload.scope)
  if (result === false) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_SCOPE_RESPONSE_REJECTED",
    )
  }
}

function assertAllowedRequest(input: {
  operation: EbaySellerOAuthReauthCallOperation
  method: "GET" | "POST"
  url: URL
  body?: URLSearchParams | string
  headers: Record<string, string>
}) {
  const headerKeys = Object.keys(input.headers)
    .map((key) => key.toLowerCase()).sort().join(",")
  const tokenHeaders = headerKeys === "authorization,content-type" &&
    input.headers.Authorization?.startsWith("Basic ") &&
    input.headers["Content-Type"] === "application/x-www-form-urlencoded"
  const tradingHeaders = headerKeys === [
    "content-type",
    "x-ebay-api-call-name",
    "x-ebay-api-compatibility-level",
    "x-ebay-api-iaf-token",
    "x-ebay-api-siteid",
  ].join(",") &&
    input.headers["Content-Type"] === "text/xml" &&
    input.headers["X-EBAY-API-CALL-NAME"] === "GetUser" &&
    input.headers["X-EBAY-API-COMPATIBILITY-LEVEL"] ===
      TRADING_COMPATIBILITY_LEVEL &&
    input.headers["X-EBAY-API-SITEID"] === "0" &&
    Boolean(input.headers["X-EBAY-API-IAF-TOKEN"])
  const restHeaders = headerKeys ===
    "accept,authorization,x-ebay-c-marketplace-id" &&
    input.headers.Accept === "application/json" &&
    input.headers.Authorization?.startsWith("Bearer ") &&
    input.headers["X-EBAY-C-MARKETPLACE-ID"] === EBAY_MARKETPLACE_ID
  const noSearch = input.url.search === ""
  const token = input.method === "POST" &&
    input.url.origin === EBAY_API_ORIGIN &&
    input.url.pathname === "/identity/v1/oauth2/token" && noSearch &&
    tokenHeaders &&
    [
      "OAUTH_AUTHORIZATION_CODE_EXCHANGE",
      "OAUTH_EXACT_UNION_REFRESH",
    ].includes(input.operation)
  const trading = input.operation === "TRADING_GET_USER" &&
    input.method === "POST" && input.url.toString() === EBAY_TRADING_ENDPOINT &&
    input.body === GET_USER_BODY && tradingHeaders
  const inventory = input.operation === "INVENTORY_GET_LOCATIONS_SCOPE_PROBE" &&
    input.method === "GET" &&
    input.url.origin === EBAY_API_ORIGIN &&
    input.url.pathname === "/sell/inventory/v1/location" &&
    input.url.searchParams.get("limit") === "1" &&
    input.url.searchParams.get("offset") === "0" &&
    [...input.url.searchParams.keys()].sort().join(",") === "limit,offset" &&
    restHeaders
  const account = input.operation === "ACCOUNT_PRIVILEGE_SCOPE_PROBE" &&
    input.method === "GET" &&
    input.url.toString() === EBAY_ACCOUNT_PRIVILEGE_ENDPOINT && restHeaders
  const analytics = input.operation === "ANALYTICS_TRAFFIC_REPORT_SCOPE_PROBE" &&
    input.method === "GET" &&
    input.url.origin === EBAY_API_ORIGIN &&
    input.url.pathname === "/sell/analytics/v1/traffic_report" &&
    [...input.url.searchParams.keys()].sort().join(",") ===
      "dimension,filter,metric" &&
    input.url.searchParams.get("dimension") === "DAY" &&
    input.url.searchParams.get("metric") ===
      EBAY_SELLER_TRAFFIC_METRICS.join(",") &&
    input.url.searchParams.get("filter")?.includes(
      "marketplace_ids:{EBAY_US}",
    ) === true && restHeaders
  if (!token && !trading && !inventory && !account && !analytics) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_REQUEST_BLOCKED",
    )
  }
  if (token && input.body instanceof URLSearchParams) {
    const keys = [...input.body.keys()].sort().join(",")
    const expected = input.operation === "OAUTH_AUTHORIZATION_CODE_EXCHANGE"
      ? "code,grant_type,redirect_uri"
      : "grant_type,refresh_token,scope"
    if (keys !== expected) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_REQUEST_BLOCKED",
      )
    }
    const authorizationCodeBody =
      input.operation === "OAUTH_AUTHORIZATION_CODE_EXCHANGE" &&
      input.body.get("grant_type") === "authorization_code" &&
      Boolean(credential(input.body.get("code"), 1_024)) &&
      Boolean(credential(input.body.get("redirect_uri"), 512))
    const refreshBody = input.operation === "OAUTH_EXACT_UNION_REFRESH" &&
      input.body.get("grant_type") === "refresh_token" &&
      Boolean(credential(input.body.get("refresh_token"))) &&
      input.body.get("scope") === EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" ")
    if (!authorizationCodeBody && !refreshBody) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_REQUEST_BLOCKED",
      )
    }
  }
}

async function boundedFetch(input: {
  operation: EbaySellerOAuthReauthCallOperation
  method: "GET" | "POST"
  url: URL
  body?: URLSearchParams | string
  headers: Record<string, string>
  fetchImpl: FetchLike
  calls: EbaySellerOAuthReauthCallEvidence[]
  clock: Clock
  externalDeadlineAt: number
  requestedTimeoutMs: number
}) {
  assertAllowedRequest(input)
  if (input.calls.length >= EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CALL_BUDGET_EXHAUSTED",
    )
  }
  const remaining = input.externalDeadlineAt - input.clock()
  const timeout = Math.min(input.requestedTimeoutMs, remaining)
  if (!Number.isFinite(timeout) || timeout < 500) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_TIME_BUDGET_EXHAUSTED",
    )
  }
  const evidence: EbaySellerOAuthReauthCallEvidence = {
    operation: input.operation,
    method: input.method,
    endpoint: input.url.pathname,
    status: "FAILED",
    httpStatus: null,
    marketplaceMutation: false,
    persisted: false,
  }
  input.calls.push(evidence)
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(Math.floor(timeout)),
    })
    evidence.httpStatus = response.status
    evidence.status = response.ok ? "SUCCEEDED" : "FAILED"
    return response
  } catch {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_NETWORK_FAILURE",
    )
  }
}

async function tokenResponse(input: {
  response: Response
  operation: EbaySellerOAuthReauthCallOperation
  requireRefreshToken: boolean
}) {
  let payload: JsonRecord = {}
  try {
    payload = record(await input.response.json())
  } catch {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_TOKEN_RESPONSE_INVALID",
    )
  }
  if (!input.response.ok) {
    const category = oauthSafeCategory(payload)
    payload = {}
    throw new EbaySellerOAuthReauthError(
      `EBAY_SELLER_OAUTH_REAUTH_${input.operation}_${category}`,
    )
  }
  exactTokenScopes(payload)
  const accessToken = credential(payload.access_token)
  const refreshToken = input.requireRefreshToken
    ? credential(payload.refresh_token)
    : ""
  const expiresIn = positiveExpiry(payload.expires_in)
  payload = {}
  if (!accessToken || !expiresIn ||
      (input.requireRefreshToken && !refreshToken)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_TOKEN_RESPONSE_INVALID",
    )
  }
  return { accessToken, refreshToken }
}

function bearerHeaders(accessToken: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
    "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE_ID,
  }
}

async function requireJsonSuccess(response: Response, code: string) {
  if (!response.ok) throw new EbaySellerOAuthReauthError(code)
  try {
    const payload = await response.json()
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("INVALID_JSON_SHAPE")
    }
  } catch {
    throw new EbaySellerOAuthReauthError(code)
  }
}

export async function prepareEbaySellerOAuthReauthStart(input: {
  configuration: EbaySellerOAuthReauthConfiguration
  actorUserId: string
  ledger: EbaySellerOAuthReauthStateLedger
  clock?: Clock
  stateFactory?: () => string
  diagnosticStateFactory?: () => string
  fetchImpl?: FetchLike
  ledgerTimeoutMs?: number
}) {
  if (!input.configuration.ready) {
    throw new EbaySellerOAuthReauthError(
      input.configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
    )
  }
  const authorizationDiagnosis =
    await diagnoseEbaySellerOAuthReauthAuthorization({
      configuration: input.configuration,
      fetchImpl: input.fetchImpl,
      stateFactory: input.diagnosticStateFactory,
    })
  if (!authorizationDiagnosis.startAllowed) {
    throw new EbaySellerOAuthReauthError(
      `EBAY_SELLER_OAUTH_REAUTH_PREFLIGHT_${authorizationDiagnosis.rootCause}`,
    )
  }
  const clock = input.clock ?? Date.now
  const state = (input.stateFactory ?? createEbaySellerOAuthReauthState)()
  const expiresAt = clock() + EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS
  const stateHash = hashEbaySellerOAuthReauthState(state)
  const created = await boundedLedgerOperation(input.ledger.createPending({
    stateHash,
    expiresAt: new Date(expiresAt).toISOString(),
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), input.ledgerTimeoutMs)
  if (!created) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COLLISION",
    )
  }
  return {
    authorizationUrl: buildEbaySellerOAuthReauthAuthorizationUrl({
      clientId: input.configuration.clientId,
      runame: input.configuration.runame,
      state,
    }),
    callbackPath: input.configuration.callbackUrl,
    cookie: createEbaySellerOAuthReauthCookie({
      state,
      expiresAt,
      actorUserId: input.actorUserId,
      branchHost: input.configuration.branchHost,
      clientSecret: input.configuration.clientSecret,
      expectedAccountFingerprint:
        input.configuration.expectedAccountFingerprint,
    }),
    expiresAt,
    stateHashPersisted: true as const,
    rawStatePersisted: false as const,
    tokenGenerated: false as const,
    authorizationPreflight: {
      rootCause: authorizationDiagnosis.rootCause,
      liveAccepted: true as const,
      scopeEncoding: authorizationDiagnosis.currentScopeEncoding,
      stateAccepted: authorizationDiagnosis.stateCausesInvalidRequest === "NO",
    },
  }
}

export async function verifyEbaySellerOAuthReauthCandidate(input: {
  authorizationCode: string
  configuration: EbaySellerOAuthReauthConfiguration
  callbackStartedAt: number
  fetchImpl?: FetchLike
  clock?: Clock
}): Promise<CandidateVerificationResult> {
  if (!input.configuration.ready || !credential(input.authorizationCode, 1_024)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_CANDIDATE_INVALID",
    )
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const clock = input.clock ?? Date.now
  const externalDeadlineAt = input.callbackStartedAt +
    EBAY_SELLER_OAUTH_REAUTH_EXTERNAL_DEADLINE_MS
  const calls: EbaySellerOAuthReauthCallEvidence[] = []
  let candidateRefreshToken = ""
  let candidateAccessToken = ""
  let initialAccessToken = ""
  try {
    const basic = Buffer.from(
      `${input.configuration.clientId}:${input.configuration.clientSecret}`,
      "utf8",
    ).toString("base64")
    const codeBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.authorizationCode,
      redirect_uri: input.configuration.runame,
    })
    const codeResponse = await boundedFetch({
      operation: "OAUTH_AUTHORIZATION_CODE_EXCHANGE",
      method: "POST",
      url: new URL(EBAY_TOKEN_ENDPOINT),
      body: codeBody,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      fetchImpl,
      calls,
      clock,
      externalDeadlineAt,
      requestedTimeoutMs: SEQUENTIAL_REQUEST_TIMEOUT_MS,
    })
    const exchanged = await tokenResponse({
      response: codeResponse,
      operation: "OAUTH_AUTHORIZATION_CODE_EXCHANGE",
      requireRefreshToken: true,
    })
    initialAccessToken = exchanged.accessToken
    candidateRefreshToken = exchanged.refreshToken
    initialAccessToken = ""

    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: candidateRefreshToken,
      scope: EBAY_SELLER_OAUTH_REAUTH_SCOPES.join(" "),
    })
    const refreshResponse = await boundedFetch({
      operation: "OAUTH_EXACT_UNION_REFRESH",
      method: "POST",
      url: new URL(EBAY_TOKEN_ENDPOINT),
      body: refreshBody,
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      fetchImpl,
      calls,
      clock,
      externalDeadlineAt,
      requestedTimeoutMs: SEQUENTIAL_REQUEST_TIMEOUT_MS,
    })
    const refreshed = await tokenResponse({
      response: refreshResponse,
      operation: "OAUTH_EXACT_UNION_REFRESH",
      requireRefreshToken: false,
    })
    candidateAccessToken = refreshed.accessToken

    assertEbayMonitorReadonlyRequest({
      operation: "TRADING_GET_USER",
      method: "POST",
      url: EBAY_TRADING_ENDPOINT,
      tradingCallName: "GetUser",
      tradingHeaderCallName: "GetUser",
      tradingBody: GET_USER_BODY,
    })
    const getUserResponse = await boundedFetch({
      operation: "TRADING_GET_USER",
      method: "POST",
      url: new URL(EBAY_TRADING_ENDPOINT),
      body: GET_USER_BODY,
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": candidateAccessToken,
      },
      fetchImpl,
      calls,
      clock,
      externalDeadlineAt,
      requestedTimeoutMs: SEQUENTIAL_REQUEST_TIMEOUT_MS,
    })
    let getUserXml = ""
    try {
      getUserXml = await getUserResponse.text()
    } catch {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_GET_USER_FAILED",
      )
    }
    const account = parseEbayTradingGetUser(getUserXml)
    getUserXml = ""
    const fingerprintMatch = account.userId
      ? ebayProductionAccountFingerprint(account.userId) ===
        input.configuration.expectedAccountFingerprint
      : false
    const expectedUserMatch = !input.configuration.expectedUserId ||
      account.userId?.toLocaleLowerCase("en-US") ===
        input.configuration.expectedUserId.toLocaleLowerCase("en-US")
    if (!getUserResponse.ok || !account.accepted || !account.userId ||
        account.site !== "US" || !fingerprintMatch || !expectedUserMatch) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_ACCOUNT_BINDING_MISMATCH",
      )
    }

    const probeDate = previousCompleteUtcDate(clock())
    const analyticsUrl = buildEbaySellerTrafficReportUrl({
      dateFrom: probeDate,
      dateTo: probeDate,
      timeZone: "UTC",
    }).url
    const probeInputs = [
      {
        operation: "INVENTORY_GET_LOCATIONS_SCOPE_PROBE" as const,
        url: new URL(EBAY_INVENTORY_LOCATION_ENDPOINT),
        failure: "EBAY_SELLER_OAUTH_REAUTH_INVENTORY_SCOPE_UNAVAILABLE",
      },
      {
        operation: "ANALYTICS_TRAFFIC_REPORT_SCOPE_PROBE" as const,
        url: analyticsUrl,
        failure: "EBAY_SELLER_OAUTH_REAUTH_ANALYTICS_SCOPE_UNAVAILABLE",
      },
      {
        operation: "ACCOUNT_PRIVILEGE_SCOPE_PROBE" as const,
        url: new URL(EBAY_ACCOUNT_PRIVILEGE_ENDPOINT),
        failure: "EBAY_SELLER_OAUTH_REAUTH_ACCOUNT_SCOPE_UNAVAILABLE",
      },
    ]
    const remaining = externalDeadlineAt - clock()
    if (remaining < 500) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_TIME_BUDGET_EXHAUSTED",
      )
    }
    const settled = await Promise.allSettled(probeInputs.map(async (probe) => {
      const response = await boundedFetch({
        operation: probe.operation,
        method: "GET",
        url: probe.url,
        headers: bearerHeaders(candidateAccessToken),
        fetchImpl,
        calls,
        clock,
        externalDeadlineAt,
        requestedTimeoutMs: PARALLEL_PROBE_TIMEOUT_MS,
      })
      await requireJsonSuccess(response, probe.failure)
    }))
    const rejected = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    if (rejected) throw rejected.reason
    if (calls.length !== EBAY_SELLER_OAUTH_REAUTH_MAX_EXTERNAL_READ_CALLS ||
        clock() > externalDeadlineAt) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_SELLER_OAUTH_REAUTH_VERIFICATION_INCOMPLETE",
      )
    }

    const result: CandidateVerificationResult = {
      refreshToken: candidateRefreshToken,
      credentialSource: "NEW_OAUTH_CANDIDATE_ONLY",
      genericEnvironmentTokenFallback: false,
      capabilities: {
        tradingBase: "AVAILABLE",
        inventoryReadonly: "AVAILABLE",
        analyticsReadonly: "AVAILABLE",
        accountReadonly: "AVAILABLE",
      },
      calls,
      safety: {
        tokenPersisted: false,
        oauthCodePersisted: false,
        rawStatePersisted: false,
        ebayWrites: 0,
        inventoryWrites: 0,
        listingWrites: 0,
        promotionWrites: 0,
        fulfillmentWrites: 0,
        buyerMessageWrites: 0,
        whatsappDispatches: 0,
        businessDataMutations: 0,
        productCaseMutations: 0,
        registryMutations: 0,
        vaultMutations: 0,
        vercelMutations: 0,
      },
    }
    candidateRefreshToken = ""
    candidateAccessToken = ""
    return result
  } finally {
    candidateRefreshToken = ""
    candidateAccessToken = ""
    initialAccessToken = ""
  }
}

export type EbaySellerOAuthReauthClaimResult =
  | {
    kind: "DENIED"
    code: string
    claimSucceeded: boolean
    oauthExchangeAttempted: false
  }
  | {
    kind: "HANDOFF"
    claimSucceeded: true
    oauthExchangeAttempted: true
    verification: CandidateVerificationResult
  }

export async function claimAndVerifyEbaySellerOAuthReauth(input: {
  callback: EbaySellerOAuthCallbackInput
  stateHash: string
  ledger: EbaySellerOAuthReauthStateLedger
  verifyCandidate?: (authorizationCode: string) =>
    Promise<CandidateVerificationResult>
  ledgerTimeoutMs?: number
}): Promise<EbaySellerOAuthReauthClaimResult> {
  const claimed = await boundedLedgerOperation(input.ledger.claimPending({
    stateHash: input.stateHash,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), input.ledgerTimeoutMs)
  if (!claimed) {
    return {
      kind: "DENIED",
      code: "EBAY_SELLER_OAUTH_REAUTH_STATE_NOT_CLAIMED",
      claimSucceeded: false,
      oauthExchangeAttempted: false,
    }
  }
  if (input.callback.kind === "DENIED") {
    return {
      kind: "DENIED",
      code: "EBAY_SELLER_OAUTH_REAUTH_CONSENT_DENIED",
      claimSucceeded: true,
      oauthExchangeAttempted: false,
    }
  }
  if (!input.verifyCandidate) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_VERIFIER_REQUIRED",
    )
  }
  const verification = await input.verifyCandidate(input.callback.code)
  return {
    kind: "HANDOFF",
    claimSucceeded: true,
    oauthExchangeAttempted: true,
    verification,
  }
}
