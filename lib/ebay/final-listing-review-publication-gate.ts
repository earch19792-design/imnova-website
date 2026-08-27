import type { SupabaseClient } from "@supabase/supabase-js"

// @ts-expect-error Node's native TypeScript tests need the explicit extension.
import { EBAY_SQUARE_PRESENTATION_QA_VERSION } from "./ebay-image-square-presentation.ts"

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
  source:
    | "ebay_reference_guided_final_listing_review_previews"
    | "APPROVED_IMAGE_REVISION_AUTOMATED_QA"
    | "APPROVED_SAME_DAY_IMAGE_SET_AUTOMATED_QA"
    | "APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA"
}

type AutomatedRevisionEvidence = {
  listingPackage: Record<string, any> | null
  revision: Record<string, any> | null
  assets: Array<Record<string, any>>
}

type AutomatedSameDayEvidence = {
  listingPackage: Record<string, any> | null
  assets: Array<Record<string, any>>
}

type AutomatedLunaSupplierEvidence = AutomatedSameDayEvidence

const AUTOMATED_CURATION_CONTRACT =
  "SELLER_OS_AUTHORIZED_COMMERCIAL_CURATION_V1_2026_07_24"
const CURRENT_COMPOSITOR =
  "EBAY_IMAGE_COMPOSITOR_FOREGROUND_V9_2026_07_22"
const CURRENT_QA_EVALUATOR = "SELLER_OS_EBAY_VISUAL_QA_V2"

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

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry)).filter(Boolean)
    : []
}

function emptyArray(value: unknown) {
  return Array.isArray(value) && value.length === 0
}

function blockedAutomatedGate(
  reason = "FINAL_LISTING_AUTOMATED_GATE_NOT_READY",
  source: FinalListingReviewPublicationGate["source"] =
    "APPROVED_IMAGE_REVISION_AUTOMATED_QA",
): FinalListingReviewPublicationGate {
  return {
    required: true,
    allowed: false,
    reason,
    reviewId: null,
    revisionId: null,
    attemptId: null,
    previewHash: null,
    finalVisualSetLocked: false,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: false,
    visualPhase: null,
    providerCallsSnapshot: 0,
    selectedAssets: 0,
    passedAssets: 0,
    source,
  }
}

