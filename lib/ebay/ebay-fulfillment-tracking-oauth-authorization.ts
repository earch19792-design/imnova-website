import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { classifyEbayCommercialOAuthFailure } from "./ebay-commercial-oauth-domain"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import {
  buildEbayFulfillmentTrackingConsentUrl,
  classifyEbayFulfillmentTrackingConnectionError,
  createEbayFulfillmentTrackingOAuthState,
  type EbayFulfillmentTrackingConnectionState,
  EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES,
  ebayFulfillmentTrackingScopeConfirmed,
  encryptEbayFulfillmentTrackingRefreshToken,
  getEbayFulfillmentTrackingCallbackConfiguration,
  hashEbayFulfillmentTrackingOAuthState,
  isValidEbayFulfillmentTrackingAuthorizationCode,
  isValidEbayFulfillmentTrackingOAuthState,
  validateEbayFulfillmentTrackingPublicKey,
} from "./ebay-fulfillment-tracking-oauth-domain"
import {
  getEbayFulfillmentTrackingConfiguration,
  preflightEbayFulfillmentTrackingOAuth,
} from "./ebay-fulfillment-tracking-oauth"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const HANDOFF_TTL_MS = 30 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>
type HandoffRow = {
  status: string
  identity_match: boolean | null
  fingerprint_match: boolean | null
  fulfillment_scope_confirmed: boolean | null
  refresh_success: boolean | null
  readiness_status: string | null
  readiness_checked_at: string | null
  error_code: string | null
  expires_at: string
  ready_at: string | null
  consumed_at: string | null
  token_installed_at: string | null
  ciphertext_cleared_at: string | null
}

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
    handoffPublicKey:
      environment.EBAY_FULFILLMENT_TRACKING_HANDOFF_PUBLIC_KEY?.trim() ?? "",
    partialDedicatedPair: Boolean(dedicatedId) !== Boolean(dedicatedSecret),
  }
}

export function getEbayFulfillmentTrackingAuthorizationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const runtime = getEbayFulfillmentTrackingConfiguration(environment)
  const value = credentials(environment)
  const baseConfigured = runtime.preview && runtime.staging && runtime.branchAuthorized &&
    runtime.clientPair === "PRESENT" && Boolean(value.runame) && runtime.identityBound &&
    !value.partialDedicatedPair
  const operatorPrepared = validateEbayFulfillmentTrackingPublicKey(value.handoffPublicKey)
  const writeGatesAllOff = !runtime.flags.oauthEnabled && !runtime.flags.writeEnabled &&
    !runtime.flags.realAdapterEnabled && !runtime.flags.submitterEnabled &&
    !runtime.flags.writtenConsentEnabled
  return {
    configured: baseConfigured && operatorPrepared && writeGatesAllOff,
    baseConfigured,
    operatorPrepared,
    environment: runtime.environment,
    preview: runtime.preview,
    staging: runtime.staging,
    branchAuthorized: runtime.branchAuthorized,
    oauthFlagEnabled: runtime.flags.oauthEnabled,
    runtimeFlags: runtime.flags,
    clientId: value.clientId ? "PRESENT" as const : "MISSING" as const,
    clientSecret: value.clientSecret ? "PRESENT" as const : "MISSING" as const,
    runame: value.runame ? "PRESENT" as const : "MISSING" as const,
    refreshToken: runtime.token,
    callback: getEbayFulfillmentTrackingCallbackConfiguration(environment),
    scopes: [...EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPES],
    tokenVariable: "EBAY_FULFILLMENT_TRACKING_REFRESH_TOKEN" as const,
    readonlyOrdersTokenFallbackAllowed: false as const,
    genericSellerTokenFallbackAllowed: false as const,
    writeEnabledAfterAuthorization: false as const,
    writeGatesAllOff,
    secretsReturned: false as const,
  }
}

function assertAuthorizationReady(environment: NodeJS.ProcessEnv) {
  const configuration = getEbayFulfillmentTrackingAuthorizationConfiguration(environment)
  if (!configuration.preview) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_PREVIEW_ONLY")
  if (!configuration.staging) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_STAGING_REQUIRED")
  if (!configuration.branchAuthorized) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_BRANCH_BLOCKED")
  if (!configuration.baseConfigured) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_NOT_CONFIGURED")
  if (!configuration.writeGatesAllOff) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_FLAGS_MUST_REMAIN_OFF")
  if (!configuration.operatorPrepared) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_OPERATOR_REQUIRED")
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
  const returnedScopeConfirmed = ebayFulfillmentTrackingScopeConfirmed(payload.scope)
  if (returnedScopeConfirmed === false) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_OAUTH_SCOPE_MISSING")
  }
  return payload
}

