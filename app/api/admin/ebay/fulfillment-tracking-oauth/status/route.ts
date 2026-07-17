export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import {
  getEbayFulfillmentTrackingAuthorizationConfiguration,
  getEbayFulfillmentTrackingAuthorizationStatus,
  runAndRecordEbayFulfillmentTrackingReadiness,
} from "@/lib/ebay/ebay-fulfillment-tracking-oauth-authorization"
import { getSupabaseAdminClient, validateAdminApiRequest } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  try {
    return NextResponse.json({
      success: true,
      configuration: getEbayFulfillmentTrackingAuthorizationConfiguration(),
      connection: await getEbayFulfillmentTrackingAuthorizationStatus(
        getSupabaseAdminClient(),
      ),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({
      success: false,
      error: "EBAY_FULFILLMENT_TRACKING_AUTHORIZATION_STATUS_FAILED",
    }, { status: 502, headers: { "Cache-Control": "no-store" } })
  }
}

export async function POST(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) return NextResponse.json(
    { success: false, error: validation.error ?? "admin_forbidden" },
    { status: validation.status || 403 },
  )
  try {
    return NextResponse.json({
      success: true,
      preflight: await runAndRecordEbayFulfillmentTrackingReadiness(
        getSupabaseAdminClient(),
      ),
    }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({
      success: false,
      error: "EBAY_FULFILLMENT_TRACKING_READINESS_FAILED",
    }, { status: 502, headers: { "Cache-Control": "no-store" } })
  }
}
