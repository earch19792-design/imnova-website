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
  EBAY_COMMERCIAL_ORDERS_READONLY_SCOPES,
  encryptEbayCommercialRefreshToken,
  getEbayCommercialOrdersCallbackConfiguration,
  hashEbayCommercialOAuthState,
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
  type EbayCommercialOrdersScopeProfile,
  validateEbayCommercialOAuthPublicKey,
} from "./ebay-commercial-orders-oauth-domain"
import {
  buildEbayCommercialOrdersBrowserStartUrl,
  createEbayCommercialOrdersBrowserStartTicket,
  EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS,
  verifyEbayCommercialOrdersBrowserStartTicket,
} from "./ebay-commercial-orders-oauth-browser-ceremony"
import {
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified,
  createEbaySellerOAuthReauthCookie,
  EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
  EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  EBAY_SELLER_OAUTH_REAUTH_PAGE_PATH,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  getEbaySellerOAuthReauthConfiguration,
  getEbaySellerOAuthReauthRuntimeCredentialMatch,
  hashEbaySellerOAuthReauthState,
} from "./ebay-seller-oauth-reauth-domain"
import type {
  EbaySellerOAuthReauthStateLedger,
} from "./ebay-seller-oauth-reauth-ledger"
import { verifyEbayCommercialOfficialAccount } from "./ebay-commercial-readers"
import { getEbayProductionIdentityBindingConfiguration } from "./ebay-seller-account-scope"
import {
  getEbayProRuntimeBoundary,
  SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION,
} from "./environment-boundaries"

const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
// The eBay RuName is registered to a certified Seller OS callback. Preview keeps
// its historical exact host; dedicated preprod uses its canonical boundary host
// so the host-only state cookie returns to the code-exchange boundary.
const AUTHORIZED_PREVIEW_BRANCH =
  "feature/seller-os-canonical-integration-foundation-v1"
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
  requestHost?: string | null,
) {
  const credentials = getCredentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const preview = environment.VERCEL_ENV === "preview"
  const authorizedBranch = environment.VERCEL_GIT_COMMIT_REF === AUTHORIZED_PREVIEW_BRANCH
  const runtimeBoundary = getEbayProRuntimeBoundary({
    vercelEnv: environment.VERCEL_ENV,
    vercelTargetEnv: environment.VERCEL_TARGET_ENV,
    vercelSystem: environment.VERCEL,
    vercelProjectId: environment.VERCEL_PROJECT_ID,
    vercelProjectProductionUrl: environment.VERCEL_PROJECT_PRODUCTION_URL,
    nodeEnv: environment.NODE_ENV,
    ebayProRuntime: environment.EBAY_PRO_RUNTIME,
    supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
    pathname: EBAY_SELLER_OAUTH_REAUTH_PAGE_PATH,
    method: "GET",
  })
  const dedicatedPreprod =
    runtimeBoundary.boundaryClassification ===
      SELLER_OS_DEDICATED_PREPROD_CLASSIFICATION &&
    runtimeBoundary.dedicatedPreprod.certified &&
    runtimeBoundary.blocked === false
  const sellerConfiguration = getEbaySellerOAuthReauthConfiguration({
    environment,
    requestHost,
  })
  const scopeProfile: EbayCommercialOrdersScopeProfile = dedicatedPreprod
    ? "COMMERCIAL_ORDERS_READONLY"
    : "COMMERCIAL_ORDERS_AND_BUYER_MESSAGE"
  const scopes = dedicatedPreprod
    ? [...EBAY_COMMERCIAL_ORDERS_READONLY_SCOPES]
    : [...EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPES]
  const dedicatedHost = normalizedHost(
    environment.VERCEL_PROJECT_PRODUCTION_URL ?? "",
  )
  const normalizedRequestHost = normalizedHost(requestHost ?? "")
  const callback = dedicatedPreprod
    ? {
        canonicalPath: EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
        canonicalUrl: sellerConfiguration.callbackUrl,
        legacyPath: "/api/admin/ebay/oauth/callback",
        legacyCallbackBlocked: true as const,
        deployedBranchHostStatus: dedicatedHost &&
            normalizedRequestHost === dedicatedHost
          ? "MATCH" as const
          : "MISMATCH" as const,
        secretsReturned: false as const,
      }
    : getEbayCommercialOrdersCallbackConfiguration(environment, requestHost)
  return {
    configured: Boolean(
      (dedicatedPreprod ? sellerConfiguration.ready : preview && authorizedBranch) &&
      credentials.clientId &&
      credentials.clientSecret && credentials.runame && credentials.pairComplete &&
      identity.bound
    ),
    environment: "PRODUCTION" as const,
    vercelTarget: dedicatedPreprod
      ? "DEDICATED_PREPROD" as const
      : preview ? "PREVIEW" as const : "BLOCKED" as const,
    branch: dedicatedPreprod
      ? "NOT_REQUIRED" as const
      : authorizedBranch ? "AUTHORIZED" as const : "BLOCKED" as const,
    clientId: credentials.clientId ? "PRESENT" as const : "MISSING" as const,
    clientSecret: credentials.clientSecret ? "PRESENT" as const : "MISSING" as const,
    runame: credentials.runame ? "PRESENT" as const : "MISSING" as const,
    identityBinding: identity.bound ? "READY" as const : "MISSING" as const,
    scopeProfile,
    scopes,
    callback,
    dedicatedPreprod,
    audit: getEbayCommercialOrdersAuthorizationAudit(environment),
    secretsReturned: false as const,
  }
}

