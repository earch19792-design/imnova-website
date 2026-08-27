export const REFERENCE_GUIDED_VISUAL_REVIEW_CONTRACT =
  "REFERENCE_GUIDED_PRODUCT_GENERATION_V1"

export const V3_FINAL_ASSET_ROLES = [
  "PRIMARY_MAIN",
  "SECONDARY_MATERIAL_DETAIL",
  "SECONDARY_PACKAGE_CONTENTS",
  "SECONDARY_SCALE_CAPACITY",
  "SECONDARY_USE_CONTEXT",
  "SECONDARY_ASPIRATIONAL_LIFESTYLE",
  "SECONDARY_HUMAN_CONTEXT",
] as const

const LEGACY_WORKSPACE_VISUAL_BLOCKERS = new Set([
  "IMAGE_REQUIRED",
  "NEED_AUTHORIZED_PRODUCT_IMAGES",
  "AUTHORIZED_LUNA_IMAGE_REQUIRED",
  "AUTHORIZED_IMAGE_REQUIRED",
])

const LEGACY_DRAFT_IMAGE_AUTH_BLOCKERS = new Set([
  "HTTPS_IMAGES_REQUIRED",
  "IMAGE_AUTHORIZATION_REQUIRED",
  "IMAGE_AUTHORIZATION_WITHOUT_SOURCE_IMAGE",
  "IMAGE_NOT_AUTHORIZED",
  "IMAGE_RIGHTS_BASIS_INVALID",
  "IMAGE_SOURCE_INVALID",
])

export function v3VisualReviewAccessible(input: {
  strategyVersion: unknown
  revisionContract: unknown
  attemptId: unknown
}) {
  return input.strategyVersion === "VISUAL_STRATEGY_V3"
    && input.revisionContract === REFERENCE_GUIDED_VISUAL_REVIEW_CONTRACT
    && typeof input.attemptId === "string"
    && /^[0-9a-f-]{36}$/i.test(input.attemptId)
}

export function v3PublicationAllowed(input: {
  visualReviewComplete: boolean
  staleCostOrStock: boolean
  commercialAuthorizationComplete: boolean
}) {
  return input.visualReviewComplete
    && !input.staleCostOrStock
    && input.commercialAuthorizationComplete
}

export function v3FinalListingReviewCanonicalReady(input: {
  activeRevisionId: unknown
  revisionId: unknown
  activeAttemptId: unknown
  attemptId: unknown
  visualPhase: unknown
  finalVisualSetLocked: unknown
  generationControlsHidden: unknown
  readyForUnpublishedOfferAuthorization: unknown
  providerCalls: unknown
  blockers: unknown
  gates: unknown
  signedImages: unknown
}) {
  const images = Array.isArray(input.signedImages)
    ? input.signedImages as Array<Record<string, unknown>>
    : []
  const blockers = Array.isArray(input.blockers) ? input.blockers : []
  const gates = input.gates && typeof input.gates === "object"
    && !Array.isArray(input.gates)
    ? Object.values(input.gates)
    : []
  const exactImages = images.length === V3_FINAL_ASSET_ROLES.length
    && images.every((asset, position) =>
      Number(asset.position) === position
      && asset.assetRole === V3_FINAL_ASSET_ROLES[position]
      && asset.status === "PASSED"
      && /^[0-9a-f]{64}$/.test(String(asset.sha256 ?? ""))
      && String(asset.storagePath ?? "").length > 0
    )
  return typeof input.activeRevisionId === "string"
    && input.activeRevisionId === input.revisionId
    && typeof input.activeAttemptId === "string"
    && input.activeAttemptId === input.attemptId
    && input.visualPhase === "COMPLETED"
    && input.finalVisualSetLocked === true
    && input.generationControlsHidden === true
    && input.readyForUnpublishedOfferAuthorization === true
    && input.providerCalls === 8
    && blockers.length === 0
    && gates.length > 0
    && gates.every((gate) => gate === true)
    && exactImages
}

export function visibleWorkspaceBlockers(input: {
  blockers: unknown
  canonicalV3FinalReview: boolean
  source?: "workspace" | "draft_readiness"
}) {
  const blockers = Array.isArray(input.blockers)
    ? input.blockers.filter((blocker): blocker is string =>
        typeof blocker === "string")
    : []
  if (!input.canonicalV3FinalReview) return blockers
  return blockers.filter((blocker) => {
    const normalized = blocker
      .replace(/^HARD_GATE:/, "")
      .replace(/^EVIDENCE_GUARD:/, "")
    if (LEGACY_WORKSPACE_VISUAL_BLOCKERS.has(normalized)) return false
    return input.source !== "draft_readiness"
      || !LEGACY_DRAFT_IMAGE_AUTH_BLOCKERS.has(normalized)
  })
}

export function canonicalWorkspacePreparationBlockers(input: {
  title: unknown
  categoryId: unknown
  description: unknown
  imageUrls: unknown
  targetPrice: unknown
  hardGates: unknown
  evidenceGuards: unknown
  resolvedHardGates: ReadonlySet<string>
}) {
  const hardGates = Array.isArray(input.hardGates)
    ? input.hardGates.filter((gate): gate is string => typeof gate === "string")
    : []
  const evidenceGuards = Array.isArray(input.evidenceGuards)
    ? input.evidenceGuards.filter((guard): guard is string =>
        typeof guard === "string")
    : []
  const unresolvedHardGates = hardGates.filter((gate) =>
    !input.resolvedHardGates.has(gate))
  const imageUrls = Array.isArray(input.imageUrls) ? input.imageUrls : []
  const targetPrice = Number(input.targetPrice)

  return [...new Set([
    ...(!String(input.title ?? "").trim() ? ["TITLE_REQUIRED"] : []),
    ...(!String(input.categoryId ?? "").trim() ? ["CATEGORY_REQUIRED"] : []),
    ...(!String(input.description ?? "").trim()
      ? ["DESCRIPTION_REQUIRED"] : []),
    ...(!imageUrls.length
      && !unresolvedHardGates.includes("NEED_AUTHORIZED_PRODUCT_IMAGES")
      ? ["IMAGE_REQUIRED"] : []),
    ...(!(Number.isFinite(targetPrice) && targetPrice > 0)
      ? ["PRICE_REQUIRED"] : []),
    ...unresolvedHardGates,
    ...evidenceGuards,
  ])]
}
