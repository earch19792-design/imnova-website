import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createEbayCommercialOAuthState,
  hashEbayCommercialOAuthState,
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
} from "./ebay-commercial-orders-oauth-domain"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import {
  EBAY_LUNA_BOCA_RATON_LOCATION,
  ensureEbayLunaBocaRatonLocation,
} from "./ebay-merchant-location-one-shot-gateway"
import {
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

const AUTHORIZATION_ENDPOINT = "https://auth.ebay.com/oauth2/authorize"
const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const REVOCATION_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token/revoke"
const BASE_SCOPE = "https://api.ebay.com/oauth/api_scope"
const INVENTORY_WRITE_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.inventory"
const AUTHORIZATION_SCOPES = [BASE_SCOPE, INVENTORY_WRITE_SCOPE] as const
const AUTHORIZED_PREVIEW_BRANCH =
  "feature/centralize-ebay-mobile-command-center"
const PURPOSE = "CREATE_LUNA_BOCA_RATON_LOCATION"
const HANDOFF_TTL_MS = 15 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 12_000

type JsonRecord = Record<string, unknown>
type FetchLike = typeof fetch
type OAuthCredentials = {
  clientId: string
  clientSecret: string
  runame: string
  runameSource: string
}

const RUNAME_VARIABLES = [
  "EBAY_REDIRECT_URI",
  "EBAY_RUNAME",
  "EBAY_RU_NAME",
  "EBAY_RuName",
  "EBAY_COMMERCIAL_ORDERS_RUNAME",
] as const

const LOCATION_PAYLOAD_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify(EBAY_LUNA_BOCA_RATON_LOCATION))
  .digest("hex")

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message.trim() : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_MERCHANT_LOCATION_OAUTH_FAILED"
}

function credentialCandidates(environment: NodeJS.ProcessEnv) {
  const clientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const clientSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const seen = new Set<string>()
  return RUNAME_VARIABLES.flatMap((runameSource) => {
    const runame = environment[runameSource]?.trim() ?? ""
    if (!runame || seen.has(runame)) return []
    seen.add(runame)
    return [{ clientId, clientSecret, runame, runameSource }]
  })
}

function assertConfiguration(environment: NodeJS.ProcessEnv) {
  const accountScope = getEbaySellerAccountScopeConfiguration()
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  if (environment.VERCEL_ENV !== "preview") {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_PREVIEW_ONLY")
  }
  if (environment.VERCEL_GIT_COMMIT_REF !== AUTHORIZED_PREVIEW_BRANCH) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_BRANCH_BLOCKED")
  }
  const candidates = credentialCandidates(environment)
  if (
    !candidates.length || !candidates[0].clientId
    || !candidates[0].clientSecret || !identity.bound
    || !identity.expectedAccountFingerprint || !accountScope.accountKey
  ) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_NOT_CONFIGURED")
  }
  return { accountScope, identity }
}