export async function startEbayFulfillmentTrackingAuthorization(
  supabase: SupabaseClient,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = assertAuthorizationReady(environment)
  const state = createEbayFulfillmentTrackingOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase.rpc(
    "start_ebay_fulfillment_tracking_oauth_handoff_v1b",
    {
      p_state_hash: hashEbayFulfillmentTrackingOAuthState(state),
      p_public_key_pem: value.handoffPublicKey,
      p_expires_at: expiresAt,
    },
  )
  if (error) {
    const code = text(error.message).includes("HANDOFF_ACTIVE")
      ? "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_ACTIVE"
      : "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_FAILED"
    throw new Error(code)
  }
  const result = Array.isArray(data) ? data[0] : data
  if (!record(result).handoff_id) {
    throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_FAILED")
  }
  return {
    authorizationUrl: buildEbayFulfillmentTrackingConsentUrl({
      clientId: value.clientId,
      runame: value.runame,
      state,
    }),
    expiresAt,
    configuration: getEbayFulfillmentTrackingAuthorizationConfiguration(environment),
    safety: {
      stateStoredAsHashOnly: true,
      serverSideExchange: true,
      refreshTokenStoredAsCiphertextOnlyUntilInstallation: true,
      privateKeyServerStored: false,
      writeFlagsChanged: false,
      ebayWrites: 0,
      secretsReturned: false,
    },
  }
}

async function failHandoff(supabase: SupabaseClient, handoffId: string, error: unknown) {
  await supabase.from("ebay_fulfillment_tracking_oauth_handoffs").update({
    status: "failed",
    encrypted_refresh_token: null,
    error_code: safeCode(error),
    updated_at: new Date().toISOString(),
  }).eq("id", handoffId).eq("status", "claimed")
}

