import "server-only"

import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildEbayPublicationConsentUrl,
  createEbayPublicationOAuthState,
  EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION,
  EBAY_PUBLICATION_OAUTH_CALLBACK_PATH,
  EBAY_PUBLICATION_OAUTH_SCOPES,
  encryptEbayPublicationCredentialBundle,
  hashEbayPublicationOAuthState,
  isValidEbayPublicationAuthorizationCode,
  isValidEbayPublicationOAuthState,
  publicationIdentityConfirmed,
  publicationScopesConfirmed,
  validateEbayPublicationOAuthPublicKey,
} from "./ebay-publication-oauth-domain"
import {
  ebayProductionAccountFingerprint,
  getEbayProductionIdentityBindingConfiguration,
  getEbaySellerAccountScopeConfiguration,
} from "./ebay-seller-account-scope"

const AUTHORIZED_PREVIEW_BRANCH =
  "feature/centralize-ebay-mobile-command-center"
const TOKEN_ENDPOINT = "https://api.ebay.com/identity/v1/oauth2/token"
const IDENTITY_ENDPOINT = "https://apiz.ebay.com/commerce/identity/v1/user/"
const HANDOFF_TTL_MS = 30 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 12_000

type FetchLike = typeof fetch
type JsonRecord = Record<string, unknown>

type OAuthCredentials = {
  clientId: string
  clientSecret: string
  runame: string
  clientSource:
    | "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID"
    | "EBAY_CLIENT_ID"
  runameSource:
    | "EBAY_PUBLICATION_RUNAME"
    | "EBAY_COMMERCIAL_ORDERS_RUNAME"
    | "EBAY_RUNAME"
    | "EBAY_RU_NAME"
    | "EBAY_RuName"
    | "NONE"
  pairComplete: boolean
}

const RUNAME_VARIABLES = [
  "EBAY_PUBLICATION_RUNAME",
  "EBAY_COMMERCIAL_ORDERS_RUNAME",
  "EBAY_RUNAME",
  "EBAY_RU_NAME",
  "EBAY_RuName",
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
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_PUBLICATION_OAUTH_FAILED"
}

function credentialFingerprint(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
}) {
  return createHash("sha256").update([
    input.clientId,
    input.clientSecret,
    input.refreshToken,
  ].join("\u0000"), "utf8").digest("hex")
}

function oauthCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): OAuthCredentials {
  const dedicatedId =
    environment.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID?.trim() ?? ""
  const dedicatedSecret =
    environment.EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_SECRET?.trim() ?? ""
  const genericId = environment.EBAY_CLIENT_ID?.trim() ?? ""
  const genericSecret = environment.EBAY_CLIENT_SECRET?.trim() ?? ""
  const dedicatedPartial = Boolean(dedicatedId) !== Boolean(dedicatedSecret)
  const useDedicated = Boolean(dedicatedId && dedicatedSecret)
  const runameSource = RUNAME_VARIABLES.find(
    (name) => Boolean(environment[name]?.trim()),
  ) ?? "NONE"

  return {
    clientId: useDedicated ? dedicatedId : genericId,
    clientSecret: useDedicated ? dedicatedSecret : genericSecret,
    runame: runameSource === "NONE"
      ? ""
      : environment[runameSource]?.trim() ?? "",
    clientSource: useDedicated
      ? "EBAY_DRAFT_ONLY_PRODUCTION_CLIENT_ID"
      : "EBAY_CLIENT_ID",
    runameSource,
    pairComplete: !dedicatedPartial,
  }
}

export function getEbayPublicationOAuthConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = oauthCredentials(environment)
  const accountScope = getEbaySellerAccountScopeConfiguration(environment)
  const preview = environment.VERCEL_ENV === "preview"
  const branchMatch =
    environment.VERCEL_GIT_COMMIT_REF === AUTHORIZED_PREVIEW_BRANCH
  const writeGatesAllOff =
    environment.EBAY_DRAFT_ONLY_WRITES_ENABLED !== "true" &&
    environment.EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED !== "true"
  return {
    configured: Boolean(
      preview && branchMatch && credentials.clientId &&
      credentials.clientSecret && credentials.runame &&
      credentials.pairComplete && accountScope.configured &&
      writeGatesAllOff
    ),
    preview,
    branchMatch,
    writeGatesAllOff,
    clientPair: credentials.clientId && credentials.clientSecret
      ? "PRESENT" as const
      : "MISSING" as const,
    clientSource: credentials.clientSource,
    runame: credentials.runame ? "PRESENT" as const : "MISSING" as const,
    runameSource: credentials.runameSource,
    identityBound: accountScope.identity.bound,
    accountScopeReady: accountScope.configured,
    callbackPath: EBAY_PUBLICATION_OAUTH_CALLBACK_PATH,
    scopes: [...EBAY_PUBLICATION_OAUTH_SCOPES],
    ebayWrites: 0 as const,
    secretsReturned: false as const,
  }
}

function assertAuthorizationReady(environment: NodeJS.ProcessEnv) {
  const configuration = getEbayPublicationOAuthConfiguration(environment)
  if (!configuration.preview) {
    throw new Error("EBAY_PUBLICATION_OAUTH_PREVIEW_ONLY")
  }
  if (!configuration.branchMatch) {
    throw new Error("EBAY_PUBLICATION_OAUTH_BRANCH_BLOCKED")
  }
  if (!configuration.writeGatesAllOff) {
    throw new Error("EBAY_PUBLICATION_OAUTH_WRITE_GATES_MUST_REMAIN_OFF")
  }
  if (!configuration.configured) {
    throw new Error("EBAY_PUBLICATION_OAUTH_NOT_CONFIGURED")
  }
  return oauthCredentials(environment)
}

