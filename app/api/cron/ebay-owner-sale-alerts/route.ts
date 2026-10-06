export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { commercialPreviewCronAuthorized } from
  "@/lib/ebay/ebay-commercial-preview-pilot"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import {
  backfillMissingOwnerSaleAlertV1,
  runEbayOwnerSaleAlertLaneV1,
} from "@/lib/ebay/ebay-owner-sale-alert-lane-v1"
import { getSellerOsOperationalRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"
import { sellerOsPostOnlyGetResponseV1 } from
  "@/lib/seller-os/post-only-runtime-route-v1"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value)
    ? value
    : "OWNER_SALE_ALERT_LANE_FAILED"
}

export async function POST(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json(
    { success: false, error: "CRON_UNAUTHORIZED" },
    { status: 401 },
  )
  const runtimeBoundary = getSellerOsOperationalRuntimeBoundary()
  if (!runtimeBoundary.authorized) return NextResponse.json({
    success: true,
    status: "disabled",
    reason: "SELLER_OS_OPERATIONAL_RUNTIME_REQUIRED",
    safety: { marketplaceWrites: 0, buyerPiiIncluded: false },
  })
  if (process.env.EBAY_OWNER_SALE_ALERT_LANE_ENABLED === "false") {
    return NextResponse.json({
      success: true,
      status: "disabled",
      reason: "OWNER_SALE_ALERT_LANE_EXPLICITLY_DISABLED",
      safety: { marketplaceWrites: 0, buyerPiiIncluded: false },
    })
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("OWNER_SALE_ALERT_ACCOUNT_SCOPE_REQUIRED")
    const supabase = getSupabaseAdminClient()
    // Run recovery after the official read so a first observation in this
    // invocation is visible to the narrow, idempotent one-order repair.
    // Recovery still runs when the eBay read is unavailable because it reads
    // only an already persisted official snapshot.
    const lane = await runEbayOwnerSaleAlertLaneV1(supabase, { accountKey })
    const backfill = await backfillMissingOwnerSaleAlertV1(
      supabase,
      { accountKey },
    )
    const success = lane.success || [
      "RECOVERED", "ALREADY_MATERIALIZED",
    ].includes(backfill.status)
    const receipt = {
      success,
      status: success ? "owner_sale_alert_lane_completed" :
        "owner_sale_alert_lane_degraded",
      lane,
      backfill,
      dependencies: {
        exactActiveListingStateRequired: false,
        commercialMonitorGateRequired: false,
        registryRequired: false,
        stockGuardRequired: false,
        lunaLinkageRequired: false,
        analyticsRequired: false,
      },
      safety: {
        ebayReadOnly: true,
        ebayWriteUsed: false,
        marketplaceWrites: 0,
        buyerPiiIncluded: false,
        rawUpstreamPayloadPersisted: false,
      },
    }
    console.info("EBAY_OWNER_SALE_ALERT_LANE_RECEIPT_V1", {
      success: receipt.success,
      status: receipt.status,
      laneStatus: lane.status,
      sourceStatus: lane.sourceStatus,
      orderCount: lane.orderCount,
      lineCount: lane.lineCount,
      ownerAlertOutboxesCreated: "ownerAlertOutboxesCreated" in lane
        ? lane.ownerAlertOutboxesCreated : 0,
      targetedRecoveryScan: "targetedRecoveryScan" in lane
        ? lane.targetedRecoveryScan : false,
      targetedRecoveryOrderObserved:
        "targetedRecoveryOrderObserved" in lane
          ? lane.targetedRecoveryOrderObserved : false,
      backfillStatus: backfill.status,
      backfillReasonCode: backfill.reasonCode,
      backfillOutboxesCreated: backfill.outboxesCreated,
      marketplaceWrites: 0,
      buyerPiiIncluded: false,
    })
    return NextResponse.json(receipt, { status: success ? 200 : 503 })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: safeCode(error),
      safety: {
        ebayReadOnly: true,
        ebayWriteUsed: false,
        marketplaceWrites: 0,
        buyerPiiIncluded: false,
      },
    }, { status: 502 })
  }
}

export function GET() {
  return sellerOsPostOnlyGetResponseV1()
}
