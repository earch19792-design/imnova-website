import { createHash } from "node:crypto"

import type { JsonRecord } from "./ebay-draft-only-readiness"

export const V3_UNPUBLISHED_CONFIRMATION =
  "AUTORIZAR INVENTORY ITEM Y OFFER UNPUBLISHED"
export const V3_PUBLICATION_SOURCE_BUCKET = "ebay-listing-image-staging"
export const V3_PUBLICATION_BUCKET = "ebay-listing-images"

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