export async function startEbayPublicationOAuth(
  supabase: SupabaseClient,
  input: { publicKeyPem: string; actorUserId?: string | null },
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = assertAuthorizationReady(environment)
  if (!validateEbayPublicationOAuthPublicKey(input.publicKeyPem)) {
    throw new Error("EBAY_PUBLICATION_OAUTH_PUBLIC_KEY_INVALID")
  }
  const accountScope = getEbaySellerAccountScopeConfiguration(environment)
  if (!accountScope.accountKey || !accountScope.identity.expectedAccountFingerprint) {
    throw new Error("EBAY_PUBLICATION_OAUTH_IDENTITY_UNBOUND")
  }
  const state = createEbayPublicationOAuthState()
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString()
  const { data, error } = await supabase
    .from("ebay_publication_oauth_handoffs")
    .insert({
      state_hash: hashEbayPublicationOAuthState(state),
      public_key_pem: input.publicKeyPem,
      status: "pending",
      account_key: accountScope.accountKey,
      expected_identity_fingerprint:
        accountScope.identity.expectedAccountFingerprint,
      requested_by: input.actorUserId ?? null,
      expires_at: expiresAt,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error("EBAY_PUBLICATION_OAUTH_HANDOFF_FAILED")
  }
  return {
    authorizationUrl: buildEbayPublicationConsentUrl({
      clientId: credentials.clientId,
      runame: credentials.runame,
      state,
    }),
    handoffId: String(data.id),
    expiresAt,
    configuration: getEbayPublicationOAuthConfiguration(environment),
    safety: {
      stateStoredAsHashOnly: true,
      serverSideExchange: true,
      credentialBundleEncryptedForOperatorOnly: true,
      writeGatesChanged: false,
      ebayWrites: 0,
      secretsReturned: false,
    },
  }
}

export async function hasPendingEbayPublicationOAuth(
  supabase: SupabaseClient,
  state: string,
) {
  if (!isValidEbayPublicationOAuthState(state)) return false
  const { data } = await supabase
    .from("ebay_publication_oauth_handoffs")
    .select("id")
    .eq("state_hash", hashEbayPublicationOAuthState(state))
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  return Boolean(data?.id)
}

export async function failPendingEbayPublicationOAuth(
  supabase: SupabaseClient,
  state: string,
  errorCode: string,
) {
  if (!isValidEbayPublicationOAuthState(state)) return false
  const { data } = await supabase
    .from("ebay_publication_oauth_handoffs")
    .update({
      status: "failed",
      error_code: errorCode,
      encrypted_credential_bundle: null,
      updated_at: new Date().toISOString(),
    })
    .eq("state_hash", hashEbayPublicationOAuthState(state))
    .eq("status", "pending")
    .select("id")
    .maybeSingle()
  return Boolean(data?.id)
}

async function tokenExchange(input: {
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
    throw new Error("EBAY_PUBLICATION_OAUTH_TOKEN_ENDPOINT_UNAVAILABLE")
  }
  const payload = record(await response.json().catch(() => ({})))
  if (!response.ok) {
    throw new Error(`EBAY_PUBLICATION_OAUTH_TOKEN_${response.status}`)
  }
  const scopeConfirmed = publicationScopesConfirmed(payload.scope)
  if (scopeConfirmed === false) {
    throw new Error("EBAY_PUBLICATION_OAUTH_SCOPE_MISSING")
  }
  return payload
}

async function verifyOfficialIdentity(
  accessToken: string,
  fetchImpl: FetchLike,
  environment: NodeJS.ProcessEnv,
) {
  const binding = getEbayProductionIdentityBindingConfiguration(environment)
  if (!binding.bound) throw new Error("EBAY_PUBLICATION_OAUTH_IDENTITY_UNBOUND")
  const response = await fetchImpl(IDENTITY_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = record(await response.json().catch(() => ({})))
  const userId = text(payload.userId)
  if (!response.ok || !publicationIdentityConfirmed(payload) || !userId) {
    throw new Error("EBAY_PUBLICATION_OAUTH_IDENTITY_UNAVAILABLE")
  }
  if (
    binding.expectedUserId &&
    binding.expectedUserId.toLocaleLowerCase("en-US") !==
      userId.toLocaleLowerCase("en-US")
  ) {
    throw new Error("EBAY_PUBLICATION_OAUTH_IDENTITY_MISMATCH")
  }
  if (
    ebayProductionAccountFingerprint(userId) !==
      binding.expectedAccountFingerprint
  ) {
    throw new Error("EBAY_PUBLICATION_OAUTH_FINGERPRINT_MISMATCH")
  }
  return true
}

async function failClaimedHandoff(
  supabase: SupabaseClient,
  handoffId: string,
  error: unknown,
) {
  await supabase
    .from("ebay_publication_oauth_handoffs")
    .update({
      status: "failed",
      encrypted_credential_bundle: null,
      error_code: safeCode(error),
      updated_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .eq("status", "claimed")
}

export async function completeEbayPublicationOAuth(
  supabase: SupabaseClient,
  input: { state: string; code: string },
  fetchImpl: FetchLike = fetch,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const credentials = assertAuthorizationReady(environment)
  if (
    !isValidEbayPublicationOAuthState(input.state) ||
    !isValidEbayPublicationAuthorizationCode(input.code)
  ) {
    throw new Error("EBAY_PUBLICATION_OAUTH_CALLBACK_INVALID")
  }
  const now = new Date().toISOString()
  const { data: handoff, error } = await supabase
    .from("ebay_publication_oauth_handoffs")
    .update({ status: "claimed", claimed_at: now, updated_at: now })
    .eq("state_hash", hashEbayPublicationOAuthState(input.state))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select(
      "id,public_key_pem,account_key,expected_identity_fingerprint",
    )
    .maybeSingle()
  if (error || !handoff?.id || !handoff.public_key_pem) {
    throw new Error("EBAY_PUBLICATION_OAUTH_STATE_INVALID")
  }
  const handoffId = String(handoff.id)
  let refreshToken = ""
  let accessToken = ""
  try {
    const accountScope = getEbaySellerAccountScopeConfiguration(environment)
    if (
      !accountScope.accountKey ||
      handoff.account_key !== accountScope.accountKey ||
      handoff.expected_identity_fingerprint !==
        accountScope.identity.expectedAccountFingerprint
    ) {
      throw new Error("EBAY_PUBLICATION_OAUTH_HANDOFF_IDENTITY_MISMATCH")
    }
    const exchanged = await tokenExchange({
      credentials,
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: credentials.runame,
      }),
      fetchImpl,
    })
    refreshToken = text(exchanged.refresh_token)
    if (!refreshToken) {
      throw new Error("EBAY_PUBLICATION_OAUTH_REFRESH_TOKEN_MISSING")
    }
    const proof = await tokenExchange({
      credentials,
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: EBAY_PUBLICATION_OAUTH_SCOPES.join(" "),
      }),
      fetchImpl,
    })
    accessToken = text(proof.access_token)
    if (!accessToken) {
      throw new Error("EBAY_PUBLICATION_OAUTH_ACCESS_TOKEN_MISSING")
    }
    await verifyOfficialIdentity(accessToken, fetchImpl, environment)
    const fingerprint = credentialFingerprint({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken,
    })
    const encrypted = encryptEbayPublicationCredentialBundle({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken,
      publicKeyPem: String(handoff.public_key_pem),
    })
    const readyAt = new Date().toISOString()
    const { data: ready, error: readyError } = await supabase
      .from("ebay_publication_oauth_handoffs")
      .update({
        encrypted_credential_bundle: encrypted,
        credential_bundle_version: EBAY_PUBLICATION_OAUTH_BUNDLE_VERSION,
        credential_fingerprint: fingerprint,
        status: "ready",
        identity_match: true,
        fingerprint_match: true,
        inventory_scope_confirmed: true,
        account_scope_confirmed: true,
        error_code: null,
        ready_at: readyAt,
        updated_at: readyAt,
      })
      .eq("id", handoffId)
      .eq("status", "claimed")
      .select("id")
      .maybeSingle()
    if (readyError || !ready?.id) {
      throw new Error("EBAY_PUBLICATION_OAUTH_HANDOFF_FAILED")
    }
    return {
      status: "READY_FOR_SECURE_INSTALLATION" as const,
      identityMatch: true as const,
      fingerprintMatch: true as const,
      inventoryScopeConfirmed: true as const,
      accountScopeConfirmed: true as const,
      writeGatesChanged: false as const,
      ebayWrites: 0 as const,
      secretsReturned: false as const,
    }
  } catch (failure) {
    await failClaimedHandoff(supabase, handoffId, failure)
    throw new Error(safeCode(failure))
  } finally {
    refreshToken = ""
    accessToken = ""
    input.code = ""
    input.state = ""
  }
}