function assertAuthorizationConfiguration(
  environment: NodeJS.ProcessEnv,
  requestHost?: string | null,
) {
  const configuration = getEbayCommercialOrdersAuthorizationConfiguration(
    environment,
    requestHost,
  )
  if (configuration.vercelTarget === "BLOCKED") {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_PREVIEW_ONLY")
  }
  if (configuration.vercelTarget === "PREVIEW" &&
      configuration.branch !== "AUTHORIZED") {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_BRANCH_BLOCKED")
  }
  if (!configuration.configured) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_NOT_CONFIGURED")
  }
  return {
    ...getCredentials(environment),
    scopeProfile: configuration.scopeProfile,
    scopes: configuration.scopes,
    callback: configuration.callback,
    dedicatedPreprod: configuration.dedicatedPreprod,
  }
}

function normalizedHost(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
}

function assertBrowserCeremonyBinding(
  requestHost: string,
  environment: NodeJS.ProcessEnv,
) {
  const credentials = assertAuthorizationConfiguration(environment, requestHost)
  const host = normalizedHost(requestHost)
  const deploymentIdentity = normalizedHost(environment.VERCEL_URL ?? "")
  if (!deploymentIdentity || !/^[a-z0-9.-]+$/.test(deploymentIdentity)) {
    throw new Error(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_DEPLOYMENT_UNAVAILABLE",
    )
  }
  const sellerConfiguration = getEbaySellerOAuthReauthConfiguration({
    environment,
    requestHost: host,
  })
  if (!sellerConfiguration.ready) {
    throw new Error(
      sellerConfiguration.reason ??
        "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_CONFIGURATION_INVALID",
    )
  }
  assertEbaySellerOAuthReauthRuntimeCredentialMatchCertified(
    getEbaySellerOAuthReauthRuntimeCredentialMatch(sellerConfiguration),
  )
  const callback = credentials.callback
  const sameCredentialBinding =
    credentials.clientId === sellerConfiguration.clientId &&
    credentials.clientSecret === sellerConfiguration.clientSecret &&
    credentials.runame === sellerConfiguration.runame
  const exactCallbackBinding =
    callback.deployedBranchHostStatus === "MATCH" &&
    sellerConfiguration.branchHost === host &&
    sellerConfiguration.callbackUrl === callback.canonicalUrl
  if (!sameCredentialBinding || !exactCallbackBinding) {
    throw new Error(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_BINDING_MISMATCH",
    )
  }
  return {
    credentials,
    sellerConfiguration,
    host,
    deploymentIdentity,
    callback,
    scopeProfile: credentials.scopeProfile,
    scopes: credentials.scopes,
  }
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
    stateFormatValid: state ? isValidEbayCommercialOAuthState(state) : null,
    scopes: phase === "base_with_state_and_fulfillment"
      ? "BASE_FULFILLMENT_READONLY_AND_COMMERCE_MESSAGE" as const
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
      scopeProfile: credentials.scopeProfile,
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

export async function startEbayCommercialOrdersBrowserAuthorization(
  supabase: SupabaseClient,
  input: {
    publicKeyPem: string
    actorUserId: string
    requestHost: string
  },
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binding = assertBrowserCeremonyBinding(input.requestHost, environment)
  if (!validateEbayCommercialOAuthPublicKey(input.publicKeyPem)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_PUBLIC_KEY_INVALID")
  }
  const state = createEbayCommercialOAuthState()
  const expiresAtMs = Date.now() +
    EBAY_COMMERCIAL_ORDERS_BROWSER_START_TTL_MS
  const expiresAt = new Date(expiresAtMs).toISOString()
  const handoffExpiresAt = new Date(
    expiresAtMs + EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  ).toISOString()
  const { data, error } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .insert({
      state_hash: hashEbayCommercialOAuthState(state),
      public_key_pem: input.publicKeyPem,
      status: "pending",
      expires_at: handoffExpiresAt,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_HANDOFF_FAILED")
  }
  const startTicket = createEbayCommercialOrdersBrowserStartTicket({
    state,
    handoffId: String(data.id),
    expiresAt: expiresAtMs,
    host: binding.host,
    deploymentIdentity: binding.deploymentIdentity,
    actorUserId: input.actorUserId,
    clientSecret: binding.sellerConfiguration.clientSecret,
    expectedAccountFingerprint:
      binding.sellerConfiguration.expectedAccountFingerprint,
    purpose: binding.scopeProfile,
  })
  return {
    startUrl: buildEbayCommercialOrdersBrowserStartUrl({
      host: binding.host,
      ticket: startTicket,
    }),
    handoffId: String(data.id),
    expiresAt,
    ceremony: {
      contractVersion: "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_V2" as const,
      startHost: binding.host,
      callbackHost: binding.host,
      startHostMatchesCallbackHost: true as const,
      startTicketMinted: true as const,
      startTicketUnconsumed: true as const,
      clientExchangePathReady: true as const,
      stateCookieCanBeIssued: true as const,
      transport: "SEALED_QUERY_TO_SAME_ORIGIN_CLIENT_POST" as const,
      actorBound: true as const,
      deploymentBound: true as const,
      stateCookieIssued: false as const,
      runameResolvesToExpectedCallback: true as const,
      scopeProfile: binding.scopeProfile,
      requestedScopes: binding.scopes,
      rawAuthorizationUrlReturned: false as const,
      secretsReturned: false as const,
    },
  }
}

export async function activateEbayCommercialOrdersBrowserAuthorization(
  supabase: SupabaseClient,
  input: {
    startTicket: string
    actorUserId: string
    requestHost: string
    ledger: EbaySellerOAuthReauthStateLedger
  },
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binding = assertBrowserCeremonyBinding(input.requestHost, environment)
  const now = Date.now()
  const ticket = verifyEbayCommercialOrdersBrowserStartTicket({
    ticket: input.startTicket,
    now,
    host: binding.host,
    deploymentIdentity: binding.deploymentIdentity,
    actorUserId: input.actorUserId,
    clientSecret: binding.sellerConfiguration.clientSecret,
    expectedAccountFingerprint:
      binding.sellerConfiguration.expectedAccountFingerprint,
  })
  if (ticket.purpose !== binding.scopeProfile) {
    throw new Error(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_SCOPE_PROFILE_MISMATCH",
    )
  }
  const { data: handoff, error } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .select("id,state_hash,status,expires_at")
    .eq("id", ticket.handoffId)
    .maybeSingle()
  if (error || !handoff?.id) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_BROWSER_START_STATE_INVALID")
  }
  if (handoff.status !== "pending") {
    throw new Error(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_ALREADY_CONSUMED",
    )
  }
  const handoffExpiresAt = Date.parse(String(handoff.expires_at ?? ""))
  if (!Number.isFinite(handoffExpiresAt) || handoffExpiresAt <= now) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_EXPIRED")
  }
  if (handoff.state_hash !== hashEbayCommercialOAuthState(ticket.state)) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_BROWSER_START_STATE_INVALID")
  }
  const stateHash = hashEbaySellerOAuthReauthState(ticket.state)
  const callbackExpiresAt = Math.min(
    now + EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
    handoffExpiresAt,
  )
  const stateHashPersisted = await input.ledger.createPending({
    stateHash,
    expiresAt: new Date(callbackExpiresAt).toISOString(),
    flowVersion: EBAY_SELLER_OAUTH_REAUTH_FLOW_VERSION,
  })
  if (!stateHashPersisted) {
    throw new Error(
      "EBAY_COMMERCIAL_ORDERS_BROWSER_START_TICKET_ALREADY_CONSUMED",
    )
  }
  const authorizationUrl = buildEbayCommercialOrdersConsentUrl({
    clientId: binding.credentials.clientId,
    runame: binding.credentials.runame,
    state: ticket.state,
    scopeProfile: binding.scopeProfile,
  })
  const parsedAuthorization = new URL(authorizationUrl)
  const exactScopeContract =
    parsedAuthorization.searchParams.get("scope") ===
      binding.scopes.join(" ")
  if (!exactScopeContract) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_OAUTH_SCOPE_CONTRACT_INVALID")
  }
  return {
    authorizationUrl,
    cookie: createEbaySellerOAuthReauthCookie({
      state: ticket.state,
      expiresAt: callbackExpiresAt,
      actorUserId: input.actorUserId,
      branchHost: binding.host,
      clientSecret: binding.sellerConfiguration.clientSecret,
      expectedAccountFingerprint:
        binding.sellerConfiguration.expectedAccountFingerprint,
    }),
    expiresAt: callbackExpiresAt,
    ceremony: {
      contractVersion: "EBAY_COMMERCIAL_ORDERS_BROWSER_CEREMONY_V2" as const,
      startHost: binding.host,
      callbackHost: binding.host,
      startHostMatchesCallbackHost: true as const,
      startTicketMinted: true as const,
      startTicketUnconsumed: false as const,
      clientExchangePathReady: true as const,
      stateCookieCanBeIssued: true as const,
      transport: "SEALED_QUERY_TO_SAME_ORIGIN_CLIENT_POST" as const,
      actorBound: true as const,
      deploymentBound: true as const,
      stateCookieIssued: true as const,
      stateHashPersisted: true as const,
      rawStatePersisted: false as const,
      runameResolvesToExpectedCallback: true as const,
      scopeProfile: binding.scopeProfile,
      requestedScopes: binding.scopes,
      exactScopeContract: true as const,
      secretsReturned: false as const,
    },
  }
}

