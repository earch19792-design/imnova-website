export const runtime = "nodejs"
export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"

import { getMarketplaceFulfillmentDashboard } from "@/lib/marketplace/fulfillment-v1a-service"
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
      dashboard: await getMarketplaceFulfillmentDashboard(getSupabaseAdminClient()),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error) }, { status: 403 })
  }
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^FULFILLMENT_[A-Z0-9_]+$/.test(value) ? value : "FULFILLMENT_DASHBOARD_FAILED"
}
