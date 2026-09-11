import "server-only"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { readOutboxImageAuthorityV1, IPAD_OUTBOX_TABLE, type OutboxRow } from "./ipad-durable-outbox-v1"
import { galleryDriftEvidenceV1 } from "./mayel-gallery-drift-v1"
import { stableOutboxJsonV1 } from "./ipad-outbox-contract-v1"
import { readMayelVisualPhaseBPreviewV1 } from "../ebay/ebay-mayel-visual-phase-b-server-v1"
import { runIpadOutboxRuntimeV1 } from "./ipad-sync-runtime-v1"

export async function recoverExistingGalleryOrderV1(input: {
  supabase: SupabaseClient; accountKey: string; outboxId: string; itemId: string; expectedManifestDigest: string;
}) {
  if (!/^[a-f0-9-]{36}$/i.test(input.outboxId) || !/^\d{9,20}$/.test(input.itemId) ||
    !/^sha256:[a-f0-9]{64}$/.test(input.expectedManifestDigest)) throw Error("OUTBOX_EXACT_SCOPE_REQUIRED")
  const lease = randomUUID(), now = new Date().toISOString()
  const found = await input.supabase.from(IPAD_OUTBOX_TABLE).select("*").eq("id", input.outboxId)
    .eq("account_key", input.accountKey).eq("item_id", input.itemId).eq("kind", "IMAGE_SYNC").maybeSingle()
  if (found.error || !found.data) throw Error("GALLERY_EXISTING_ORDER_NOT_FOUND")
  const previous = found.data as OutboxRow
  if (previous.intent.requestedChanges.manifestDigest !== input.expectedManifestDigest) throw Error("GALLERY_RECOVERY_MANIFEST_CHANGED")
  if (previous.dispatch_count > 0 || previous.state === "SYNCED") {
    // Existing runtime reconciles official readback, never redispatches an
    // already-attempted intent. Do not reset its idempotency counter.
    return { status: previous.state, recoveryRequired: false, imageWriteCount: 0, officialReadback: previous.official_readback }
  }
  if (previous.state !== "REQUIRES_ATTENTION" || previous.reason_code !== "MATERIAL_LISTING_DRIFT" ||
    !previous.binding.ownerDelegation) throw Error("GALLERY_RECOVERY_NOT_ELIGIBLE")
  const claimed = await input.supabase.from(IPAD_OUTBOX_TABLE).update({ lease_token: lease,
    lease_until: new Date(Date.now() + 300_000).toISOString() })
    .eq("id", previous.id).eq("account_key", input.accountKey).eq("item_id", input.itemId)
    .eq("state", previous.state).eq("reason_code", previous.reason_code).eq("payload_hash", previous.payload_hash).eq("dispatch_count", 0)
    .or(`lease_until.is.null,lease_until.lt.${now}`).select("*").maybeSingle()
  if (claimed.error || !claimed.data) throw Error("GALLERY_RECOVERY_CONCURRENT_INTENT")
  const row = claimed.data as OutboxRow
  const audit = row.binding.optimizationAudit as { after?: unknown } | undefined
  row.binding = { ...row.binding, galleryProposal: row.binding.galleryProposal ?? {
    images: audit?.after, recordedAt: row.received_at, manifestDigest: input.expectedManifestDigest } }
  const patch = async (values: Record<string, unknown>) => {
    const changed = await input.supabase.from(IPAD_OUTBOX_TABLE).update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("account_key", input.accountKey).eq("lease_token", lease).eq("dispatch_count", 0)
      .select("id").maybeSingle()
    if (changed.error || !changed.data) throw Error("GALLERY_RECOVERY_LEASE_LOST")
  }
  try {
    const authority = await readOutboxImageAuthorityV1({ supabase: input.supabase, row })
    if (!authority.approved || authority.manifestDigest !== input.expectedManifestDigest) throw Error(authority.reason ?? "GALLERY_RECOVERY_QA_CHANGED")
    const executions = await input.supabase.from("ebay_mayel_visual_phase_b_executions_v1").select("id")
      .eq("marketplace_account_key", input.accountKey).eq("visual_task_id", row.intent.requestedChanges.taskId!)
      .eq("visual_manifest_digest", input.expectedManifestDigest).limit(1)
    if (executions.error || executions.data?.length) throw Error("GALLERY_RECOVERY_EXECUTION_ALREADY_EXISTS")
    const preview = await readMayelVisualPhaseBPreviewV1({ ...input, taskId: row.intent.requestedChanges.taskId! })
    const official = preview.officialReadStatus === "PASS" && preview.currentImageSetProven && preview.accountIdentityProven && preview.listingIdentityProven
    const evidence = galleryDriftEvidenceV1({ binding: row.binding, currentUrls: preview.currentImages, official,
      currentObservedAt: preview.officialObservedAt,
      currentReadbackReference: `${preview.officialReadAuthority}:${row.item_id}:${preview.officialObservedAt}` })
    const binding = { ...row.binding, galleryDriftEvidence: evidence }
    await patch({ binding })
    if (evidence.DRIFT_CLASSIFICATION !== "NO_DRIFT") return { status: "REQUIRES_ATTENTION", evidence, imageWriteCount: 0 }
    if (!preview.safeToExecuteVisualChange || !preview.visualOnlyDiff || preview.unauthorizedFieldDiffCount !== 0 ||
      preview.visualManifestDigest !== input.expectedManifestDigest || !row.binding.baseListing || !preview.currentListingVersionFields ||
      stableOutboxJsonV1(row.binding.baseListing) !== stableOutboxJsonV1(preview.currentListingVersionFields) ||
      stableOutboxJsonV1(preview.proposedFinalImages) !== stableOutboxJsonV1(authority.expectedImages)) throw Error("GALLERY_RECOVERY_CURRENT_SAFETY_FAILED")
    const recovery = { contract: "MAYEL_EXISTING_GALLERY_RECOVERY_V1", recoveredAt: new Date().toISOString(),
      previousState: row.state, previousReason: row.reason_code, sameOutboxId: row.id,
      originalPayloadHash: row.payload_hash, manifestDigest: input.expectedManifestDigest,
      classification: evidence.DRIFT_CLASSIFICATION, approvedAssetsReused: true, newImageGenerationCount: 0, duplicateAssetCount: 0 }
    await patch({ binding: { ...binding, galleryRecovery: recovery }, state: "PENDING_EBAY_SYNC", reason_code: null,
      next_attempt_at: new Date().toISOString(), lease_token: null, lease_until: null })
  } finally {
    await input.supabase.from(IPAD_OUTBOX_TABLE).update({ lease_token: null, lease_until: null })
      .eq("id", row.id).eq("account_key", input.accountKey).eq("lease_token", lease)
  }
  const runtime = await runIpadOutboxRuntimeV1({ ...input })
  const stored = await input.supabase.from(IPAD_OUTBOX_TABLE).select("id,state,reason_code,dispatch_count,official_readback,execution_receipt,binding")
    .eq("id", row.id).eq("account_key", input.accountKey).eq("item_id", input.itemId).single()
  if (stored.error) throw Error("GALLERY_RECOVERY_DURABLE_READBACK_REQUIRED")
  return { status: stored.data.state, reason: stored.data.reason_code, syncOrderRecovered: true,
    imageWriteCount: runtime.listingWriteCount, officialReadback: stored.data.official_readback,
    evidence: stored.data.binding.galleryDriftEvidence, executionReceipt: stored.data.execution_receipt, runtime }
}
