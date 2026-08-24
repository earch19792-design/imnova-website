export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

import { NextResponse } from "next/server"

import {
  createSellerAutomationRun,
  finishSellerAutomationRun,
  reconcileActiveListingProtectionRisks,
} from "@/lib/ebay/ebay-seller-command-center-automation"
import { commercialPreviewCronAuthorized } from "@/lib/ebay/ebay-commercial-preview-pilot"
import { getEbaySellerAccountScopeConfiguration } from "@/lib/ebay/ebay-seller-account-scope"
import {
  fetchPublicLunaProductForActiveListingMonitor,
  runTargetedActiveListingLunaMonitor,
} from "@/lib/ebay/ebay-targeted-active-listing-luna-monitor"
import { getEbayCommercialMonitorLiveReadonly } from
  "@/lib/ebay/ebay-commercial-monitor-live-readonly"
import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { runAutomaticCertifiedOosProtectionV1 } from
  "@/lib/ebay/ebay-auto-certified-oos-protection-v1"
import {
  endLiveInvariantViolationNotAvailableV1,
  SELLER_OS_LIVE_INVARIANT_END_AUTHORIZATION_V1,
} from "@/lib/ebay/ebay-commercial-improvement-action-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

const BULK_END_UNLINKED_LIVE_TARGETS_V1 = Object.freeze([
  "366543596425",
  "366575102453",
  "366582630351",
  "366584136876",
  "366584249461",
  "366597780377",
  "366602466981",
  "366608128809",
])

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z0-9_]+$/.test(code)
    ? code.slice(0, 120)
    : "TARGETED_ACTIVE_LISTING_LUNA_MONITOR_FAILED"
}

function row(value: unknown) {
  const resolved = Array.isArray(value) ? value[0] : value
  return resolved && typeof resolved === "object" && !Array.isArray(resolved)
    ? resolved as Record<string, unknown>
    : null
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed)))
    : fallback
}

function configuration() {
  return {
    enabled: process.env.EBAY_TARGETED_LUNA_ACTIVE_MONITOR_ENABLED === "true",
    previewOnly: true,
    limit: boundedInteger(
      process.env.EBAY_TARGETED_LUNA_ACTIVE_MONITOR_LIMIT,
      100,
      1,
      100,
    ),
    concurrency: boundedInteger(
      process.env.EBAY_TARGETED_LUNA_ACTIVE_MONITOR_CONCURRENCY,
      4,
      1,
      4,
    ),
  }
}

