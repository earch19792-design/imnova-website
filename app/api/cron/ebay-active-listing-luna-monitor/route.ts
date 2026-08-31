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
import { persistAnalyticsLastKnownGoodV1 } from
  "@/lib/ebay/ebay-analytics-last-known-good-persistence-v1"
import { getCommercialMonitorReadonly } from
  "@/lib/ebay/commercial-monitor-readonly-service"
import { autoIngestUnmanagedEbayLiveListingsV1 } from
  "@/lib/ebay/ebay-unmanaged-live-auto-intake-v1"
import { runAutomaticCertifiedOosProtectionV1 } from
  "@/lib/ebay/ebay-auto-certified-oos-protection-v1"
import { reconcileSellerOsStockIdentityV1 } from
  "@/lib/ebay/ebay-stock-identity-auto-reconciliation-v1"
import { selectSellerOsLunaStockFreshnessRenewalsV1 } from
  "@/lib/ebay/ebay-luna-stock-freshness-renewal-v1"
import { auditSellerOsLunaProtectedSessionV1 } from
  "@/lib/ebay/ebay-luna-protected-session-server-v1"
import {
  endLiveInvariantViolationNotAvailableV1,
  SELLER_OS_LIVE_INVARIANT_END_AUTHORIZATION_V1,
} from "@/lib/ebay/ebay-commercial-improvement-action-service"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSellerOsStockGuardRuntimeBoundary } from
  "@/lib/ebay/environment-boundaries"

const BULK_END_UNLINKED_LIVE_TARGETS_V1 = Object.freeze([
  "366608128809",
  "366543596425",
  "366575102453",
  "366582630351",
  "366584136876",
  "366584249461",
  "366597780377",
  "366602466981",
])

