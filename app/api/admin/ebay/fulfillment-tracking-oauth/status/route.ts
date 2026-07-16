export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getEbayFulfillmentTrackingAuthorizationConfiguration } from "@/lib/ebay/ebay-fulfillment-tracking-oauth-authorization"
import { preflightEbayFulfillmentTrackingOAuth } from "@/lib/ebay/ebay-fulfillment-tracking-oauth"
import { validateAdminApiRequest } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  return NextResponse.json({
    success: true,
    configuration: getEbayFulfillmentTrackingAuthorizationConfiguration(),
  }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  return NextResponse.json({
    success: true,
    preflight: await preflightEbayFulfillmentTrackingOAuth(),
  }, { headers: { "Cache-Control": "no-store" } })
}
