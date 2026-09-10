import { visualIntentOrderV1, type VisualIntentV1 } from "./mayel-visual-intent-v1"
import { validateMayelHumanQaV1, type MayelVisualOutputRole } from "../ebay/ebay-mayel-visual-workstation-v1"

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const MAYEL_ASSET_TRANSITION_V1 = "MAYEL_APPROVED_ASSET_TRANSITION_V1"

/** The same ordered base shown by the station must build its new manifest.
 * Existing manifests require the separate certified rebase flow. */
export function approvalGalleryV1(task: Record<string, unknown>, official: { images: string[]; digest: string } | null,
  expectedDigest?: string | null) {
  if (expectedDigest && official?.digest !== expectedDigest) throw Error("MAYEL_VISUAL_GALLERY_CHANGED_REVIEW_REQUIRED")
  const old = task.current_image_set as string[]
  if (!official) throw Error("MAYEL_VISUAL_CURRENT_GALLERY_REQUIRED")
  if (task.visual_manifest_digest && JSON.stringify(old) !== JSON.stringify(official.images))
    throw Error("MAYEL_VISUAL_GALLERY_CHANGED_REVIEW_REQUIRED")
  return [...official.images]
}

export function savedSafeDecisionV1(asset: Record<string, unknown>, task: Record<string, unknown>) {
  const qa = record(asset.qa_result), decision = record(qa.transitionDecision)
  if (asset.status === "rejected" || asset.mayel_approval_status === "REJECTED" || record(qa.humanReview).decision === "REJECT")
    return { safe: false as const, reason: "REJECTED_ASSET_IMMUTABLE" }
  if (qa.automaticStatus !== "PASSED" || decision.contract !== MAYEL_ASSET_TRANSITION_V1 ||
    decision.assetId !== asset.id || decision.taskId !== task.id || decision.outputSha256 !== asset.output_sha256 ||
    decision.sourceImageSetDigest !== task.source_image_set_digest || decision.productTruthDigest !== task.product_truth_digest ||
    decision.actorUserId !== task.assigned_operator_user_id ||
    !validateMayelHumanQaV1(decision.checks, asset.mayel_output_role as MayelVisualOutputRole))
    return { safe: false as const, reason: "SEMANTIC_QA_EVIDENCE_REQUIRED" }
  const intent = record(decision.intent) as unknown as VisualIntentV1
  if (intent.assetId !== asset.id) return { safe: false as const, reason: "VISUAL_INTENT_REQUIRED" }
  return { safe: true as const, reason: null, decision, intent }
}

export function assertReviewIntentV1(current: string[], previous: readonly VisualIntentV1[], intent: VisualIntentV1) {
  return visualIntentOrderV1(current, [...previous.filter(i => i.assetId !== intent.assetId), intent])
}
