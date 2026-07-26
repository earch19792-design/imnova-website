const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const MARKETPLACE_INSIGHTS_ENDPOINT =
  "https://api.ebay.com/buy/marketplace-insights/v1_beta/item_sales/search"
const MARKETPLACE_INSIGHTS_SCOPE =
  "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"
const STAGING_REF = "vsfthqydfrdzulldbfbe"
const PREVIEW_BRANCH = "feature/centralize-ebay-mobile-center"
const REQUEST_TIMEOUT_MS = 8_000

type PreflightEnvironment = Record<string, string | undefined>
type FetchLike = typeof fetch

export type MarketplaceInsightsPreflightCategory =
  | "AUTHORIZED"
  | "NOT_ENTITLED"
  | "INVALID_SCOPE"
  | "CLIENT_CREDENTIAL_MISMATCH"
  | "TOKEN_REJECTED"
  | "TOKEN_ENDPOINT_UNAVAILABLE"
  | "ENDPOINT_UNAVAILABLE"
  | "RATE_LIMITED"
  | "MALFORMED_REQUEST"
  | "REQUEST_FAILED"
  | "NOT_EXECUTED"

export type MarketplaceInsightsPreflightResult = {
  environment: "PREVIEW" | "BLOCKED"
  preview: boolean
  staging: boolean
  branchMatch: boolean
  clientPair: "PRESENT" | "MISSING"
  configuredFlag: "TRUE" | "FALSE"
  requestedScope: "BUY_MARKETPLACE_INSIGHTS"
  scopeConfirmed: boolean
  tokenStatus: "READY" | MarketplaceInsightsPreflightCategory
  entitlement: MarketplaceInsightsPreflightCategory
  historyRequest: "AVAILABLE" | "REJECTED" | "NOT_EXECUTED"
  httpStatus: number | null
  observedAt: string
  safety: {
    requestMethod: "GET" | "NOT_EXECUTED"
    payloadStored: false
    payloadReturned: false
    accessTokenStored: false
    secretsExposed: false
    piiExposed: false
    openAiCalls: 0
    ebayWrites: 0
    productionChanged: false
  }
}

function stagingRef(environment: PreflightEnvironment) {
  try {
    return new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "")
      .hostname.split(".")[0] ?? null
  } catch {
    return null
  }
}

export function getMarketplaceInsightsPreflightConfiguration(
  environment: PreflightEnvironment = process.env,
) {
  const preview = environment.VERCEL_ENV === "preview"
  const staging = stagingRef(environment) === STAGING_REF
  const branchMatch = environment.VERCEL_GIT_COMMIT_REF === PREVIEW_BRANCH
  const clientIdPresent = Boolean(environment.EBAY_CLIENT_ID?.trim())
  const clientSecretPresent = Boolean(environment.EBAY_CLIENT_SECRET?.trim())
  return {
    preview,
    staging,
    branchMatch,
    clientPair: clientIdPresent && clientSecretPresent
      ? "PRESENT" as const
      : "MISSING" as const,
    configuredFlag: environment.EBAY_MARKETPLACE_INSIGHTS_ENABLED?.trim() === "true"
      ? "TRUE" as const
      : "FALSE" as const,
    configured: preview && staging && branchMatch && clientIdPresent && clientSecretPresent,
  }
}

function categoryFromToken(status: number, oauthError: string) {
  if (oauthError === "invalid_scope") return "INVALID_SCOPE" as const
  if (oauthError === "invalid_client") return "CLIENT_CREDENTIAL_MISMATCH" as const
  if (status === 429) return "RATE_LIMITED" as const
  if (status >= 500) return "TOKEN_ENDPOINT_UNAVAILABLE" as const
  if (status === 400) return "MALFORMED_REQUEST" as const
  return "TOKEN_REJECTED" as const
}

function categoryFromInsights(status: number) {
  if (status === 401) return "TOKEN_REJECTED" as const
  if (status === 403) return "NOT_ENTITLED" as const
  if (status === 404) return "ENDPOINT_UNAVAILABLE" as const
  if (status === 429) return "RATE_LIMITED" as const
  if (status === 400) return "MALFORMED_REQUEST" as const
  return status >= 500 ? "ENDPOINT_UNAVAILABLE" as const : "REQUEST_FAILED" as const
}

function networkCategory(error: unknown, tokenRequest: boolean) {
  const name = error instanceof Error ? error.name : ""
  if (name === "AbortError" || name === "TimeoutError") {
    return tokenRequest ? "TOKEN_ENDPOINT_UNAVAILABLE" as const : "ENDPOINT_UNAVAILABLE" as const
  }
  return tokenRequest ? "TOKEN_ENDPOINT_UNAVAILABLE" as const : "REQUEST_FAILED" as const
}