export function evaluateApprovedLunaSupplierImageAutomationGate(
  evidence: AutomatedLunaSupplierEvidence,
): FinalListingReviewPublicationGate {
  const listingPackage = object(evidence.listingPackage)
  const packageData = object(listingPackage.package_data)
  const readiness = object(packageData.supplierImageReadiness)
  const imageUrls = stringArray(packageData.imageUrls)
  const manifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(object) : []
  const assetIds = manifest.map((entry) => text(entry.assetId))
  const actor = text(listingPackage.created_by)
  const blocked = () => blockedAutomatedGate(
    "FINAL_LISTING_LUNA_SUPPLIER_IMAGE_GATE_NOT_READY",
    "APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA",
  )
  if (
    !["draft", "ready_for_review", "approved"].includes(
      text(listingPackage.status),
    ) || !actor || readiness.version !== "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1" ||
    readiness.authorityVersion !==
      "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1" ||
    readiness.imageRights !== "PASS_INHERITED" ||
    readiness.imageOptimization !== "AUTO_PASS" ||
    readiness.imageReady !== true ||
    readiness.humanImageActionRequired !== false ||
    imageUrls.length < 1 || imageUrls.length > 24 ||
    new Set(imageUrls).size !== imageUrls.length ||
    manifest.length !== imageUrls.length ||
    assetIds.length !== imageUrls.length ||
    assetIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id)) ||
    new Set(assetIds).size !== assetIds.length ||
    Number(readiness.validCompliantImageCount) !== imageUrls.length ||
    evidence.assets.length !== imageUrls.length
  ) return blocked()

  const byId = new Map(evidence.assets.map((asset) => [
    text(asset.id), object(asset),
  ]))
  const ordered = assetIds.map((id) => byId.get(id)).filter(Boolean)
  const passed = ordered.filter((asset, index) => {
    const transformation = object(asset?.transformation)
    const qa = object(asset?.qa_result)
    const rightsAuthority = object(qa.rightsAuthority)
    const entry = manifest[index]
    const allowedTransform = (
      transformation.backgroundMethod === "AUTHORIZED_SOURCE_FRAMED_CONTAIN" &&
      transformation.sourcePixelsTreatment === "PRESERVED_FULL_FRAME"
    ) || (
      transformation.backgroundMethod ===
        "LIGHT_NEUTRAL_DETERMINISTIC_NORMALIZATION" &&
      transformation.sourcePixelsTreatment === "NEAR_NEUTRAL_WHITEN_ONLY"
    )
    let officialSource = false
    try {
      const host = new URL(text(asset?.source_url)).hostname.toLowerCase()
      officialSource = host === "cdn.shopify.com" ||
        host === "lunaportex.com" || host.endsWith(".lunaportex.com")
    } catch {
      officialSource = false
    }
    return asset?.status === "approved" &&
      text(asset?.approved_by) === actor &&
      text(asset?.created_by) === actor &&
      Number.isFinite(Date.parse(text(asset?.approved_at))) &&
      officialSource && asset?.rights_evidence_confirmed === true &&
      asset?.rights_basis === "supplier_authorized" &&
      asset?.authorization_reference ===
        "OPERATOR_ATTESTED_LUNA_SUPPLIER_IMAGE_AUTHORIZATION_V1" &&
      asset?.transformation_version === "EBAY_MAIN_IMAGE_SAFE_WHITE_V2" &&
      asset?.output_width === 1600 && asset?.output_height === 1600 &&
      transformation.supplierRightsAuthorityVersion ===
        "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1" &&
      /^[0-9a-f]{64}$/.test(text(
        transformation.supplierImageIdentityDigest,
      )) && /^[0-9a-f]{64}$/.test(text(
        transformation.supplierImageSourceBindingDigest,
      )) && transformation.generativeAiUsed === false && allowedTransform &&
      qa.automaticStatus === "PASSED" &&
      qa.approvalMode === "AUTOMATIC_DETERMINISTIC" &&
      qa.imageReadiness === "IMAGE_READY_AUTO_PASS" &&
      qa.humanApprovalRequired === false &&
      qa.outputQualityPassed === true &&
      qa.materialProductEquivalencePassed === true &&
      qa.sourceHashPreserved === true &&
      qa.onlyAllowedDeterministicTransforms === true &&
      rightsAuthority.version ===
        "OPERATOR_BOUND_LUNA_SUPPLIER_IMAGE_RIGHTS_V1" &&
      rightsAuthority.authorityProvenance === "OPERATOR_ATTESTED" &&
      rightsAuthority.documentedLicense === false &&
      rightsAuthority.operatorAttested === true &&
      text(entry.assetId) === text(asset?.id) &&
      text(entry.sha256) === text(asset?.output_sha256) &&
      text(entry.url) === text(asset?.public_url) &&
      imageUrls[index] === text(asset?.public_url) &&
      entry.automaticQa === "PASSED"
  })
  const ready = ordered.length === imageUrls.length &&
    passed.length === imageUrls.length
  return {
    required: true,
    allowed: ready,
    reason: ready ? null : "FINAL_LISTING_LUNA_SUPPLIER_IMAGE_GATE_NOT_READY",
    reviewId: null,
    revisionId: null,
    attemptId: null,
    previewHash: null,
    finalVisualSetLocked: ready,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: ready,
    visualPhase: ready ? "COMPLETED" : null,
    providerCallsSnapshot: 0,
    selectedAssets: ordered.length,
    passedAssets: passed.length,
    source: "APPROVED_LUNA_SUPPLIER_IMAGE_AUTOMATED_QA",
  }
}