export async function hasPendingEbayCommercialOrdersAuthorization(
  supabase: SupabaseClient,
  state: string,
) {
  if (!isValidEbayCommercialOAuthState(state)) return false
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .select("id")
    .eq("state_hash", hashEbayCommercialOAuthState(state))
    .eq("status", "pending")
    .gt("expires_at", now)
    .maybeSingle()
  if (error) {
    throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_STATE_READ_FAILED")
  }
  return Boolean(data?.id)
}

export async function failPendingEbayCommercialOrdersAuthorization(
  supabase: SupabaseClient,
  state: string,
  errorCode: string,
) {
  if (!isValidEbayCommercialOAuthState(state) ||
      !/^[A-Z0-9_]{3,160}$/.test(errorCode)) return false
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("ebay_commercial_oauth_handoffs")
    .update({ status: "failed", error_code: errorCode, updated_at: now })
    .eq("state_hash", hashEbayCommercialOAuthState(state))
    .eq("status", "pending")
    .select("id")
    .maybeSingle()
  return !error && Boolean(data?.id)
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
  input: { state: string; code: string; requestHost?: string | null },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = assertAuthorizationConfiguration(
    environment,
    input.requestHost,
  )
  if (
    !isValidEbayCommercialOAuthState(input.state) ||
    !isValidEbayCommercialAuthorizationCode(input.code)
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
        scope: credentials.scopes.join(" "),
      }),
      fetchImpl,
    })
    accessToken = text(scopeProof.access_token)
    if (!accessToken) throw authorizationError("MALFORMED_REQUEST")

    await verifyEbayCommercialOfficialAccount(accessToken, fetchImpl)
    if (credentials.scopeProfile === "COMMERCIAL_ORDERS_READONLY") {
      const consumedAt = new Date().toISOString()
      const { error: consumedError } = await supabase
        .from("ebay_commercial_oauth_handoffs")
        .update({
          encrypted_refresh_token: null,
          status: "consumed",
          identity_match: true,
          fulfillment_scope_confirmed: true,
          error_code: null,
          ready_at: consumedAt,
          consumed_at: consumedAt,
          updated_at: consumedAt,
        })
        .eq("id", handoffId)
        .eq("status", "claimed")
      if (consumedError) {
        throw new Error("EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_HANDOFF_FAILED")
      }
      return {
        status: "CONSUMED" as const,
        handoffMode: "ONE_TIME_OPERATOR" as const,
        refreshToken,
        identityMatch: true as const,
        fulfillmentScopeConfirmed: true as const,
        commerceMessageScopeConfirmed: false as const,
        tokenPersisted: false as const,
        secretsReturned: false as const,
      }
    }
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
      handoffMode: "ENCRYPTED_OPERATOR" as const,
      identityMatch: true as const,
      fulfillmentScopeConfirmed: true as const,
      commerceMessageScopeConfirmed: true as const,
      tokenPersisted: true as const,
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
