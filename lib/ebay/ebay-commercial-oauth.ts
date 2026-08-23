import "server-only"

import {
  probeEbayProductionIdentityReadOnly,
} from "./ebay-manual-listing-trading-readonly"
import {
  classifyEbayCommercialOAuthFailure,
  getEbayCommercialOAuthAction,
  getEbayCommercialOrdersOAuthConfiguration,
  type EbayCommercialOAuthCategory,
  type EbayCommercialOAuthStatus,
} from "./ebay-commercial-oauth-domain"
import {
  EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE,
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES,
  getEbayCommercialOrdersCallbackConfiguration,
} from "./ebay-commercial-orders-oauth-domain"
import {
  createEbayReadonlyRateLimitError,
  getEbayReadonlyRateLimitMetadata,
} from "./ebay-readonly-rate-limit"

export {
  classifyEbayCommercialOAuthFailure,
  EBAY_COMMERCIAL_OAUTH_CATEGORIES,
  getEbayCommercialOAuthAction,
  getEbayCommercialOrdersOAuthConfiguration,
  getEbayCommercialReaderAuthState,
  oauthStatusFromCommercialError,
  type EbayCommercialOAuthCategory,
  type EbayCommercialOAuthStatus,
} from "./ebay-commercial-oauth-domain"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
export const EBAY_FULFILLMENT_READONLY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly"
export const EBAY_COMMERCE_MESSAGE_SCOPE =
  EBAY_COMMERCIAL_ORDERS_COMMERCE_MESSAGE_SCOPE
const FULFILLMENT_SCOPES = `${BASE_SCOPE} ${EBAY_FULFILLMENT_READONLY_SCOPE}`
// The browser grant is minted with this exact canonical set. Reuse the same
// set when refreshing the purpose-bound Message token: eBay documents that a
// refresh request may use the original set (or a supported subset), and the
// exact set avoids a provider-side invalid_scope divergence while retaining
// the already-authorized read-only Fulfillment capability.
const MESSAGE_SCOPES = EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES.join(" ")
const REQUEST_TIMEOUT_MS = 12_000
const MAX_RETRIES = 3

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

type CachedToken = {
  value: string
  expiresAt: number
}

let cachedOrdersToken: CachedToken | null = null
let cachedMessageToken: CachedToken | null = null

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function retryable(status: number) {
  return status >= 500
}

async function wait(attempt: number) {
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.min(400 * (2 ** attempt), 3_000),
  ))
}

function ordersCredentials(environment: NodeJS.ProcessEnv = process.env) {
  const genericClientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const genericClientSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const dedicatedClientId = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = environment.EBAY_COMMERCIAL_ORDERS_REFRESH_TOKEN?.trim() ?? ""
  const dedicatedClientPairPartial = Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)
  const clientId = dedicatedClientId && dedicatedClientSecret
    ? dedicatedClientId
    : genericClientId
  const clientSecret = dedicatedClientId && dedicatedClientSecret
    ? dedicatedClientSecret
    : genericClientSecret

  return {
    clientId,
    clientSecret,
    refreshToken,
    dedicatedClientPairPartial,
    clientSource: dedicatedClientId && dedicatedClientSecret
      ? "DEDICATED_ORDERS_APPLICATION" as const
      : "GENERAL_APPLICATION_DEDICATED_REFRESH" as const,
  }
}

class EbayCommercialOrdersOAuthError extends Error {
  readonly category: EbayCommercialOAuthCategory

  constructor(category: EbayCommercialOAuthCategory) {
    super(`EBAY_COMMERCIAL_ORDERS_OAUTH_${category}`)
    this.name = "EbayCommercialOrdersOAuthError"
    this.category = category
  }
}