export function evaluateApprovedSameDayImageSetAutomationGate(
  evidence: AutomatedSameDayEvidence,
): FinalListingReviewPublicationGate {
  const listingPackage = object(evidence.listingPackage)
  const packageData = object(listingPackage.package_data)
  const sameDayPilot = object(packageData.sameDayPilot)
  const imageUrls = stringArray(packageData.imageUrls)
  const manifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(object) : []
  const assetIds = manifest.map((entry) => text(entry.assetId))
  const manifestPositions = manifest.map((entry) => Number(entry.position))
  const actor = text(listingPackage.created_by)
  const blocked = () => blockedAutomatedGate(
    "FINAL_LISTING_AUTOMATED_GATE_NOT_READY",
    "APPROVED_SAME_DAY_IMAGE_SET_AUTOMATED_QA",
  )
  if (
    !["draft", "ready_for_review", "approved"].includes(
      text(listingPackage.status),
    )
    || !/^[0-9a-f-]{36}$/i.test(text(sameDayPilot.runId))
    || !/^[0-9a-f-]{36}$/i.test(text(sameDayPilot.candidateId))
    || !actor
    || imageUrls.length !== 7
    || new Set(imageUrls).size !== 7
    || manifest.length !== 7
    || manifestPositions.some((position) => !Number.isInteger(position))
    || new Set(manifestPositions).size !== 7
    || assetIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))
    || new Set(assetIds).size !== 7
    || evidence.assets.length !== 7
  ) return blocked()

  const byId = new Map(evidence.assets.map((asset) => [
    text(asset.id), object(asset),
  ]))
  const ordered = assetIds.map((id) => byId.get(id)).filter(Boolean)
  const controlIds = new Set(ordered.map((asset) =>
    text(object(asset?.transformation).sameDayImageControlId)))
  const slots = ordered.map((asset) =>
    text(object(asset?.transformation).slot))
  const sourceHashes = ordered.map((asset) => text(asset?.source_sha256))
  const outputHashes = ordered.map((asset) => text(asset?.output_sha256))
  const objectives = ordered.slice(1).map((asset) => text(
    object(object(asset?.transformation).visualStrategyPosition)
      .salesObjective,
  ))
  const passed = ordered.filter((asset, index) => {
    const transformation = object(asset?.transformation)
    const qa = object(asset?.qa_result)
    const entry = manifest[index]
    return asset?.status === "approved"
      && text(asset?.approved_by) === actor
      && text(asset?.created_by) === actor
      && Number.isFinite(Date.parse(text(asset?.approved_at)))
      && asset?.rights_evidence_confirmed === true
      && asset?.output_width === 1600
      && asset?.output_height === 1600
      && transformation.version === "EBAY_LISTING_IMAGE_COMPOSITION_SET_V2"
      && transformation.compositorContractVersion === CURRENT_COMPOSITOR
      && (
        transformation.presentationMode === "SINGLE_SOURCE_INFORMATIONAL"
        || (
          transformation.presentationMode === "AUTHORIZED_MULTI_SOURCE"
          && (
            transformation.curationContractVersion === undefined
            || transformation.curationContractVersion
              === AUTOMATED_CURATION_CONTRACT
          )
          && transformation.competitorPixelsUsed !== true
          && transformation.productDossierFactsChanged !== true
          && transformation.calypsoProductFactsUsed !== true
        )
      )
      && (index === 0
        ? [
          "PRESERVED_FRAMED_SOURCE",
          "NORMALIZED_LIGHT_NEUTRAL",
        ].includes(transformation.authorizedSourceTreatment)
        : transformation.authorizedSourceTreatment
          === "LOCAL_AUTHORIZED_FOREGROUND")
      && transformation.sourceVisualPolicy === "EXACT_AUTHORIZED_PIXELS_ONLY"
      && transformation.authorizedSourceViewReused === true
      && transformation.originalPackagePixelsPreserved === true
      && transformation.competitorImageUsed === false
      && transformation.verifiedFactsOnly === true
      && transformation.generativeAiUsed === false
      && transformation.squarePresentationVersion
        === EBAY_SQUARE_PRESENTATION_QA_VERSION
      && transformation.artificialFrameAdded === false
      && transformation.outputEncodingQuality === 94
      && text(transformation.sameDayPilotRunId) === text(sameDayPilot.runId)
      && text(transformation.sameDayPilotCandidateId)
        === text(sameDayPilot.candidateId)
      && qa.automaticStatus === "PASSED"
      && qa.productFidelityPassed === true
      && qa.commercialQualityPassed === true
      && qa.technicalQualityPassed === true
      && qa.compositionPassed === true
      && qa.textPolicyPassed === true
      && qa.contextualPropsPassed === true
      && qa.mobileReadabilityPassed === true
      && qa.squarePresentationQaVersion
        === EBAY_SQUARE_PRESENTATION_QA_VERSION
      && qa.squareFormatPassed === true
      && qa.artificialInsetFrameFree === true
      && qa.sourceQualityPassed === true
      && qa.safeCanvasPlacementPassed === true
      && qa.mobileFocalPointPassed === true
      && Number(qa.productCoverageRatio) >= (index === 0 ? .75 : .68)
      && Number(qa.productCoverageRatio) <= (index === 0 ? .85 : .82)
      && qa.sourceViewCapabilityPassed === true
      && qa.marketSignalsLimitedToScene === true
      && qa.hiddenProductGeometryGenerated === false
      && qa.qaEvaluatorVersion === CURRENT_QA_EVALUATOR
      && emptyArray(qa.failureReasons)
      && emptyArray(qa.blockers)
      && text(entry.assetId) === text(asset?.id)
      && text(entry.sha256) === text(asset?.output_sha256)
      && text(entry.url) === text(asset?.public_url)
      && imageUrls[index] === text(asset?.public_url)
      && entry.automaticQa === "PASSED"
      && Number.isFinite(Date.parse(text(entry.humanApprovedAt)))
      && (
        entry.generativeAiUsed === undefined
        || entry.generativeAiUsed === false
      )
  })
  const ready = ordered.length === 7
    && passed.length === 7
    && slots[0] === "MAIN_WHITE_BACKGROUND"
    && object(ordered[0]?.qa_result).mainBackground === "PURE_WHITE"
    && new Set(slots).size === 7
    && controlIds.size === 1
    && Boolean([...controlIds][0])
    && new Set(sourceHashes).size >= 1
    && new Set(sourceHashes).size <= 5
    && sourceHashes.every((value) => /^[0-9a-f]{64}$/.test(value))
    && new Set(outputHashes).size === 7
    && outputHashes.every((value) => /^[0-9a-f]{64}$/.test(value))
    && objectives.length === 6
    && new Set(objectives).size === 6
    && objectives.every(Boolean)

  return {
    required: true,
    allowed: ready,
    reason: ready ? null : "FINAL_LISTING_AUTOMATED_GATE_NOT_READY",
    reviewId: ready ? [...controlIds][0] : null,
    revisionId: null,
    attemptId: null,
    previewHash: null,
    finalVisualSetLocked: ready,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: ready,
    visualPhase: ready ? "COMPLETED" : null,
    providerCallsSnapshot: 0,
    selectedAssets: ordered.length,
    passedAssets: passed.length,
    source: "APPROVED_SAME_DAY_IMAGE_SET_AUTOMATED_QA",
  }
}

