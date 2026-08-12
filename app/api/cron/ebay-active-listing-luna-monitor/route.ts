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
import { fetchLunaAuthenticatedDirectedProductV1 } from
  "@/lib/ebay/ebay-luna-authenticated-http-watcher-v1"
import { runTargetedActiveListingLunaMonitor } from "@/lib/ebay/ebay-targeted-active-listing-luna-monitor"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

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
  if (process.env.VERCEL_ENV !== "preview" || !config.enabled) {
    return NextResponse.json({
      success: true,
      status: "disabled",
      configuration: config,
      safety: {
        previewOnly: true,
        authenticatedLunaReads: 0,
        ebayApiWrites: 0,
        openAiCalls: 0,
        productionChanged: false,
      },
    })
  }

  const accountKey = getEbaySellerAccountScopeConfiguration().accountKey
  if (!accountKey) {
    return NextResponse.json(
      { success: false, error: "TARGETED_ACTIVE_LISTING_ACCOUNT_SCOPE_REQUIRED" },
      { status: 423 },
    )
  }
  const supabase = getSupabaseAdminClient()
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

    // The authenticated watcher never invokes the legacy automatic supplier
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
        fetchLunaAuthenticatedDirectedProductV1(target.productUrl),
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
