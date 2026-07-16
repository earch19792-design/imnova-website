import "server-only"

import { createHash } from "node:crypto"

import { classifyEbayCommercialOAuthFailure } from "./ebay-commercial-oauth-domain"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import {
  classifyEbayFulfillmentTrackingConnectionError,
  EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
  EBAY_FULFILLMENT_TRACKING_WRITE_SCOPE,
  ebayFulfillmentTrackingScopeConfirmed,
} from "./ebay-fulfillment-tracking-oauth-domain"
import { getEbayProductionIdentityBindingConfiguration } from "./ebay-seller-account-scope"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const AUTHORIZED_PREVIEW_BRANCH = "feature/centralize-ebay-mobile-command-center"
const STAGING_REF = "vsfthqydfrdzulldbfbe"
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>
type CachedToken = { value: string; expiresAt: number }

let cachedToken: CachedToken | null = null

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function enabled(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim().toLowerCase() === "true"
}

function stagingMatches(environment: NodeJS.ProcessEnv) {
  try {
    return new URL(environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "").hostname ===
      `${STAGING_REF}.supabase.co`
  } catch {
    return false
  }
}

function fingerprint(value: string) {
  return value
    ? `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)}`
    : null
}

function credentials(environment: NodeJS.ProcessEnv) {
  const dedicatedClientId = environment.EBAY_FULFILLMENT_TRACKING_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret = environment.EBAY_FULFILLMENT_TRACKING_CLIENT_SECRET?.trim() ?? ""
  const genericClientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const genericClientSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const partialDedicatedPair = Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)
  const useDedicatedPair = Boolean(dedicatedClientId && dedicatedClientSecret)
  return {
    clientId: useDedicatedPair ? dedicatedClientId : genericClientId,
    clientSecret: useDedicatedPair ? dedicatedClientSecret : genericClientSecret,
    refreshToken: environment.EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN?.trim() ?? "",
    runame: environment.EBAY_FULFILLMENT_TRACKING_RUNAME?.trim() ?? "",
    partialDedicatedPair,
    clientSource: useDedicatedPair
      ? "EBAY_FULFILLMENT_TRACKING_CLIENT_ID" as const
      : "EBAY_CLIENT_ID" as const,
    secretSource: useDedicatedPair
      ? "EBAY_FULFILLMENT_TRACKING_CLIENT_SECRET" as const
      : "EBAY_CLIENT_SECRET" as const,
  }
}

export function getEbayFulfillmentTrackingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = credentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const preview = environment.VERCEL_ENV === "preview"
  const staging = stagingMatches(environment)
  const branch = environment.VERCEL_GIT_COMMIT_REF === AUTHORIZED_PREVIEW_BRANCH
  const flags = {
    oauthEnabled: enabled(environment, "EBAY_FULFILLMENT_TRACKING_OAUTH_ENABLED"),
    writeEnabled: enabled(environment, "EBAY_FULFILLMENT_TRACKING_WRITE_ENABLED"),
    realAdapterEnabled: enabled(environment, "MARKETPLACE_FULFILLMENT_REAL_ADAPTER_ENABLED"),
    submitterEnabled: enabled(environment, "MARKETPLACE_FULFILLMENT_SUBMITTER_ENABLED"),
  }
  const tokenPresent = Boolean(value.refreshToken)
  const clientPairPresent = Boolean(value.clientId && value.clientSecret && !value.partialDedicatedPair)
  const allFlagsEnabled = Object.values(flags).every(Boolean)
  return {
    environment: "EBAY_PRODUCTION" as const,
    preview,
    staging,
    branchAuthorized: branch,
    flags,
    allFlagsEnabled,
    executable: preview && staging && branch && allFlagsEnabled && tokenPresent &&
      clientPairPresent && identity.bound,
    oauthAuthorizationReady: preview && staging && branch &&
      clientPairPresent && Boolean(value.runame) && identity.bound,
    token: tokenPresent ? "PRESENT" as const : "MISSING" as const,
    tokenSource: "EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN" as const,
    readonlyOrdersTokenFallbackAllowed: false as const,
    genericSellerTokenFallbackAllowed: false as const,
    clientPair: clientPairPresent ? "PRESENT" as const : "MISSING" as const,
    clientSource: value.clientSource,
    secretSource: value.secretSource,
    runame: value.runame ? "PRESENT" as const : "MISSING" as const,
    clientFingerprint: fingerprint(value.clientId),
    requiredScope: EBAY_FULFILLMENT_TRACKING_WRITE_SCOPE,
    scopes: [...EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES],
    identityBound: identity.bound,
    secretsReturned: false as const,
  }
}

