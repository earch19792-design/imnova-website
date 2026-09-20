export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  SellerOsAdminPreResearchErrorV1,
  assertSellerOsOwnerAdminPreResearchV1,
} from "@/lib/ebay/luna-pre-research-admin-api-v1"
import {
  SELLER_OS_CONTROL_CSRF_TTL_MS,
  consumeSellerOsControlCsrfV1,
  issueSellerOsControlCsrfV1,
} from "@/lib/ebay/teo-pre-research-control-csrf-v1"
import {
  SELLER_OS_CONTROL_OAUTH_BINDINGS_V1,
  authorizeSellerOsControlConsentV1,
  parseSellerOsControlAuthorizationRequestV1,
} from "@/lib/ebay/teo-pre-research-control-authorization-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const ENDPOINT = "/api/admin/ebay/pre-research-control/capability"
const OPERATION = "TEO_CONTROL_AUTHORIZATION"
const CSRF_COOKIE = "seller_os_admin_pre_research_control_csrf"
const HEADERS = { "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" }

function token(request: NextRequest) {
  return /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization") ?? "")?.[1] ?? ""
}

function cookieOptions(request: NextRequest, maxAge: number) {
  return { httpOnly: true, secure: request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https",
    sameSite: "strict" as const, path: ENDPOINT, maxAge,
    priority: "high" as const }
}

function csrfContext(request: NextRequest, actorUserId: string) {
  return { actorUserId, adminSessionToken: token(request), requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"), operation: OPERATION }
}

function csrfSigningSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ""
  if (secret.length < 32) throw new SellerOsAdminPreResearchErrorV1(
    "ADMIN_PRE_RESEARCH_CSRF_ENTROPY_UNAVAILABLE")
  return secret
}

async function consumeControlCsrf(request: NextRequest, actorUserId: string,
  admin: ReturnType<typeof getSupabaseAdminClient>) {
  return consumeSellerOsControlCsrfV1({
    ...csrfContext(request, actorUserId),
    contentType: request.headers.get("content-type"),
    csrfHeader: request.headers.get("x-seller-os-csrf"),
    csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
  }, {
    signingSecret: csrfSigningSecret(),
    consumeReplay: async (csrf) => {
      const result = await admin.rpc("consume_seller_os_control_csrf_v1", {
        p_token_digest: csrf.tokenDigest,
        p_owner_user_id: csrf.actorUserId,
        p_expires_at: csrf.expiresAt,
      })
      if (result.error || typeof result.data !== "boolean") {
        throw new SellerOsAdminPreResearchErrorV1(
          "ADMIN_PRE_RESEARCH_CSRF_STORE_UNAVAILABLE")
      }
      return result.data
    },
  })
}

function failure(cause: unknown) {
  const code = cause instanceof SellerOsAdminPreResearchErrorV1 ? cause.code
    : cause instanceof Error && /^[A-Z0-9_]{3,180}$/.test(cause.message)
      ? cause.message : "TEO_CONTROL_AUTHORIZATION_FAILED_CLOSED"
  const status = code.includes("REJECTED") ? 400
    : code.includes("REQUIRED") || code.includes("CSRF") ? 403 : 503
  return NextResponse.json({ success: false, error: code },
    { status, headers: HEADERS })
}

function controlOAuthClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? ""
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? ""
  if (!url || !anon) throw new Error("TEO_CONTROL_OAUTH_NOT_CONFIGURED")
  const storageKey = "seller-os-control-oauth-request"
  const session = JSON.stringify({ access_token: accessToken,
    refresh_token: "server-request-only",
    expires_at: Math.floor(Date.now() / 1_000) + 300 })
  return createClient(url, anon, { auth: { autoRefreshToken: false,
    persistSession: true, detectSessionInUrl: false, storageKey,
    storage: {
      getItem: (key) => key === storageKey ? session : null,
      setItem: () => undefined,
      removeItem: () => undefined,
    } } })
}

type ControlOAuthClient = ReturnType<typeof controlOAuthClient>

async function getAuthorizationDetails(client: ControlOAuthClient,
  authorizationId: string) {
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(
    authorizationId)
  if (error || !data || !("authorization_id" in data)) {
    throw new Error("TEO_CONTROL_AUTHORIZATION_DETAILS_FAILED")
  }
  return data
}

