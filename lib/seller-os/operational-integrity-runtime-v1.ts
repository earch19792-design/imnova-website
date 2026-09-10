import type { SupabaseClient } from "@supabase/supabase-js"

import { runMayelVisualSafeRebaseRecoveryV1 } from
  "../ebay/ebay-mayel-visual-safe-rebase-runtime-v1"
import { runMayelVisualDelegatedRuntimeV1 } from
  "../ebay/ebay-mayel-visual-delegated-runtime-v1"
import { runMayelContinuousLivePortfolioOptimizationV1 } from
  "../ebay/ebay-mayel-continuous-live-portfolio-v1"
import { runSellerOsEconomicEvidenceRefreshV1 } from
  "./economic-evidence-refresh-runtime-v1"

import { persistSellerOsOperationalIntegrityAuditV1,
  recoverSellerOsOperationalIntegrityV1 } from
  "./operational-integrity-ledger-v1"
import { auditSellerOsOperationalSnapshotV1,
  readSellerOsOperationalSnapshotV1 } from "./operational-snapshot-v1"

export const SELLER_OS_OPERATIONAL_INTEGRITY_RUNTIME_V1 =
  "SELLER_OS_OPERATIONAL_INTEGRITY_RUNTIME_V1" as const

export async function runSellerOsOperationalIntegrityRuntimeV1(
  input: Readonly<{
    supabase: SupabaseClient
    accountKey: string
    accountAlias: string | null
    now?: Date
  }>,
) {
  const read = () => readSellerOsOperationalSnapshotV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    accountAlias: input.accountAlias,
    now: input.now,
  }).then((snapshot) => ({ snapshot,
    audit: auditSellerOsOperationalSnapshotV1(snapshot) }))
  const initial = await read()
  const receipt = await persistSellerOsOperationalIntegrityAuditV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    audit: initial.audit,
  })
  const recovery = await recoverSellerOsOperationalIntegrityV1({
    supabase: input.supabase,
    accountKey: input.accountKey,
    audit: initial.audit,
    reRead: async () => (await read()).audit,
  })
  const mayelVisualSafeRebase = await runMayelVisualSafeRebaseRecoveryV1({
    supabase: input.supabase, accountKey: input.accountKey,
  })
  let mayelVisualDelegatedExecution: Awaited<ReturnType<
    typeof runMayelVisualDelegatedRuntimeV1>> | Readonly<{
      status: "DEGRADED"
      failureClass: string
      listingWriteCount: 0
      mediaWriteCount: 0
    }>
  try {
    mayelVisualDelegatedExecution = await runMayelVisualDelegatedRuntimeV1({
      supabase: input.supabase, accountKey: input.accountKey,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    mayelVisualDelegatedExecution = Object.freeze({
      status: "DEGRADED" as const,
      failureClass: /^[A-Z][A-Z0-9_:+.-]{2,319}$/.test(code)
        ? code : "MAYEL_VISUAL_DELEGATED_RUNTIME_FAILED",
      listingWriteCount: 0 as const, mediaWriteCount: 0 as const,
    })
  }
  const mayelContinuousPortfolio =
    await runMayelContinuousLivePortfolioOptimizationV1({
      supabase: input.supabase, accountKey: input.accountKey, now: input.now,
    })
  let economicEvidenceRefresh: Awaited<ReturnType<
    typeof runSellerOsEconomicEvidenceRefreshV1>> | Readonly<{
      contractVersion: typeof import("./economic-evidence-refresh-v1")
        .SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1
      status: "FAILED_RETRYABLE"
      reasonCode: string
      marketplaceWrites: 0
    }>
  try {
    economicEvidenceRefresh = await runSellerOsEconomicEvidenceRefreshV1({
      supabase: input.supabase, accountKey: input.accountKey,
      accountAlias: input.accountAlias, now: input.now,
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : ""
    economicEvidenceRefresh = Object.freeze({
      contractVersion: "SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_V1" as const,
      status: "FAILED_RETRYABLE" as const,
      reasonCode: /^[A-Z][A-Z0-9_]{2,159}$/.test(reason)
        ? reason : "SELLER_OS_ECONOMIC_EVIDENCE_REFRESH_FAILED",
      marketplaceWrites: 0 as const,
    })
  }
  const { runIpadOutboxRuntimeV1 } = await import("./ipad-sync-runtime-v1")
  const ipadOutbox = mayelVisualDelegatedExecution.listingWriteCount > 0
    ? { status: "NEXT_RUNTIME_WRITE_BUDGET", processed: 0, listingWriteCount: 0, mediaWriteCount: 0 }
    : await runIpadOutboxRuntimeV1(input).catch(() => ({ status: "RETRY_NEXT_RUNTIME", processed: 0, listingWriteCount: 0, mediaWriteCount: 0 }))
  // Permanent OWNER delegation uses the same runtime and one shared dispatch budget.
  // No additional worker, heartbeat, Shipping claim or portfolio scan is introduced.
  const contentBudgetAvailable = mayelVisualDelegatedExecution.status !== "DEGRADED" && ipadOutbox.status !== "RETRY_NEXT_RUNTIME" &&
    mayelVisualDelegatedExecution.listingWriteCount === 0 &&
    ipadOutbox.listingWriteCount === 0 && !("dispatchAttempts" in ipadOutbox && Number(ipadOutbox.dispatchAttempts) > 0) &&
    !("writeOutcomeUnknown" in ipadOutbox && ipadOutbox.writeOutcomeUnknown)
  let mayelContent: { status: string; writes: number; dispatchAttempts: number } = { status: "NEXT_RUNTIME_WRITE_BUDGET", writes: 0, dispatchAttempts: 0 }
  if (contentBudgetAvailable) {
    const { runMayelContentOutboxV1, enqueueMayelContentOptimizationV1 } = await import("./mayel-autonomous-content-server-v1")
    try {
      mayelContent = await runMayelContentOutboxV1(input)
      if (mayelContent.status === "NO_DUE_WORK" && "visualQueue" in mayelContinuousPortfolio) {
        const candidates = mayelContinuousPortfolio.visualQueue.outcomes.filter(o => o.eligible === true && typeof o.taskId === "string")
        // Rotate within the already-read bounded portfolio at the existing cadence.
        // At most one content evidence preparation per runtime, never a new scan.
        const index = candidates.length ? Math.floor((input.now ?? new Date()).getTime() / (30 * 60_000)) % candidates.length : 0
        const candidate = candidates[index]
        if (typeof candidate?.taskId === "string") {
          const queued = await enqueueMayelContentOptimizationV1({ ...input, taskId: candidate.taskId })
          mayelContent = { status: queued.status, writes: 0, dispatchAttempts: 0 }
          if (queued.status === "PENDING_EBAY_SYNC") mayelContent = await runMayelContentOutboxV1(input)
        }
      }
    } catch { mayelContent = { status: "RETRY_NEXT_RUNTIME", writes: 0, dispatchAttempts: 0 } }
  }
  return Object.freeze({
    ipadOutbox,
    mayelContent,
    contractVersion: SELLER_OS_OPERATIONAL_INTEGRITY_RUNTIME_V1,
    status: initial.audit.status,
    snapshotContractVersion: initial.snapshot.contractVersion,
    summary: initial.audit.summary,
    authorityFailures: initial.snapshot.authorityFailures,
    durableReceipt: receipt,
    recovery,
    mayelVisualSafeRebase,
    mayelVisualDelegatedExecution,
    mayelContinuousPortfolio,
    economicEvidenceRefresh,
    safety: Object.freeze({
      marketplaceWrites:
        mayelVisualDelegatedExecution.listingWriteCount + ipadOutbox.listingWriteCount + mayelContent.writes,
      productDecisions: 0 as const,
      categorySelections: 0 as const,
      publisherDispatches: 0 as const,
      genericRecoveryOnly: true as const,
      businessFactWrites: 0 as const,
      mayelManifestRebaseCount: mayelVisualSafeRebase.rebasedCount,
      mayelVisualListingWriteCount:
        mayelVisualDelegatedExecution.listingWriteCount,
      mayelVisualMediaWriteCount:
        mayelVisualDelegatedExecution.mediaWriteCount,
      mayelContinuousPortfolioMarketplaceWrites:
        mayelContinuousPortfolio.marketplaceWrites,
      economicEvidenceRefreshMarketplaceWrites: 0 as const,
    }),
  })
}
