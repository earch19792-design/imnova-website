export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  collectOwnEbayPerformanceForLearning,
  getEbayCategoryLearningActivationConfiguration,
} from "@/lib/ebay/ebay-category-performance-learning"
import { reverifyManualEbayListingsReadonly } from "@/lib/ebay/ebay-manual-listing-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const activation = getEbayCategoryLearningActivationConfiguration()
  if (!activation.active) {
    return NextResponse.json({
      success: true,
      status: "PREVIEW_LEARNING_DISABLED",
      activation,
      safety: {
        previewOnly: true,
        verifiedOwnListingsOnly: true,
        externalReadsPerformed: false,
        persistencePerformed: false,
        ebayWriteUsed: false,
        openAiCalls: 0,
        automaticPriceChanges: 0,
        automaticDeployments: 0,
        canPublish: false,
      },
    })
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
      activation,
      safety: {
        previewOnly: true,
        verifiedOwnListingsOnly: true,
        ebayReadOnly: true,
        ebayResourceMethods: ["GET"],
        oauthTokenExchangeMethod: "POST",
        ebayWriteUsed: false,
        openAiCalls: 0,
        automaticPriceChanges: 0,
        automaticDeployments: 0,
        canPublish: false,
      },
    })
  } catch {
    return NextResponse.json({
      success: false,
      error: "EBAY_PERFORMANCE_LEARNING_CRON_FAILED",
      activation,
      safety: {
        previewOnly: true,
        verifiedOwnListingsOnly: true,
        ebayReadOnly: true,
        ebayWriteUsed: false,
        openAiCalls: 0,
        automaticPriceChanges: 0,
        automaticDeployments: 0,
        canPublish: false,
      },
    }, { status: 502 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
