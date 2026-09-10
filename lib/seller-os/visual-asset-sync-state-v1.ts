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
export function visualAssetSyncViewV1(asset: Record<string, unknown>, task: Record<string, unknown>, outbox: Record<string, unknown>[] = []) {
  const approved = visualAssetOwnerApprovedV1(asset, task)
  const rows = outbox.filter(row => {
    const binding = record(row.binding), changes = record(record(row.intent).requestedChanges)
    if (row.item_id != null && row.item_id !== task.ebay_item_id) return false
    if (changes.taskId != null && changes.taskId !== task.id) return false
    const manifest = binding.executionManifestDigest ?? changes.manifestDigest
    if (manifest != null && manifest !== task.visual_manifest_digest) return false
    return (binding.assetId === asset.id && binding.sourceSha256 === asset.source_sha256) ||
      (Array.isArray(binding.assets) && binding.assets.some(a => record(a).assetId === asset.id && record(a).sourceSha256 === asset.source_sha256))
  }).sort((a,b) => Date.parse(String(b.received_at ?? "1970-01-01")) - Date.parse(String(a.received_at ?? "1970-01-01")))
  const currentRows = rows.slice(0, 1)
  const attention = currentRows.some(r => ["ATTENTION", "REQUIRES_ATTENTION"].includes(String(r.state)))
  const synced = currentRows.some(r => r.state === "SYNCED" && r.official_readback === true &&
    record(r.binding).executionManifestDigest === task.visual_manifest_digest)
  const active = currentRows.find(r => ["OFFICIAL_READBACK_REQUIRED", "UNKNOWN_COMMIT", "SYNCING", "REVALIDATING", "PENDING_EBAY_SYNC"].includes(String(r.state)))
  const state = attention || asset.status === "rejected" ? "REQUIRES_ATTENTION" :
    !approved ? record(asset.qa_result).automaticStatus === "PASSED" ? "OWNER_APPROVAL_REQUIRED" : "DRAFT" :
    synced ? "SYNCED" : active ? active.state === "UNKNOWN_COMMIT" ? "OFFICIAL_READBACK_REQUIRED" : String(active.state) : "APPROVED_FOR_EBAY_SYNC"
  return { state, approvedForEbaySync: approved, generation: visualAssetGenerationV1(asset),
    idempotencyKey: visualAssetSyncKeyV1(asset), creativeSlot: asset.mayel_output_role,
    qaStatus: record(asset.qa_result).automaticStatus ?? "UNPROVEN", ownerApproval: asset.owner_sync_approval ?? null,
    sourceProvenance: { references: asset.source_image_references, sourceImageSetDigest: asset.source_image_set_digest,
      productTruthDigest: asset.product_truth_digest, sourceSha256: asset.source_sha256 },
    serverReceiptPresent: rows.length > 0 }
}
