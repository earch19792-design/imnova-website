export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { reconcileMarketplaceFulfillmentSimulator } from "@/lib/marketplace/fulfillment-v1a-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  try {
    return NextResponse.json({ success: true, result: await reconcileMarketplaceFulfillmentSimulator(getSupabaseAdminClient()) })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error), safety: { secondPosts: 0, ebayWrites: 0, previewOnly: true } }, { status: 403 })
  }
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^FULFILLMENT_[A-Z0-9_]+$/.test(value) ? value : "FULFILLMENT_RECONCILIATION_FAILED"
}