export async function GET(req: Request) {
  if (!commercialPreviewCronAuthorized(req)) {
    return NextResponse.json({ success: false, error: "CRON_UNAUTHORIZED" }, { status: 401 })
  }
  const config = configuration()
  const activation = Object.freeze({
    contractVersion: "AUTO_CERTIFIED_OOS_END_LISTING_V1",
    schedulerRequested: config.enabled,
    previewSchedulerEnabled:
      process.env.VERCEL_ENV === "preview" && config.enabled,
    productionSchedulerEnabled: false as const,
  })
  if (process.env.VERCEL_ENV !== "preview" || !config.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      configuration: config,
      activation,
      safety: {
        previewOnly: true,
        productionSchedulerEnabled: false,
        authenticatedLunaReads: 0,
        ebayApiWrites: 0,
        openAiCalls: 0,
        productionChanged: false,
      },
    })
  }

  const account = getEbaySellerAccountScopeConfiguration()
  const accountKey = account.accountKey
  if (!accountKey) {
    return NextResponse.json(
      { success: false, error: "TARGETED_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED" },
      { status: 423 },
    )
  }
  const supabase = getSupabaseAdminClient()
  const bulkEndOutcomes: Array<Record<string, unknown>> = []
  for (const itemId of BULK_END_UNLINKED_LIVE_TARGETS_V1) {
    try {
      const currentLive = await getEbayCommercialMonitorLiveReadonly({
        accountKey,
        accountAlias: account.accountAlias,
      })
      const currentMonitor = await getCommercialMonitorReadonly(
        supabase,
        { accountKey, accountAlias: account.accountAlias,
          configurationReason: account.reason },
        currentLive,
      )
      const listing = currentMonitor.listings.find((row) =>
        row.identity.itemId === itemId) ?? null
      if (!listing ||
          listing.discovery.livePresence.status !== "LIVE_ACTIVE") {
        bulkEndOutcomes.push({ itemId, status: "SKIPPED_NOT_CURRENT_LIVE",
          ebayWriteCount: 0 })
        continue
      }
      if (listing.stock.supplierLinkageStatus === "CERTIFIED") {
        bulkEndOutcomes.push({ itemId, status: "SKIPPED_CERTIFIED",
          ebayWriteCount: 0 })
        continue
      }
      const result = await endLiveInvariantViolationNotAvailableV1({
        itemId,
        expectedSku: listing.identity.sku,
        automationAuthorization:
          SELLER_OS_LIVE_INVARIANT_END_AUTHORIZATION_V1,
      })
      bulkEndOutcomes.push({ itemId, status: result.status,
        ebayWriteCount: result.ebayWriteCount,
        officialReadbackNotCurrentLive:
          result.officialReadbackNotCurrentLive })
    } catch (error) {
      bulkEndOutcomes.push({ itemId, status: "FAILED",
        error: safeCode(error), ebayWriteCount: 0 })
    }
  }
  const bulkEndWriteCount = bulkEndOutcomes.reduce((sum, outcome) => sum +
    (typeof outcome.ebayWriteCount === "number"
      ? outcome.ebayWriteCount : 0), 0)
  const bulkEndFailedCount = bulkEndOutcomes.filter((outcome) =>
    outcome.status === "FAILED").length
  if (bulkEndWriteCount > 0 || bulkEndFailedCount > 0) {
    return NextResponse.json({
      success: bulkEndFailedCount === 0,
      status: bulkEndFailedCount === 0
        ? "bulk_end_unlinked_completed" : "bulk_end_unlinked_partial",
      targetCount: BULK_END_UNLINKED_LIVE_TARGETS_V1.length,
      outcomes: bulkEndOutcomes,
      ebayWriteCount: bulkEndWriteCount,
      humanInterventionCount: 0,
      safety: { browserSessionRequired: false, inventoryApiUsed: false,
        databaseWrites: 0, lunaWrites: 0, otherListingWrites: 0,
        newSchedulerCreated: false },
    }, { status: bulkEndFailedCount === 0 ? 200 : 502 })
  }
  let runId = ""
  let leaseOwned = false
  try {
    const run = await createSellerAutomationRun(supabase, {
      runKind: "risk_monitor",
      triggerSource: "schedule",
      metrics: {
        stage: "TARGETED_ACTIVE_LISTING_LUNA_MONITOR",
        accountKey,
        previewOnly: true,
      },
    })
    runId = run.id
    const { data: claimData, error: claimError } = await supabase.rpc(
      "claim_ebay_targeted_luna_monitor_run",
      {
        p_account_key: accountKey,
        p_run_id: runId,
        p_lease_seconds: 180,
      },
    )
    const claim = row(claimData)
    if (claimError || !claim) {
      throw new Error("TARGETED_LUNA_MONITOR_CLAIM_FAILED")
    }
    if (claim.claimed !== true) {
      await finishSellerAutomationRun(supabase, runId, {
        status: "cancelled",
        metrics: {
          stage: "TARGETED_ACTIVE_LISTING_LUNA_MONITOR",
          accountKey,
          reason: "TARGETED_LUNA_MONITOR_ALREADY_RUNNING",
          heartbeatAvailable: false,
        },
      })
      return NextResponse.json({
        success: true,
        status: "already_running",
        resumeAt: claim.active_run_lease_expires_at ?? null,
        safety: {
          previewOnly: true,
          authenticatedLunaReads: 0,
          ebayApiWrites: 0,
          openAiCalls: 0,
          productionChanged: false,
        },
      }, { status: 202 })
    }
    leaseOwned = true

    // Protection is evaluated first so a fresh certified-zero condition cannot
    // age out behind the broader evidence refresh. The account-scoped lease
    // serializes writers; the writer itself re-reads eBay before and after.
    const live = await getEbayCommercialMonitorLiveReadonly({
      accountKey,
      accountAlias: account.accountAlias,
    })
    const canonicalMonitor = await getCommercialMonitorReadonly(
      supabase,
      { accountKey, accountAlias: account.accountAlias,
        configurationReason: account.reason },
      live,
    )
    const automaticOosProtection = await runAutomaticCertifiedOosProtectionV1({
      monitor: canonicalMonitor,
      maxMarketplaceWrites: 1,
    })
    if (automaticOosProtection.ebayWriteCount === 1) {
      const { error: leaseFinishError } = await supabase.rpc(
        "finish_ebay_targeted_luna_monitor_run",
        { p_account_key: accountKey, p_run_id: runId, p_success: true,
          p_error_code: null },
      )
      if (leaseFinishError) throw new Error("TARGETED_LUNA_MONITOR_FINISH_FAILED")
      leaseOwned = false
      await finishSellerAutomationRun(supabase, runId, {
        status: "completed",
        claimedTasks: automaticOosProtection.eligibleItemIds.length,
        successfulTasks: 1,
        failedTasks: 0,
        metrics: { stage: "AUTO_CERTIFIED_OOS_END_LISTING",
          accountKey, automaticOosProtection, heartbeatAvailable: true },
      })
      return NextResponse.json({ success: true, status: "completed",
        automaticOosProtection, automationRunId: runId })
    }

    // The public exact watcher never invokes the legacy automatic supplier
    // linker. Existing listings enter the bounded human-approval queue; only
    // the versioned Item-ID-bound approval contract can authorize a Luna read.
    const preflightProtection = {
      status: "skipped_human_approved_exact_link_required" as const,
      automaticSupplierLinksCreated: 0 as const,
      registryBusinessDataMutations: 0 as const,
    }
    const monitor = await runTargetedActiveListingLunaMonitor(supabase, {
      accountKey,
      limit: config.limit,
      concurrency: config.concurrency,
      productFetcher: (target) =>
        fetchPublicLunaProductForActiveListingMonitor(target.productUrl),
    })

    // Global reconciliation is safe only after every selected active listing
    // received fresh exact Luna evidence. On a partial run, retaining the old
    // protection heartbeat is the fail-closed behavior.
    const protection = monitor.status === "complete"
      ? await reconcileActiveListingProtectionRisks(supabase, {
          limit: Math.max(1, Math.min(monitor.totalActiveListingRows, 100)),
          timeBudgetMs: 20_000,
        })
      : {
          status: "skipped_fail_closed" as const,
          reason: "TARGETED_LUNA_MONITOR_NOT_COMPLETE",
        }
    const status = monitor.status === "complete" ? "completed" : "partial"
    const metrics = {
      stage: "TARGETED_ACTIVE_LISTING_LUNA_MONITOR",
      accountKey,
      monitor,
      preflightProtection,
      protection,
      automaticOosProtection,
      heartbeatAvailable: monitor.status === "complete",
    }
    const leaseSuccess = monitor.status === "complete"
    const { error: leaseFinishError } = await supabase.rpc(
      "finish_ebay_targeted_luna_monitor_run",
      {
        p_account_key: accountKey,
        p_run_id: runId,
        p_success: leaseSuccess,
        p_error_code: leaseSuccess
          ? null
          : monitor.status === "partial"
            ? "TARGETED_LUNA_MONITOR_PARTIAL"
            : "TARGETED_LUNA_MONITOR_UNAVAILABLE",
      },
    )
    if (leaseFinishError) throw new Error("TARGETED_LUNA_MONITOR_FINISH_FAILED")
    leaseOwned = false
    await finishSellerAutomationRun(supabase, runId, {
      status,
      claimedTasks: monitor.exactTargetsSelected,
      successfulTasks: monitor.exactTargetsObserved,
      failedTasks: monitor.unavailable.length,
      metrics,
    })
    return NextResponse.json({
      success: monitor.status === "complete",
      status: monitor.status,
      monitor,
      preflightProtection,
      protection,
      automaticOosProtection,
      automationRunId: runId,
    }, { status: monitor.status === "unavailable" ? 503 : 200 })
  } catch (error) {
    const code = safeCode(error)
    if (runId && leaseOwned) {
      try {
        await supabase.rpc("finish_ebay_targeted_luna_monitor_run", {
          p_account_key: accountKey,
          p_run_id: runId,
          p_success: false,
          p_error_code: code,
        })
      } catch {
        // The database lease expires automatically; never mask the root error.
      }
      leaseOwned = false
    }
    if (runId) {
      await finishSellerAutomationRun(supabase, runId, {
        status: "failed",
        error,
        metrics: {
          stage: "TARGETED_ACTIVE_LISTING_LUNA_MONITOR",
          accountKey,
          heartbeatAvailable: false,
          safety: {
            previewOnly: true,
            ebayApiWrites: 0,
            openAiCalls: 0,
            productionChanged: false,
          },
        },
      }).catch(() => undefined)
    }
    return NextResponse.json({
      success: false,
      error: code,
      safety: {
        previewOnly: true,
        ebayApiWrites: 0,
        openAiCalls: 0,
        productionChanged: false,
      },
    }, { status: code === "TARGETED_ACTIVE_LISTING_LUNA_MONITOR_PREVIEW_ONLY" ? 403 : 502 })
  }
}