async function tokenRequest(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
  scope: string
  fetchImpl: FetchLike
}) {
  if (!input.clientId || !input.clientSecret || !input.refreshToken) {
    throw new EbayCommercialOrdersOAuthError("MALFORMED_REQUEST")
  }
  if (
    TOKEN_ENDPOINT !== "https://api.ebay.com/identity/v1/oauth2/token"
  ) {
    throw new EbayCommercialOrdersOAuthError("MALFORMED_REQUEST")
  }
  const credentials = Buffer.from(
    `${input.clientId}:${input.clientSecret}`,
    "utf8",
  ).toString("base64")

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await input.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          scope: input.scope,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      let payload: JsonRecord = {}
      try {
        payload = record(await response.json())
      } catch {
        payload = {}
      }
      if (response.ok) {
        const accessToken = text(payload.access_token)
        if (!accessToken) {
          throw new EbayCommercialOrdersOAuthError("MALFORMED_REQUEST")
        }
        return {
          accessToken,
          expiresIn: Math.max(120, Number(payload.expires_in) || 7_200),
        }
      }
      if (response.status === 429) {
        throw createEbayReadonlyRateLimitError("EBAY_OAUTH_429", response, {
          apiFamily: "OAUTH",
          operation: "ORDERS_REFRESH_TOKEN",
          endpoint: "/identity/v1/oauth2/token",
        })
      }
      const category = classifyEbayCommercialOAuthFailure(response.status, payload)
      if (retryable(response.status) && attempt < MAX_RETRIES - 1) {
        await wait(attempt)
        continue
      }
      throw new EbayCommercialOrdersOAuthError(category)
    } catch (error) {
      if (error instanceof EbayCommercialOrdersOAuthError) throw error
      if (getEbayReadonlyRateLimitMetadata(error)) throw error
      if (attempt === MAX_RETRIES - 1) {
        throw new EbayCommercialOrdersOAuthError("TOKEN_ENDPOINT_UNAVAILABLE")
      }
      await wait(attempt)
    }
  }
  throw new EbayCommercialOrdersOAuthError("TOKEN_ENDPOINT_UNAVAILABLE")
}

export async function getEbayCommercialOrdersAccessToken(
  fetchImpl: FetchLike = fetch,
) {
  if (cachedOrdersToken && cachedOrdersToken.expiresAt > Date.now() + 60_000) {
    return cachedOrdersToken.value
  }
  const credentials = ordersCredentials()
  if (credentials.dedicatedClientPairPartial) {
    throw new EbayCommercialOrdersOAuthError("CLIENT_CREDENTIAL_MISMATCH")
  }
  const token = await tokenRequest({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: credentials.refreshToken,
    scope: FULFILLMENT_SCOPES,
    fetchImpl,
  })
  cachedOrdersToken = {
    value: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1_000,
  }
  return token.accessToken
}

export function clearEbayCommercialOrdersAccessToken() {
  cachedOrdersToken = null
}

/**
 * Purpose-bound Message API token. It deliberately reuses the canonical
 * Orders application/refresh-token binding instead of introducing another
 * OAuth flow or credential store. eBay will reject the refresh if the human
 * grant does not include commerce.message, which keeps the caller fail-closed.
 */
export async function getEbayCommercialMessageAccessToken(
  fetchImpl: FetchLike = fetch,
) {
  if (cachedMessageToken && cachedMessageToken.expiresAt > Date.now() + 60_000) {
    return cachedMessageToken.value
  }
  const credentials = ordersCredentials()
  if (credentials.dedicatedClientPairPartial) {
    throw new EbayCommercialOrdersOAuthError("CLIENT_CREDENTIAL_MISMATCH")
  }
  const token = await tokenRequest({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: credentials.refreshToken,
    scope: MESSAGE_SCOPES,
    fetchImpl,
  })
  cachedMessageToken = {
    value: token.accessToken,
    expiresAt: Date.now() + token.expiresIn * 1_000,
  }
  return token.accessToken
}

export function clearEbayCommercialMessageAccessToken() {
  cachedMessageToken = null
}

