export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { collectOwnEbayPerformanceForLearning } from
  "@/lib/ebay/ebay-category-performance-learning"
import { reverifyManualEbayListingsReadonly } from
  "@/lib/ebay/ebay-manual-listing-service"
import { refreshTeoOwnerListingExperimentsV1 } from
  "@/lib/ebay/teo-owner-listing-experiment-service-v1"
import { sellerOsPostOnlyGetResponseV1,
  sellerOsPostRuntimeAuthorizedV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

function safeReasonCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_]{2,119}$/.test(message) ? message : fallback
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdminClient()
  if (!authorized(req) && !await sellerOsPostRuntimeAuthorizedV1({
    request: req,
    supabase,
  })) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" },
      { status: 401 })
  }
  try {
    const manualListingReverification =
      await reverifyManualEbayListingsReadonly(supabase, {
        limit: 2,
        timeBudgetMs: 15_000,
      })
    const performanceMemory =
      await collectOwnEbayPerformanceForLearning(supabase, {
        maximumListings: 200,
        collectionMode: "TEO_OWNER_MANUAL",
      }).catch((error) => ({
        status: "TEO_PERFORMANCE_MEMORY_FAILED" as const,
        reasonCode: safeReasonCode(error,
          "TEO_PERFORMANCE_MEMORY_UNAVAILABLE"),
        rankingAdjustmentApplied: false as const,
      }))
    const experimentFollowUp =
      await refreshTeoOwnerListingExperimentsV1(supabase, {
        maximumExperiments: 5,
      }).catch((error) => ({
        processed: 0,
        results: [],
        status: "TEO_EXPERIMENT_FOLLOW_UP_FAILED" as const,
        reasonCode: safeReasonCode(error,
          "TEO_EXPERIMENT_FOLLOW_UP_UNAVAILABLE"),
        ebayWriteUsed: false as const,
      }))
    const partial = manualListingReverification.failed > 0 ||
      performanceMemory.status ===
      "TEO_PERFORMANCE_MEMORY_FAILED" ||
      "status" in experimentFollowUp && experimentFollowUp.status ===
        "TEO_EXPERIMENT_FOLLOW_UP_FAILED"
    return NextResponse.json({
      success: true,
      status: partial
        ? "TEO_DAILY_REVIEW_PARTIAL"
        : "TEO_DAILY_REVIEW_COMPLETED",
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
