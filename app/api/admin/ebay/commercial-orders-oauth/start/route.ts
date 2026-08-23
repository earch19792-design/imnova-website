export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayCommercialOrdersAuthorizationConfiguration,
  startEbayCommercialOrdersBrowserAuthorization,
} from "@/lib/ebay/ebay-commercial-orders-oauth-authorization"
import {
  assertEbaySellerOAuthReauthAdmin,
} from "@/lib/ebay/ebay-seller-oauth-reauth-domain"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,160}$/.test(code)
    ? code
    : "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_START_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 },
    )
  }
  let actorUserId: string
  try {
    actorUserId = assertEbaySellerOAuthReauthAdmin(validation)
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeCode(error) },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    )
  }
  let input: { publicKeyPem?: unknown } = {}
  try {
    input = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_INVALID_JSON" },
      { status: 400 },
    )
  }
  if (typeof input.publicKeyPem !== "string") {
    return NextResponse.json(
      { success: false, error: "EBAY_COMMERCIAL_ORDERS_AUTHORIZATION_PUBLIC_KEY_REQUIRED" },
      { status: 400 },
    )
  }
  try {
    const result = await startEbayCommercialOrdersBrowserAuthorization(
      getSupabaseAdminClient(),
      {
        publicKeyPem: input.publicKeyPem,
        actorUserId,
        requestHost: new URL(req.url).host,
      },
    )
    return NextResponse.json(
      { success: true, ...result },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    )
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeCode(error),
      configuration: getEbayCommercialOrdersAuthorizationConfiguration(),
    }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    })
  }
}
