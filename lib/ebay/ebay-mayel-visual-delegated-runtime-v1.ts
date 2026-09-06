import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import { executeMayelTradingVisualDelegatedManifestV1 } from
  "./ebay-mayel-visual-phase-b-server-v1"

export const MAYEL_VISUAL_DELEGATED_RUNTIME_V1 =
  "MAYEL_VISUAL_DELEGATED_RUNTIME_V1" as const
const INVARIANT = "VALID_MAYEL_MANIFEST_EVENTUALLY_REACHES_OFFICIAL_EBAY"
const MAX_TASKS_PER_RUN = 3
const MAX_LISTING_WRITES_PER_RUN = 1

function safeCode(error: unknown) {
  const value = error instanceof Error ? error.message : ""
  return /^[A-Z][A-Z0-9_:+.-]{2,319}$/.test(value)
    ? value : "MAYEL_VISUAL_DELEGATED_RUNTIME_FAILED"
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value))
    .digest("hex")}`
}

export async function runMayelVisualDelegatedRuntimeV1(input: Readonly<{
  supabase: SupabaseClient
  accountKey: string
}>) {
  const authority = await input.supabase.from(
    "ebay_mayel_visual_delegation_authorities_v1")
    .select("id,authority_digest,main_image_authority,owner_per_image_approval,owner_per_listing_visual_approval")
    .eq("marketplace_account_key", input.accountKey)
    .eq("marketplace_id", "EBAY_US").eq("status", "ACTIVE")
    .is("revoked_at", null).maybeSingle()
  if (authority.error) {
    throw new Error("MAYEL_VISUAL_RUNTIME_AUTHORITY_READ_FAILED")
  }
  const authorityActive = Boolean(authority.data
    && authority.data.main_image_authority === true
    && authority.data.owner_per_image_approval === false
    && authority.data.owner_per_listing_visual_approval === false)
  if (!authorityActive) return Object.freeze({ authorityActive: false,
    discoveredCount: 0, claimedCount: 0, listingWriteCount: 0,
    mediaWriteCount: 0, outcomes: Object.freeze([]),
    status: "WAITING_FOR_DELEGATION" as const })

  const tasks = await input.supabase.from("ebay_mayel_visual_tasks_v1")
    .select("id,ebay_item_id,visual_manifest_id,visual_manifest_digest,updated_at")
    .eq("marketplace_account_key", input.accountKey)
    .eq("status", "OWNER_PREVIEW_READY")
    .not("visual_manifest_id", "is", null)
    .not("visual_manifest_digest", "is", null)
    .order("updated_at", { ascending: true }).limit(MAX_TASKS_PER_RUN)
  if (tasks.error) {
    throw new Error("MAYEL_VISUAL_RUNTIME_TASK_DISCOVERY_FAILED")
  }

  const outcomes: Record<string, unknown>[] = []
  let claimedCount = 0
  let listingWriteCount = 0
  let mediaWriteCount = 0
  for (const task of tasks.data ?? []) {
    if (listingWriteCount >= MAX_LISTING_WRITES_PER_RUN) break
    const taskId = String(task.id)
    const itemId = String(task.ebay_item_id)
    try {
      const execution = await executeMayelTradingVisualDelegatedManifestV1({
        supabase: input.supabase, accountKey: input.accountKey, taskId,
      })
      const claimed = execution.status !== "ALREADY_EXECUTED"
        && execution.status !== "ALREADY_CLAIMED"
      if (claimed) claimedCount += 1
      listingWriteCount += execution.tradingListingWriteCount
      mediaWriteCount += execution.mediaApiWriteCount
      outcomes.push({ taskId, itemId, manifestId: task.visual_manifest_id,
        manifestDigest: task.visual_manifest_digest,
        status: execution.status,
        listingWriteCount: execution.tradingListingWriteCount,
        mediaWriteCount: execution.mediaApiWriteCount,
        execution: execution.execution })
    } catch (error) {
      outcomes.push({ taskId, itemId, manifestId: task.visual_manifest_id,
        manifestDigest: task.visual_manifest_digest,
        status: "BLOCKED", failureClass: safeCode(error),
        listingWriteCount: 0, mediaWriteCount: 0 })
    }
  }

  const observedAt = new Date().toISOString()
  const evidenceFingerprint = fingerprint({
    authorityDigest: authority.data?.authority_digest,
    tasks: (tasks.data ?? []).map((task) => [task.id,
      task.visual_manifest_id, task.visual_manifest_digest]),
    outcomes: outcomes.map((outcome) => [outcome.taskId, outcome.status,
      outcome.failureClass ?? null]),
  })
  const receipt = await input.supabase.from(
    "seller_os_operational_learning_ledger_v1").upsert({
      marketplace_account_key: input.accountKey,
      failure_class: outcomes.some((outcome) => outcome.status === "BLOCKED")
        ? "MAYEL_VISUAL_DELEGATED_RUNTIME_BLOCKED"
        : "MAYEL_VISUAL_DELEGATED_RUNTIME_STATE",
      invariant_code: INVARIANT,
      mechanism_version: MAYEL_VISUAL_DELEGATED_RUNTIME_V1,
      evidence_fingerprint: evidenceFingerprint,
      recovery_policy_version: MAYEL_VISUAL_DELEGATED_RUNTIME_V1,
      retry_safety: "SAFE_IDEMPOTENT_RUNTIME_RESUME",
      recovery_class: "AUTO_RECOVERABLE",
      recovery_outcome: outcomes.some((outcome) => outcome.status === "BLOCKED")
        ? "OBSERVED" : "RECOVERED",
      regression_guard: { maxListingWritesPerRun:
        MAX_LISTING_WRITES_PER_RUN, exactManifestBinding: true,
      freshOfficialPreflight: true, atomicClaim: true,
      ambiguousWriteRetryAllowed: false, officialReadbackRequired: true },
      evidence: { authorityId: authority.data?.id, outcomes,
        listingWriteCount, mediaWriteCount },
      status: outcomes.some((outcome) => outcome.status === "BLOCKED")
        ? "OPEN" : "RESOLVED",
      first_observed_at: observedAt, last_observed_at: observedAt,
      resolved_at: outcomes.some((outcome) => outcome.status === "BLOCKED")
        ? null : observedAt,
    }, { onConflict:
      "marketplace_account_key,invariant_code,evidence_fingerprint,mechanism_version",
    }).select("id").maybeSingle()
  if (receipt.error || !receipt.data) {
    throw new Error("MAYEL_VISUAL_RUNTIME_RECEIPT_PERSIST_FAILED")
  }
  return Object.freeze({ authorityActive: true,
    discoveredCount: (tasks.data ?? []).length, claimedCount,
    listingWriteCount, mediaWriteCount, outcomes: Object.freeze(outcomes),
    receiptId: receipt.data.id,
    status: outcomes.some((outcome) => outcome.status === "BLOCKED")
      ? "DEGRADED" as const : "OPERATING" as const })
}
