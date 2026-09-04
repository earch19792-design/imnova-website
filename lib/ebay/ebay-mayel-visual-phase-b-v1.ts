import { mayelVisualDigestV1 } from "./ebay-mayel-visual-workstation-v1"

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
      && !url.search && !url.hash ? url.href : null
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
  return mayelVisualDigestV1(urls.map((url, position) => ({ position, url })))
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
  mainImageProtected: true
  mainImageChanged: boolean
  fieldsToChange: readonly ["IMAGES_ONLY"]
  capacityExceeded: boolean
  imageCount: number
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
  const manifestAssetsValid = manifestAssets.length === approvedAssets.length
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
  const sharedContractValid = manifest.contractVersion === "MAYEL_VISUAL_MANIFEST_V1"
    && manifest.visualTaskId === input.visualTaskId
    && manifest.ebayItemId === input.ebayItemId
    && manifest.currentMainImagePreserved === true
    && manifest.separateExplicitOwnerApprovalRequiredForMainImage === true
    && JSON.stringify(manifest.fieldsToChange) === '["IMAGES_ONLY"]'
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
  else if (mainImageChanged) blocker = "MAYEL_VISUAL_MAIN_IMAGE_CHANGE_NOT_AUTHORIZED"
  else if (currentOfficial.some((url) => !proposedUrls.includes(url))) {
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
    mainImageProtected: true,
    mainImageChanged,
    fieldsToChange: Object.freeze(["IMAGES_ONLY"] as const),
    capacityExceeded,
    imageCount: proposedUrls.length,
  })
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
