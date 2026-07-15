import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  classifyEbayCommercialOAuthFailure,
  type EbayCommercialOAuthCategory,
} from "./ebay-commercial-oauth-domain"
import {
  buildEbayCommercialOrdersConsentUrl,
  buildEbayCommercialOrdersDiagnosticConsentUrl,
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

export const EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASES = [
  "base_only",
  "base_with_state",
  "base_with_state_and_fulfillment",
] as const

export type EbayCommercialOrdersDiagnosticPhase =
  typeof EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASES[number]

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

type OAuthCredentials = {
  clientId: string
  clientSecret: string
  runame: string
  pairComplete: boolean
  clientSource: "EBAY_COMMERCIAL_ORDERS_CLIENT_ID" | "EBAY_CLIENT_ID"
  clientSecretSource:
    | "EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET"
    | "EBAY_CLIENT_SECRET"
  runameSource:
    | "EBAY_COMMERCIAL_ORDERS_RUNAME"
    | "EBAY_RUNAME"
    | "EBAY_RU_NAME"
    | "EBAY_RuName"
    | "NONE"
}

const CLIENT_ID_VARIABLES = [
  "EBAY_COMMERCIAL_ORDERS_CLIENT_ID",
  "EBAY_CLIENT_ID",
] as const
const CLIENT_SECRET_VARIABLES = [
  "EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET",
  "EBAY_CLIENT_SECRET",
] as const
const RUNAME_VARIABLES = [
  "EBAY_COMMERCIAL_ORDERS_RUNAME",
  "EBAY_RUNAME",
  "EBAY_RU_NAME",
  "EBAY_RuName",
] as const
const AUDITED_OAUTH_VARIABLES = [
  ...CLIENT_ID_VARIABLES,
  ...CLIENT_SECRET_VARIABLES,
  ...RUNAME_VARIABLES,
] as const
const OAUTH_INVISIBLE_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f\u00a0\u200b-\u200f\u2028-\u202f\u2060\ufeff]/u

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

function fingerprint(value: string) {
  return value
    ? `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16)}`
    : null
}

function variableState(environment: NodeJS.ProcessEnv, name: string) {
  if (!(name in environment)) return "MISSING" as const
  return environment[name]?.trim() ? "PRESENT" as const : "EMPTY" as const
}

function presentVariables(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
) {
  return names.filter((name) => Boolean(environment[name]?.trim()))
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
  const runameSource = RUNAME_VARIABLES.find(
    (name) => Boolean(environment[name]?.trim()),
  ) ?? "NONE"
  const runame = runameSource === "NONE"
    ? ""
    : environment[runameSource]?.trim() ?? ""

  return {
    clientId: useDedicatedPair ? dedicatedClientId : genericClientId,
    clientSecret: useDedicatedPair ? dedicatedClientSecret : genericClientSecret,
    runame,
    pairComplete: !partialDedicatedPair,
    clientSource: useDedicatedPair
      ? "EBAY_COMMERCIAL_ORDERS_CLIENT_ID"
      : "EBAY_CLIENT_ID",
    clientSecretSource: useDedicatedPair
      ? "EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET"
      : "EBAY_CLIENT_SECRET",
    runameSource,
  }
}

