import type { SupabaseClient } from "@supabase/supabase-js"

const EXPECTED_ATTEMPT = "f166b395-8d3a-4921-b273-1a62a6032707"
const EXPECTED_REVISION = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"

type FinalReview = {
  id: string
  attempt_id: string
  revision_id: string
  listing_package_id: string
  preview_hash: string
  final_visual_set_locked: boolean
  generation_controls_hidden: boolean
  ready_for_unpublished_offer_authorization: boolean
  visual_phase: string
  provider_calls_snapshot: number
  blockers: string[] | null
  gates: Record<string, unknown>
  preview_snapshot: Record<string, unknown>
}

type SelectedImage = {
  position: number
  assetRole: string
  status: string
  sha256: string
}

export type FinalListingReviewPublicationGate = {
  required: boolean
  allowed: boolean
  reason: string | null
  reviewId: string | null
  revisionId: string | null
  attemptId: string | null
  previewHash: string | null
  finalVisualSetLocked: boolean
  generationControlsHidden: boolean
  readyForUnpublishedOfferAuthorization: boolean
  visualPhase: string | null
  providerCallsSnapshot: number
  selectedAssets: number
  passedAssets: number
  source: "ebay_reference_guided_final_listing_review_previews"
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function selectedImagesFromPreview(review: FinalReview) {
  const snapshot = object(review.preview_snapshot)
  return Array.isArray(snapshot.selectedImages)
    ? snapshot.selectedImages.map(object) as SelectedImage[]
    : []
}

export function evaluateFinalListingReviewPublicationGate(
  review: FinalReview | null,
): FinalListingReviewPublicationGate {
  if (!review) {
    return {
      required: false,
      allowed: false,
      reason: "FINAL_LISTING_REVIEW_NOT_FOUND",
      reviewId: null,
      revisionId: null,
      attemptId: null,
      previewHash: null,
      finalVisualSetLocked: false,
      generationControlsHidden: false,
      readyForUnpublishedOfferAuthorization: false,
      visualPhase: null,
      providerCallsSnapshot: 0,
      selectedAssets: 0,
      passedAssets: 0,
      source: "ebay_reference_guided_final_listing_review_previews",
    }
  }

  const selectedImages = selectedImagesFromPreview(review)
  const exactPositions = selectedImages.length === 7
    && new Set(selectedImages.map((asset) => asset.position)).size === 7
    && selectedImages.every((asset, index) => asset.position === index)
  const allPassed = selectedImages.every((asset) => asset.status === "PASSED")
  const primaryMainFirst = selectedImages[0]?.assetRole === "PRIMARY_MAIN"
  const gates = object(review.gates)
  const allGatesPassed = Object.values(gates).every((value) => value === true)
  const blockers = Array.isArray(review.blockers) ? review.blockers : []
  const ready =
    review.revision_id === EXPECTED_REVISION
    && review.attempt_id === EXPECTED_ATTEMPT
    && review.final_visual_set_locked === true
    && review.generation_controls_hidden === true
    && review.ready_for_unpublished_offer_authorization === true
    && review.visual_phase === "COMPLETED"
    && review.provider_calls_snapshot === 8
    && blockers.length === 0
    && exactPositions
    && allPassed
    && primaryMainFirst
    && allGatesPassed

  return {
    required: true,
    allowed: ready,
    reason: ready ? null : "FINAL_LISTING_REVIEW_NOT_READY",
    reviewId: review.id,
    revisionId: review.revision_id,
    attemptId: review.attempt_id,
    previewHash: review.preview_hash,
    finalVisualSetLocked: review.final_visual_set_locked,
    generationControlsHidden: review.generation_controls_hidden,
    readyForUnpublishedOfferAuthorization:
      review.ready_for_unpublished_offer_authorization,
    visualPhase: review.visual_phase,
    providerCallsSnapshot: review.provider_calls_snapshot,
    selectedAssets: selectedImages.length,
    passedAssets: selectedImages.filter((asset) => asset.status === "PASSED").length,
    source: "ebay_reference_guided_final_listing_review_previews",
  }
}

export async function loadFinalListingReviewPublicationGate(input: {
  supabase: SupabaseClient
  listingPackageId: string
  actorId?: string
}): Promise<FinalListingReviewPublicationGate> {
  let query = input.supabase
    .from("ebay_reference_guided_final_listing_review_previews")
    .select("*")
    .eq("listing_package_id", input.listingPackageId)
    .eq("attempt_id", EXPECTED_ATTEMPT)
    .eq("revision_id", EXPECTED_REVISION)
    .order("created_at", { ascending: false })
    .limit(1)
  if (input.actorId) query = query.eq("created_by", input.actorId)
  const { data: review, error } = await query.maybeSingle()
  if (error) throw new Error("FINAL_LISTING_REVIEW_GATE_LOOKUP_FAILED")
  return evaluateFinalListingReviewPublicationGate(review as FinalReview | null)
}