const STOCK_IDENTITY_RECONCILIATION_TARGETS_V1 = Object.freeze([
  "366582586826", "366592485792", "366597434810",
])
const LUNA_PRODUCTION_POLL_INTERVAL_SECONDS = 900
const LUNA_PRODUCTION_STOCK_READ_AUTHORITY =
  "LUNA_PORTEX_PUBLIC_EXACT_PRODUCT_STOCK" as const

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
  const runtimeBoundary = getSellerOsStockGuardRuntimeBoundary()
  const authorizedStockGuardRuntime = runtimeBoundary.authorized
  const refreshOnly = new URL(req.url).searchParams.get("refreshOnly") ===
    "true"
  const activation = Object.freeze({
    contractVersion: "ACTIVATE_LUNA_STOCKGUARD_PRODUCTION_POLLING_V1",
    schedulerRequested: config.enabled,
    previewSchedulerEnabled:
      runtimeBoundary.historicalPreviewAllowed && config.enabled,
    dedicatedPreprodSchedulerEnabled:
      runtimeBoundary.dedicatedPreprodAllowed && config.enabled,
    productionSchedulerEnabled:
      authorizedStockGuardRuntime && config.enabled,
    boundaryClassification: runtimeBoundary.boundaryClassification,
    scheduler: Object.freeze({
      status: authorizedStockGuardRuntime && config.enabled
        ? "ENABLED" as const : "DISABLED" as const,
      intervalSeconds: LUNA_PRODUCTION_POLL_INTERVAL_SECONDS,
      maximumAttempts: 3 as const,
      baseBackoffSeconds: 30 as const,
      maximumBackoffSeconds: 900 as const,
      maximumConcurrency: 4 as const,
      oneEffectiveActiveWorkerPerLogicalWindow: true as const,
    }),
  })
  if (!authorizedStockGuardRuntime || !config.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      configuration: config,
      activation,
      safety: {
        previewOnly: runtimeBoundary.historicalPreviewAllowed,
        dedicatedPreprod: runtimeBoundary.dedicatedPreprodAllowed,
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
  for (const itemId of activation.productionSchedulerEnabled
    ? [] : BULK_END_UNLINKED_LIVE_TARGETS_V1) {
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
        previewOnly: runtimeBoundary.historicalPreviewAllowed,
        dedicatedPreprod: runtimeBoundary.dedicatedPreprodAllowed,
        boundaryClassification: runtimeBoundary.boundaryClassification,
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

    if (activation.productionSchedulerEnabled) {
      const protectedSession = await auditSellerOsLunaProtectedSessionV1({
        vaultSchemaApplied: true,
      })
      const publicStockSessionGate = Object.freeze({
        authority: LUNA_PRODUCTION_STOCK_READ_AUTHORITY,
        protectedSessionRequired: false as const,
        protectedSessionStatus: protectedSession.status,
      })
      const live = await getEbayCommercialMonitorLiveReadonly({
        accountKey,
        accountAlias: account.accountAlias,
      })
      const analyticsLastKnownGood = await persistAnalyticsLastKnownGoodV1({
        supabase,
        accountKey,
        live,
      })
      const unmanagedLiveIntake = await autoIngestUnmanagedEbayLiveListingsV1(
        supabase,
        {
          accountKey,
          listings: live.discovery.currentLiveListings,
        },
      )
      const canonicalMonitor = await getCommercialMonitorReadonly(
        supabase,
        { accountKey, accountAlias: account.accountAlias,
          configurationReason: account.reason },
        live,
      )
      const currentLive = canonicalMonitor.listings.filter((listing) =>
        listing.discovery.livePresence.status === "LIVE_ACTIVE")
      const freshnessRenewal =
        selectSellerOsLunaStockFreshnessRenewalsV1({
          schedulerIntervalSeconds: LUNA_PRODUCTION_POLL_INTERVAL_SECONDS,
          listings: currentLive.map((listing) => ({
            itemId: listing.identity.itemId,
            liveStatus: listing.discovery.livePresence.status,
            supplierLinkageStatus: listing.stock.supplierLinkageStatus,
            limitationCode: listing.stock.limitationCode,
            freshness: listing.stock.freshness,
          })),
        })
      const eligibleItemIds = currentLive.filter((listing) =>
        listing.stock.supplierLinkageStatus === "CERTIFIED")
        .map((listing) => listing.identity.itemId).sort()
      const identityMismatchSkippedItemIds = currentLive.filter((listing) =>
        listing.stock.limitationCode ===
          "CERTIFIED_COMPONENT_STOCK_IDENTITY_MISMATCH")
        .map((listing) => listing.identity.itemId).sort()
      const targetItemIds = freshnessRenewal.targetItemIds
      const stockPolling = await reconcileSellerOsStockIdentityV1(supabase, {
        accountKey,
        targetItemIds,
        intervalSeconds: LUNA_PRODUCTION_POLL_INTERVAL_SECONDS,
      })
      const postPollLive = await getEbayCommercialMonitorLiveReadonly({
        accountKey,
        accountAlias: account.accountAlias,
      })
      const postPollMonitor = await getCommercialMonitorReadonly(
        supabase,
        { accountKey, accountAlias: account.accountAlias,
          configurationReason: account.reason },
        postPollLive,
      )
      const automaticOosProtection = await runAutomaticCertifiedOosProtectionV1({
        monitor: postPollMonitor,
        allowedItemIds: targetItemIds,
        maxMarketplaceWrites: refreshOnly ? 0 : 1,
      })
      const postPollCertified = postPollMonitor.listings.filter((listing) =>
        listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
        listing.stock.supplierLinkageStatus === "CERTIFIED")
      const targetSet = new Set(targetItemIds)
      const refreshedTargets = postPollCertified.filter((listing) =>
        targetSet.has(listing.identity.itemId))
      const refreshedByItemId = new Map(refreshedTargets.map((listing) =>
        [listing.identity.itemId, listing]))
      const pollingByItemId = new Map((stockPolling.outcomes as readonly
        Record<string, unknown>[]).map((outcome) =>
        [String(outcome.itemId ?? ""), outcome]))
      const refreshSucceeded = refreshedTargets.filter((listing) =>
        listing.stock.freshness.status === "FRESH").length
      const refreshFailed = targetItemIds.length - refreshSucceeded
      const sourceUnavailableCount = refreshFailed
      const success = stockPolling.targetCount === targetItemIds.length &&
        stockPolling.ambiguousCount === 0 && stockPolling.noMatchCount === 0 &&
        sourceUnavailableCount === 0
      const refreshResults = Object.freeze({
        refreshAttempted: targetItemIds.length,
        refreshSucceeded,
        refreshFailed,
        freshCount: postPollCertified.filter((listing) =>
          listing.stock.freshness.status === "FRESH").length,
        staleCount: postPollCertified.filter((listing) =>
          listing.stock.freshness.status === "STALE").length,
        unknownCount: postPollCertified.filter((listing) =>
          listing.stock.freshness.status === "UNKNOWN").length,
        certifiedOosCount: postPollCertified.filter((listing) =>
          listing.stock.state === "CERTIFIED_OOS").length,
        failures: Object.freeze(targetItemIds.flatMap((itemId) => {
          const listing = refreshedByItemId.get(itemId)
          if (listing?.stock.freshness.status === "FRESH") return []
          const outcome = pollingByItemId.get(itemId)
          const reasonCodes = Array.isArray(outcome?.reasonCodes)
            ? outcome.reasonCodes.filter((code): code is string =>
                typeof code === "string" && /^[A-Z0-9_]+$/.test(code))
            : []
          return [{ itemId, reasonCodes: reasonCodes.length
            ? reasonCodes
            : [listing?.stock.limitationCode ??
                String(outcome?.status ??
                  "LUNA_REFRESH_DID_NOT_PRODUCE_FRESH_EVIDENCE")] }]
        })),
      })
      const { error: leaseFinishError } = await supabase.rpc(
        "finish_ebay_targeted_luna_monitor_run",
        { p_account_key: accountKey, p_run_id: runId, p_success: success,
          p_error_code: success ? null : "LUNA_PRODUCTION_POLLING_PARTIAL" },
      )
      if (leaseFinishError) throw new Error("TARGETED_LUNA_MONITOR_FINISH_FAILED")
      leaseOwned = false
      await finishSellerAutomationRun(supabase, runId, {
        status: success ? "completed" : "partial",
        claimedTasks: stockPolling.targetCount,
        successfulTasks: stockPolling.autoResolvedCount,
        failedTasks: stockPolling.ambiguousCount + stockPolling.noMatchCount +
          sourceUnavailableCount,
        metrics: { stage: "LUNA_PRODUCTION_STOCK_POLLING_V1", accountKey,
          activation, publicStockSessionGate,
          protectedSessionStatus: protectedSession.status,
          currentLiveCount: currentLive.length,
          unmanagedLiveIntake,
          certifiedLinkageCount: currentLive.filter((listing) =>
            listing.stock.supplierLinkageStatus === "CERTIFIED").length,
          pollEligibleCount: eligibleItemIds.length,
          identityMismatchSkippedCount: identityMismatchSkippedItemIds.length,
          freshnessRenewal, refreshResults,
          stockPolling, automaticOosProtection },
      })
      return NextResponse.json({ success,
        status: success ? "completed" : "partial",
        activation,
        publicStockSessionGate,
        oldGateRevalidation: "STALE_GATE_CLOSED_CURRENT_PREREQUISITES_SATISFIED",
        protectedSessionStatus: protectedSession.status,
        humanBootstrapRequired: false,
        currentLiveCount: currentLive.length,
        certifiedLinkageCount: currentLive.filter((listing) =>
          listing.stock.supplierLinkageStatus === "CERTIFIED").length,
        pollEligibleCount: eligibleItemIds.length,
        identityMismatchSkippedCount: identityMismatchSkippedItemIds.length,
        freshnessRenewal,
        analyticsLastKnownGood,
        refreshResults,
        stockPolling,
        automaticOosProtection,
        automationRunId: runId,
        safety: { parallelSchedulerCreated: false, newMigrationCount: 1,
          browserSessionRequired: false, humanInterventionCount: 0,
          lunaWrites: 0, marketplaceWrites:
            automaticOosProtection.ebayWriteCount },
      }, { status: success ? 200 : 503 })
    }

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
    const stockIdentityTargetIds = canonicalMonitor.listings
      .filter((listing) =>
        STOCK_IDENTITY_RECONCILIATION_TARGETS_V1.includes(
          listing.identity.itemId) &&
        listing.discovery.livePresence.status === "LIVE_ACTIVE" &&
        listing.stock.supplierLinkageStatus === "CERTIFIED" &&
        listing.stock.state === "STOCK_UNKNOWN")
      .map((listing) => listing.identity.itemId)
    const stockIdentityReconciliation =
      await reconcileSellerOsStockIdentityV1(supabase, {
        accountKey, targetItemIds: stockIdentityTargetIds,
      })
    const postReconciliationLive = stockIdentityReconciliation.autoResolvedCount
      ? await getEbayCommercialMonitorLiveReadonly({
          accountKey, accountAlias: account.accountAlias,
        }) : live
    const postReconciliationMonitor = stockIdentityReconciliation.autoResolvedCount
      ? await getCommercialMonitorReadonly(
          supabase,
          { accountKey, accountAlias: account.accountAlias,
            configurationReason: account.reason },
          postReconciliationLive,
        ) : canonicalMonitor
    const postReconciliationProtection =
      await runAutomaticCertifiedOosProtectionV1({
        monitor: postReconciliationMonitor,
        allowedItemIds: stockIdentityTargetIds,
        maxMarketplaceWrites: 1,
      })
    if (postReconciliationProtection.ebayWriteCount === 1) {
      const { error: leaseFinishError } = await supabase.rpc(
        "finish_ebay_targeted_luna_monitor_run",
        { p_account_key: accountKey, p_run_id: runId, p_success: true,
          p_error_code: null },
      )
      if (leaseFinishError) throw new Error("TARGETED_LUNA_MONITOR_FINISH_FAILED")
      leaseOwned = false
      await finishSellerAutomationRun(supabase, runId, {
        status: "completed",
        claimedTasks: stockIdentityReconciliation.targetCount,
        successfulTasks: stockIdentityReconciliation.autoResolvedCount,
        failedTasks: stockIdentityReconciliation.ambiguousCount +
          stockIdentityReconciliation.noMatchCount,
        metrics: { stage: "STOCK_IDENTITY_AUTO_RECONCILIATION_V1",
          accountKey, stockIdentityReconciliation,
          automaticOosProtection: postReconciliationProtection,
          heartbeatAvailable: false },
      })
      return NextResponse.json({ success: true, status: "completed",
        stockIdentityReconciliation,
        automaticOosProtection: postReconciliationProtection,
        automationRunId: runId })
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
      stockIdentityReconciliation,
      postReconciliationProtection,
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
      stockIdentityReconciliation,
      postReconciliationProtection,
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
