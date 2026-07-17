export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import { runLunaPortexMarketRadarSync } from "@/lib/market-radar-lunaportex"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  buildSellerWorkerId,
  createSellerAutomationRun,
  finishSellerAutomationRun,
  reconcileActiveListingProtectionRisks,
  reconcileSellerScanTasks,
} from "@/lib/ebay/ebay-seller-command-center-automation"
import { deliverSellerWhatsAppAlerts } from "@/lib/ebay/ebay-seller-whatsapp-alerts"
import { getSellerWhatsAppGatewayConfiguration } from "@/lib/ebay/ebay-seller-whatsapp-gateway"

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const startedAt = Date.now()
  const supabase = getSupabaseAdminClient()
  let automationRunId = ""
  try {
    const automationRun = await createSellerAutomationRun(supabase, {
      runKind: "luna_sync",
      triggerSource: "schedule",
    })
    automationRunId = automationRun.id
    const sync = await runLunaPortexMarketRadarSync(supabase)
    const taskReconciliation = await reconcileSellerScanTasks(supabase, {
      forceDue: false,
      limit: 300,
    })
    const protection = await reconcileActiveListingProtectionRisks(supabase)
    const whatsappConfiguration = getSellerWhatsAppGatewayConfiguration()
    const whatsapp = whatsappConfiguration.deliveryAttemptAllowed
      ? await deliverSellerWhatsAppAlerts(supabase, {
          workerId: buildSellerWorkerId("seller-whatsapp-protection"),
          limit: 20,
          dryRun: false,
        }).catch(() => ({ mode: "delivery_error" as const }))
      : { mode: "disabled" as const, status: whatsappConfiguration.status }
    const metrics = {
      syncStatus: sync.scanStatus,
      scanCompletenessPercent: sync.scanCompletenessPercent,
      taskReconciliation,
      protection,
      whatsapp,
      elapsedMs: Date.now() - startedAt,
    }
    await finishSellerAutomationRun(supabase, automationRunId, {
      status: sync.scanStatus === "COMPLETE" ? "completed" : "partial",
      metrics,
    })
    return NextResponse.json({
      success: true,
      sync,
      taskReconciliation,
      protection,
      whatsapp,
      automation: {
        stage: "LUNA_MARKET_RADAR_REFRESH",
        nextStage: "EBAY_LUNA_PRIORITY_SCAN",
        elapsedMs: Date.now() - startedAt,
      },
    })
  } catch (error) {
    if (automationRunId) {
      await finishSellerAutomationRun(supabase, automationRunId, {
        status: "failed",
        error,
        metrics: { elapsedMs: Date.now() - startedAt },
      }).catch(() => undefined)
    }
    return NextResponse.json(
      { success: false, error: "MARKET_RADAR_LUNA_SCHEDULED_SYNC_FAILED" },
      { status: 502 },
    )
  }
}
