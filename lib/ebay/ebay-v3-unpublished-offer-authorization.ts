import { createHash } from "node:crypto"

import type { JsonRecord } from "./ebay-draft-only-readiness"

export const V3_UNPUBLISHED_CONFIRMATION =
  "AUTORIZAR INVENTORY ITEM Y OFFER UNPUBLISHED"
export const V3_UNPUBLISHED_AUTHORIZATION_ACTION_VERSION =
  "AUTHORIZE_RECONCILED_V1"
export const V3_PUBLICATION_SOURCE_BUCKET = "ebay-listing-image-staging"
export const V3_PUBLICATION_BUCKET = "ebay-listing-images"

export const V3_UNPUBLISHED_PREFLIGHT_RESULTS = [
  "READY_TO_RESUME_EXISTING_AUTHORIZATION",
  "READY_FOR_NEW_HUMAN_AUTHORIZATION",
  "ERROR",
] as const

export type V3UnpublishedPreflightResult =
  typeof V3_UNPUBLISHED_PREFLIGHT_RESULTS[number]

export type V3PublicationAsset = {
  position: number
  assetRole: string
  sha256: string
  sourceStoragePath: string
  publicationStoragePath: string
  url: string
  mime: "image/png"
  width: 1600
  height: 1600
  bytes: number
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  )
}

export function v3AuthorizationHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex")
}

export function buildV3UnpublishedAuthorizationIdempotencyKey(input: {
  listingPackageId: string
  previewHash: string
  payloadHash: string
  targetAccountFingerprint: string
  actionVersion: string
}) {
  const bindingHash = v3AuthorizationHash({
    listingPackageId: input.listingPackageId,
    previewHash: input.previewHash,
    payloadHash: input.payloadHash,
    targetAccountFingerprint: input.targetAccountFingerprint,
    actionVersion: input.actionVersion,
  })
  return `v3-unpublished:${input.actionVersion}:${bindingHash.slice(0, 32)}`
}

