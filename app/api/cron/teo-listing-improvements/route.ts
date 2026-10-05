export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { collectOwnEbayPerformanceForLearning } from
  "@/lib/ebay/ebay-category-performance-learning"
import { reverifyManualEbayListingsReadonly } from
  "@/lib/ebay/ebay-manual-listing-service"
import { refreshTeoOwnerListingExperimentsV1 } from
  "@/lib/ebay/teo-owner-listing-experiment-service-v1"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 })
  }
  try {
    const supabase = getSupabaseAdminClient()
    const manualListingReverification =
      await reverifyManualEbayListingsReadonly(supabase, {
        limit: 2,
        timeBudgetMs: 15_000,
      })
    const performanceMemory = await collectOwnEbayPerformanceForLearning(
      supabase,
      {
        maximumListings: 200,
        collectionMode: "TEO_OWNER_MANUAL",
      },
    )
    const experimentFollowUp = await refreshTeoOwnerListingExperimentsV1(
      supabase,
      { maximumExperiments: 5 },
    )
    return NextResponse.json({
      success: true,
      status: "TEO_DAILY_REVIEW_COMPLETED",
      manualListingReverification,
      performanceMemory,
      experimentFollowUp,
      safety: {
        verifiedOwnListingsOnly: true,
        ebayReadOnly: true,
        ebayWriteUsed: false,
        rankingAdjustmentApplied: false,
        automaticPriceChanges: 0,
        ownerConfirmationRequired: true,
      },
    })
  } catch {
    return NextResponse.json({
      success: false,
      error: "TEO_DAILY_REVIEW_FAILED",
      safety: {
        ebayReadOnly: true,
        ebayWriteUsed: false,
        automaticPriceChanges: 0,
        ownerConfirmationRequired: true,
      },
    }, { status: 502 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
