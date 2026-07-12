export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { validateAdminApiRequest } from "@/lib/supabase-admin"
import {
  getEbaySellerAnalyticsConfigurationState,
  getEbaySellerTrafficPerformance,
} from "@/lib/ebay/ebay-seller-analytics-readonly-gateway"

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
  const listingIds = (url.searchParams.get("listingIds") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  const configuration = getEbaySellerAnalyticsConfigurationState()
  if (!configuration.configured) {
    return NextResponse.json({
      success: false,
      error: "EBAY_SELLER_OAUTH_NOT_CONFIGURED",
      configuration,
    }, { status: 503 })
  }
  try {
    const report = await getEbaySellerTrafficPerformance({
      dateFrom: url.searchParams.get("dateFrom") ?? "",
      dateTo: url.searchParams.get("dateTo") ?? "",
      listingIds,
    })
    return NextResponse.json({ success: true, report, configuration })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorCode(error), configuration },
      { status: 502 }
    )
  }
}
