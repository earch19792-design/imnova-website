export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS,
  SellerOsAdminPreResearchErrorV1,
  assertSellerOsOwnerAdminPreResearchV1,
  getSellerOsAdminPreResearchCsrfBoundaryV1,
} from "@/lib/ebay/luna-pre-research-admin-api-v1"
import {
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

export async function GET(request: NextRequest) {
  try {
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const csrf = getSellerOsAdminPreResearchCsrfBoundaryV1().issue(
      csrfContext(request, actor.actorSubject))
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const capabilities = await getSupabaseAdminClient().from(
      "seller_os_pre_research_command_capabilities_v1")
      .select("capability_id,command_client_id,allowed_contract_version,maximum_candidates,enabled,created_at,updated_at,disabled_at,expires_at")
      .eq("marketplace_account_key", account.accountKey)
      .eq("owner_user_id", actor.actorSubject).order("created_at", {
        ascending: false }).limit(20)
    if (capabilities.error) throw new Error("TEO_CONTROL_CAPABILITY_READ_FAILED")
    const response = NextResponse.json({ success: true, csrf,
      capabilityCode: "TEO_PRE_RESEARCH_NORMAL_BATCH_V1",
      maximumCandidates: 50, capabilities: capabilities.data ?? [] },
    { headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, csrf.csrfToken,
      cookieOptions(request,
        Math.floor(SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS / 1_000)))
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
        body.action !== "DISABLE" || typeof body.commandClientId !== "string" ||
        body.commandClientId.length < 8 || body.commandClientId.length > 240 ||
        /[\u0000\r\n]/.test(body.commandClientId)) {
      throw new SellerOsAdminPreResearchErrorV1(
        "TEO_CONTROL_DISABLE_REQUEST_REJECTED")
    }
    getSellerOsAdminPreResearchCsrfBoundaryV1().consume({
      ...csrfContext(request, actor.actorSubject),
      contentType: request.headers.get("content-type"),
      csrfHeader: request.headers.get("x-seller-os-csrf"),
      csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
    })
    consumed = true
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const disabled = await getSupabaseAdminClient().rpc(
      "disable_seller_os_pre_research_command_v1", {
        p_marketplace_account_key: account.accountKey,
        p_owner_user_id: actor.actorSubject,
        p_command_client_id: body.commandClientId,
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
    const parsed = parseSellerOsControlAuthorizationRequestV1(body)
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    getSellerOsAdminPreResearchCsrfBoundaryV1().consume({
      ...csrfContext(request, actor.actorSubject),
      contentType: request.headers.get("content-type"),
      csrfHeader: request.headers.get("x-seller-os-csrf"),
      csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
    })
    consumed = true
    const accessToken = token(request)
    const oauthClient = controlOAuthClient(accessToken)
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) throw new Error("CANONICAL_ACCOUNT_SCOPE_REQUIRED")
    const authorized = await authorizeSellerOsControlConsentV1({
      authorizationId: parsed.authorizationId,
      actorUserId: actor.actorSubject,
    }, {
      getAuthorizationDetails: (authorizationId) =>
        getAuthorizationDetails(oauthClient, authorizationId),
      approveAuthorization: (authorizationId) =>
        approveAuthorization(oauthClient, authorizationId),
      persistCapability: async (clientId) => {
        const persisted = await getSupabaseAdminClient().rpc(
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
