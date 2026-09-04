export const runtime = "nodejs"
export const maxDuration = 300

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
import { runSellerOsDemandFirstBroadNetNightlyV1 } from
  "@/lib/ebay/ebay-demand-first-broad-net-orchestrator-v1"
import { runRadarLunaQuickPickHandoffCycleV1 } from
  "@/lib/ebay/ebay-radar-luna-quick-pick-handoff-v1"
import { getEbaySellerAccountScopeConfiguration } from
  "@/lib/ebay/ebay-seller-account-scope"
import { getEbayTaxonomyListingIntelligence } from
  "@/lib/ebay/ebay-seller-keyword-demand-gateway"
import { preflightEbayCategoryProductIdentifiers } from
  "@/lib/ebay/ebay-draft-only-gateway"
import { runQuickPickRadarOvernightEnrichmentV1 } from
  "@/lib/ebay/ebay-quick-pick-radar-overnight-enrichment-v1"
import { runSellerOsLongitudinalRadarCycleV1 } from
  "@/lib/ebay/ebay-longitudinal-family-radar-runtime-v1"

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
  const certificationOnly = new URL(req.url).searchParams.get(
    "longitudinalCertification",
  ) === "1"
  if (certificationOnly) {
    try {
      const longitudinalRadar = await runSellerOsLongitudinalRadarCycleV1({
        supabase, mode: "CERTIFICATION",
      })
      return NextResponse.json({ success: true, longitudinalRadar,
        automation: { stage: "LONGITUDINAL_RADAR_CERTIFICATION",
          schedulerRuntimePathReused: true,
          elapsedMs: Date.now() - startedAt } })
    } catch {
      return NextResponse.json({ success: false,
        error: "LONGITUDINAL_RADAR_CERTIFICATION_FAILED" }, { status: 502 })
    }
  }
  const radarToQuickPickCertification = new URL(req.url).searchParams.get(
    "radarToQuickPickCertification",
  ) === "1"
  if (radarToQuickPickCertification) {
    try {
      const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
      if (!accountKey) throw new Error("RADAR_TO_QUICK_PICK_ACCOUNT_SCOPE_REQUIRED")
      const radarToQuickPick = await runRadarLunaQuickPickHandoffCycleV1({
        supabase, accountKey, mode: "CERTIFICATION",
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
      })
      return NextResponse.json({ success: true, radarToQuickPick,
        automation: { stage: "RADAR_TO_LUNA_TO_QUICK_PICK_CERTIFICATION",
          schedulerRuntimePathReused: true,
          elapsedMs: Date.now() - startedAt } })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      return NextResponse.json({ success: false,
        error: /^[A-Z][A-Z0-9_]{2,119}$/.test(message) ? message :
          "RADAR_TO_QUICK_PICK_CERTIFICATION_FAILED" }, { status: 502 })
    }
  }
  let automationRunId = ""
  try {
    const automationRun = await createSellerAutomationRun(supabase, {
      runKind: "luna_sync",
      triggerSource: "schedule",
    })
    automationRunId = automationRun.id
    const longitudinalRadar = await runSellerOsLongitudinalRadarCycleV1({
      supabase, mode: "SCHEDULED",
    }).catch(() => ({
      contractVersion: "SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_V1" as const,
      status: "RETRYABLE_FAILURE" as const,
      schedulerEnabled: true as const,
      marketplaceWrites: 0 as const,
    }))
    const sync = await runLunaPortexMarketRadarSync(supabase)
    const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
    if (!accountKey) throw new Error("NIGHT_RADAR_FACTORY_ACCOUNT_SCOPE_REQUIRED")
    const broadNet = await runSellerOsDemandFirstBroadNetNightlyV1({
      supabase, accountKey,
    })
    let radarToQuickPick
    try {
      radarToQuickPick = await runRadarLunaQuickPickHandoffCycleV1({
        supabase, accountKey, mode: "SCHEDULED",
        taxonomyReader: getEbayTaxonomyListingIntelligence,
        productIdentifierPolicyReader: preflightEbayCategoryProductIdentifiers,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      const reasonCode = /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
        ? message : "RADAR_TO_QUICK_PICK_HANDOFF_FAILED"
      radarToQuickPick = {
        contractVersion: "RADAR_LUNA_QUICK_PICK_HANDOFF_V1",
        status: "RETRYABLE_FAILURE", reasonCode,
        quickPickHandoffCreated: false,
        futureRadarToLunaRequiresCodex: false,
        futureRadarToQuickPickRequiresCodex: false,
        marketplaceWrites: 0, listingPublications: 0,
      }
    }
    let quickPickOvernightEnrichment
    try {
      quickPickOvernightEnrichment =
        await runQuickPickRadarOvernightEnrichmentV1({
          supabase, accountKey,
          taxonomyReader: getEbayTaxonomyListingIntelligence,
          productIdentifierPolicyReader:
            preflightEbayCategoryProductIdentifiers,
          runId: automationRunId,
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      quickPickOvernightEnrichment = {
        contractVersion: "QUICK_PICK_RADAR_OVERNIGHT_ENRICHMENT_V1",
        status: "PARTIAL",
        reasonCode: /^[A-Z][A-Z0-9_]{2,119}$/.test(message)
          ? message : "QUICK_PICK_OVERNIGHT_ENRICHMENT_FAILED",
        existingRadarReused: true,
        existingSchedulerReused: true,
        existingQuickPickResolversReused: true,
        existingResolversReused: true,
        readyNowNotDelayed: true,
        readyProductsNeverWaitForNight: true,
        comparableFactPromotedToProductTruth: false,
        ownerOnlyAfterExhaustion: true,
        ownerActionVisibleOnlyAfterAutomaticResolutionExhausted: true,
        radarSignalsNotCountedAsReady: true,
        remoteOwnerLastMileReady: true,
        overnightEnrichmentReuseCertified: false,
        safety: { marketplaceWrites: 0, listingPublications: 0,
          customerProductionTouched: false },
      }
    }
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
      radarRefreshExecuted: true,
      longitudinalRadar,
      freshFamilyObservationsCreated: broadNet.freshObservationsCreated,
      radarToQuickPick,
      quickPickOvernightEnrichment,
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
      longitudinalRadar,
      broadNet,
      radarToQuickPick,
      quickPickOvernightEnrichment,
      taskReconciliation,
      protection,
      whatsapp,
      automation: {
        stage: "RADAR_TO_LUNA_TO_QUICK_PICK",
        nextStage: radarToQuickPick.quickPickHandoffCreated
          ? "QUICK_PICK_GOLDEN_PATH" : "EBAY_LUNA_PRIORITY_SCAN",
        radarRefreshExecuted: true,
        freshFamilyObservationsCreated: broadNet.freshObservationsCreated,
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