export async function getEbayPublicationOAuthStatus(
  supabase: SupabaseClient,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const now = new Date().toISOString()
  await supabase
    .from("ebay_publication_oauth_handoffs")
    .update({
      status: "expired",
      encrypted_credential_bundle: null,
      updated_at: now,
    })
    .in("status", ["pending", "claimed"])
    .lte("expires_at", now)
  const { data, error } = await supabase
    .from("ebay_publication_oauth_handoffs")
    .select(
      "status,identity_match,fingerprint_match,inventory_scope_confirmed,account_scope_confirmed,error_code,expires_at,ready_at,installed_at,ciphertext_cleared_at",
    )
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error("EBAY_PUBLICATION_OAUTH_STATUS_FAILED")
  return {
    configuration: getEbayPublicationOAuthConfiguration(environment),
    state: data?.status ?? "authorization_required",
    identityMatch: data?.identity_match ?? null,
    fingerprintMatch: data?.fingerprint_match ?? null,
    inventoryScopeConfirmed: data?.inventory_scope_confirmed ?? null,
    accountScopeConfirmed: data?.account_scope_confirmed ?? null,
    expiresAt: data?.expires_at ?? null,
    readyAt: data?.ready_at ?? null,
    installedAt: data?.installed_at ?? null,
    ciphertextClearedAt: data?.ciphertext_cleared_at ?? null,
    errorCode: data?.error_code ?? null,
    ebayWrites: 0 as const,
    secretsReturned: false as const,
  }
}

export function sanitizeEbayPublicationOAuthCallbackError(value: string) {
  return value === "access_denied"
    ? "EBAY_PUBLICATION_OAUTH_CONSENT_DENIED"
    : "EBAY_PUBLICATION_OAUTH_CALLBACK_REJECTED"
}