export async function failEbayFulfillmentTrackingAuthorizationConsent(
  supabase: SupabaseClient,
  state: string,
  errorCode: string,
) {
  if (!isValidEbayFulfillmentTrackingOAuthState(state)) return false
  const now = new Date().toISOString()
  const { data } = await supabase.from("ebay_fulfillment_tracking_oauth_handoffs")
    .update({
      status: "failed",
      encrypted_refresh_token: null,
      error_code: sanitizeEbayFulfillmentTrackingCallbackError(errorCode),
      updated_at: now,
    })
    .eq("state_hash", hashEbayFulfillmentTrackingOAuthState(state))
    .eq("status", "pending")
    .select("id").maybeSingle()
  return Boolean(data?.id)
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
    const identity = await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
    const encrypted = encryptEbayFulfillmentTrackingRefreshToken(
      refreshToken,
      String(handoff.public_key_pem),
    )
    const readyAt = new Date().toISOString()
    const { data: ready, error: readyError } = await supabase
      .from("ebay_fulfillment_tracking_oauth_handoffs")
      .update({
        encrypted_refresh_token: encrypted,
        status: "ready",
        identity_match: identity.identityMatch,
        fingerprint_match: identity.fingerprintMatches,
        fulfillment_scope_confirmed: true,
        refresh_success: true,
        error_code: null,
        ready_at: readyAt,
        updated_at: readyAt,
      }).eq("id", handoffId).eq("status", "claimed")
      .select("id").maybeSingle()
    if (readyError || !ready?.id) {
      throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_HANDOFF_FAILED")
    }
    return {
      status: "AUTHORIZATION_IN_PROGRESS" as const,
      identityMatch: true as const,
      fingerprintMatch: true as const,
      fulfillmentScopeConfirmed: true as const,
      awaitingSecureInstallation: true as const,
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

function stateFromHandoff(row: HandoffRow | null): EbayFulfillmentTrackingConnectionState | null {
  if (!row) return null
  if (["pending", "claimed", "ready"].includes(row.status)) {
    return "AUTHORIZATION_IN_PROGRESS"
  }
  if (row.status === "expired") return "EXPIRED_OR_REVOKED"
  if (row.status === "failed") {
    return classifyEbayFulfillmentTrackingConnectionError(row.error_code)
  }
  if (row.status === "consumed" && row.readiness_status) {
    const state = row.readiness_status as EbayFulfillmentTrackingConnectionState
    return [
      "READY", "SCOPE_MISSING", "IDENTITY_MISMATCH", "FINGERPRINT_MISMATCH",
      "EXPIRED_OR_REVOKED", "ERROR",
    ].includes(state) ? state : "ERROR"
  }
  return row.status === "consumed" ? "AUTHORIZATION_IN_PROGRESS" : null
}

export async function getEbayFulfillmentTrackingAuthorizationStatus(
  supabase: SupabaseClient,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = getEbayFulfillmentTrackingAuthorizationConfiguration(environment)
  const now = new Date().toISOString()
  await supabase.from("ebay_fulfillment_tracking_oauth_handoffs")
    .update({ status: "expired", encrypted_refresh_token: null, updated_at: now })
    .in("status", ["pending", "claimed"]).lte("expires_at", now)
  const { data, error } = await supabase.from("ebay_fulfillment_tracking_oauth_handoffs")
    .select("status,identity_match,fingerprint_match,fulfillment_scope_confirmed,refresh_success,readiness_status,readiness_checked_at,error_code,expires_at,ready_at,consumed_at,token_installed_at,ciphertext_cleared_at")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_STATUS_FAILED")
  const latest = data as HandoffRow | null
  const state = !configuration.baseConfigured
    ? "NOT_CONFIGURED" as const
    : !configuration.writeGatesAllOff
      ? "ERROR" as const
    : stateFromHandoff(latest) ?? (configuration.refreshToken === "PRESENT"
      ? "AUTHORIZATION_IN_PROGRESS" as const
      : "AUTHORIZATION_REQUIRED" as const)
  return {
    state,
    token: configuration.refreshToken,
    fulfillmentScope: latest?.fulfillment_scope_confirmed === true ? "YES" as const : "NO" as const,
    identity: latest?.identity_match === true ? "MATCH" as const : latest?.identity_match === false ? "MISMATCH" as const : "UNKNOWN" as const,
    fingerprint: latest?.fingerprint_match === true ? "MATCH" as const : latest?.fingerprint_match === false ? "MISMATCH" as const : "UNKNOWN" as const,
    refreshSuccessful: latest?.refresh_success === true,
    environmentPreview: configuration.preview,
    branchMatch: configuration.branchAuthorized,
    adapterConfigured: configuration.baseConfigured && configuration.refreshToken === "PRESENT",
    operatorPrepared: configuration.operatorPrepared,
    callbackPath: configuration.callback.canonicalPath,
    callbackHostMatch: configuration.callback.deployedBranchHostStatus,
    authorizationAvailable: configuration.configured && !["pending", "claimed", "ready"].includes(latest?.status ?? ""),
    lastHandoff: latest ? {
      status: latest.status,
      expiresAt: latest.expires_at,
      readyAt: latest.ready_at,
      consumedAt: latest.consumed_at,
      tokenInstalledAt: latest.token_installed_at,
      ciphertextClearedAt: latest.ciphertext_cleared_at,
      readinessCheckedAt: latest.readiness_checked_at,
      errorCode: latest.error_code,
    } : null,
    writeGate: configuration.runtimeFlags.writeEnabled ? "ON" as const : "OFF" as const,
    submitter: configuration.runtimeFlags.submitterEnabled ? "ON" as const : "OFF" as const,
    flags: {
      oauth: configuration.oauthFlagEnabled ? "ON" as const : "OFF" as const,
      write: configuration.writeGatesAllOff ? "OFF" as const : "CHECK_REQUIRED" as const,
    },
    ebayWrites: 0 as const,
    nextAction: state === "READY"
      ? "Conexión validada. Mantener todos los gates de escritura apagados."
      : state === "AUTHORIZATION_IN_PROGRESS"
        ? "Completar consentimiento o esperar instalación segura y nuevo deployment."
        : state === "AUTHORIZATION_REQUIRED"
          ? configuration.operatorPrepared
            ? "Autorizar tracking con eBay."
            : "Preparar una clave pública efímera mediante el operador asistido."
          : "Revisar el estado sanitizado y generar un handoff nuevo.",
    secretsReturned: false as const,
  }
}

export async function runAndRecordEbayFulfillmentTrackingReadiness(
  supabase: SupabaseClient,
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const result = await preflightEbayFulfillmentTrackingOAuth(fetchImpl, environment)
  const checkedAt = new Date().toISOString()
  const { data: handoff } = await supabase
    .from("ebay_fulfillment_tracking_oauth_handoffs")
    .select("id").eq("status", "consumed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (handoff?.id) {
    await supabase.from("ebay_fulfillment_tracking_oauth_handoffs").update({
      readiness_status: result.status,
      readiness_checked_at: checkedAt,
      refresh_success: result.refreshSuccessful,
      fulfillment_scope_confirmed: result.scopeConfirmed,
      identity_match: result.identityMatch,
      fingerprint_match: result.fingerprintMatch,
      error_code: "errorCode" in result ? result.errorCode : null,
      updated_at: checkedAt,
    }).eq("id", handoff.id).eq("status", "consumed")
  }
  return result
}

export function sanitizeEbayFulfillmentTrackingCallbackError(value: string) {
  return value === "access_denied"
    ? "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CONSENT_DENIED"
    : "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_CALLBACK_REJECTED"
}