async function approveAuthorization(client: ControlOAuthClient,
  authorizationId: string) {
  const { data, error } = await client.auth.oauth.approveAuthorization(
    authorizationId, { skipBrowserRedirect: true })
  if (error || !data || typeof data.redirect_url !== "string") {
    throw new Error("TEO_CONTROL_OAUTH_CONSENT_FAILED")
  }
  return data.redirect_url
}

function parseTraceCapabilityAuthorization(value: unknown) {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null
  if (!body || Object.keys(body).sort().join(",") !==
      "action,commandClientId" ||
      body.action !== "AUTHORIZE_COMMERCIAL_TRACE" ||
      body.commandClientId !== SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.clientId) {
    throw new SellerOsAdminPreResearchErrorV1(
      "TEO_COMMERCIAL_TRACE_AUTHORIZATION_REQUEST_REJECTED")
  }
  return Object.freeze({ commandClientId:
    SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.clientId })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const csrf = issueSellerOsControlCsrfV1(
      csrfContext(request, actor.actorSubject), {
        signingSecret: csrfSigningSecret(),
      })
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const capabilities = await getSupabaseAdminClient().from(
      "seller_os_pre_research_command_capabilities_v1")
      .select("capability_id,command_client_id,allowed_contract_version,maximum_candidates,enabled,created_at,updated_at,disabled_at,expires_at")
      .eq("marketplace_account_key", account.accountKey)
      .eq("owner_user_id", actor.actorSubject).order("created_at", {
        ascending: false }).limit(20)
    if (capabilities.error) throw new Error("TEO_CONTROL_CAPABILITY_READ_FAILED")
    const traceCapabilities = await getSupabaseAdminClient().from(
      "seller_os_commercial_trace_command_capabilities_v1")
      .select("capability_id,command_client_id,oauth_resource,allowed_contract_version,enabled,created_at,updated_at,disabled_at,expires_at")
      .eq("marketplace_account_key", account.accountKey)
      .eq("owner_user_id", actor.actorSubject).order("created_at", {
        ascending: false }).limit(20)
    if (traceCapabilities.error) throw new Error(
      "TEO_COMMERCIAL_TRACE_CAPABILITY_READ_FAILED")
    const response = NextResponse.json({ success: true, csrf,
      capabilityCode: "TEO_PRE_RESEARCH_NORMAL_BATCH_V1",
      traceCapabilityCode: "TEO_COMMERCIAL_TRACE_V1",
      maximumCandidates: 50, capabilities: capabilities.data ?? [],
      traceCapabilities: traceCapabilities.data ?? [] },
    { headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, csrf.csrfToken,
      cookieOptions(request,
        Math.floor(SELLER_OS_CONTROL_CSRF_TTL_MS / 1_000)))
    return response
  } catch (cause) { return failure(cause) }
}

export async function DELETE(request: NextRequest) {
  let consumed = false
  try {
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || Object.keys(body).sort().join(",") !== "action,commandClientId" ||
        !["DISABLE", "DISABLE_COMMERCIAL_TRACE"].includes(String(body.action)) ||
        typeof body.commandClientId !== "string" ||
        body.commandClientId.length < 8 || body.commandClientId.length > 240 ||
        /[\u0000\r\n]/.test(body.commandClientId)) {
      throw new SellerOsAdminPreResearchErrorV1(
        "TEO_CONTROL_DISABLE_REQUEST_REJECTED")
    }
    const admin = getSupabaseAdminClient()
    await consumeControlCsrf(request, actor.actorSubject, admin)
    consumed = true
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const traceAction = body.action === "DISABLE_COMMERCIAL_TRACE"
    const disabled = await admin.rpc(traceAction
      ? "disable_seller_os_commercial_trace_v1"
      : "disable_seller_os_pre_research_command_v1", {
        p_marketplace_account_key: account.accountKey,
        p_owner_user_id: actor.actorSubject,
        p_command_client_id: body.commandClientId,
        ...(traceAction ? { p_oauth_resource:
          SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.resource } : {}),
      })
    if (disabled.error) throw new Error("TEO_CONTROL_DISABLE_FAILED")
    const response = NextResponse.json({ success: true,
      disabled: disabled.data === true,
      safety: { marketplaceWrites: 0, stockGuardMutations: 0 } },
    { headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, "", cookieOptions(request, 0))
    return response
  } catch (cause) {
    const response = failure(cause)
    if (consumed) response.cookies.set(CSRF_COOKIE, "", cookieOptions(request, 0))
    return response
  }
}