export function evaluateApprovedImageRevisionAutomationGate(
  evidence: AutomatedRevisionEvidence,
): FinalListingReviewPublicationGate {
  const listingPackage = object(evidence.listingPackage)
  const packageData = object(listingPackage.package_data)
  const revision = object(evidence.revision)
  const preferredRevisionId = text(packageData.preferredImageRevisionId)
  const revisionId = text(revision.id)
  const assetIds = stringArray(revision.asset_ids)
  const revisionManifest = Array.isArray(revision.asset_manifest)
    ? revision.asset_manifest.map(object) : []
  const imageUrls = stringArray(packageData.imageUrls)
  const packageManifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(object) : []
  if (
    listingPackage.status === "archived"
    || !preferredRevisionId
    || revisionId !== preferredRevisionId
    || revision.status !== "APPROVED"
    || revision.strategy_version !== "VISUAL_STRATEGY_V2"
    || revision.revision_contract !== "LEGACY_VISUAL_STRATEGY_V2"
    || revision.human_decision !== "APPROVED"
    || !text(revision.reviewed_by)
    || !Number.isFinite(Date.parse(text(revision.reviewed_at)))
    || revision.openai_calls !== 0
    || revision.competitor_image_count !== 0
    || revision.ebay_writes !== 0
    || revision.production_changed !== false
    || !/^[0-9a-f]{64}$/.test(text(revision.image_set_hash))
    || Number(revision.authorized_source_count) < 2
    || Number(revision.authorized_source_count) > 5
    || assetIds.length !== 7
    || new Set(assetIds).size !== 7
    || revisionManifest.length !== 7
    || imageUrls.length !== 7
    || new Set(imageUrls).size !== 7
    || packageManifest.length !== 7
    || evidence.assets.length !== 7
  ) return blockedAutomatedGate()

  const byId = new Map(evidence.assets.map((asset) => [
    text(asset.id), object(asset),
  ]))
  const ordered = assetIds.map((id) => byId.get(id)).filter(Boolean)
  const slots = ordered.map((asset) =>
    text(object(asset?.transformation).slot))
  const sourceHashes = ordered.map((asset) => text(asset?.source_sha256))
  const outputHashes = ordered.map((asset) => text(asset?.output_sha256))
  const objectives = ordered.slice(1).map((asset) => text(
    object(object(asset?.transformation).visualStrategyPosition)
      .salesObjective,
  ))
  const passed = ordered.filter((asset) => {
    const transformation = object(asset?.transformation)
    const qa = object(asset?.qa_result)
    return asset?.status === "approved"
      && text(asset?.approved_by) === text(revision.reviewed_by)
      && Number.isFinite(Date.parse(text(asset?.approved_at)))
      && asset?.rights_evidence_confirmed === true
      && asset?.output_width === 1600
      && asset?.output_height === 1600
      && transformation.compositorContractVersion === CURRENT_COMPOSITOR
      && transformation.curationContractVersion
        === AUTOMATED_CURATION_CONTRACT
      && transformation.presentationMode === "AUTHORIZED_MULTI_SOURCE"
      && (transformation.slot === "MAIN_WHITE_BACKGROUND" ||
        transformation.authorizedSourceTreatment ===
          "LOCAL_AUTHORIZED_FOREGROUND")
      && transformation.foregroundMatteMethod !== "FULL_AUTHORIZED_FRAME"
      && transformation.sourceVisualPolicy === "EXACT_AUTHORIZED_PIXELS_ONLY"
      && transformation.authorizedSourceViewReused === true
      && transformation.originalPackagePixelsPreserved === true
      && transformation.competitorImageUsed === false
      && transformation.competitorPixelsUsed === false
      && transformation.verifiedFactsOnly === true
      && transformation.calypsoProductFactsUsed === false
      && transformation.productDossierFactsChanged === false
      && transformation.generativeAiUsed === false
      && transformation.squarePresentationVersion ===
        EBAY_SQUARE_PRESENTATION_QA_VERSION
      && transformation.artificialFrameAdded === false
      && transformation.outputEncodingQuality === 94
      && qa.automaticStatus === "PASSED"
      && qa.productFidelityPassed === true
      && qa.commercialQualityPassed === true
      && qa.technicalQualityPassed === true
      && qa.compositionPassed === true
      && qa.textPolicyPassed === true
      && qa.contextualPropsPassed === true
      && qa.mobileReadabilityPassed === true
      && qa.squarePresentationQaVersion ===
        EBAY_SQUARE_PRESENTATION_QA_VERSION
      && qa.squareFormatPassed === true
      && qa.artificialInsetFrameFree === true
      && qa.sourceQualityPassed === true
      && qa.safeCanvasPlacementPassed === true
      && qa.mobileFocalPointPassed === true
      && Number(qa.productCoverageRatio) >=
        (transformation.slot === "MAIN_WHITE_BACKGROUND" ? .75 : .68)
      && Number(qa.productCoverageRatio) <=
        (transformation.slot === "MAIN_WHITE_BACKGROUND" ? .85 : .82)
      && qa.sourceViewCapabilityPassed === true
      && qa.marketSignalsLimitedToScene === true
      && qa.hiddenProductGeometryGenerated === false
      && qa.qaEvaluatorVersion === CURRENT_QA_EVALUATOR
      && emptyArray(qa.failureReasons)
      && emptyArray(qa.blockers)
  })
  const exactManifestBinding = revisionManifest.every((entry, index) =>
    text(entry.assetId) === assetIds[index]
    && text(entry.outputSha256) === outputHashes[index]
    && text(entry.sourceSha256) === sourceHashes[index]
    && text(entry.slot) === slots[index],
  ) && packageManifest.every((entry, index) =>
    text(entry.assetId) === assetIds[index]
    && text(entry.sha256) === outputHashes[index]
    && text(entry.url) === imageUrls[index]
    && text(ordered[index]?.public_url) === imageUrls[index],
  )
  const ready = ordered.length === 7
    && passed.length === 7
    && slots[0] === "MAIN_WHITE_BACKGROUND"
    && object(ordered[0]?.qa_result).mainBackground === "PURE_WHITE"
    && new Set(slots).size === 7
    && new Set(sourceHashes).size
      === Number(revision.authorized_source_count)
    && new Set(outputHashes).size === 7
    && outputHashes.every((value) => /^[0-9a-f]{64}$/.test(value))
    && objectives.length === 6
    && new Set(objectives).size === 6
    && objectives.every(Boolean)
    && exactManifestBinding

  return {
    required: true,
    allowed: ready,
    reason: ready ? null : "FINAL_LISTING_AUTOMATED_GATE_NOT_READY",
    reviewId: revisionId || null,
    revisionId: revisionId || null,
    attemptId: null,
    previewHash: text(revision.image_set_hash) || null,
    finalVisualSetLocked: ready,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: ready,
    visualPhase: ready ? "COMPLETED" : null,
    providerCallsSnapshot: Number(revision.openai_calls) || 0,
    selectedAssets: ordered.length,
    passedAssets: passed.length,
    source: "APPROVED_IMAGE_REVISION_AUTOMATED_QA",
  }
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
  const legacyGate = evaluateFinalListingReviewPublicationGate(
    review as FinalReview | null,
  )
  if (legacyGate.allowed) return legacyGate

  let packageQuery = input.supabase
    .from("ebay_listing_packages")
    .select("id,status,created_by,package_data")
    .eq("id", input.listingPackageId)
  if (input.actorId) packageQuery = packageQuery.eq("created_by", input.actorId)
  const { data: listingPackage, error: packageError } =
    await packageQuery.maybeSingle()
  if (packageError) throw new Error("FINAL_LISTING_AUTOMATED_GATE_LOOKUP_FAILED")
  const packageData = object(listingPackage?.package_data)
  const preferredRevisionId = text(packageData.preferredImageRevisionId)
  const packageManifest = Array.isArray(packageData.imageAssetManifest)
    ? packageData.imageAssetManifest.map(object) : []
  const packageAssetIds = packageManifest
    .map((entry) => text(entry.assetId))
    .filter(Boolean)
  if (!listingPackage) return legacyGate

  if (!preferredRevisionId && packageAssetIds.length > 0) {
    let assetsQuery = input.supabase
      .from("ebay_listing_image_assets")
      .select([
        "id", "status", "approved_by", "approved_at", "public_url",
        "source_sha256", "output_sha256", "output_width", "output_height",
        "rights_evidence_confirmed", "transformation", "qa_result",
        "created_by", "source_url", "rights_basis",
        "authorization_reference", "transformation_version",
      ].join(","))
      .eq("listing_package_id", input.listingPackageId)
      .in("id", packageAssetIds)
    if (input.actorId) assetsQuery = assetsQuery.eq("created_by", input.actorId)
    const { data: assets, error: assetsError } = await assetsQuery
    if (assetsError) {
      throw new Error("FINAL_LISTING_AUTOMATED_GATE_LOOKUP_FAILED")
    }
    const automatedEvidence = {
      listingPackage: listingPackage as Record<string, any>,
      assets: (assets ?? []) as Array<Record<string, any>>,
    }
    if (object(packageData.supplierImageReadiness).version ===
        "LUNA_SUPPLIER_IMAGE_AUTO_READY_V1") {
      return evaluateApprovedLunaSupplierImageAutomationGate(
        automatedEvidence,
      )
    }
    if (packageAssetIds.length === 7) {
      return evaluateApprovedSameDayImageSetAutomationGate(automatedEvidence)
    }
    return legacyGate
  }
  if (!preferredRevisionId) return legacyGate

  let revisionQuery = input.supabase
    .from("ebay_same_day_pilot_image_revisions")
    .select("*")
    .eq("id", preferredRevisionId)
    .eq("listing_package_id", input.listingPackageId)
  if (input.actorId) revisionQuery = revisionQuery.eq("created_by", input.actorId)
  const { data: revision, error: revisionError } =
    await revisionQuery.maybeSingle()
  if (revisionError) throw new Error("FINAL_LISTING_AUTOMATED_GATE_LOOKUP_FAILED")
  const assetIds = stringArray(revision?.asset_ids)
  if (!revision || assetIds.length !== 7) {
    return blockedAutomatedGate()
  }
  let assetsQuery = input.supabase
    .from("ebay_listing_image_assets")
    .select([
      "id", "status", "approved_by", "approved_at", "public_url",
      "source_sha256", "output_sha256", "output_width", "output_height",
      "rights_evidence_confirmed", "transformation", "qa_result",
    ].join(","))
    .eq("listing_package_id", input.listingPackageId)
    .in("id", assetIds)
  if (input.actorId) assetsQuery = assetsQuery.eq("created_by", input.actorId)
  const { data: assets, error: assetsError } = await assetsQuery
  if (assetsError) throw new Error("FINAL_LISTING_AUTOMATED_GATE_LOOKUP_FAILED")
  return evaluateApprovedImageRevisionAutomationGate({
    listingPackage: listingPackage as Record<string, any>,
    revision: revision as Record<string, any>,
    assets: (assets ?? []) as Array<Record<string, any>>,
  })
}
