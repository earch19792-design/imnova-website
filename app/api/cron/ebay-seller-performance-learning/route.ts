export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  collectOwnEbayPerformanceForLearning,
} from "@/lib/ebay/ebay-category-performance-learning"
import { reverifyManualEbayListingsReadonly } from "@/lib/ebay/ebay-manual-listing-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  try {
    const supabase = getSupabaseAdminClient()
    const manualListingReverification =
      await reverifyManualEbayListingsReadonly(supabase, {
        limit: 2,
        timeBudgetMs: 15_000,
      })
    const learning = await collectOwnEbayPerformanceForLearning(supabase)
    return NextResponse.json({
      success: true,
      status: learning.status,
      learning,
      manualListingReverification,
      safety: {
        ebayReadOnly: true,
        ebayResourceMethods: ["GET"],
        oauthTokenExchangeMethod: "POST",
        ebayWriteUsed: false,
        canPublish: false,
      },
    })
  } catch {
    return NextResponse.json({
      success: false,
      error: "EBAY_PERFORMANCE_LEARNING_CRON_FAILED",
      safety: { ebayReadOnly: true, ebayWriteUsed: false, canPublish: false },
    }, { status: 502 })
  }
}
