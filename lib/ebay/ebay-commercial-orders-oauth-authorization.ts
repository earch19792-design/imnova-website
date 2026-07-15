import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  classifyEbayCommercialOAuthFailure,
  type EbayCommercialOAuthCategory,
} from "./ebay-commercial-oauth-domain"
import {
  buildEbayCommercialOrdersConsentUrl,
  createEbayCommercialOAuthState,
  EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES,
  encryptEbayCommercialRefreshToken,
  hashEbayCommercialOAuthState,
  validateEbayCommercialOAuthPublicKey,
} from "./ebay-commercial-orders-oauth-domain"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import { getEbayProductionIdentityBindingConfiguration } from "./ebay-seller-account-scope"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const AUTHORIZED_PREVIEW_BRANCH = "feature/centralize-ebay-mobile-command-center"
const HANDOFF_TTL_MS = 30 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

type OAuthCredentials = {
  clientId: string
  clientSecret: string
  runame: string
  pairComplete: boolean
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
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_FAILED"
}

function authorizationError(category: EbayCommercialOAuthCategory) {
  return new Error(`EBAY_COMMERCIAL_ORDERS_OAUTH_${category}`)
}

function getCredentials(environment: NodeJS.ProcessEnv): OAuthCredentials {
  const dedicatedClientId = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const genericClientId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const genericClientSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const partialDedicatedPair = Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret)
  const useDedicatedPair = Boolean(dedicatedClientId && dedicatedClientSecret)
  const runame = environment.EBAY_COMMERCIAL_ORDERS_RUNAME?.trim()
    || environment.EBAY_RUNAME?.trim()
    || environment.EBAY_RU_NAME?.trim()
    || environment.EBAY_RuName?.trim()
    || ""

  return {
    clientId: useDedicatedPair ? dedicatedClientId : genericClientId,
    clientSecret: useDedicatedPair ? dedicatedClientSecret : genericClientSecret,
    runame,
    pairComplete: !partialDedicatedPair,
  }
}

export function getEbayCommercialOrdersAuthorizationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = getCredentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration()
  const preview = environment.VERCEL_ENV === "preview"
  const authorizedBranch = environment.VERCEL_GIT_COMMIT_REF === AUTHORIZED_PREVIEW_BRANCH
  return {
    configured: Boolean(
      preview && authorizedBranch && credentials.clientId &&
      credentials.clientSecret && credentials.runame && credentials.pairComplete &&
      identity.bound
    ),
    environment: "PRODUCTION" as const,
    vercelTarget: preview ? "PREVIEW" as const : "BLOCKED" as const,
    branch: authorizedBranch ? "AUTHORIZED" as const : "BLOCKED" as const,
    clientId: credentials.clientId ? "PRESENT" as const : "MISSING" as const,
    clientSecret: credentials.clientSecret ? "PRESENT" as const : "MISSING" as const,
    runame: credentials.runame ? "PRESENT" as const : "MISSING" as const,
    identityBinding: identity.bound ? "READY" as const : "MISSING" as const,
    scopes: [...EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES],
    secretsReturned: false as const,
  }
}

function assertAuthorizationConfiguration(environment: NodeJS.ProcessEnv) {
  const configuration = getEbayCommercialOrdersAuthorizationConfiguration(environment)
  if (configuration.vercelTarget !== "PREVIEW") {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_PREVIEW_ONLY")
  }
  if (configuration.branch !== "AUTHORIZED") {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_BRANCH_BLOCKED")
  }
  if (!configuration.configured) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_NOT_CONFIGURED")
  }
  return getCredentials(environment)
}

