export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayFulfillmentTrackingAuthorizationConfiguration,
  startEbayFulfillmentTrackingAuthorization,
} from "@/lib/ebay/ebay-fulfillment-tracking-oauth-authorization"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]{3,180}$/.test(code)
    ? code
    : "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_START_FAILED"
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  try {
    const input = await req.json() as { publicKeyPem?: unknown }
    if (typeof input.publicKeyPem !== "string") {
      throw new Error("EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_PUBLIC_KEY_REQUIRED")
    }
    return NextResponse.json({
      success: true,
      ...await startEbayFulfillmentTrackingAuthorization(
        getSupabaseAdminClient(),
        input.publicKeyPem,
      ),
    }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeCode(error),
      configuration: getEbayFulfillmentTrackingAuthorizationConfiguration(),
    }, { status: 403, headers: { "Cache-Control": "no-store" } })
  }
}
