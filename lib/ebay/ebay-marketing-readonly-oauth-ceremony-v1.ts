import { Buffer } from "node:buffer"

import {
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
  buildEbaySellerOAuthReauthPurposeAuthorizationUrl,
  createEbaySellerOAuthReauthCookie,
  createEbaySellerOAuthReauthState,
  EBAY_MARKETING_READONLY_OAUTH_SCOPES,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  EbaySellerOAuthReauthError,
  exactEbaySellerOAuthReauthReturnedScopes,
  getEbaySellerOAuthReauthRuntimeCredentialMatch,
  hashEbaySellerOAuthReauthState,
  type EbaySellerOAuthCallbackInput,
  type EbaySellerOAuthReauthConfiguration,
} from "./ebay-seller-oauth-reauth-domain"
import {
  preflightEbaySellerOAuthReauthAuthorizationRequest,
} from "./ebay-seller-oauth-reauth"
import type {
  EbaySellerOAuthReauthStateLedger,
} from "./ebay-seller-oauth-reauth-ledger"
import {
  ebayProductionAccountFingerprint,
} from "./ebay-seller-account-scope"
import {
  assertEbayMonitorReadonlyRequest,
  parseEbayTradingGetUser,
} from "./ebay-commercial-monitor-live-readonly-domain"

const API_ORIGIN = "https://api.ebay.com"
const TOKEN_ENDPOINT = `${API_ORIGIN}/identity/v1/oauth2/token`
const TRADING_ENDPOINT = `${API_ORIGIN}/ws/api.dll`
const MARKETING_SMOKE_ENDPOINT =
  `${API_ORIGIN}/sell/marketing/v1/ad_campaign/find_campaign_by_ad_reference`
const MARKETPLACE_ID = "EBAY_US"
const TRADING_COMPATIBILITY_LEVEL = "1423"
const REQUEST_TIMEOUT_MS = 6_000
const TARGET_ITEM_ID = "366582586826"

const GET_USER_BODY = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
  "<GetUserRequest xmlns=\"urn:ebay:apis:eBLBaseComponents\">" +
  "<OutputSelector>User.UserID</OutputSelector>" +
  "<OutputSelector>User.Site</OutputSelector>" +
  "</GetUserRequest>"

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function credential(value: unknown, maximum = 8_192) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return normalized && normalized.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : ""
}

async function withLedgerTimeout<T>(operation: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new EbaySellerOAuthReauthError(
          "EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT",
        )), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function prepareEbayMarketingReadonlyOAuthStart(input: {
  configuration: EbaySellerOAuthReauthConfiguration
  actorUserId: string
  ledger: EbaySellerOAuthReauthStateLedger
  fetchImpl?: FetchLike
  clock?: () => number
  stateFactory?: () => string
}) {
  if (!input.configuration.ready) {
    throw new EbaySellerOAuthReauthError(
      input.configuration.reason ??
        "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
    )
  }
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
    getEbaySellerOAuthReauthRuntimeCredentialMatch(input.configuration),
  )
  const clock = input.clock ?? Date.now
  const state = (input.stateFactory ?? createEbaySellerOAuthReauthState)()
  const expiresAt = clock() + EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS
  const authorizationUrl = buildEbaySellerOAuthReauthPurposeAuthorizationUrl({
    clientId: input.configuration.clientId,
    runame: input.configuration.runame,
    state,
    purpose: "MARKETING_READONLY",
  })
  const preflight = await preflightEbaySellerOAuthReauthAuthorizationRequest({
    authorizationUrl,
    stateExpected: true,
    fetchImpl: input.fetchImpl ?? fetch,
  })
  if (preflight.acceptedByAuthEndpoint !== "YES" ||
      preflight.safeErrorCategory !== "NONE") {
    throw new EbaySellerOAuthReauthError(
      "EBAY_MARKETING_READONLY_OAUTH_PREFLIGHT_REJECTED",
    )
  }
  const stateHash = hashEbaySellerOAuthReauthState(state)
  const created = await withLedgerTimeout(input.ledger.createPending({
    stateHash,
    expiresAt: new Date(expiresAt).toISOString(),
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS)
  if (!created) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_SELLER_OAUTH_REAUTH_STATE_COLLISION",
    )
  }
  return {
    purpose: "MARKETING_READONLY" as const,
    authorizationUrl,
    callbackPath: input.configuration.callbackUrl,
    cookie: createEbaySellerOAuthReauthCookie({
      state,
      expiresAt,
      actorUserId: input.actorUserId,
      branchHost: input.configuration.branchHost,
      clientSecret: input.configuration.clientSecret,
      expectedAccountFingerprint:
        input.configuration.expectedAccountFingerprint,
      purpose: "MARKETING_READONLY",
    }),
    expiresAt,
    scopeCount: EBAY_MARKETING_READONLY_OAUTH_SCOPES.length,
    targetSecretSlot: "EBAY_MARKETING_READONLY_REFRESH_TOKEN" as const,
    authorizationPreflight: {
      liveAccepted: true as const,
      scopeEncoding: "RFC3986_PERCENT20" as const,
      stateAccepted: true as const,
      scopeContractExact: true as const,
      positiveInvariantsPassed: true as const,
      runtimeCredentialMatch: true as const,
    },
  }
}