export function getEbayCommercialOrdersAuthorizationAudit(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = getCredentials(environment)
  const dedicatedClientId = environment.EBAY_COMMERCIAL_ORDERS_CLIENT_ID?.trim() ?? ""
  const dedicatedClientSecret =
    environment.EBAY_COMMERCIAL_ORDERS_CLIENT_SECRET?.trim() ?? ""
  const variableStates = Object.fromEntries(
    AUDITED_OAUTH_VARIABLES.map((name) => [
      name,
      variableState(environment, name),
    ]),
  )
  const leadingOrTrailingWhitespace = AUDITED_OAUTH_VARIABLES.filter((name) => {
    const raw = environment[name]
    return typeof raw === "string" && raw !== raw.trim()
  })
  const controlOrInvisibleCharacters = AUDITED_OAUTH_VARIABLES.filter((name) =>
    OAUTH_INVISIBLE_CHARACTER_PATTERN.test(environment[name] ?? "")
  )
  const percentEncodedValues = AUDITED_OAUTH_VARIABLES.filter((name) =>
    /%[0-9a-f]{2}/i.test(environment[name]?.trim() ?? "")
  )

  return {
    effectiveClientIdFingerprint: fingerprint(credentials.clientId),
    effectiveRuNameFingerprint: fingerprint(credentials.runame),
    dedicatedClientPairPresent: Boolean(
      dedicatedClientId && dedicatedClientSecret,
    ),
    dedicatedClientPairPartial:
      Boolean(dedicatedClientId) !== Boolean(dedicatedClientSecret),
    clientSource: credentials.clientSource,
    clientSecretSource: credentials.clientSecretSource,
    runameSource: credentials.runameSource,
    variableStates,
    clientIdVariablesPresent: presentVariables(
      environment,
      CLIENT_ID_VARIABLES,
    ),
    clientSecretVariablesPresent: presentVariables(
      environment,
      CLIENT_SECRET_VARIABLES,
    ),
    runameVariablesPresent: presentVariables(environment, RUNAME_VARIABLES),
    leadingOrTrailingWhitespace,
    controlOrInvisibleCharacters,
    percentEncodedValues,
    secretsReturned: false as const,
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
    audit: getEbayCommercialOrdersAuthorizationAudit(environment),
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

export async function diagnoseEbayCommercialOrdersConsentRequest(
  phase: EbayCommercialOrdersDiagnosticPhase,
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASES.includes(phase)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_PHASE_INVALID")
  }
  const credentials = assertAuthorizationConfiguration(environment)
  const state = phase === "base_only" ? undefined : createEbayCommercialOAuthState()
  const authorizationUrl = buildEbayCommercialOrdersDiagnosticConsentUrl({
    clientId: credentials.clientId,
    runame: credentials.runame,
    phase,
    state,
  })
  if (
    authorizationUrl.includes("prompt=") ||
    authorizationUrl.includes("+") ||
    authorizationUrl.includes("%252F")
  ) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_ENCODING_INVALID")
  }

  let response: Response
  try {
    response = await fetchImpl(authorizationUrl, {
      redirect: "follow",
      cache: "no-store",
      headers: { Accept: "text/html,application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("EBAY_COMMERCIAL_ORDERS_DIAGNOSTIC_ENDPOINT_UNAVAILABLE")
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  let invalidRequest = false
  if (contentType.includes("json")) {
    try {
      invalidRequest = text(record(await response.json()).error_id).toLowerCase() ===
        "invalid_request"
    } catch {
      invalidRequest = false
    }
  }
  return {
    phase,
    result: invalidRequest
      ? "INVALID_REQUEST" as const
      : response.ok
        ? "ACCEPTED" as const
        : "UNKNOWN_REJECTION" as const,
    stateIncluded: Boolean(state),
    stateFormatValid: state ? /^[A-Za-z0-9_-]{43}$/.test(state) : null,
    scopes: phase === "base_with_state_and_fulfillment"
      ? "BASE_AND_FULFILLMENT_READONLY" as const
      : "BASE_ONLY" as const,
    parameterNames: [
      "client_id",
      "response_type",
      "redirect_uri",
      "scope",
      ...(state ? ["state"] : []),
    ],
    promptIncluded: false as const,
    percent20ScopeSeparator: phase === "base_with_state_and_fulfillment",
    doubleEncodingDetected: false as const,
    plusSeparatorDetected: false as const,
    redirectUriUsesExactRuname: true as const,
    configurationAudit:
      getEbayCommercialOrdersAuthorizationAudit(environment),
    handoffCreated: false as const,
    secretsReturned: false as const,
    authorizationUrlReturned: false as const,
    ebayWriteUsed: false as const,
  }
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
