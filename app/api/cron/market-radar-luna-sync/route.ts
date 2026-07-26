export const runtime = "nodejs"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  getLunaCatalogCoverageRuntimeConfiguration,
  runLunaPortexMarketRadarSync,
} from "@/lib/market-radar-lunaportex"
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

const CRON_SYNC_TIME_BUDGET_MS = 42_000
const CRON_SYNC_PAGE_BUDGET = 4

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? ""
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`)
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const startedAt = Date.now()
  const readOnlyMode =
    new URL(req.url).searchParams.get("mode") ===
      "readonly"
  const supabase = getSupabaseAdminClient()
  let automationRunId = ""
  try {
    const automationRun = await createSellerAutomationRun(supabase, {
      runKind: "luna_sync",
      triggerSource: "schedule",
    })
    automationRunId = automationRun.id
    const sync = await runLunaPortexMarketRadarSync(
      supabase,
      {
        timeBudgetMs:
          CRON_SYNC_TIME_BUDGET_MS,
        maxCatalogPagesPerInvocation:
          CRON_SYNC_PAGE_BUDGET,
      }
    )
    const continuationRequired =
      sync.continuationRequired === true
    const catalogComplete =
      sync.scanStatus === "COMPLETE" &&
      !continuationRequired
    const taskReconciliation =
      !catalogComplete || readOnlyMode
        ? {
            insertedOrUpdated:
              0,
            dueNow:
              0,
            status:
              !catalogComplete
                ? continuationRequired
                  ? "SKIPPED_CATALOG_CONTINUATION"
                  : "SKIPPED_CATALOG_NOT_COMPLETE"
                : "SKIPPED_READ_ONLY",
          }
        : await reconcileSellerScanTasks(supabase, {
            forceDue: false,
            limit: 300,
          })
    const protection =
      !catalogComplete || readOnlyMode
        ? {
            status:
              !catalogComplete
                ? "SKIPPED_CATALOG_NOT_COMPLETE"
                : "SKIPPED_READ_ONLY",
          }
        : await reconcileActiveListingProtectionRisks(supabase)
    const whatsappConfiguration = getSellerWhatsAppGatewayConfiguration()
    const notificationDispatchEnabled =
      !readOnlyMode &&
      catalogComplete &&
      process.env.LUNA_MARKET_RADAR_NOTIFICATION_DISPATCH_ENABLED === "true"
    const whatsapp =
      notificationDispatchEnabled &&
      whatsappConfiguration.deliveryAttemptAllowed
      ? await deliverSellerWhatsAppAlerts(supabase, {
          workerId: buildSellerWorkerId("seller-whatsapp-protection"),
          limit: 20,
          dryRun: false,
        }).catch(() => ({ mode: "delivery_error" as const }))
      : { mode: "disabled" as const, status: whatsappConfiguration.status }
    const metrics = {
      syncStatus: sync.scanStatus,
      scanCompletenessPercent: sync.scanCompletenessPercent,
      catalogCoverage:
        getLunaCatalogCoverageRuntimeConfiguration(),
      taskReconciliation,
      protection,
      whatsapp,
      elapsedMs: Date.now() - startedAt,
    }
    await finishSellerAutomationRun(supabase, automationRunId, {
      status: sync.scanStatus === "COMPLETE"
        ? "completed"
        : sync.scanStatus === "FAILED"
          ? "failed"
          : "partial",
      metrics,
    })
    return NextResponse.json(
      {
        success: true,
        sync,
        taskReconciliation,
        protection,
        whatsapp,
        automation: {
          stage: "LUNA_MARKET_RADAR_REFRESH",
          nextStage:
            continuationRequired
              ? "LUNA_MARKET_RADAR_RESUME"
              : catalogComplete
                ? "EBAY_LUNA_PRIORITY_SCAN"
                : "LUNA_CATALOG_PARTIAL_TERMINAL",
          notificationDispatchEnabled,
          readOnlyMode,
          catalogComplete,
          catalogCoverage:
            getLunaCatalogCoverageRuntimeConfiguration(),
          elapsedMs: Date.now() - startedAt,
        },
      },
      {
        status:
          continuationRequired
            ? 202
            : 200,
      }
    )
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