async function resolveAuthorizationCredentials(
  environment: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
): Promise<OAuthCredentials> {
  for (const candidate of credentialCandidates(environment)) {
    const parameters = [
      ["client_id", candidate.clientId],
      ["response_type", "code"],
      ["redirect_uri", candidate.runame],
      ["scope", BASE_SCOPE],
    ]
    const diagnosticUrl = `${AUTHORIZATION_ENDPOINT}?${parameters.map(
      ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    ).join("&")}`
    try {
      const response = await fetchImpl(diagnosticUrl, {
        redirect: "follow",
        cache: "no-store",
        headers: { Accept: "text/html,application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? ""
      const body = contentType.includes("json")
        ? record(await response.json().catch(() => ({})))
        : { html: (await response.text()).slice(0, 20_000) }
      const invalidRequest =
        text(body.error_id).toLowerCase() === "invalid_request"
        || text(body.error).toLowerCase() === "invalid_request"
        || text(body.html).includes("invalid_request")
        || new URL(response.url).pathname === "/oauth2/errorOauth"
      if (!invalidRequest) return candidate
    } catch {
      // Try the next server-configured RuName.
    }
  }
  throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_RUNAME_REJECTED")
}

function authorizationUrl(input: OAuthCredentials & { state: string }) {
  if (!isValidEbayCommercialOAuthState(input.state)) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_START_INVALID")
  }
  const parameters = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", AUTHORIZATION_SCOPES.join(" ")],
    ["state", input.state],
  ]
  return `${AUTHORIZATION_ENDPOINT}?${parameters.map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  ).join("&")}`
}

async function exchangeAuthorizationCode(input: {
  credentials: OAuthCredentials
  code: string
  fetchImpl: FetchLike
}) {
  let response: Response
  try {
    response = await input.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${input.credentials.clientId}:${input.credentials.clientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.credentials.runame,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_TOKEN_UNAVAILABLE")
  }
  const payload = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    const oauthError = text(payload.error).toLowerCase()
    throw new Error(oauthError === "invalid_scope"
      ? "EBAY_MERCHANT_LOCATION_OAUTH_SCOPE_REJECTED"
      : oauthError === "invalid_grant"
        ? "EBAY_MERCHANT_LOCATION_OAUTH_GRANT_REJECTED"
        : oauthError === "invalid_client"
          ? "EBAY_MERCHANT_LOCATION_OAUTH_CLIENT_REJECTED"
          : "EBAY_MERCHANT_LOCATION_OAUTH_TOKEN_REJECTED")
  }
  const accessToken = text(payload.access_token)
  if (!accessToken) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_ACCESS_TOKEN_MISSING")
  }
  const returnedScopes = new Set(text(payload.scope).split(/\s+/).filter(Boolean))
  if (
    returnedScopes.size
    && AUTHORIZATION_SCOPES.some((scope) => !returnedScopes.has(scope))
  ) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_SCOPE_PROOF_FAILED")
  }
  return {
    accessToken,
    refreshToken: text(payload.refresh_token),
  }
}

