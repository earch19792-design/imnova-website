import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  createEbayCommercialOAuthState,
  hashEbayCommercialOAuthState,
  isValidEbayCommercialAuthorizationCode,
  isValidEbayCommercialOAuthState,
} from "./ebay-commercial-orders-oauth-domain"
import { preflightEbayAccountPoliciesReadonly } from "./ebay-account-policy-readonly-gateway"
import { EBAY_READONLY_SCOPES } from "./ebay-seller-readonly-oauth-data-audit"
import {
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

const AUTHORIZATION_ENDPOINT = "https://auth.ebay.com/oauth2/authorize"
const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const AUTHORIZED_PREVIEW_BRANCH =
  "feature/centralize-ebay-mobile-command-center"
const HANDOFF_TTL_MS = 30 * 60 * 1_000
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
    : "EBAY_ACCOUNT_POLICY_AUTHORIZATION_FAILED"
}

function credentials(
  environment: NodeJS.ProcessEnv = process.env,
): OAuthCredentials {
  const runameSource = RUNAME_VARIABLES.find(
    (name) => Boolean(environment[name]?.trim()),
  ) ?? "NONE"
  return {
    clientId: environment.EBAY_CLIENT_ID?.trim() ?? "",
    clientSecret: environment.EBAY_CLIENT_SECRET?.trim() ?? "",
    runame: runameSource === "NONE"
      ? ""
      : environment[runameSource]?.trim() ?? "",
    runameSource,
  }
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

async function resolveAuthorizationCredentials(
  environment: NodeJS.ProcessEnv,
  fetchImpl: FetchLike,
) {
  const candidates = credentialCandidates(environment)
  for (const candidate of candidates) {
    const parameters = [
      ["client_id", candidate.clientId],
      ["response_type", "code"],
      ["redirect_uri", candidate.runame],
      ["scope", EBAY_READONLY_SCOPES[0]],
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
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
      const body = contentType.includes("json")
        ? record(await response.json().catch(() => ({})))
        : { html: (await response.text()).slice(0, 20_000) }
      const invalidRequest = text(body.error_id).toLowerCase() === "invalid_request"
        || text(body.error).toLowerCase() === "invalid_request"
        || text(body.html).includes("invalid_request")
        || new URL(response.url).pathname === "/oauth2/errorOauth"
      if (!invalidRequest) return candidate
    } catch {
      // Try the next configured RuName without exposing its value.
    }
  }
  throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_RUNAME_REJECTED")
}

export function getEbayAccountPolicyReadonlyAuthorizationConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const oauth = credentials(environment)
  const identity = getEbayProductionIdentityBindingConfiguration(environment)
  const accountScope = getEbaySellerAccountScopeConfiguration()
  const preview = environment.VERCEL_ENV === "preview"
  const branchAllowed =
    environment.VERCEL_GIT_COMMIT_REF === AUTHORIZED_PREVIEW_BRANCH
  return {
    configured: Boolean(
      preview && branchAllowed && oauth.clientId && oauth.clientSecret
      && oauth.runame && identity.bound && accountScope.accountKey,
    ),
    environment: "PRODUCTION" as const,
    vercelTarget: preview ? "PREVIEW" as const : "BLOCKED" as const,
    branch: branchAllowed ? "AUTHORIZED" as const : "BLOCKED" as const,
    clientId: oauth.clientId ? "PRESENT" as const : "MISSING" as const,
    clientSecret: oauth.clientSecret ? "PRESENT" as const : "MISSING" as const,
    runame: oauth.runame ? "PRESENT" as const : "MISSING" as const,
    runameSource: oauth.runameSource,
    identityBinding: identity.bound ? "READY" as const : "MISSING" as const,
    accountScope: accountScope.accountKey ? "READY" as const : "MISSING" as const,
    scopes: [...EBAY_READONLY_SCOPES],
    secretsReturned: false as const,
  }
}

function assertConfiguration(environment: NodeJS.ProcessEnv) {
  const configuration =
    getEbayAccountPolicyReadonlyAuthorizationConfiguration(environment)
  if (configuration.vercelTarget !== "PREVIEW") {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_PREVIEW_ONLY")
  }
  if (configuration.branch !== "AUTHORIZED") {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_BRANCH_BLOCKED")
  }
  if (!configuration.configured) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_NOT_CONFIGURED")
  }
  return credentials(environment)
}

function authorizationUrl(input: {
  clientId: string
  runame: string
  state: string
}) {
  if (
    !input.clientId || !input.runame
    || !isValidEbayCommercialOAuthState(input.state)
  ) throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_START_INVALID")
  const parameters = [
    ["client_id", input.clientId],
    ["response_type", "code"],
    ["redirect_uri", input.runame],
    ["scope", EBAY_READONLY_SCOPES.join(" ")],
    ["state", input.state],
  ]
  return `${AUTHORIZATION_ENDPOINT}?${parameters.map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  ).join("&")}`
}

