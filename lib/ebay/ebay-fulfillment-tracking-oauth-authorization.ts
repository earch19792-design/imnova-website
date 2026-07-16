import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { classifyEbayCommercialOAuthFailure } from "./ebay-commercial-oauth-domain"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import {
  buildEbayFulfillmentTrackingConsentUrl,
  createEbayFulfillmentTrackingOAuthState,
  EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
  encryptEbayFulfillmentTrackingRefreshToken,
  getEbayFulfillmentTrackingCallbackConfiguration,
  hashEbayFulfillmentTrackingOAuthState,
  isValidEbayFulfillmentTrackingAuthorizationCode,
  isValidEbayFulfillmentTrackingOAuthState,
  validateEbayFulfillmentTrackingPublicKey,
} from "./ebay-fulfillment-tracking-oauth-domain"
import { getEbayFulfillmentTrackingConfiguration } from "./ebay-fulfillment-tracking-oauth"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const HANDOFF_TTL_MS = 30 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_FAILED"
}

function credentials(environment: NodeJS.ProcessEnv) {
  const dedicatedId = environment.EBAY_FULFILLMENT_TRACKING_CLIENT_ID?.trim() ?? ""
  const dedicatedSecret = environment.EBAY_FULFILLMENT_TRACKING_CLIENT_SECRET?.trim() ?? ""
  const useDedicated = Boolean(dedicatedId && dedicatedSecret)
  return {
    clientId: useDedicated ? dedicatedId : environment.EBAY_CLIENT_ID?.trim() ?? "",
    clientSecret: useDedicated ? dedicatedSecret : environment.EBAY_CLIENT_SECRET?.trim() ?? "",
    runame: environment.EBAY_FULFILLMENT_TRACKING_RUNAME?.trim() ?? "",
    partialDedicatedPair: Boolean(dedicatedId) !== Boolean(dedicatedSecret),
  }
}

export function getEbayFulfillmentTrackingAuthorizationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const runtime = getEbayFulfillmentTrackingConfiguration(environment)
  const value = credentials(environment)
  return {
    configured: runtime.oauthAuthorizationReady && !value.partialDedicatedPair,
    environment: runtime.environment,
    preview: runtime.preview,
    staging: runtime.staging,
    branchAuthorized: runtime.branchAuthorized,
    oauthFlagEnabled: runtime.flags.oauthEnabled,
    clientId: value.clientId ? "PRESENT" as const : "MISSING" as const,
    clientSecret: value.clientSecret ? "PRESENT" as const : "MISSING" as const,
    runame: value.runame ? "PRESENT" as const : "MISSING" as const,
    refreshToken: runtime.token,
    callback: getEbayFulfillmentTrackingCallbackConfiguration(environment),
    scopes: [...EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES],
    tokenVariable: "EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN" as const,
    readonlyOrdersTokenFallbackAllowed: false as const,
    writeEnabledAfterAuthorization: false as const,
    secretsReturned: false as const,
  }
}

function assertAuthorizationReady(environment: NodeJS.ProcessEnv) {
  const configuration = getEbayFulfillmentTrackingAuthorizationConfiguration(environment)
  if (!configuration.preview) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_PREVIEW_ONLY")
  if (!configuration.staging) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_STAGING_REQUIRED")
  if (!configuration.branchAuthorized) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_BRANCH_BLOCKED")
  if (!configuration.oauthFlagEnabled) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_DISABLED")
  if (!configuration.configured) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_NOT_CONFIGURED")
  return credentials(environment)
}