export async function startEbayCommercialOrdersAuthorization(
  supabase: SupabaseClient,
  publicKeyPem: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = assertAuthorizationConfiguration(environment)
  if (!validateEbayCommercialOAuthPublicKey(publicKeyPem)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_PUBLIC_KEY_INVALID")
  }

  const state = createEbayCommercialOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .insert({
      state_hash: hashEbayCommercialOAuthState(state),
      public_key_pem: publicKeyPem,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_HANDOFF_FAILED")
  }

  return {
    authorizationUrl: buildEbayCommercialOrdersConsentUrl({
      clientId: credentials.clientId,
      runame: credentials.runame,
      state,
    }),
    handoffId: String(data.id),
    expiresAt,
    configuration: getEbayCommercialOrdersAuthorizationConfiguration(environment),
    safety: {
      serverSideExchange: true,
      stateStoredAsHashOnly: true,
      refreshTokenStoredAsCiphertextOnly: true,
      ebayWriteUsed: false,
      getOrdersUsed: false,
      secretsReturned: false,
    },
  }
}

async function tokenExchange(input: {
  credentials: OAuthCredentials
  body: URLSearchParams
  fetchImpl: FetchLike
}) {
  const basic = Buffer.from(
    `${input.credentials.clientId}:${input.credentials.clientSecret}`,
    "utf8",
  ).toString("base64")
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
    throw authorizationError("TOKEN_ENDPOINT_UNAVAILABLE")
  }
  let payload: JsonRecord = {}
  try {
    payload = record(await response.json())
  } catch {
    payload = {}
  }
  if (!response.ok) {
    throw authorizationError(
      classifyEbayCommercialOAuthFailure(response.status, payload),
    )
  }
  return payload
}

async function failHandoff(
  supabase: SupabaseClient,
  handoffId: string,
  error: unknown,
) {
  await supabase
    .from("ebay_commercial_oauth_handoffs")
    .update({
      status: "failed",
      error_code: safeCode(error),
      updated_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .eq("status", "claimed")
}

export async function completeEbayCommercialOrdersAuthorization(
  supabase: SupabaseClient,
  input: { state: string; code: string },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = assertAuthorizationConfiguration(environment)
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(input.state) ||
    !input.code || input.code.length > 2_048
  ) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CALLBACK_INVALID")
  }

  const now = new Date().toISOString()
  const { data: handoff, error: claimError } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("state_hash", hashEbayCommercialOAuthState(input.state))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,public_key_pem")
    .maybeSingle()
  if (claimError || !handoff?.id || !handoff.public_key_pem) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_STATE_INVALID")
  }

  const handoffId = String(handoff.id)
  let refreshToken = ""
  let accessToken = ""
  try {
    const authorizationPayload = await tokenExchange({
      credentials,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: credentials.runame,
      }),
      fetchImpl,
    })
    refreshToken = text(authorizationPayload.refresh_token)
    if (!refreshToken) throw authorizationError("MALFORMED_REQUEST")

    const scopeProof = await tokenExchange({
      credentials,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES.join(" "),
      }),
      fetchImpl,
    })
    accessToken = text(scopeProof.access_token)
    if (!accessToken) throw authorizationError("MALFORMED_REQUEST")

    await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
    const encryptedRefreshToken = encryptEbayCommercialRefreshToken(
      refreshToken,
      String(handoff.public_key_pem),
    )
    const readyAt = new Date().toISOString()
    const { error: readyError } = await supabase
      .from("ebay_commercial_oauth_handoffs")
      .update({
        encrypted_refresh_token: encryptedRefreshToken,
        status: "ready",
        identity_match: true,
        fulfillment_scope_confirmed: true,
        error_code: null,
        ready_at: readyAt,
        updated_at: readyAt,
      })
      .eq("id", handoffId)
      .eq("status", "claimed")
    if (readyError) {
      throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_HANDOFF_FAILED")
    }
    return {
      status: "READY" as const,
      identityMatch: true as const,
      fulfillmentScopeConfirmed: true as const,
      secretsReturned: false as const,
    }
  } catch (error) {
    await failHandoff(supabase, handoffId, error)
    throw new Error(safeCode(error))
  } finally {
    refreshToken = ""
    accessToken = ""
    input.code = ""
    input.state = ""
  }
}

export function sanitizeEbayCommercialAuthorizationCallbackError(value: string) {
  return value === "access_denied"
    ? "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CONSENT_DENIED"
    : "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_CALLBACK_REJECTED"
}
