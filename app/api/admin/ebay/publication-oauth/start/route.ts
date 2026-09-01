export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"

import {
  startEbayPublicationOAuthBrowserCeremony,
} from "@/lib/ebay/ebay-publication-oauth-authorization"
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
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_PUBLICATION_OAUTH_BROWSER_START_FAILED"
}

const responseHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

export async function POST(request: NextRequest) {
  try {
    assertEbaySellerOAuthReauthSameOrigin(request)
    const validation = await validateAdminApiRequest(request)
    const actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
    const supabase = getSupabaseAdminClient()
    const prepared = await startEbayPublicationOAuthBrowserCeremony(
      supabase,
      {
        actorUserId,
        requestHost: request.nextUrl.host,
        ledger: createSupabaseEbaySellerOAuthReauthStateLedger(supabase),
      },
    )
    const response = NextResponse.json({
      success: true,
      authorizationUrl: prepared.authorizationUrl,
      expiresAt: new Date(prepared.expiresAt).toISOString(),
      ceremony: prepared.ceremony,
    }, { status: 200, headers: responseHeaders })
    response.cookies.set(
      EBAY_SELLER_OAUTH_REAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    response.cookies.set(
      EBAY_MARKETING_READONLY_OAUTH_COOKIE,
      "",
      ebaySellerOAuthReauthCookieOptions(0),
    )
    response.cookies.set(
      EBAY_PUBLICATION_PRODUCTION_OAUTH_COOKIE,
      prepared.cookie,
      ebaySellerOAuthReauthCookieOptions(
        Math.floor(EBAY_SELLER_OAUTH_REAUTH_STATE_TTL_MS / 1_000),
      ),
    )
    return response
  } catch (cause) {
    return NextResponse.json({
      success: false,
      error: safeCode(cause),
    }, { status: 403, headers: responseHeaders })
  }
}
