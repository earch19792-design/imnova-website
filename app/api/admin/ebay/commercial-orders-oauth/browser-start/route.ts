export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import {
  activateEbayCommercialOrdersBrowserAuthorization,
} from "@/lib/ebay/ebay-commercial-orders-oauth-authorization"
import {
  assertEbaySellerOAuthReauthAdmin,
  assertEbaySellerOAuthReauthSameOrigin,
  ebaySellerOAuthReauthCookieOptions,
  EBAY_MARKETING_READONLY_OAUTH_COOKIE,
  EBAY_PUBLICATION_PRODUCTION_OAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_COOKIE,
  EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS,
} from "@/lib/ebay/ebay-seller-oauth-reauth-domain"
import {
  createSupabaseEbaySellerOAuthReauthStateLedger,
} from "@/lib/ebay/ebay-seller-oauth-reauth-ledger"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(cause: unknown) {
  const code = cause instanceof Error ? cause.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_COMMERCIAL_ORDERS_BROWSER_START_FAILED"
}

export async function POST(request: NextRequest) {
  try {
    assertEbaySellerOAuthReauthSameOrigin(request)
    const validation = await validateAdminApiRequest(request)
    const actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      throw new Error("EBAY_COMMERCIAL_ORDERS_BROWSER_START_INVALID")
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join(",") !== "startTicket" ||
        typeof (payload as { startTicket?: unknown }).startTicket !== "string") {
      throw new Error("EBAY_COMMERCIAL_ORDERS_BROWSER_START_INVALID")
    }
    const supabase = getSupabaseAdminClient()
    const activated = await activateEbayCommercialOrdersBrowserAuthorization(
      supabase,
      {
        startTicket: (payload as { startTicket: string }).startTicket,
        actorUserId,
        requestHost: request.nextUrl.host,
        ledger: createSupabaseEbaySellerOAuthReauthStateLedger(supabase),
      },
    )
    const response = NextResponse.json({
      success: true,
      authorizationUrl: activated.authorizationUrl,
      expiresAt: new Date(activated.expiresAt).toISOString(),
      ceremony: activated.ceremony,
    }, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    })
    response.cookies.set(
      EBAY_SELLER_OAUTH_REAUTH_COOKIE,
      activated.cookie,
      ebaySellerOAuthReauthCookieOptions(
        Math.floor(EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS / 1_000),
      ),
    )
    response.cookies.set(
      EBAY_MARKETING_READONLY_OAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    response.cookies.set(
      EBAY_PUBLICATION_PRODUCTION_OAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    return response
  } catch (cause) {
    return NextResponse.json({
      success: false,
      error: safeCode(cause),
    }, {
      status: 403,
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    })
  }
}