async function revokeToken(input: {
  token: string
  hint: "access_token" | "refresh_token"
  credentials: OAuthCredentials
  fetchImpl: FetchLike
}) {
  if (!input.token) return
  try {
    await input.fetchImpl(REVOCATION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${input.credentials.clientId}:${input.credentials.clientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: input.token,
        token_type_hint: input.hint,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    // Best effort only; the token is never persisted or returned.
  }
}

export async function startEbayMerchantLocationOAuth(
  supabase: SupabaseClient,
  input: { actorUserId: string; accountKey: string },
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  const configuration = assertConfiguration(environment)
  if (
    configuration.accountScope.accountKey !== input.accountKey
    || !/^[0-9a-f-]{36}$/i.test(input.actorUserId)
  ) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_REQUEST_INVALID")
  }
  const oauth = await resolveAuthorizationCredentials(environment, fetchImpl)
  const state = createEbayCommercialOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("ebay_merchant_location_oauth_handoffs")
    .insert({
      state_hash: hashEbayCommercialOAuthState(state),
      account_key: input.accountKey,
      actor_user_id: input.actorUserId,
      purpose: PURPOSE,
      expected_identity_fingerprint:
        configuration.identity.expectedAccountFingerprint,
      payload_fingerprint: LOCATION_PAYLOAD_FINGERPRINT,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_HANDOFF_FAILED")
  }
  return {
    authorizationUrl: authorizationUrl({ ...oauth, state }),
    expiresAt,
    safety: {
      purpose: PURPOSE,
      locationKey: EBAY_LUNA_BOCA_RATON_LOCATION.merchantLocationKey,
      scopes: [...AUTHORIZATION_SCOPES],
      tokenPersisted: false,
      canCreateInventoryItem: false,
      canCreateOffer: false,
      canPublish: false,
    },
  }
}

export async function hasPendingEbayMerchantLocationOAuth(
  supabase: SupabaseClient,
  state: string,
) {
  if (!isValidEbayCommercialOAuthState(state)) return false
  const { data, error } = await supabase
    .from("ebay_merchant_location_oauth_handoffs")
    .select("id")
    .eq("state_hash", hashEbayCommercialOAuthState(state))
    .eq("purpose", PURPOSE)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_STATE_LOOKUP_FAILED")
  return Boolean(data?.id)
}

export async function failPendingEbayMerchantLocationOAuth(
  supabase: SupabaseClient,
  state: string,
  reason: string,
) {
  if (!isValidEbayCommercialOAuthState(state)) return
  const now = new Date().toISOString()
  await supabase
    .from("ebay_merchant_location_oauth_handoffs")
    .update({
      status: "failed",
      error_code: safeCode(new Error(reason)),
      finished_at: now,
      updated_at: now,
    })
    .eq("state_hash", hashEbayCommercialOAuthState(state))
    .eq("purpose", PURPOSE)
    .eq("status", "pending")
}

async function failClaimedHandoff(
  supabase: SupabaseClient,
  handoffId: string,
  error: unknown,
) {
  const now = new Date().toISOString()
  await supabase
    .from("ebay_merchant_location_oauth_handoffs")
    .update({
      status: "failed",
      error_code: safeCode(error),
      finished_at: now,
      updated_at: now,
    })
    .eq("id", handoffId)
    .eq("status", "claimed")
}

export async function completeEbayMerchantLocationOAuth(
  supabase: SupabaseClient,
  input: { state: string; code: string },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = assertConfiguration(environment)
  if (
    !isValidEbayCommercialOAuthState(input.state)
    || !isValidEbayCommercialAuthorizationCode(input.code)
  ) throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_CALLBACK_INVALID")

  const now = new Date().toISOString()
  const { data: handoff, error: claimError } = await supabase
    .from("ebay_merchant_location_oauth_handoffs")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("state_hash", hashEbayCommercialOAuthState(input.state))
    .eq("purpose", PURPOSE)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select(
      "id,account_key,actor_user_id,expected_identity_fingerprint,payload_fingerprint",
    )
    .maybeSingle()
  if (claimError || !handoff?.id) {
    throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_STATE_INVALID")
  }

  const handoffId = String(handoff.id)
  let oauth: OAuthCredentials | null = null
  let accessToken = ""
  let refreshToken = ""
  try {
    if (
      handoff.account_key !== configuration.accountScope.accountKey
      || handoff.expected_identity_fingerprint
        !== configuration.identity.expectedAccountFingerprint
      || handoff.payload_fingerprint !== LOCATION_PAYLOAD_FINGERPRINT
    ) {
      throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_BINDING_MISMATCH")
    }
    oauth = await resolveAuthorizationCredentials(environment, fetchImpl)
    const exchanged = await exchangeAuthorizationCode({
      credentials: oauth,
      code: input.code,
      fetchImpl,
    })
    accessToken = exchanged.accessToken
    refreshToken = exchanged.refreshToken
    await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
    const result = await ensureEbayLunaBocaRatonLocation({
      accessToken,
      fetchImpl,
    })
    const readyAt = new Date().toISOString()
    const { error: readyError } = await supabase
      .from("ebay_merchant_location_oauth_handoffs")
      .update({
        status: "ready",
        result_code: result.status,
        ebay_writes: result.ebayWrites,
        error_code: null,
        finished_at: readyAt,
        updated_at: readyAt,
      })
      .eq("id", handoffId)
      .eq("status", "claimed")
    if (readyError) {
      throw new Error("EBAY_MERCHANT_LOCATION_OAUTH_HANDOFF_FAILED")
    }
    return {
      status: result.status,
      locationVerified: true as const,
      ebayWrites: result.ebayWrites,
      secretsReturned: false as const,
    }
  } catch (error) {
    await failClaimedHandoff(supabase, handoffId, error)
    throw new Error(safeCode(error))
  } finally {
    if (oauth) {
      await revokeToken({
        token: accessToken,
        hint: "access_token",
        credentials: oauth,
        fetchImpl,
      })
      await revokeToken({
        token: refreshToken,
        hint: "refresh_token",
        credentials: oauth,
        fetchImpl,
      })
    }
    accessToken = ""
    refreshToken = ""
    input.code = ""
    input.state = ""
  }
}

export function sanitizeEbayMerchantLocationOAuthCallbackError(value: string) {
  return value === "access_denied"
    ? "EBAY_MERCHANT_LOCATION_OAUTH_CONSENT_DENIED"
    : "EBAY_MERCHANT_LOCATION_OAUTH_CALLBACK_REJECTED"
}