export function assertEbayFulfillmentTrackingWriterEnabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = getEbayFulfillmentTrackingConfiguration(environment)
  if (!configuration.preview) throw new Error("EBAY_FULFILLMENT_TRACKING_PRODUCTION_BLOCKED")
  if (!configuration.staging) throw new Error("EBAY_FULFILLMENT_TRACKING_STAGING_REQUIRED")
  if (!configuration.branchAuthorized) throw new Error("EBAY_FULFILLMENT_TRACKING_BRANCH_BLOCKED")
  if (!configuration.allFlagsEnabled) throw new Error("EBAY_FULFILLMENT_TRACKING_FLAGS_DISABLED")
  if (!configuration.executable) throw new Error("EBAY_FULFILLMENT_TRACKING_NOT_READY")
  return configuration
}

function assertEbayFulfillmentTrackingOAuthPreflightEnabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = getEbayFulfillmentTrackingConfiguration(environment)
  if (!configuration.preview) throw new Error("EBAY_FULFILLMENT_TRACKING_PRODUCTION_BLOCKED")
  if (!configuration.staging) throw new Error("EBAY_FULFILLMENT_TRACKING_STAGING_REQUIRED")
  if (!configuration.branchAuthorized) throw new Error("EBAY_FULFILLMENT_TRACKING_BRANCH_BLOCKED")
  if (configuration.token !== "PRESENT" || configuration.clientPair !== "PRESENT" || !configuration.identityBound) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_NOT_READY")
  }
  return configuration
}

export async function getEbayFulfillmentTrackingAccessToken(
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assertEbayFulfillmentTrackingOAuthPreflightEnabled(environment)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const value = credentials(environment)
  if (value.partialDedicatedPair) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_CLIENT_CREDENTIAL_MISMATCH")
  }
  const basic = Buffer.from(`${value.clientId}:${value.clientSecret}`, "utf8").toString("base64")
  let response: Response
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: value.refreshToken,
        scope: EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES.join(" "),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_TOKEN_ENDPOINT_UNAVAILABLE")
  }
  let payload: JsonRecord = {}
  try { payload = record(await response.json()) } catch { payload = {} }
  if (!response.ok) {
    throw new Error(`EBAY_FULFILLMENT_TRACKING_OAUTH_${classifyEbayCommercialOAuthFailure(response.status, payload)}`)
  }
  const accessToken = text(payload.access_token)
  if (!accessToken) throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_MALFORMED_REQUEST")
  const returnedScopeConfirmed = ebayFulfillmentTrackingScopeConfirmed(payload.scope)
  if (returnedScopeConfirmed === false) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPE_MISSING")
  }
  await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
  cachedToken = {
    value: accessToken,
    expiresAt: Date.now() + Math.max(120, Number(payload.expires_in) || 7_200) * 1_000,
  }
  return accessToken
}

export function clearEbayFulfillmentTrackingAccessToken() {
  cachedToken = null
}

export async function preflightEbayFulfillmentTrackingOAuth(
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  try {
    const token = await getEbayFulfillmentTrackingAccessToken(fetchImpl, environment)
    const identity = await verifyEbayCommercialOfficialAccount(token, fetchImpl)
    const configuration = getEbayFulfillmentTrackingConfiguration(environment)
    return {
      status: "READY" as const,
      scopeConfirmed: true as const,
      refreshSuccessful: true as const,
      identityMatch: identity.identityMatch,
      fingerprintMatch: identity.fingerprintMatches,
      environmentPreview: configuration.preview,
      branchMatch: configuration.branchAuthorized,
      adapterConfigured: configuration.preview && configuration.staging &&
        configuration.branchAuthorized && configuration.clientPair === "PRESENT" &&
        configuration.token === "PRESENT" && configuration.identityBound,
      writeGate: configuration.flags.writeEnabled ? "ON" as const : "OFF" as const,
      submitter: configuration.flags.submitterEnabled ? "ON" as const : "OFF" as const,
      tokenSource: "EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN" as const,
      getOrdersUsed: false as const,
      ebayWrites: 0 as const,
      secretsReturned: false as const,
    }
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]{3,180}$/.test(error.message)
      ? error.message
      : "EBAY_FULFILLMENT_TRACKING_OAUTH_UNKNOWN_ERROR"
    return {
      status: classifyEbayFulfillmentTrackingConnectionError(code),
      errorCode: code,
      scopeConfirmed: false as const,
      refreshSuccessful: false as const,
      identityMatch: null,
      fingerprintMatch: null,
      environmentPreview: getEbayFulfillmentTrackingConfiguration(environment).preview,
      branchMatch: getEbayFulfillmentTrackingConfiguration(environment).branchAuthorized,
      adapterConfigured: false as const,
      writeGate: getEbayFulfillmentTrackingConfiguration(environment).flags.writeEnabled
        ? "ON" as const
        : "OFF" as const,
      submitter: getEbayFulfillmentTrackingConfiguration(environment).flags.submitterEnabled
        ? "ON" as const
        : "OFF" as const,
      tokenSource: "EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN" as const,
      getOrdersUsed: false as const,
      ebayWrites: 0 as const,
      secretsReturned: false as const,
    }
  }
}
