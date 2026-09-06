import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  readMayelVisualPhaseBPreviewV1,
  rebaseMayelVisualPhaseBPreviewV1,
} from "./ebay-mayel-visual-phase-b-server-v1"

export const MAYEL_VISUAL_SAFE_REBASE_RUNTIME_V1 =
  "MAYEL_VISUAL_SAFE_REBASE_RUNTIME_V1" as const
const INVARIANT = "MAYEL_VISUAL_MANIFEST_MATCHES_CURRENT_OFFICIAL_IMAGE_SET"
const MAX_TASKS_PER_RUN = 3

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

function safeCode(error: unknown) {
  const code = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_:+.-]{2,319}$/.test(code)
    ? code : "MAYEL_VISUAL_SAFE_REBASE_RUNTIME_FAILED"
}

export async function runMayelVisualSafeRebaseRecoveryV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const authority = await input.supabase
    .from("ebay_mayel_visual_delegation_authorities_v1")
    .select("id,authority_digest,main_image_authority,owner_per_image_approval,owner_per_listing_visual_approval")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .maybeSingle()
  if (authority.error) throw new Error("MAYEL_VISUAL_REBASE_AUTHORITY_READ_FAILED")
  const delegationActive = Boolean(authority.data
    && authority.data.main_image_authority === true
    && authority.data.owner_per_image_approval === false
    && authority.data.owner_per_listing_visual_approval === false)
  if (!delegationActive) return Object.freeze({ authorityActive: false,
    discoveredCount: 0, claimedCount: 0, rebasedCount: 0, receipts: [],
    marketplaceWrites: 0 as const })

  const tasks = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,visual_manifest_digest")
    .eq("marketplace_account_key", input.accountKey)
    .eq("status", "OWNER_PREVIEW_READY")
    .order("updated_at", { ascending: true }).limit(MAX_TASKS_PER_RUN)
  if (tasks.error) {
    throw new Error("MAYEL_VISUAL_REBASE_TASK_DISCOVERY_FAILED")
  }
  // A task can produce many ordered manifests over its lifetime. Completion
  // of an older rebase must never suppress discovery for a newer manifest.
  // The durable ledger's exact (old digest + current official digest)
  // fingerprint is the idempotency authority, not task identity alone.
  const eligibleTasks = tasks.data ?? []
  const workerId = `mayel-safe-rebase:${randomUUID()}`
  const receipts: Record<string, unknown>[] = []
  let claimedCount = 0
  let rebasedCount = 0

  for (const task of eligibleTasks) {
    const taskId = String(task.id)
    const oldDigest = String(task.visual_manifest_digest ?? "")
    let preview
    try {
      preview = await readMayelVisualPhaseBPreviewV1({
        supabase: input.supabase, accountKey: input.accountKey, taskId,
      })
    } catch (error) {
      receipts.push({ taskId, status: "DISCOVERY_FAILED",
        errorClass: safeCode(error) })
      continue
    }
    if (!preview.safeRebaseAvailable) {
      receipts.push({ taskId, status: "NOT_SAFE_REBASE_ELIGIBLE",
        blocker: preview.blocker })
      continue
    }
    const evidenceFingerprint = fingerprint({ taskId, oldDigest,
      currentOfficialImageSetDigest: preview.currentOfficialImageSetDigest })
    const observedAt = new Date().toISOString()
    const evidence = { taskId, oldDigest,
      currentOfficialImageSetDigest: preview.currentOfficialImageSetDigest,
      safeRebaseAvailable: true, mayelAssetPreserved:
        preview.mayelAssetPreserved, marketplaceWrites: 0 }
    const ledger = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").upsert({
      marketplace_account_key: input.accountKey,
      failure_class: "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED",
      invariant_code: INVARIANT,
      mechanism_version: MAYEL_VISUAL_SAFE_REBASE_RUNTIME_V1,
      evidence_fingerprint: evidenceFingerprint,
      recovery_policy_version: MAYEL_VISUAL_SAFE_REBASE_RUNTIME_V1,
      retry_safety: "SAFE_IDEMPOTENT_RUNTIME_RESUME",
      recovery_class: "AUTO_RECOVERABLE",
      recovery_outcome: "OBSERVED", regression_guard: {
        exactDigestCompareAndSwap: true, preserveApprovedAsset: true,
        marketplaceWrites: 0, ownerAdditionalApprovalCount: 0 },
      evidence, status: "OPEN", first_observed_at: observedAt,
      last_observed_at: observedAt, resolved_at: null,
    }, { onConflict:
      "marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version",
      ignoreDuplicates: true }).select("id").maybeSingle()
    if (ledger.error) throw new Error("MAYEL_VISUAL_REBASE_LEDGER_PERSIST_FAILED")
    const claim = await input.supabase.rpc(
      "claim_seller_os_operational_integrity_v1", {
        p_marketplace_account_key: input.accountKey,
        p_invariant_code: INVARIANT,
        p_evidence_fingerprint: evidenceFingerprint,
        p_mechanism_version: MAYEL_VISUAL_SAFE_REBASE_RUNTIME_V1,
        p_worker_id: workerId, p_lease_seconds: 180,
      })
    if (claim.error) throw new Error("MAYEL_VISUAL_REBASE_CLAIM_FAILED")
    const claimed = Array.isArray(claim.data) ? claim.data[0] : null
    if (claimed?.claimed !== true || !claimed.ledger_id) continue
    claimedCount += 1
    let receipt: Record<string, unknown>
    let resolved = false
    try {
      const rebase = await rebaseMayelVisualPhaseBPreviewV1({
        supabase: input.supabase, accountKey: input.accountKey, taskId,
        expectedVisualManifestDigest: oldDigest,
      })
      const readback = await readMayelVisualPhaseBPreviewV1({
        supabase: input.supabase, accountKey: input.accountKey, taskId,
      })
      resolved = rebase.safeRebaseApplied === true
        && readback.mayelManifestValid === true
        && readback.currentImageSetProven === true
        && readback.mayelAssetPreserved === true
        && readback.mayelReworkRequired === false
        && readback.visualOnlyDiff === true
        && readback.unauthorizedFieldDiffCount === 0
      receipt = { taskId, status: resolved ? "RECOVERED" : "READBACK_FAILED",
        rebase, readback: { mayelManifestValid: readback.mayelManifestValid,
          currentImageSetProven: readback.currentImageSetProven,
          mayelAssetPreserved: readback.mayelAssetPreserved,
          mayelReworkRequired: readback.mayelReworkRequired,
          visualOnlyDiff: readback.visualOnlyDiff,
          unauthorizedFieldDiffCount: readback.unauthorizedFieldDiffCount },
        marketplaceWrites: 0 }
      if (resolved) rebasedCount += 1
    } catch (error) {
      receipt = { taskId, status: "RECOVERY_FAILED",
        errorClass: safeCode(error), marketplaceWrites: 0 }
    }
    const receiptWrite = await input.supabase.from(
      "seller_os_operational_learning_ledger_v1").update({
      evidence: { ...evidence, rebaseReceipt: receipt },
      last_observed_at: new Date().toISOString(),
    }).eq("id", String(claimed.ledger_id)).eq("lease_owner", workerId)
    if (receiptWrite.error) throw new Error("MAYEL_VISUAL_REBASE_RECEIPT_FAILED")
    const finish = await input.supabase.rpc(
      "finish_seller_os_operational_integrity_v1", {
        p_ledger_id: String(claimed.ledger_id), p_worker_id: workerId,
        p_invariant_resolved: resolved,
      })
    if (finish.error || finish.data !== true) {
      throw new Error("MAYEL_VISUAL_REBASE_FINISH_FAILED")
    }
    receipts.push({ ...receipt, ledgerId: String(claimed.ledger_id) })
  }
  return Object.freeze({ authorityActive: true,
    discoveredCount: eligibleTasks.length, claimedCount, rebasedCount,
    receipts: Object.freeze(receipts), marketplaceWrites: 0 as const })
}
