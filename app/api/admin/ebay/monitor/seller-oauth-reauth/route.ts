export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

import { NextRequest, NextResponse } from "next/server"

import {
  claimAndVerifyEbaySellerOAuthReauth,
  prepareEbaySellerOAuthReauthStart,
  verifyEbaySellerOAuthReauthCandidate,
} from "@/lib/ebay/ebay-seller-oauth-reauth"
import {
  assertEbaySellerOAuthReauthAdmin,
  assertEbaySellerOAuthReauthSameOrigin,
  ebaySellerOAuthReauthCookieOptions,
  EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
  EBAY_SELLER_OAUTH_REAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS,
  EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
  EbaySellerOAuthReauthError,
  getEbaySellerOAuthReauthConfiguration,
  parseEbaySellerOAuthReauthCallbackUrl,
  renderEbaySellerOAuthReauthFailureHtml,
  renderEbaySellerOAuthReauthSuccessHtml,
  safeEbaySellerOAuthReauthError,
  verifyEbaySellerOAuthReauthCookie,
} from "@/lib/ebay/ebay-seller-oauth-reauth-domain"
import {
  createSupabaseEbaySellerOAuthReauthStateLedger,
} from "@/lib/ebay/ebay-seller-oauth-reauth-ledger"
import { getEbayProRuntimeBoundary } from "@/lib/ebay/environment-boundaries"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function callbackHtml(code: string, status: number) {
  const response = new NextResponse(
    renderEbaySellerOAuthReauthFailureHtml(code),
    {
      status,
      headers: {
        ...EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
  response.cookies.set(
    EBAY_SELLER_OAUTH_REAUTH_COOKIE,
    "",
    ebaySellerOAuthReauthCookieOptions(0),
  )
  return response
}

function successHtml(refreshToken: string) {
  const response = new NextResponse(
    renderEbaySellerOAuthReauthSuccessHtml(refreshToken),
    {
      status: 200,
      headers: {
        ...EBAY_SELLER_OAUTH_REAUTH_RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
  response.cookies.set(
    EBAY_SELLER_OAUTH_REAUTH_COOKIE,
    "",
    ebaySellerOAuthReauthCookieOptions(0),
  )
  return response
}

function runtimeAllowed(request: NextRequest) {
  return !getEbayProRuntimeBoundary({
    pathname: request.nextUrl.pathname,
    method: request.method,
  }).blocked
}

export async function POST(request: NextRequest) {
  try {
    if (!runtimeAllowed(request)) {
      return NextResponse.json(
        { success: false, error: "EBAY_SELLER_OAUTH_REAUTH_RUNTIME_DENIED" },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      )
    }
    assertEbaySellerOAuthReauthSameOrigin(request)
    const validation = await validateAdminApiRequest(request)
    const actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
    const configuration = getEbaySellerOAuthReauthConfiguration({
      requestHost: request.nextUrl.host,
    })
    if (!configuration.ready) {
      throw new EbaySellerOAuthReauthError(
        configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
      )
    }
    const ledger = createSupabaseEbaySellerOAuthReauthStateLedger(
      getSupabaseAdminClient(),
    )
    const prepared = await prepareEbaySellerOAuthReauthStart({
      configuration,
      actorUserId,
      ledger,
    })
    const response = NextResponse.json({
      success: true,
      authorizationUrl: prepared.authorizationUrl,
      callbackPath: EBAY_SELLER_OAUTH_REAUTH_CALLBACK_PATH,
      scopeCount: 4,
      expiresAt: new Date(prepared.expiresAt).toISOString(),
      stateHashPersisted: true,
      rawStatePersisted: false,
      tokenGenerated: false,
    }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
    response.cookies.set(
      EBAY_SELLER_OAUTH_REAUTH_COOKIE,
      prepared.cookie,
      ebaySellerOAuthReauthCookieOptions(
        Math.floor(EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS / 1_000),
      ),
    )
    return response
  } catch (cause) {
    return NextResponse.json({
      success: false,
      error: safeEbaySellerOAuthReauthError(cause),
    }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  }
}

export async function GET(request: NextRequest) {
  const callbackStartedAt = Date.now()
  let candidateRefreshToken = ""
  try {
    if (!runtimeAllowed(request)) {
      return callbackHtml("EBAY_SELLER_OAUTH_REAUTH_RUNTIME_DENIED", 403)
    }
    const configuration = getEbaySellerOAuthReauthConfiguration({
      requestHost: request.nextUrl.host,
    })
    if (!configuration.ready) {
      return callbackHtml(
        configuration.reason ?? "EBAY_SELLER_OAUTH_REAUTH_CONFIGURATION_INVALID",
        403,
      )
    }
    const cookies = request.cookies.getAll(EBAY_SELLER_OAUTH_REAUTH_COOKIE)
    if (cookies.length !== 1) {
      return callbackHtml(
        "EBAY_SELLER_OAUTH_REAUTH_STATE_COOKIE_INVALID",
        400,
      )
    }
    const callback = parseEbaySellerOAuthReauthCallbackUrl(request.url)
    const transaction = verifyEbaySellerOAuthReauthCookie({
      cookie: cookies[0]?.value ?? "",
      state: callback.state,
      now: callbackStartedAt,
      branchHost: configuration.branchHost,
      clientSecret: configuration.clientSecret,
      expectedAccountFingerprint: configuration.expectedAccountFingerprint,
    })
    const ledger = createSupabaseEbaySellerOAuthReauthStateLedger(
      getSupabaseAdminClient(),
    )
    const result = await claimAndVerifyEbaySellerOAuthReauth({
      callback,
      stateHash: transaction.stateHash,
      ledger,
      verifyCandidate: callback.kind === "CODE"
        ? (authorizationCode) => verifyEbaySellerOAuthReauthCandidate({
          authorizationCode,
          configuration,
          callbackStartedAt,
        })
        : undefined,
    })
    if (result.kind !== "HANDOFF") {
      return callbackHtml(result.code, result.claimSucceeded ? 400 : 409)
    }
    if (Date.now() - callbackStartedAt >=
        EBAY_SELLER_OAUTH_REAUTH_INTERNAL_HARD_BUDGET_MS) {
      return callbackHtml(
        "EBAY_SELLER_OAUTH_REAUTH_TIME_BUDGET_EXHAUSTED",
        504,
      )
    }
    candidateRefreshToken = result.verification.refreshToken
    const response = successHtml(candidateRefreshToken)
    candidateRefreshToken = ""
    return response
  } catch (cause) {
    return callbackHtml(safeEbaySellerOAuthReauthError(cause), 400)
  } finally {
    candidateRefreshToken = ""
  }
}
