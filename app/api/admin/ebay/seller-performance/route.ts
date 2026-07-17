export const runtime = "nodejs"

import { NextResponse } from "next/server"
import {
  getSupabaseAdminClient,
  validateAdminApiRequest,
} from "@/lib/supabase-admin"
import {
  getEbaySellerAnalyticsConfigurationState,
  getEbaySellerTrafficPerformance,
} from "@/lib/ebay/ebay-seller-analytics-readonly-gateway"
import {
  getEbayCategoryLearningAccountKey,
  loadStoredEbayCategoryLearningState,
} from "@/lib/ebay/ebay-category-performance-learning"
import {
  EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION,
} from "@/lib/ebay/ebay-luna-demand-opportunity-engine"

function safeErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(message)
    ? message
    : "EBAY_SELLER_ANALYTICS_READ_FAILED"
}

export async function GET(req: Request) {
  const validation = await validateAdminApiRequest(req)
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error ?? "admin_forbidden" },
      { status: validation.status || 403 }
    )
  }
  const url = new URL(req.url)
  const requestedListingIds = (url.searchParams.get("listingIds") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^\d{9,20}$/.test(entry))
    .slice(0, 200)
  const configuration = getEbaySellerAnalyticsConfigurationState()
  if (!configuration.configured) {
    return NextResponse.json({
      success: false,
      error: "EBAY_SELLER_OAUTH_NOT_CONFIGURED",
      configuration,
    }, { status: 503 })
  }
  try {
    const supabase = getSupabaseAdminClient()
    const accountKey = getEbayCategoryLearningAccountKey()
    let listingIds = requestedListingIds
    if (!listingIds.length) {
      const { data: verifiedLinks, error: linksError } = await supabase
        .from("ebay_manual_listing_links")
        .select("ebay_item_id")
        .eq("account_key", accountKey)
        .eq("marketplace_id", "EBAY_US")
        .eq("verification_status", "verified")
        .order("verified_at", { ascending: false })
        .limit(200)
      if (linksError) throw new Error("EBAY_VERIFIED_LISTING_LINKS_READ_FAILED")
      listingIds = [...new Set((verifiedLinks ?? [])
        .map((row) => String(row.ebay_item_id ?? ""))
        .filter((itemId) => /^\d{9,20}$/.test(itemId)))]
      if (!listingIds.length) {
        return NextResponse.json({
          success: false,
          error: "EBAY_VERIFIED_LISTING_REQUIRED",
          configuration,
          listingSelection: {
            mode: "VERIFIED_OWN_LINKS",
            count: 0,
            itemIdsReturnedToBrowser: false,
            reportRequestAffectsLearning: false,
          },
        }, { status: 409 })
      }
    }
    const dateFrom = url.searchParams.get("dateFrom") ?? ""
    const dateTo = url.searchParams.get("dateTo") ?? ""
    const report = await getEbaySellerTrafficPerformance({
      dateFrom,
      dateTo,
      listingIds,
    })
    let learning: Record<string, unknown>
    try {
      learning = await loadStoredEbayCategoryLearningState(
        supabase,
        EBAY_LUNA_DEMAND_OPPORTUNITY_ENGINE_VERSION,
      )
    } catch (error) {
      const code = safeErrorCode(error)
      learning = {
        status: "STORED_LEARNING_UNAVAILABLE",
        error: code === "EBAY_SELLER_ANALYTICS_READ_FAILED"
          ? "EBAY_CATEGORY_LEARNING_STATE_READ_FAILED"
          : code,
        persistencePerformed: false,
        trainingTriggered: false,
        automaticCollectionOnly: true,
        categoryLearning: [],
        rankingAdjustmentApplied: false,
      }
    }
    return NextResponse.json({
      success: true,
      report,
      learning,
      listingSelection: {
        mode: requestedListingIds.length ? "EXPLICIT" : "VERIFIED_OWN_LINKS",
        count: listingIds.length,
        itemIdsReturnedToBrowser: listingIds.length > 0,
        visibility: "ADMIN_ONLY_TRAFFIC_REPORT",
        reportRequestAffectsLearning: false,
      },
      configuration,
    })
  } catch (error) {
    const code = safeErrorCode(error)
    return NextResponse.json(
      { success: false, error: code, configuration },
      {
        status: code === "EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_REQUIRED" ||
          code === "EBAY_CATEGORY_LEARNING_ACCOUNT_SCOPE_INVALID"
          ? 503
          : code === "EBAY_VERIFIED_LISTING_LINKS_READ_FAILED"
            ? 503
          : 502,
      }
    )
  }
}