export async function startEbayAccountPolicyReadonlyAuthorization(
  supabase: SupabaseClient,
  input: { actorUserId: string; accountKey: string },
  environment: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
) {
  assertConfiguration(environment)
  const oauth = await resolveAuthorizationCredentials(environment, fetchImpl)
  const accountScope = getEbaySellerAccountScopeConfiguration()
  if (!accountScope.accountKey || accountScope.accountKey !== input.accountKey) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_ACCOUNT_SCOPE_INVALID")
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.actorUserId)) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_ACTOR_INVALID")
  }
  const state = createEbayCommercialOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("ebay_account_policy_oauth_handoffs")
    .insert({
      state_hash: hashEbayCommercialOAuthState(state),
      account_key: input.accountKey,
      actor_user_id: input.actorUserId,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_HANDOFF_FAILED")
  }
  return {
    authorizationUrl: authorizationUrl({
      clientId: oauth.clientId,
      runame: oauth.runame,
      state,
    }),
    handoffId: String(data.id),
    expiresAt,
    configuration:
      getEbayAccountPolicyReadonlyAuthorizationConfiguration(environment),
    safety: {
      serverSideExchange: true,
      stateStoredAsHashOnly: true,
      refreshTokenStoredInVaultOnly: true,
      ebayWriteUsed: false,
      secretsReturned: false,
    },
  }
}

export async function hasPendingEbayAccountPolicyAuthorization(
  supabase: SupabaseClient,
  state: string,
) {
  if (!isValidEbayCommercialOAuthState(state)) return false
  const { data, error } = await supabase
    .from("ebay_account_policy_oauth_handoffs")
    .select("id")
    .eq("state_hash", hashEbayCommercialOAuthState(state))
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_STATE_LOOKUP_FAILED")
  }
  return Boolean(data?.id)
}

async function exchangeToken(input: {
  credentials: OAuthCredentials
  body: URLSearchParams
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
      body: input.body,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_TOKEN_ENDPOINT_UNAVAILABLE")
  }
  const payload = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    const oauthError = text(payload.error).toLowerCase()
    throw new Error(oauthError === "invalid_scope"
      ? "EBAY_ACCOUNT_POLICY_AUTHORIZATION_SCOPE_REJECTED"
      : oauthError === "invalid_grant"
        ? "EBAY_ACCOUNT_POLICY_AUTHORIZATION_GRANT_REJECTED"
        : oauthError === "invalid_client"
          ? "EBAY_ACCOUNT_POLICY_AUTHORIZATION_CLIENT_REJECTED"
          : "EBAY_ACCOUNT_POLICY_AUTHORIZATION_TOKEN_REJECTED")
  }
  return payload
}

async function failHandoff(
  supabase: SupabaseClient,
  handoffId: string,
  error: unknown,
) {
  await supabase
    .from("ebay_account_policy_oauth_handoffs")
    .update({
      status: "failed",
      error_code: safeCode(error),
      updated_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .eq("status", "claimed")
}

export async function completeEbayAccountPolicyAuthorization(
  supabase: SupabaseClient,
  input: { state: string; code: string },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  assertConfiguration(environment)
  const oauth = await resolveAuthorizationCredentials(environment, fetchImpl)
  if (
    !isValidEbayCommercialOAuthState(input.state)
    || !isValidEbayCommercialAuthorizationCode(input.code)
  ) throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_CALLBACK_INVALID")

  const now = new Date().toISOString()
  const { data: handoff, error: claimError } = await supabase
    .from("ebay_account_policy_oauth_handoffs")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("state_hash", hashEbayCommercialOAuthState(input.state))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,account_key,actor_user_id")
    .maybeSingle()
  if (claimError || !handoff?.id || !handoff.account_key) {
    throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_STATE_INVALID")
  }

  const handoffId = String(handoff.id)
  let refreshToken = ""
  try {
    const authorization = await exchangeToken({
      credentials: oauth,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: oauth.runame,
      }),
      fetchImpl,
    })
    refreshToken = text(authorization.refresh_token)
    if (!refreshToken) {
      throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_REFRESH_TOKEN_MISSING")
    }
    const preflight = await preflightEbayAccountPoliciesReadonly(
      {},
      fetchImpl,
      refreshToken,
    )
    if (
      preflight.identity.status !== "BOUND"
      || !preflight.privilege.usable
    ) throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_PREFLIGHT_REJECTED")

    const { data: stored, error: storeError } = await supabase.rpc(
      "store_ebay_account_policy_readonly_refresh_token_v1",
      {
        p_account_key: String(handoff.account_key),
        p_actor: String(handoff.actor_user_id),
        p_identity_fingerprint: preflight.identity.accountFingerprint,
        p_refresh_token: refreshToken,
        p_now: new Date().toISOString(),
      },
    )
    if (storeError || stored !== true) {
      throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_VAULT_STORE_FAILED")
    }
    const readyAt = new Date().toISOString()
    const { error: readyError } = await supabase
      .from("ebay_account_policy_oauth_handoffs")
      .update({
        status: "ready",
        identity_match: true,
        readonly_scopes_confirmed: true,
        error_code: null,
        ready_at: readyAt,
        updated_at: readyAt,
      })
      .eq("id", handoffId)
      .eq("status", "claimed")
    if (readyError) {
      throw new Error("EBAY_ACCOUNT_POLICY_AUTHORIZATION_HANDOFF_FAILED")
    }
    return {
      status: "READY" as const,
      identityMatch: true as const,
      readonlyScopesConfirmed: true as const,
      secretsReturned: false as const,
    }
  } catch (error) {
    await failHandoff(supabase, handoffId, error)
    throw new Error(safeCode(error))
  } finally {
    refreshToken = ""
    input.code = ""
    input.state = ""
  }
}

export function sanitizeEbayAccountPolicyReadonlyAuthorizationCallbackError(
  value: string,
) {
  return value === "access_denied"
    ? "EBAY_ACCOUNT_POLICY_AUTHORIZATION_CONSENT_DENIED"
    : "EBAY_ACCOUNT_POLICY_AUTHORIZATION_CALLBACK_REJECTED"
}