function baseResult(
  environment: PreflightEnvironment,
  now: Date,
): MarketplaceInsightsPreflightResult {
  const configuration = getMarketplaceInsightsPreflightConfiguration(environment)
  return {
    environment: configuration.preview && configuration.staging && configuration.branchMatch
      ? "PREVIEW"
      : "BLOCKED",
    preview: configuration.preview,
    staging: configuration.staging,
    branchMatch: configuration.branchMatch,
    clientPair: configuration.clientPair,
    configuredFlag: configuration.configuredFlag,
    requestedScope: "BUY_MARKETPLACE_INSIGHTS",
    scopeConfirmed: false,
    tokenStatus: "NOT_EXECUTED",
    entitlement: "NOT_EXECUTED",
    historyRequest: "NOT_EXECUTED",
    httpStatus: null,
    observedAt: now.toISOString(),
    safety: {
      requestMethod: "NOT_EXECUTED",
      payloadStored: false,
      payloadReturned: false,
      accessTokenStored: false,
      secretsExposed: false,
      piiExposed: false,
      openAiCalls: 0,
      ebayWrites: 0,
      productionChanged: false,
    },
  }
}

export async function runMarketplaceInsightsPreflight(input: {
  environment?: PreflightEnvironment
  fetchImpl?: FetchLike
  now?: Date
} = {}): Promise<MarketplaceInsightsPreflightResult> {
  const environment = input.environment ?? process.env
  const fetchImpl = input.fetchImpl ?? fetch
  const result = baseResult(environment, input.now ?? new Date())
  const configuration = getMarketplaceInsightsPreflightConfiguration(environment)
  if (!configuration.configured) return result

  const clientId = environment.EBAY_CLIENT_ID!.trim()
  const clientSecret = environment.EBAY_CLIENT_SECRET!.trim()
  let tokenResponse: Response
  try {
    tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: MARKETPLACE_INSIGHTS_SCOPE,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const category = networkCategory(error, true)
    result.tokenStatus = category
    result.entitlement = category
    return result
  }

  const tokenPayload = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>
  if (!tokenResponse.ok) {
    const oauthError = typeof tokenPayload.error === "string" ? tokenPayload.error : ""
    const category = categoryFromToken(tokenResponse.status, oauthError)
    result.tokenStatus = category
    result.entitlement = category
    result.httpStatus = tokenResponse.status
    return result
  }

  const accessToken = typeof tokenPayload.access_token === "string"
    ? tokenPayload.access_token.trim()
    : ""
  const returnedScopes = typeof tokenPayload.scope === "string"
    ? tokenPayload.scope.split(/\s+/).filter(Boolean)
    : []
  result.scopeConfirmed = returnedScopes.includes(MARKETPLACE_INSIGHTS_SCOPE)
  if (!accessToken) {
    result.tokenStatus = "TOKEN_REJECTED"
    result.entitlement = "TOKEN_REJECTED"
    return result
  }
  if (!result.scopeConfirmed) {
    result.tokenStatus = "INVALID_SCOPE"
    result.entitlement = "INVALID_SCOPE"
    return result
  }
  result.tokenStatus = "READY"

  const url = new URL(MARKETPLACE_INSIGHTS_ENDPOINT)
  url.searchParams.set("q", "Lysol disinfecting wipes")
  url.searchParams.set("limit", "1")
  let insightsResponse: Response
  try {
    insightsResponse = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const category = networkCategory(error, false)
    result.entitlement = category
    result.historyRequest = "REJECTED"
    result.safety.requestMethod = "GET"
    return result
  }

  result.httpStatus = insightsResponse.status
  result.safety.requestMethod = "GET"
  await insightsResponse.body?.cancel().catch(() => undefined)
  if (insightsResponse.ok) {
    result.entitlement = "AUTHORIZED"
    result.historyRequest = "AVAILABLE"
    return result
  }
  result.entitlement = categoryFromInsights(insightsResponse.status)
  result.historyRequest = "REJECTED"
  return result
}

export const EBAY_MARKETPLACE_INSIGHTS_PREFLIGHT_CONTRACT = Object.freeze({
  tokenEndpoint: TOKEN_ENDPOINT,
  endpoint: MARKETPLACE_INSIGHTS_ENDPOINT,
  scope: MARKETPLACE_INSIGHTS_SCOPE,
  marketplace: "EBAY_US",
  method: "GET",
  productionWrites: 0,
})
