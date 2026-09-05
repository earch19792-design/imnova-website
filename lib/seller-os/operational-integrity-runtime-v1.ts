import type { SupabaseClient } from "@supabase/supabase-js"

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
  return Object.freeze({
    contractVersion: SELLER_OS_OPERATIONAL_INTEGRITY_RUNTIME_V1,
    status: initial.audit.status,
    snapshotContractVersion: initial.snapshot.contractVersion,
    summary: initial.audit.summary,
    authorityFailures: initial.snapshot.authorityFailures,
    durableReceipt: receipt,
    recovery,
    safety: Object.freeze({
      marketplaceWrites: 0 as const,
      productDecisions: 0 as const,
      categorySelections: 0 as const,
      publisherDispatches: 0 as const,
      genericReadOnlyRecoveryOnly: true as const,
    }),
  })
}