export function resolveV3UnpublishedAuthorizationPreflight(input: {
  authorizationPreview: {
    listingPackageId: string
    revisionId: string
    finalPreviewId: string
    status: string
    invalidated: boolean
    sourcePreviewHash: string
    exactPreviewHash: string
    payloadHash: string
    target: string
    accountFingerprint: string
    preflightExpiresAt: string | null
    exactPayloadHashValid: boolean
    authoritySnapshotHashValid: boolean
    screenConsistencyValid: boolean
  } | null
  approval: {
    id: string
    listingPackageId: string
    status: string
    payloadHash: string
    target: string
    accountFingerprint: string
    expiresAt: string | null
    consumedAt: string | null
    revokedAt: string | null
    approvedPayloadHashValid: boolean
  } | null
  expectedListingPackageId: string
  expectedRevisionId: string
  expectedFinalPreviewId: string
  expectedSourcePreviewHash: string
  runtimeTarget: string
  runtimeAccountFingerprint: string
  runtimeReady: boolean
  nowMs?: number
}) {
  const nowMs = input.nowMs ?? Date.now()
  const preview = input.authorizationPreview
  const approval = input.approval
  if (!preview) {
    return {
      result: "READY_FOR_NEW_HUMAN_AUTHORIZATION" as const,
      reason: "AUTHORIZATION_PREVIEW_NOT_PREPARED",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch: false,
      payloadHashMatch: false,
      targetAccountMatch: false,
      preflightSnapshotFresh: false,
    }
  }
  const previewHashMatch =
    preview.sourcePreviewHash === input.expectedSourcePreviewHash
  const previewIntegrityValid = Boolean(
    /^[0-9a-f]{64}$/.test(preview.sourcePreviewHash)
    && /^[0-9a-f]{64}$/.test(preview.exactPreviewHash)
    && /^[0-9a-f]{64}$/.test(preview.payloadHash)
    && /^[0-9a-f]{64}$/.test(preview.accountFingerprint)
    && preview.listingPackageId === input.expectedListingPackageId
    && preview.revisionId === input.expectedRevisionId
    && preview.finalPreviewId === input.expectedFinalPreviewId
    && preview.status === "READY_FOR_HUMAN_AUTHORIZATION"
    && !preview.invalidated
    && preview.exactPayloadHashValid
    && preview.authoritySnapshotHashValid
    && preview.screenConsistencyValid,
  )
  const targetAccountMatch =
    input.runtimeReady
    && input.runtimeTarget === "PRODUCTION"
    && preview.target === input.runtimeTarget
    && preview.accountFingerprint === input.runtimeAccountFingerprint
    && (!approval
      || approval.status !== "approved"
      || Boolean(approval.consumedAt)
      || Boolean(approval.revokedAt)
      || (
        approval.target === preview.target
        && approval.accountFingerprint === preview.accountFingerprint
      ))
  const payloadHashMatch = Boolean(
    approval && approval.payloadHash === preview.payloadHash,
  )
  const approvalFresh = Boolean(
    approval?.expiresAt
    && Number.isFinite(Date.parse(approval.expiresAt))
    && Date.parse(approval.expiresAt) > nowMs,
  )
  const preflightSnapshotFresh = Boolean(
    preview.preflightExpiresAt
    && Number.isFinite(Date.parse(preview.preflightExpiresAt))
    && Date.parse(preview.preflightExpiresAt) > nowMs,
  )
  const approvalActive = Boolean(
    approval
    && approval.status === "approved"
    && !approval.consumedAt
    && !approval.revokedAt,
  )
  const approvalIntegrityValid = !approval
    || (
      /^[0-9a-f]{64}$/.test(approval.payloadHash)
      && /^[0-9a-f]{64}$/.test(approval.accountFingerprint)
      && approval.approvedPayloadHashValid
    )

  if (!previewIntegrityValid) {
    return {
      result: "ERROR" as const,
      reason: "AUTHORIZATION_PREVIEW_INTEGRITY_INVALID",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }
  if (!approvalIntegrityValid) {
    return {
      result: "ERROR" as const,
      reason: "ACTIVE_APPROVAL_INTEGRITY_INVALID",
      activeApprovalFound: true,
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }
  if (!input.runtimeReady) {
    return {
      result: "ERROR" as const,
      reason: "EBAY_DRAFT_ONLY_RUNTIME_NOT_READY",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch: false,
      preflightSnapshotFresh,
    }
  }
  if (!previewHashMatch) {
    return {
      result: "ERROR" as const,
      reason: "FINAL_PREVIEW_HASH_MISMATCH",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch: false,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }
  if (!targetAccountMatch) {
    return {
      result: "ERROR" as const,
      reason: "TARGET_ACCOUNT_MISMATCH",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch: false,
      preflightSnapshotFresh,
    }
  }
  if (
    approval?.consumedAt
    || approval?.status === "consumed"
    || approval?.status === "executed"
  ) {
    return {
      result: "ERROR" as const,
      reason: "APPROVAL_ALREADY_CONSUMED",
      activeApprovalFound: true,
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }
  if (approvalActive && !approvalFresh) {
    return {
      result: "READY_FOR_NEW_HUMAN_AUTHORIZATION" as const,
      reason: preflightSnapshotFresh
        ? "ACTIVE_APPROVAL_EXPIRED"
        : "AUTHORIZATION_PREFLIGHT_EXPIRED",
      activeApprovalFound: true,
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }
  const activeApprovalReusable = approvalActive
    && approvalFresh
    && preflightSnapshotFresh
    && previewHashMatch
    && payloadHashMatch
    && targetAccountMatch
    && approval?.listingPackageId === preview.listingPackageId

  if (activeApprovalReusable) {
    return {
      result: "READY_TO_RESUME_EXISTING_AUTHORIZATION" as const,
      reason: null,
      activeApprovalFound: true,
      activeApprovalReusable: true,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh,
    }
  }

  if (!preflightSnapshotFresh) {
    return {
      result: "READY_FOR_NEW_HUMAN_AUTHORIZATION" as const,
      reason: "AUTHORIZATION_PREFLIGHT_EXPIRED",
      activeApprovalFound: Boolean(approval),
      activeApprovalReusable: false,
      previewHashMatch,
      payloadHashMatch,
      targetAccountMatch,
      preflightSnapshotFresh: false,
    }
  }

  const reason = approvalActive && !payloadHashMatch
    ? "ACTIVE_APPROVAL_PAYLOAD_MISMATCH"
    : approval?.revokedAt || approval?.status === "revoked"
      ? "APPROVAL_REVOKED"
      : "NO_ACTIVE_COMPATIBLE_APPROVAL"

  return {
    result: "READY_FOR_NEW_HUMAN_AUTHORIZATION" as const,
    reason,
    activeApprovalFound: Boolean(approval),
    activeApprovalReusable: false,
    previewHashMatch,
    payloadHashMatch,
    targetAccountMatch,
    preflightSnapshotFresh,
  }
}

export function validateV3PublicationAssets(value: unknown) {
  const assets = Array.isArray(value) ? value as V3PublicationAsset[] : []
  const positions = assets.map((asset) => asset.position)
  const roles = assets.map((asset) => asset.assetRole)
  const valid = assets.length === 7
    && positions.every((position, index) => position === index)
    && new Set(positions).size === 7
    && new Set(roles).size === 7
    && assets[0]?.assetRole === "PRIMARY_MAIN"
    && assets.every((asset) =>
      /^[0-9a-f]{64}$/.test(asset.sha256)
      && asset.mime === "image/png"
      && asset.width === 1600
      && asset.height === 1600
      && asset.bytes > 0
      && asset.publicationStoragePath.endsWith(`/${asset.sha256}.png`)
      && /^https:\/\//.test(asset.url)
      && !/[?&](token|expires|signature)=/i.test(asset.url)
    )
  if (!valid) throw new Error("EBAY_V3_PUBLICATION_TRANSPORT_INVALID")
  return assets
}

export function withV3FinalSetAuthorization(
  payload: JsonRecord,
  binding: JsonRecord,
): JsonRecord {
  const compliance = payload.compliance && typeof payload.compliance === "object"
    ? payload.compliance as JsonRecord
    : {}
  return {
    ...payload,
    compliance: {
      ...compliance,
      v3FinalSetAuthorization: binding,
    },
  }
}

export function packageWithV3PublicationAssets(
  listingPackage: JsonRecord,
  assetsValue: unknown,
) {
  const assets = validateV3PublicationAssets(assetsValue)
  const packageData = listingPackage.package_data
    && typeof listingPackage.package_data === "object"
    ? listingPackage.package_data as JsonRecord
    : {}
  return {
    ...listingPackage,
    package_data: {
      ...packageData,
      imageUrls: assets.map((asset) => asset.url),
      imageAssetManifest: assets.map((asset) => ({
        position: asset.position,
        role: asset.assetRole,
        slot: asset.assetRole,
        url: asset.url,
        sha256: asset.sha256,
        automaticQa: "PASSED",
        humanApprovedAt: "V3_FINAL_ATOMIC_SELECTION",
        generativeAiUsed: ![0, 1, 2].includes(asset.position),
        transformationVersion: "REFERENCE_GUIDED_PRODUCT_GENERATION_V3_FINAL_SET",
      })),
    },
  } as JsonRecord
}
