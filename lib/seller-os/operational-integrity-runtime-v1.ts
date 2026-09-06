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
  return Object.freeze({
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
        mayelVisualDelegatedExecution.listingWriteCount,
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