export async function POST(request: NextRequest) {
  let consumed = false
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const parsed = body?.action === "AUTHORIZE"
      ? parseSellerOsControlAuthorizationRequestV1(body) : null
    const traceAuthorization = parsed ? null
      : parseTraceCapabilityAuthorization(body)
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const admin = getSupabaseAdminClient()
    await consumeControlCsrf(request, actor.actorSubject, admin)
    consumed = true
    const accessToken = token(request)
    const oauthClient = controlOAuthClient(accessToken)
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    if (traceAuthorization) {
      const existingControl = await admin.from(
        "seller_os_pre_research_command_capabilities_v1")
        .select("capability_id").eq("marketplace_account_key", account.accountKey)
        .eq("owner_user_id", actor.actorSubject)
        .eq("command_client_id", traceAuthorization.commandClientId)
        .eq("enabled", true)
        .limit(1).maybeSingle()
      if (existingControl.error || !existingControl.data) {
        throw new Error("TEO_COMMERCIAL_TRACE_CAPABILITY_BINDING_INVALID")
      }
      const persisted = await admin.rpc(
        "authorize_seller_os_commercial_trace_v1", {
          p_marketplace_account_key: account.accountKey,
          p_owner_user_id: actor.actorSubject,
          p_command_client_id: traceAuthorization.commandClientId,
          p_oauth_resource: SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.resource,
          p_expires_at: null,
        })
      if (persisted.error) throw new Error(
        "TEO_COMMERCIAL_TRACE_CAPABILITY_PERSIST_FAILED")
      const response = NextResponse.json({ success: true,
        capability: persisted.data, actor: { subject: actor.actorSubject },
        safety: { marketplaceWrites: 0, publisherAuthority: 0,
          preResearchMutations: 0 } }, { headers: HEADERS })
      response.cookies.set(CSRF_COOKIE, "", cookieOptions(request, 0))
      return response
    }
    if (!parsed) throw new Error("TEO_CONTROL_AUTHORIZATION_REQUEST_REJECTED")
    const authorized = await authorizeSellerOsControlConsentV1({
      authorizationId: parsed.authorizationId,
      actorUserId: actor.actorSubject,
    }, {
      getAuthorizationDetails: (authorizationId) =>
        getAuthorizationDetails(oauthClient, authorizationId),
      getAuthorizationResource: async (authorizationId, actorUserId) => {
        const result = await admin.rpc(
          "get_seller_os_control_oauth_resource_v1", {
            p_authorization_id: authorizationId,
            p_owner_user_id: actorUserId,
            p_client_id: SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.clientId,
            p_redirect_uri: SELLER_OS_CONTROL_OAUTH_BINDINGS_V1.redirectUri,
          })
        if (result.error || typeof result.data !== "string") {
          throw new Error("TEO_CONTROL_AUTHORIZATION_BINDING_INVALID")
        }
        return result.data
      },
      approveAuthorization: (authorizationId) =>
        approveAuthorization(oauthClient, authorizationId),
      persistCapability: async (clientId) => {
        const persisted = await admin.rpc(
          "authorize_seller_os_pre_research_command_v1", {
            p_marketplace_account_key: account.accountKey,
            p_owner_user_id: actor.actorSubject,
            p_command_client_id: clientId, p_maximum_candidates: 50,
            p_expires_at: null,
          })
        if (persisted.error) {
          throw new Error("TEO_CONTROL_CAPABILITY_PERSIST_FAILED")
        }
        return persisted.data
      },
    })
    const response = NextResponse.json({ success: true,
      redirectUrl: authorized.redirectUrl,
      capability: authorized.capability, actor: { subject: actor.actorSubject },
      safety: { marketplaceWrites: 0, stockGuardMutations: 0,
        publisherAuthority: 0, commercialTraces: 0 } }, { headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, "", cookieOptions(request, 0))
    return response
  } catch (cause) {
    const response = failure(cause)
    if (consumed) response.cookies.set(CSRF_COOKIE, "", cookieOptions(request, 0))
    return response
  }
}