async function tokenExchange(input: {
  clientId: string
  clientSecret: string
  body: URLSearchParams
  fetchImpl: FetchLike
}) {
  const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")
  let response: Response
  try {
    response = await input.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: input.body,
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
  return payload
}

export async function startEbayFulfillmentTrackingAuthorization(
  supabase: SupabaseClient,
  publicKeyPem: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = assertAuthorizationReady(environment)
  if (!validateEbayFulfillmentTrackingPublicKey(publicKeyPem)) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_PUBLIC_KEY_INVALID")
  }
  const state = createEbayFulfillmentTrackingOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase.from("ebay_fulfillment_tracking_oauth_handoffs")
    .insert({
      state_hash: hashEbayFulfillmentTrackingOAuthState(state),
      public_key_pem: publicKeyPem,
      status: "pending",
      expires_at: expiresAt,
    }).select("id").single()
  if (error || !data?.id) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_FAILED")
  return {
    authorizationUrl: buildEbayFulfillmentTrackingConsentUrl({
      clientId: value.clientId,
      runame: value.runame,
      state,
    }),
    handoffId: String(data.id),
    expiresAt,
    configuration: getEbayFulfillmentTrackingAuthorizationConfiguration(environment),
    safety: {
      stateStoredAsHashOnly: true,
      serverSideExchange: true,
      refreshTokenStoredAsCiphertextOnly: true,
      writeFlagsChanged: false,
      ebayWrites: 0,
      secretsReturned: false,
    },
  }
}

async function failHandoff(supabase: SupabaseClient, handoffId: string, error: unknown) {
  await supabase.from("ebay_fulfillment_tracking_oauth_handoffs").update({
    status: "failed",
    error_code: safeCode(error),
    updated_at: new Date().toISOString(),
  }).eq("id", handoffId).eq("status", "claimed")
}

export async function completeEbayFulfillmentTrackingAuthorization(
  supabase: SupabaseClient,
  input: { state: string; code: string },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = assertAuthorizationReady(environment)
  if (
    !isValidEbayFulfillmentTrackingOAuthState(input.state) ||
    !isValidEbayFulfillmentTrackingAuthorizationCode(input.code)
  ) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CALLBACK_INVALID")
  const now = new Date().toISOString()
  const { data: handoff, error } = await supabase
    .from("ebay_fulfillment_tracking_oauth_handoffs")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("state_hash", hashEbayFulfillmentTrackingOAuthState(input.state))
    .eq("status", "pending").gt("expires_at", now)
    .select("id,public_key_pem").maybeSingle()
  if (error || !handoff?.id || !handoff.public_key_pem) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_STATE_INVALID")
  }
  const handoffId = String(handoff.id)
  let refreshToken = ""
  let accessToken = ""
  try {
    const exchanged = await tokenExchange({
      clientId: value.clientId,
      clientSecret: value.clientSecret,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: value.runame,
      }),
      fetchImpl,
    })
    refreshToken = text(exchanged.refresh_token)
    if (!refreshToken) throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_MALFORMED_REQUEST")
    const proof = await tokenExchange({
      clientId: value.clientId,
      clientSecret: value.clientSecret,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES.join(" "),
      }),
      fetchImpl,
    })
    accessToken = text(proof.access_token)
    if (!accessToken) throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_MALFORMED_REQUEST")
    await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
    const encrypted = encryptEbayFulfillmentTrackingRefreshToken(
      refreshToken,
      String(handoff.public_key_pem),
    )
    const readyAt = new Date().toISOString()
    const { error: readyError } = await supabase
      .from("ebay_fulfillment_tracking_oauth_handoffs")
      .update({
        encrypted_refresh_token: encrypted,
        status: "ready",
        identity_match: true,
        fulfillment_scope_confirmed: true,
        error_code: null,
        ready_at: readyAt,
        updated_at: readyAt,
      }).eq("id", handoffId).eq("status", "claimed")
    if (readyError) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_FAILED")
    return {
      status: "READY" as const,
      identityMatch: true as const,
      fulfillmentScopeConfirmed: true as const,
      writeFlagsChanged: false as const,
      ebayWrites: 0 as const,
      secretsReturned: false as const,
    }
  } catch (failure) {
    await failHandoff(supabase, handoffId, failure)
    throw new Error(safeCode(failure))
  } finally {
    refreshToken = ""
    accessToken = ""
    input.code = ""
    input.state = ""
  }
}

export function sanitizeEbayFulfillmentTrackingCallbackError(value: string) {
  return value === "access_denied"
    ? "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CONSENT_DENIED"
    : "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CALLBACK_REJECTED"
}
