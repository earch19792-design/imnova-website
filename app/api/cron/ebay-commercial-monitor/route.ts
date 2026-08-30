export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import {
  getCommercialMonitorScheduleConfiguration,
  getDueCommercialMonitorLanes,
  runEbayCommercialMonitor,
} from "@/lib/ebay/ebay-commercial-monitor-service"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { readManualListingFromTradingApi } from
  "@/lib/ebay/ebay-manual-listing-trading-readonly"
import { readEbaySellerStoreSubscriptionReadonly } from
  "@/lib/ebay/ebay-account-policy-readonly-gateway"

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(value) ? value : "COMMERCIAL_MONITOR_CRON_FAILED"
}

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) return NextResponse.json(
    { success: false, error: "CRON_UNAUTHORIZED" },
    { status: 401 },
  )
  const feeAuthorityItemId = new URL(req.url).searchParams.get(
    "feeAuthorityItemId",
  )?.trim() ?? ""
  if (feeAuthorityItemId) {
    if (!/^\d{9,20}$/.test(feeAuthorityItemId)) {
      return NextResponse.json({
        success: false,
        error: "EBAY_FEE_AUTHORITY_ITEM_ID_INVALID",
        marketplaceWrites: 0,
      }, { status: 400 })
    }
    try {
      const [listing, subscription] = await Promise.all([
        readManualListingFromTradingApi(feeAuthorityItemId),
        readEbaySellerStoreSubscriptionReadonly(),
      ])
      return NextResponse.json({
        success: true,
        status: "fee_authority_readonly_completed",
        item: {
          itemId: listing.itemId,
          ownership: listing.ownership,
          listingStatus: listing.listingStatus,
          categoryId: listing.safeDefaults.categoryId ?? null,
          marketplaceId: "EBAY_US",
        },
        accountFeeContext: subscription,
        authority: {
          category: "EBAY_TRADING_GET_ITEM_READONLY",
          storeSubscription: "EBAY_ACCOUNT_GET_SUBSCRIPTION_READONLY",
        },
        safety: {
          analyticsRequests: 0,
          lunaRequests: 0,
          marketplaceWrites: 0,
          databaseWrites: 0,
        },
      })
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: safeCode(error),
        safety: {
          analyticsRequests: 0,
          lunaRequests: 0,
          marketplaceWrites: 0,
          databaseWrites: 0,
        },
      }, { status: 502 })
    }
  }
  const schedule = getCommercialMonitorScheduleConfiguration()
  if (process.env.VERCEL_ENV !== "preview" || !schedule.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      schedule,
      safety: {
        previewOnly: true,
        productionUnchanged: true,
        ebayWriteUsed: false,
      },
    })
  }
  try {
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("COMMERCIAL_MONITOR_ACCOUNT_SCOPE_REQUIRED")
    const supabase = getSupabaseAdminClient()
    const lanes = await getDueCommercialMonitorLanes(supabase, accountKey)
    const run = await runEbayCommercialMonitor(supabase, {
      triggerSource: "schedule",
      lanes,
      workerId: `commercial-schedule:${randomUUID()}`,
      dispatchWhatsApp: false,
      dryRunWhatsApp: true,
    })
    return NextResponse.json({ success: true, schedule, lanes, run })
  } catch (error) {
    const code = safeCode(error)
    return NextResponse.json(
      {
        success: false,
        error: code,
        schedule,
        safety: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED"
          ? {
              externalReadersStarted: false,
              productionUnchanged: true,
              ebayWriteUsed: false,
            }
          : {
              productionUnchanged: true,
              ebayWriteUsed: false,
            },
      },
      { status: code === "COMMERCIAL_MONITOR_SCHEDULER_GATE_REQUIRED" ? 423 : 502 },
    )
  }
}
