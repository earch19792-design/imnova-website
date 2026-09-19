export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS,
  SellerOsAdminPreResearchErrorV1,
  assertSellerOsOwnerAdminPreResearchV1,
  getSellerOsAdminPreResearchCsrfBoundaryV1,
  parseNormalLunaPreResearchAdminRequestV1,
} from "@/lib/ebay/luna-pre-research-admin-api-v1"
import { requestLunaPreResearchV1 } from
  "@/lib/ebay/luna-pre-research-intake-v1"
import { getSupabaseAdminClient, validateAdminApiRequest } from
  "@/lib/supabase-admin"

const ENDPOINT = "/api/admin/ebay/pre-research"
const OPERATION = "NORMAL_PRE_RESEARCH"
const CSRF_COOKIE = "seller_os_admin_pre_research_csrf"
const MAXIMUM_REQUEST_BYTES = 16_384
const HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
})

function bearerToken(request: NextRequest) {
  return /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  )?.[1] ?? ""
}

function protectedCookieOptions(request: NextRequest, maxAge: number) {
  return { httpOnly: true,
    secure: request.headers.get("x-forwarded-proto") === "https" ||
      request.nextUrl.protocol === "https:",
    sameSite: "strict" as const, path: ENDPOINT, maxAge,
    priority: "high" as const }
}

function csrfContext(request: NextRequest, actorUserId: string) {
  return { actorUserId, adminSessionToken: bearerToken(request),
    requestUrl: request.url, origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    operation: OPERATION }
}

async function readRequest(request: NextRequest) {
  const body = await request.text()
  if (!body || Buffer.byteLength(body, "utf8") > MAXIMUM_REQUEST_BYTES) {
    throw new SellerOsAdminPreResearchErrorV1(
      "ADMIN_PRE_RESEARCH_REQUEST_REJECTED",
    )
  }
  try {
    return parseNormalLunaPreResearchAdminRequestV1(JSON.parse(body))
  } catch (cause) {
    if (cause instanceof SellerOsAdminPreResearchErrorV1) throw cause
    throw new SellerOsAdminPreResearchErrorV1(
      "ADMIN_PRE_RESEARCH_REQUEST_REJECTED",
    )
  }
}

function failure(cause: unknown) {
  const code = cause instanceof SellerOsAdminPreResearchErrorV1
    ? cause.code : cause instanceof Error && /^[A-Z0-9_]{3,160}$/.test(cause.message)
      ? cause.message : "ADMIN_PRE_RESEARCH_FAILED_CLOSED"
  const status = code.includes("OWNER_ADMIN") || code.includes("CSRF")
    ? 403 : code.includes("REQUEST_REJECTED") ? 400 : 503
  return NextResponse.json({ success: false, error: code,
    credentialsIncluded: false, marketplaceWrites: 0 },
  { status, headers: HEADERS })
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.search) {
    return failure(new SellerOsAdminPreResearchErrorV1(
      "ADMIN_PRE_RESEARCH_REQUEST_REJECTED",
    ))
  }
  try {
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const csrf = getSellerOsAdminPreResearchCsrfBoundaryV1().issue(
      csrfContext(request, actor.actorSubject),
    )
    const response = NextResponse.json({ success: true, csrf,
      operation: OPERATION }, { status: 200, headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, csrf.csrfToken,
      protectedCookieOptions(request,
        Math.floor(SELLER_OS_ADMIN_PRE_RESEARCH_CSRF_TTL_MS / 1_000)))
    return response
  } catch (cause) {
    return failure(cause)
  }
}

export async function POST(request: NextRequest) {
  let csrfConsumed = false
  try {
    const auth = await validateAdminApiRequest(request)
    const actor = assertSellerOsOwnerAdminPreResearchV1(auth)
    const input = await readRequest(request)
    getSellerOsAdminPreResearchCsrfBoundaryV1().consume({
      ...csrfContext(request, actor.actorSubject),
      contentType: request.headers.get("content-type"),
      csrfHeader: request.headers.get("x-seller-os-csrf"),
      csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
    })
    csrfConsumed = true
    const account = getEbaySellerAccountScopeConfiguration()
    if (!account.accountKey) {
      throw new SellerOsAdminPreResearchErrorV1(
        "ADMIN_PRE_RESEARCH_ACCOUNT_SCOPE_REQUIRED",
      )
    }
    const result = await requestLunaPreResearchV1({
      supabase: getSupabaseAdminClient(), accountKey: account.accountKey,
      ...input,
    })
    const response = NextResponse.json({ success: true, result,
      actor: { subject: actor.actorSubject },
      safety: { claims: 0, researchCalls: 0, commercialTraces: 0,
        publisherAuthority: 0, marketplaceWrites: 0 } },
    { status: 200, headers: HEADERS })
    response.cookies.set(CSRF_COOKIE, "",
      protectedCookieOptions(request, 0))
    return response
  } catch (cause) {
    const response = failure(cause)
    if (csrfConsumed) response.cookies.set(CSRF_COOKIE, "",
      protectedCookieOptions(request, 0))
    return response
  }
}
