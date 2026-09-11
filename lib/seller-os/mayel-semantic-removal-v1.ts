import type { GalleryDecisionV1 } from "./mayel-full-gallery-mutation-v1"

export const MAYEL_REMOVAL_REASONS_V1 = ["LOW_QUALITY", "REDUNDANT", "MISLEADING", "OBSOLETE",
  "WEAK_CONVERSION_VALUE", "VISUAL_DUPLICATE", "REPLACED_BY_BETTER_AUTHORIZED_ASSET"] as const
export const MAYEL_REMOVAL_CHECKS_V1 = ["exactListingIdentity", "productTruthPreserved", "semanticQaPass",
  "removalReasonProven", "requiredProductInformationNotLost", "finalGalleryRemainsValid"] as const
export type RemovalReviewV1 = {
  id: string; account_key: string; task_id: string; item_id: string; product_truth_digest: string;
  source_image_set_digest: string; base_manifest_digest: string; current_images: string[];
  final_images: string[]; source_position: number; reason: string; evidence_references: string[];
  checks: Record<string, unknown>; revoked_at: string | null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export function semanticRemovalReviewMatchesV1(input: { review: RemovalReviewV1; task: Record<string, unknown>;
  decision: GalleryDecisionV1; currentImages: readonly string[]; finalImages: readonly string[] }) {
  const { review: r, task: t, decision: d } = input
  return r.revoked_at === null && r.id === d.removalEvidence?.reviewId &&
    r.account_key === t.marketplace_account_key && r.task_id === t.id && r.item_id === t.ebay_item_id &&
    r.product_truth_digest === t.product_truth_digest && r.source_image_set_digest === t.source_image_set_digest &&
    r.base_manifest_digest === d.removalEvidence?.baseManifestDigest &&
    r.source_position === d.sourcePosition && r.reason === d.removalEvidence?.reason &&
    MAYEL_REMOVAL_REASONS_V1.includes(r.reason as typeof MAYEL_REMOVAL_REASONS_V1[number]) &&
    MAYEL_REMOVAL_CHECKS_V1.every(k => r.checks[k] === true) && r.checks.identityDrift === false &&
    r.checks.productUncertainty === false && r.checks.unsupportedClaimCount === 0 &&
    r.checks.competitorContaminationCount === 0 && same(r.current_images, input.currentImages) &&
    same(r.final_images, input.finalImages) && r.evidence_references.length > 0 &&
    same(r.evidence_references, d.removalEvidence?.evidenceReferences)
}
