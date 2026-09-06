import {
  buildMayelOrderedVisualManifestV2,
  buildMayelVisualManifestV1,
  MAYEL_ORDERED_VISUAL_MANIFEST_VERSION,
  MAYEL_VISUAL_OUTPUT_ROLES,
  mayelVisualDigestV1,
} from "./ebay-mayel-visual-workstation-v1"
import { buildOfficialTradingPictureReadbackV1 } from
  "./ebay-active-listing-image-revision-service"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function exactHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value.trim())
    return url.protocol === "https:" && !url.username && !url.password
      && !url.hash ? url.href : null
  } catch { return null }
}

function uuid(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(normalized) ? normalized : null
}

function sha(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : ""
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null
}

export function ebayOfficialImageSetDigestV1(urls: readonly string[]) {
  return buildOfficialTradingPictureReadbackV1(urls).officialImageSetDigest
}

export type MayelVisualPhaseBPlanV1 = Readonly<{
  ready: boolean
  blocker: string | null
  currentOfficialImageSetDigest: string
  visualManifestDigest: string | null
  ownerAuthorizationDigest: string | null
  currentMainImage: string | null
  currentSecondaryImages: readonly string[]
  newMayelSecondaryImages: readonly string[]
  proposedFinalOrderedImageUrls: readonly string[]
  canonicalAssetIds: readonly string[]
  canonicalAssetSha256s: readonly string[]
  mainImageProtected: boolean
  mainImageChanged: boolean
  fieldsToChange: readonly ["IMAGES_ONLY"]
  capacityExceeded: boolean
  imageCount: number
}>

export type MayelVisualPhaseBRebaseV1 = Readonly<{
  safe: boolean
  blocker: string | null
  manifest: Readonly<Record<string, unknown>> | null
  visualManifestDigest: string | null
  currentOfficialImageSetDigest: string
  mayelAssetPreserved: boolean
  mayelReworkRequired: boolean
  mainImagePreserved: boolean
}>

