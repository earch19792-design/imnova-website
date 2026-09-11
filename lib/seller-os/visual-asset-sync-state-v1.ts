import { delegatedVisualQaV1 } from "./mayel-optimization-delegation-v1"
import { visualAssetStatusV1, visualEvidenceV1 } from "./mayel-visual-asset-status-v1"
import type { MayelOwnerActionEvidenceV1 } from "./mayel-owner-action-presentation-v1"
import { createHash } from "node:crypto"

export const VISUAL_OWNER_SYNC_CONFIRMATION = "APPROVE_THIS_ASSET_FOR_EBAY_SYNC_V1"
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function visualAssetGenerationV1(asset: Record<string, unknown>) {
  return `${asset.id}:${asset.output_sha256}`
}
export function visualAssetSyncKeyV1(asset: Record<string, unknown>) {
  return `ipados:v1:${createHash("sha256").update(`visual-sync:${visualAssetGenerationV1(asset)}`).digest("hex")}`
}
export function visualAssetOwnerApprovedV1(asset: Record<string, unknown>, task: Record<string, unknown>) {
  const approval = record(asset.owner_sync_approval)
  return asset.status === "approved" && asset.mayel_approval_status === "APPROVED" &&
    record(asset.qa_result).automaticStatus === "PASSED" &&
    record(record(asset.qa_result).humanReview).decision === "APPROVE" &&
    approval.confirmation === VISUAL_OWNER_SYNC_CONFIRMATION && approval.assetId === asset.id &&
    approval.generation === visualAssetGenerationV1(asset) && approval.idempotencyKey === visualAssetSyncKeyV1(asset) &&
    typeof approval.ownerUserId === "string" && /^[a-f0-9-]{36}$/.test(approval.ownerUserId) &&
    typeof approval.approvedAt === "string" && Number.isFinite(Date.parse(approval.approvedAt)) &&
    asset.source_image_set_digest === task.source_image_set_digest && asset.product_truth_digest === task.product_truth_digest &&
    approval.sourceImageSetDigest === task.source_image_set_digest && approval.productTruthDigest === task.product_truth_digest
}
export function visualAssetSyncViewV1(asset: Record<string, unknown>, task: Record<string, unknown>, outbox: Record<string, unknown>[] = [], delegation: { active: boolean; authorized: boolean; reason?: string | null } = { active: false, authorized: false }) {
  const approved = visualAssetOwnerApprovedV1(asset, task) || delegation.authorized && asset.status === "approved" && asset.mayel_approval_status === "APPROVED"
  const rows = outbox.filter(row => {
    if (row.state === "SUPERSEDED") return false
    if (row.account_key != null && row.account_key !== task.marketplace_account_key) return false
    const binding = record(row.binding), changes = record(record(row.intent).requestedChanges)
    if (row.item_id != null && row.item_id !== task.ebay_item_id) return false
    if (changes.taskId != null && changes.taskId !== task.id) return false
    if (changes.manifestDigest != null && changes.manifestDigest !== task.visual_manifest_digest) return false
    const manifest = binding.executionManifestDigest ?? changes.manifestDigest
    if (manifest != null && manifest !== task.visual_manifest_digest) return false
    return (binding.assetId === asset.id && binding.sourceSha256 === asset.source_sha256) ||
      (Array.isArray(binding.assets) && binding.assets.some(a => record(a).assetId === asset.id && record(a).sourceSha256 === asset.source_sha256))
  }).sort((a,b) => Date.parse(String(b.received_at ?? "1970-01-01")) - Date.parse(String(a.received_at ?? "1970-01-01")))
  const currentRows = rows.slice(0, 1)
  const attention = currentRows.some(r => ["ATTENTION", "REQUIRES_ATTENTION"].includes(String(r.state)))
  const manifest = record(task.visual_manifest)
  const entries = Array.isArray(manifest.proposedOrderedImages) ? manifest.proposedOrderedImages.map(record) : []
  const gallery = record(record(task.selection_signal).currentOfficialGallery)
  const boundAsset = typeof task.marketplace_account_key === "string" && task.marketplace_account_key.length > 0 && asset.mayel_visual_task_id === task.id && asset.account_key === task.marketplace_account_key &&
    typeof asset.id === "string" && typeof task.ebay_item_id === "string" &&
    typeof asset.output_sha256 === "string" && /^[a-f0-9]{64}$/.test(asset.output_sha256) &&
    typeof task.product_truth_digest === "string" && asset.product_truth_digest === task.product_truth_digest &&
    typeof task.source_image_set_digest === "string" && asset.source_image_set_digest === task.source_image_set_digest
  const generated = boundAsset && typeof asset.output_storage_path === "string" && asset.output_storage_path.length > 0
  const qaPassed = boundAsset && delegatedVisualQaV1(asset, task)
  const synced = boundAsset && manifest.ebayItemId === task.ebay_item_id && manifest.visualTaskId === task.id && currentRows.some(r => r.state === "SYNCED" && r.official_readback === true &&
    r.account_key === task.marketplace_account_key && r.item_id === task.ebay_item_id && record(record(r.intent).requestedChanges).taskId === task.id &&
    typeof task.visual_manifest_digest === "string" && record(r.binding).executionManifestDigest === task.visual_manifest_digest &&
    record(r.execution_receipt).manifestDigest === task.visual_manifest_digest &&
    typeof record(r.execution_receipt).officialDigest === "string" &&
    (record(r.execution_receipt).officialDigest === gallery.digest && gallery.authority === "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" ||
      Number.isFinite(Date.parse(String(record(r.execution_receipt).observedAt))) &&
      (gallery.authority !== "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" ||
        Date.parse(String(record(r.execution_receipt).observedAt)) > Date.parse(String(gallery.observedAt)))) &&
    entries.some(e => e.assetId === asset.id && e.outputSha256 === asset.output_sha256))
  const active = currentRows.find(r => ["OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT", "SYNCING", "REVALIDATING", "PENDING_EBAY_SYNC"].includes(String(r.state)))
  const recoveryAttention = asset.status === "pending_review" && record(record(asset.qa_result).transitionRecovery).state === "REQUIRES_ATTENTION"
  const waitingForEbay = gallery.authority !== "CURRENT_OFFICIAL_ORDERED_IMAGE_SET" && ["WAITING_FOR_EBAY", "WAIT_RETRY_WINDOW"].includes(String(record(record(task.selection_signal).galleryRecovery).state))
  const quotaOnly = waitingForEbay && qaPassed && delegation.reason === "CURRENT_LIVE_READBACK_REQUIRED"
  const invalidSyncClaim = !synced && currentRows.some(r => r.state === "SYNCED")
  const state = synced ? "SYNCED" : attention || invalidSyncClaim || recoveryAttention || asset.status === "rejected" || delegation.active && !delegation.authorized && !quotaOnly && asset.status === "approved" ? "REQUIRES_ATTENTION" :
    !approved ? delegation.active ? "QA_READY" : record(asset.qa_result).automaticStatus === "PASSED" ? "OWNER_APPROVAL_REQUIRED" : "DRAFT" :
    synced ? "SYNCED" : active ? active.state === "UNKNOWN_COMMIT" ? "OFFICIAL_READBACK_REQUIRED" : String(active.state) : "APPROVED_FOR_EBAY_SYNC"
  const latest = currentRows[0]
  const receiptOwnerAction = record(latest?.execution_receipt).ownerAction as MayelOwnerActionEvidenceV1["ownerAction"]
  const ownerEvidenceBound = typeof task.visual_manifest_digest === "string" && task.visual_manifest_digest.length > 0 &&
    record(record(latest?.intent).requestedChanges).taskId === task.id && latest?.account_key === task.marketplace_account_key && latest?.item_id === task.ebay_item_id &&
    record(record(latest?.intent).requestedChanges).manifestDigest === task.visual_manifest_digest
  const manualApprovalRequired = !delegation.active && boundAsset && state === "OWNER_APPROVAL_REQUIRED"
  const ownerAction = manualApprovalRequired ? { required: true, humanOnly: true, proven: true,
    action: "Compara la propuesta y completa la revisión requerida por la autoridad de tu cuenta antes de autorizarla.",
    reasonCode: "OWNER_VISUAL_REVIEW_REQUIRED", sourceReference: `visual-asset:${asset.id}:${visualAssetGenerationV1(asset)}` } :
    ownerEvidenceBound ? receiptOwnerAction : undefined
  const view = { state, ownerAction, ownerActionRequired: manualApprovalRequired,
    reasonCode: typeof latest?.reason_code === "string" ? latest.reason_code : delegation.reason,
    autonomousOptimization: delegation.active, generated, qaPassed, readbackCompatible: synced,
    waitingForEbay: waitingForEbay && !synced && asset.status !== "rejected",
    officialReadback: synced, savedToSellerOS: generated, approvedForEbaySync: approved || synced, generation: visualAssetGenerationV1(asset),
    idempotencyKey: visualAssetSyncKeyV1(asset), creativeSlot: asset.mayel_output_role,
    qaStatus: record(asset.qa_result).automaticStatus ?? "UNPROVEN", ownerApproval: asset.owner_sync_approval ?? null,
    sourceProvenance: { references: asset.source_image_references, sourceImageSetDigest: asset.source_image_set_digest,
      productTruthDigest: asset.product_truth_digest, sourceSha256: asset.source_sha256 },
    serverReceiptPresent: rows.length > 0 }
  const presentation = visualAssetStatusV1(visualEvidenceV1(view))
  return { ...view, ownerActionRequired: presentation.ownerActionRequired, ownerCtaPresent: presentation.ownerCtaPresent,
    ownerActionState: presentation.ownerActionState, mayelWorkflowState: presentation.mayelWorkflowState,
    listingOperationalHealth: presentation.listingOperationalHealth, presentation }
}