async function tokenPayload(response: Response, requireRefreshToken: boolean) {
  let payload: JsonRecord
  try {
    payload = record(await response.json())
  } catch {
    throw new EbaySellerOAuthReauthError(
      "EBAY_MARKETING_READONLY_OAUTH_TOKEN_RESPONSE_INVALID",
    )
  }
  const scopes = exactEbaySellerOAuthReauthReturnedScopes(
    payload.scope,
    "MARKETING_READONLY",
  )
  const accessToken = credential(payload.access_token)
  const refreshToken = requireRefreshToken
    ? credential(payload.refresh_token)
    : ""
  if (!response.ok || scopes === false || !accessToken ||
      (requireRefreshToken && !refreshToken)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_MARKETING_READONLY_OAUTH_TOKEN_RESPONSE_INVALID",
    )
  }
  payload = {}
  return { accessToken, refreshToken }
}

async function oauthPost(input: {
  body: URLSearchParams
  basic: string
  fetchImpl: FetchLike
}) {
  return input.fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${input.basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: input.body,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

export async function verifyEbayMarketingReadonlyOAuthCandidate(input: {
  authorizationCode: string
  configuration: EbaySellerOAuthReauthConfiguration
  fetchImpl?: FetchLike
}) {
  if (!input.configuration.ready ||
      !credential(input.authorizationCode, 1_024)) {
    throw new EbaySellerOAuthReauthError(
      "EBAY_MARKETING_READONLY_OAUTH_CANDIDATE_INVALID",
    )
  }
  const fetchImpl = input.fetchImpl ?? fetch
  const basic = Buffer.from(
    `${input.configuration.clientId}:${input.configuration.clientSecret}`,
    "utf8",
  ).toString("base64")
  let refreshToken = ""
  let accessToken = ""
  try {
    const exchange = await tokenPayload(await oauthPost({
      basic,
      fetchImpl,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.authorizationCode,
        redirect_uri: input.configuration.runame,
      }),
    }), true)
    refreshToken = exchange.refreshToken
    accessToken = exchange.accessToken
    accessToken = ""

    const refreshed = await tokenPayload(await oauthPost({
      basic,
      fetchImpl,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_MARKETING_READONLY_OAUTH_SCOPES.join(" "),
      }),
    }), false)
    accessToken = refreshed.accessToken

    assertEbayMonitorReadonlyRequest({
      operation: "TRADING_GET_USER",
      method: "POST",
      url: TRADING_ENDPOINT,
      tradingCallName: "GetUser",
      tradingHeaderCallName: "GetUser",
      tradingBody: GET_USER_BODY,
    })
    const getUserResponse = await fetchImpl(TRADING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetUser",
        "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body: GET_USER_BODY,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    let userXml = await getUserResponse.text()
    const account = parseEbayTradingGetUser(userXml)
    userXml = ""
    const fingerprintMatch = account.userId
      ? ebayProductionAccountFingerprint(account.userId) ===
        input.configuration.expectedAccountFingerprint
      : false
    const expectedUserMatch = !input.configuration.expectedUserId ||
      account.userId?.toLocaleLowerCase("en-US") ===
        input.configuration.expectedUserId.toLocaleLowerCase("en-US")
    if (!getUserResponse.ok || !account.accepted || account.site !== "US" ||
        !fingerprintMatch || !expectedUserMatch) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_MARKETING_READONLY_OAUTH_ACCOUNT_BINDING_MISMATCH",
      )
    }

    const smokeUrl = new URL(MARKETING_SMOKE_ENDPOINT)
    smokeUrl.searchParams.set("listing_id", TARGET_ITEM_ID)
    const smokeResponse = await fetchImpl(smokeUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE_ID,
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const smokePayload = record(await smokeResponse.json().catch(() => ({})))
    if (!smokeResponse.ok || !smokePayload) {
      throw new EbaySellerOAuthReauthError(
        "EBAY_MARKETING_READONLY_OAUTH_SCOPE_UNPROVEN",
      )
    }
    const result = {
      refreshToken,
      purpose: "MARKETING_READONLY" as const,
      credentialSource: "NEW_DEDICATED_MARKETING_OAUTH_CANDIDATE_ONLY" as const,
      targetSecretSlot: "EBAY_MARKETING_READONLY_REFRESH_TOKEN" as const,
      marketingOAuthScopeProven: true as const,
      findCampaignByAdReferenceAuthorized: true as const,
      accountIdentityMatch: true as const,
      marketplaceId: MARKETPLACE_ID,
      marketplaceWrites: 0 as const,
      tokenPersisted: false as const,
      unrelatedSecretChanges: 0 as const,
    }
    refreshToken = ""
    return result
  } finally {
    refreshToken = ""
    accessToken = ""
  }
}

export async function claimAndVerifyEbayMarketingReadonlyOAuth(input: {
  callback: EbaySellerOAuthCallbackInput
  stateHash: string
  ledger: EbaySellerOAuthReauthStateLedger
  configuration: EbaySellerOAuthReauthConfiguration
  fetchImpl?: FetchLike
}) {
  const claimed = await withLedgerTimeout(input.ledger.claimPending({
    stateHash: input.stateHash,
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  }), EBAY_SELLER_OAUTH_REAUTH_LEDGER_TIMEOUT_MS)
  if (!claimed) {
    return {
      kind: "DENIED" as const,
      code: "EBAY_SELLER_OAUTH_REAUTH_STATE_NOT_CLAIMED" as const,
      claimSucceeded: false as const,
    }
  }
  if (input.callback.kind === "DENIED") {
    return {
      kind: "DENIED" as const,
      code: "EBAY_MARKETING_READONLY_OAUTH_CONSENT_DENIED" as const,
      claimSucceeded: true as const,
    }
  }
  const verification = await verifyEbayMarketingReadonlyOAuthCandidate({
    authorizationCode: input.callback.code,
    configuration: input.configuration,
    fetchImpl: input.fetchImpl,
  })
  return {
    kind: "HANDOFF" as const,
    claimSucceeded: true as const,
    verification,
  }
}