export function buildMayelVisualPhaseBPlanV1(input: {
  visualTaskId: string
  ebayItemId: string
  visualManifest: unknown
  visualManifestDigest: unknown
  currentOfficialImageUrls: readonly string[]
  approvedAssets: readonly unknown[]
  canonicalPublicAssetUrlAllowed: (url: string) => boolean
}): MayelVisualPhaseBPlanV1 {
  const manifest = record(input.visualManifest)
  const storedDigest = typeof input.visualManifestDigest === "string"
    ? input.visualManifestDigest.trim() : ""
  const embeddedDigest = typeof manifest.visualManifestDigest === "string"
    ? manifest.visualManifestDigest.trim() : ""
  const material = { ...manifest }
  delete material.visualManifestDigest
  const recomputedDigest = mayelVisualDigestV1(material)
  const currentOfficial = input.currentOfficialImageUrls
    .map(exactHttpsUrl).filter((url): url is string => Boolean(url))
  const currentDigest = ebayOfficialImageSetDigestV1(currentOfficial)
  const manifestCurrent = [manifest.currentMainImage,
    ...(Array.isArray(manifest.currentSecondaryImages)
      ? manifest.currentSecondaryImages : [])]
    .map(exactHttpsUrl).filter((url): url is string => Boolean(url))
  const proposedEntries = Array.isArray(manifest.proposedOrderedImages)
    ? manifest.proposedOrderedImages.map(record) : []
  const proposed = proposedEntries.map((entry) => exactHttpsUrl(entry.publicUrl))
  const positionsValid = proposedEntries.every((entry, index) =>
    Number(entry.position) === index)
  const approvedAssets = input.approvedAssets.flatMap((value) => {
    const asset = record(value)
    const id = uuid(asset.id)
    const outputSha256 = sha(asset.output_sha256 ?? asset.outputSha256)
    const publicUrl = exactHttpsUrl(asset.public_url ?? asset.publicUrl)
    const approved = asset.status === "approved"
      && asset.mayel_approval_status === "APPROVED"
      && asset.owner_approval_status === "PENDING"
    return id && outputSha256 && publicUrl && approved
      && input.canonicalPublicAssetUrlAllowed(publicUrl)
      ? [{ id, outputSha256, publicUrl }] : []
  })
  const approvedById = new Map(approvedAssets.map((asset) => [asset.id, asset]))
  const manifestAssets = proposedEntries.filter((entry) => entry.assetId !== null)
  const orderedContract = manifest.contractVersion ===
    MAYEL_ORDERED_VISUAL_MANIFEST_VERSION
  const manifestAssetsValid = (!orderedContract &&
    manifestAssets.length === approvedAssets.length || orderedContract)
    && manifestAssets.every((entry) => {
      const id = uuid(entry.assetId)
      const asset = id ? approvedById.get(id) : null
      return Boolean(asset && entry.outputSha256 === asset.outputSha256
        && exactHttpsUrl(entry.publicUrl) === asset.publicUrl)
    })
  const allProposedValid = proposed.length === proposedEntries.length
  const proposedUrls = proposed.filter((url): url is string => Boolean(url))
  const capacityExceeded = proposedUrls.length > 24
  const mainImageChanged = Boolean(currentOfficial[0]
    && proposedUrls[0] !== currentOfficial[0])
  const v1ContractValid = manifest.contractVersion === "MAYEL_VISUAL_MANIFEST_V1"
    && manifest.visualTaskId === input.visualTaskId
    && manifest.ebayItemId === input.ebayItemId
    && manifest.currentMainImagePreserved === true
    && manifest.separateExplicitOwnerApprovalRequiredForMainImage === true
    && JSON.stringify(manifest.fieldsToChange) === '["IMAGES_ONLY"]'
  const v2ContractValid = orderedContract
    && manifest.visualTaskId === input.visualTaskId
    && manifest.ebayItemId === input.ebayItemId
    && manifest.orderControlledByMayel === true
    && manifest.backendSilentReorder === false
    && manifest.mayelMainImageAuthority === true
    && manifest.ownerPerImageApproval === false
    && manifest.ownerPerListingVisualApproval === false
    && JSON.stringify(manifest.fieldsToChange) === '["IMAGES_ONLY"]'
  const sharedContractValid = (v1ContractValid || v2ContractValid)
    && /^sha256:[0-9a-f]{64}$/.test(storedDigest)
    && storedDigest === embeddedDigest && storedDigest === recomputedDigest
  let blocker: string | null = null
  if (!sharedContractValid) blocker = "MAYEL_VISUAL_MANIFEST_INVALID"
  else if (!currentOfficial.length || currentOfficial.length !== manifestCurrent.length
    || currentOfficial.some((url, index) => url !== manifestCurrent[index])) {
    blocker = "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED"
  } else if (!positionsValid || !allProposedValid
    || new Set(proposedUrls).size !== proposedUrls.length
    || !manifestAssetsValid) blocker = "MAYEL_VISUAL_FINAL_IMAGE_SET_INVALID"
  else if (!orderedContract && mainImageChanged) {
    blocker = "MAYEL_VISUAL_MAIN_IMAGE_CHANGE_NOT_AUTHORIZED"
  } else if (!orderedContract && currentOfficial.some((url) =>
    !proposedUrls.includes(url))) {
    blocker = "MAYEL_VISUAL_CURRENT_IMAGE_REMOVAL_NOT_AUTHORIZED"
  } else if (capacityExceeded) blocker = "MAYEL_VISUAL_IMAGE_CAPACITY_DECISION_REQUIRED"
  return Object.freeze({
    ready: blocker === null,
    blocker,
    currentOfficialImageSetDigest: currentDigest,
    visualManifestDigest: /^sha256:[0-9a-f]{64}$/.test(storedDigest)
      ? storedDigest : null,
    ownerAuthorizationDigest: blocker === null ? storedDigest : null,
    currentMainImage: currentOfficial[0] ?? null,
    currentSecondaryImages: Object.freeze(currentOfficial.slice(1)),
    newMayelSecondaryImages: Object.freeze(approvedAssets.map((asset) =>
      asset.publicUrl)),
    proposedFinalOrderedImageUrls: Object.freeze(proposedUrls),
    canonicalAssetIds: Object.freeze(approvedAssets.map((asset) => asset.id)),
    canonicalAssetSha256s: Object.freeze(approvedAssets.map((asset) =>
      asset.outputSha256)),
    mainImageProtected: !orderedContract,
    mainImageChanged,
    fieldsToChange: Object.freeze(["IMAGES_ONLY"] as const),
    capacityExceeded,
    imageCount: proposedUrls.length,
  })
}

/**
 * Rebuilds only the material Phase B manifest over a fresh official image set.
 * The approved Mayel assets and both evidence digests must remain bound to the
 * exact Phase A task. This never authorizes or executes a marketplace write.
 */
