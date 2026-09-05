export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { reconcileMarketplaceFulfillmentSimulator } from "@/lib/marketplace/fulfillment-v1a-service"
import {
  getMarketplaceFulfillmentV1BReadiness,
  runMarketplaceFulfillmentRealReconciler,
} from "@/lib/marketplace/fulfillment-v1b-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

export async function POST(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  try {
    const supabase = getSupabaseAdminClient()
    const readiness = getMarketplaceFulfillmentV1BReadiness()
    return NextResponse.json({
      success: true,
      result: readiness.executable
        ? await runMarketplaceFulfillmentRealReconciler(supabase)
        : await reconcileMarketplaceFulfillmentSimulator(supabase),
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: safeCode(error), safety: { secondPosts: 0, ebayWrites: 0, previewOnly: true } }, { status: 403 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^(?:FULFILLMENT|EBAY_FULFILLMENT)_[A-Z0-9_]+$/.test(value) ? value : "FULFILLMENT_RECONCILIATION_FAILED"
}