async function legacyGenericFulfillmentPreflight(fetchImpl: FetchLike) {
  const clientId = process.env.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim() ?? ""
  const refreshToken = process.env.EBAY_SELLER_REFRESH_TOKEN?.trim() ?? ""
  try {
    const token = await tokenRequest({
      clientId,
      clientSecret,
      refreshToken,
      scope: FULFILLMENT_SCOPES,
      fetchImpl,
    })
    // The preflight deliberately proves only token minting. It does not call
    // getOrders, return the access token, or persist it.
    token.accessToken = ""
    return {
      status: "READY" as const,
      fulfillmentScopeConfirmed: true,
      actionRequired: getEbayCommercialOAuthAction("READY"),
    }
  } catch (error) {
    const status = error instanceof EbayCommercialOrdersOAuthError
      ? error.category
      : "UNKNOWN_OAUTH_ERROR" as const
    return {
      status,
      fulfillmentScopeConfirmed: false,
      actionRequired: getEbayCommercialOAuthAction(status),
    }
  }
}

async function dedicatedOrdersPreflight(fetchImpl: FetchLike) {
  const configuration = getEbayCommercialOrdersOAuthConfiguration()
  if (!configuration.configured) {
    const status: EbayCommercialOAuthCategory = configuration.dedicatedClientPairComplete
      ? "MALFORMED_REQUEST"
      : "CLIENT_CREDENTIAL_MISMATCH"
    return {
      status,
      fulfillmentScopeConfirmed: false,
      actionRequired: getEbayCommercialOAuthAction(status),
      refreshTokenFallbackUsed: false,
    }
  }
  const credentials = ordersCredentials()
  try {
    const token = await tokenRequest({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      scope: FULFILLMENT_SCOPES,
      fetchImpl,
    })
    token.accessToken = ""
    return {
      status: "READY" as const,
      fulfillmentScopeConfirmed: true,
      actionRequired: getEbayCommercialOAuthAction("READY"),
      refreshTokenFallbackUsed: false,
    }
  } catch (error) {
    const status = error instanceof EbayCommercialOrdersOAuthError
      ? error.category
      : "UNKNOWN_OAUTH_ERROR" as const
    return {
      status,
      fulfillmentScopeConfirmed: false,
      actionRequired: getEbayCommercialOAuthAction(status),
      refreshTokenFallbackUsed: false,
    }
  }
}

export async function getEbayCommercialOAuthPreflight(
  fetchImpl: FetchLike = fetch,
) {
  const configuration = getEbayCommercialOrdersOAuthConfiguration()
  const [legacyOrders, dedicatedOrders, identityResult] = await Promise.all([
    legacyGenericFulfillmentPreflight(fetchImpl),
    dedicatedOrdersPreflight(fetchImpl),
    probeEbayProductionIdentityReadOnly(fetchImpl).then((result) => ({
      status: "READY" as const,
      fingerprintMatches: result.configuredFingerprintMatches,
      identityBindingStatus: result.identityBindingStatus,
    })).catch((error: unknown) => {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "EBAY_TRADING_GETUSER_500"
      return {
        status: "UNAVAILABLE" as const,
        fingerprintMatches: false,
        identityBindingStatus: "UNAVAILABLE" as const,
        error: code,
      }
    }),
  ])

  return {
    environment: "PRODUCTION" as const,
    clientId: configuration.clientId,
    clientSecret: configuration.clientSecret,
    genericSellerRefreshToken: configuration.genericSellerRefreshToken,
    dedicatedOrdersRefreshToken: configuration.dedicatedOrdersRefreshToken,
    legacyGenericOrdersProbe: legacyOrders,
    dedicatedOrders,
    officialIdentity: identityResult,
    callback: getEbayCommercialOrdersCallbackConfiguration(),
    safety: {
      tokenEndpointOnly: true,
      getUserReadOnlyUsed: true,
      getOrdersUsed: false,
      getItemUsed: false,
      ebayWriteUsed: false,
      secretsReturned: false,
      rawOAuthDescriptionReturned: false,
    },
  }
}