export function buildMayelVisualPhaseBRebaseV1(input: {
  visualTaskId: string
  ebayItemId: string
  visualManifest: unknown
  visualManifestDigest: unknown
  taskProductTruthDigest: unknown
  taskSourceImageSetDigest: unknown
  currentOfficialImageUrls: readonly string[]
  approvedAssets: readonly unknown[]
  appliedMayelOfficialImages?: readonly Readonly<{
    assetId: string
    officialUrl: string
  }>[]
  canonicalPublicAssetUrlAllowed: (url: string) => boolean
}): MayelVisualPhaseBRebaseV1 {
  const manifest = record(input.visualManifest)
  const oldCurrent = [manifest.currentMainImage,
    ...(Array.isArray(manifest.currentSecondaryImages)
      ? manifest.currentSecondaryImages : [])]
    .map(exactHttpsUrl).filter((url): url is string => Boolean(url))
  const oldPlan = buildMayelVisualPhaseBPlanV1({
    visualTaskId: input.visualTaskId,
    ebayItemId: input.ebayItemId,
    visualManifest: input.visualManifest,
    visualManifestDigest: input.visualManifestDigest,
    currentOfficialImageUrls: oldCurrent,
    approvedAssets: input.approvedAssets,
    canonicalPublicAssetUrlAllowed: input.canonicalPublicAssetUrlAllowed,
  })
  const currentOfficial = input.currentOfficialImageUrls
    .map(exactHttpsUrl).filter((url): url is string => Boolean(url))
  const currentDigest = ebayOfficialImageSetDigestV1(currentOfficial)
  const taskProductTruthDigest = typeof input.taskProductTruthDigest === "string"
    ? input.taskProductTruthDigest.trim() : ""
  const taskSourceImageSetDigest = typeof input.taskSourceImageSetDigest === "string"
    ? input.taskSourceImageSetDigest.trim() : ""
  const evidenceBound = /^sha256:[0-9a-f]{64}$/.test(taskProductTruthDigest)
    && /^sha256:[0-9a-f]{64}$/.test(taskSourceImageSetDigest)
    && manifest.productTruthDigest === taskProductTruthDigest
    && manifest.sourceImageSetDigest === taskSourceImageSetDigest
  const approvedAssets = input.approvedAssets.flatMap((value) => {
    const asset = record(value)
    const id = uuid(asset.id)
    const role = typeof asset.mayel_output_role === "string"
      ? asset.mayel_output_role : typeof asset.role === "string" ? asset.role : ""
    const outputSha256 = sha(asset.output_sha256 ?? asset.outputSha256)
    const publicUrl = exactHttpsUrl(asset.public_url ?? asset.publicUrl)
    const bound = asset.product_truth_digest === taskProductTruthDigest
      && asset.source_image_set_digest === taskSourceImageSetDigest
    return id && outputSha256 && publicUrl && bound
      && asset.status === "approved"
      && asset.mayel_approval_status === "APPROVED"
      && asset.owner_approval_status === "PENDING"
      && MAYEL_VISUAL_OUTPUT_ROLES.includes(role as never)
      && input.canonicalPublicAssetUrlAllowed(publicUrl)
      ? [{ assetId: id, role: role as (typeof MAYEL_VISUAL_OUTPUT_ROLES)[number],
        outputSha256, publicUrl }] : []
  })
  let blocker: string | null = null
  if (!oldPlan.ready) blocker = oldPlan.blocker
  else if (!evidenceBound || approvedAssets.length !== input.approvedAssets.length
    || approvedAssets.length < 1) {
    blocker = "MAYEL_VISUAL_REBASE_EVIDENCE_BINDING_CONFLICT"
  } else if (!currentOfficial.length
    || currentOfficial.length !== input.currentOfficialImageUrls.length
    || new Set(currentOfficial).size !== currentOfficial.length) {
    blocker = "MAYEL_VISUAL_REBASE_OFFICIAL_IMAGE_SET_INVALID"
  } else if (manifest.contractVersion !== MAYEL_ORDERED_VISUAL_MANIFEST_VERSION
    && approvedAssets.some((asset) => currentOfficial.includes(asset.publicUrl))) {
    blocker = "MAYEL_VISUAL_REBASE_ASSET_ALREADY_OFFICIAL"
  }
  if (blocker) return Object.freeze({ safe: false, blocker, manifest: null,
    visualManifestDigest: null, currentOfficialImageSetDigest: currentDigest,
    mayelAssetPreserved: approvedAssets.length === input.approvedAssets.length,
    mayelReworkRequired: blocker ===
      "MAYEL_VISUAL_REBASE_EVIDENCE_BINDING_CONFLICT",
    mainImagePreserved: false })
  const rebasedManifest = manifest.contractVersion ===
    MAYEL_ORDERED_VISUAL_MANIFEST_VERSION
    ? buildMayelOrderedVisualManifestV2({
      visualTaskId: input.visualTaskId,
      ebayItemId: input.ebayItemId,
      currentImages: currentOfficial,
      assets: approvedAssets,
      finalOrder: (() => {
        const retained: Array<{
          kind: "MAYEL_ASSET"; assetId: string
        } | { kind: "CURRENT_OFFICIAL"; publicUrl: string }> = []
        const previous = Array.isArray(manifest.proposedOrderedImages)
          ? manifest.proposedOrderedImages.map(record) : []
        for (const entry of previous) {
          const assetId = uuid(entry.assetId)
          if (assetId && approvedAssets.some((asset) =>
            asset.assetId === assetId)) {
            retained.push({ kind: "MAYEL_ASSET", assetId })
            continue
          }
          const publicUrl = exactHttpsUrl(entry.publicUrl)
          if (publicUrl && currentOfficial.includes(publicUrl)) {
            retained.push({ kind: "CURRENT_OFFICIAL", publicUrl })
          }
        }
        const represented = new Set(retained.map((entry) =>
          entry.kind === "MAYEL_ASSET"
            ? approvedAssets.find((asset) => asset.assetId === entry.assetId)
              ?.publicUrl : entry.publicUrl))
        const manifestAssetIds = new Set([
          ...previous.map((entry) => uuid(entry.assetId)).filter(
            (value): value is string => Boolean(value)),
          ...(Array.isArray(manifest.removedAssetIds)
            ? manifest.removedAssetIds.map(uuid).filter(
              (value): value is string => Boolean(value)) : []),
        ])
        // A prior verified execution may have converted a durable Mayel asset
        // into an EPS URL. That URL is managed by the asset intent already;
        // treating it as an unrelated newly-official image would resurrect a
        // removed asset or duplicate a selected one during safe rebase.
        const managedOfficialUrls = new Set(
          (input.appliedMayelOfficialImages ?? []).flatMap((binding) => {
            const assetId = uuid(binding.assetId)
            const officialUrl = exactHttpsUrl(binding.officialUrl)
            return assetId && officialUrl && manifestAssetIds.has(assetId)
              ? [officialUrl] : []
          }),
        )
        const intentionallyRemovedOfficialUrls = new Set(
          (Array.isArray(manifest.removedOfficialImageUrls)
            ? manifest.removedOfficialImageUrls : [])
            .map(exactHttpsUrl).filter(
              (value): value is string => Boolean(value)),
        )
        const newlyOfficial = currentOfficial.filter((url) =>
          !represented.has(url) && !managedOfficialUrls.has(url)
          && !intentionallyRemovedOfficialUrls.has(url))
          .map((publicUrl) => ({
            kind: "CURRENT_OFFICIAL" as const, publicUrl }))
        return [...retained, ...newlyOfficial]
      })(),
      productTruthDigest: taskProductTruthDigest,
      sourceImageSetDigest: taskSourceImageSetDigest,
    })
    : buildMayelVisualManifestV1({
      visualTaskId: input.visualTaskId,
      ebayItemId: input.ebayItemId,
      currentImages: currentOfficial,
      assets: approvedAssets,
      productTruthDigest: taskProductTruthDigest,
      sourceImageSetDigest: taskSourceImageSetDigest,
    })
  const rebasedPlan = buildMayelVisualPhaseBPlanV1({
    visualTaskId: input.visualTaskId,
    ebayItemId: input.ebayItemId,
    visualManifest: rebasedManifest,
    visualManifestDigest: rebasedManifest.visualManifestDigest,
    currentOfficialImageUrls: currentOfficial,
    approvedAssets: input.approvedAssets,
    canonicalPublicAssetUrlAllowed: input.canonicalPublicAssetUrlAllowed,
  })
  return Object.freeze({ safe: rebasedPlan.ready,
    blocker: rebasedPlan.blocker,
    manifest: rebasedPlan.ready ? rebasedManifest : null,
    visualManifestDigest: rebasedPlan.ready
      ? rebasedManifest.visualManifestDigest : null,
    currentOfficialImageSetDigest: currentDigest,
    mayelAssetPreserved: true,
    mayelReworkRequired: false,
    mainImagePreserved: rebasedPlan.ready && !rebasedPlan.mainImageChanged })
}

export const MAYEL_VISUAL_PHASE_B_STATES = Object.freeze([
  "OWNER_REVIEW_PENDING",
  "OWNER_APPROVED",
  "PREFLIGHT",
  "EXECUTING",
  "WRITE_ACCEPTED",
  "OFFICIAL_READBACK_PENDING",
  "APPLIED_AND_OFFICIALLY_VERIFIED",
  "AUTHORIZATION_INVALIDATED",
  "PREFLIGHT_FAILED",
  "WRITE_FAILED",
  "READBACK_FAILED",
  "READBACK_MISMATCH",
] as const)
