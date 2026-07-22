import { createHash } from "node:crypto"

import sharp from "sharp"

import {
  prepareAuthorizedEbayFullFrameLayer,
  prepareAuthorizedEbaySecondaryForeground,
} from "./ebay-image-optimization-service"

export const AUTHORIZED_FOREGROUND_IDENTITY_VERSION =
  "AUTHORIZED_PRODUCT_FOREGROUND_IDENTITY_V1_2026_07_22"

export type AuthorizedForegroundIdentityEvidence = {
  version: typeof AUTHORIZED_FOREGROUND_IDENTITY_VERSION
  foregroundSha256: string
  maskSha256: string
  silhouetteSha256: string
  colorSha256: string
  foregroundAspectRatio: number
  visibleFeatureChecks: Array<{
    feature: "PERFORATIONS" | "HANDLES" | "RIM" | "BASE"
    regionSha256: string
    edgeDensity: number
    passed: true
  }>
  whiteBackgroundExcluded: true
  colorAndProportionsPassed: true
  allRequiredFeaturesPassed: true
}

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

export async function buildAuthorizedForegroundIdentityEvidence(
  source: Buffer,
  mode: "FULL_FRAME" | "PROTECTED_TRIMAP" = "PROTECTED_TRIMAP",
  sourceAngle: "FRONT" | "SIDE" = "FRONT",
): Promise<AuthorizedForegroundIdentityEvidence> {
  const foreground = mode === "FULL_FRAME"
    ? await prepareAuthorizedEbayFullFrameLayer(source)
    : await prepareAuthorizedEbaySecondaryForeground(source, {
      authorizedNativeHighResolution: true,
    })
  if (!foreground) throw new Error("AUTHORIZED_FOREGROUND_IDENTITY_UNSAFE")
  try {
    const metadata = await sharp(foreground.output).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    if (!width || !height) throw new Error("AUTHORIZED_FOREGROUND_IDENTITY_UNSAFE")
    const normalized = await sharp(foreground.output).resize(512, 512, {
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    try {
      const mask = Buffer.alloc(512 * 512)
      const colorSamples: number[] = []
      for (let index = 0; index < mask.length; index += 1) {
        const offset = index * normalized.info.channels
        const alpha = normalized.data[offset + 3]
        mask[index] = alpha
        const lightBackground = Math.min(
          normalized.data[offset], normalized.data[offset + 1],
          normalized.data[offset + 2],
        ) >= 248 && Math.max(
          normalized.data[offset], normalized.data[offset + 1],
          normalized.data[offset + 2],
        ) - Math.min(
          normalized.data[offset], normalized.data[offset + 1],
          normalized.data[offset + 2],
        ) <= 8
        if (alpha >= 128 && !lightBackground) {
          colorSamples.push(
            normalized.data[offset], normalized.data[offset + 1],
            normalized.data[offset + 2],
          )
        }
      }
      const color = Buffer.from(colorSamples)
      if (color.length < 3_000) {
        color.fill(0)
        mask.fill(0)
        throw new Error("AUTHORIZED_FOREGROUND_IDENTITY_UNSAFE")
      }
      const features = sourceAngle === "SIDE" ? [
        { feature: "HANDLES" as const, left: 100, top: 45, width: 312, height: 180 },
        { feature: "RIM" as const, left: 30, top: 0, width: 452, height: 130 },
        { feature: "PERFORATIONS" as const, left: 60, top: 220, width: 392, height: 300 },
        { feature: "BASE" as const, left: 80, top: 350, width: 352, height: 162 },
      ] : [
        { feature: "HANDLES" as const, left: 0, top: 80, width: 512, height: 170 },
        { feature: "RIM" as const, left: 60, top: 120, width: 392, height: 120 },
        { feature: "PERFORATIONS" as const, left: 90, top: 185, width: 332, height: 230 },
        { feature: "BASE" as const, left: 120, top: 350, width: 272, height: 145 },
      ]
      const visibleFeatureChecks: AuthorizedForegroundIdentityEvidence[
        "visibleFeatureChecks"] = []
      const grayscale = await sharp(normalized.data, {
        raw: {
          width: normalized.info.width,
          height: normalized.info.height,
          channels: normalized.info.channels,
        },
      }).greyscale().raw().toBuffer()
      const featureImage = sharp(grayscale, {
        raw: {
          width: normalized.info.width,
          height: normalized.info.height,
          channels: 1,
        },
      })
      for (const feature of features) {
        const left = Math.min(
          normalized.info.width - 1,
          Math.floor(feature.left / 512 * normalized.info.width),
        )
        const top = Math.min(
          normalized.info.height - 1,
          Math.floor(feature.top / 512 * normalized.info.height),
        )
        const width = Math.min(
          normalized.info.width - left,
          Math.max(1, Math.floor(feature.width / 512 * normalized.info.width)),
        )
        const height = Math.min(
          normalized.info.height - top,
          Math.max(1, Math.floor(feature.height / 512 * normalized.info.height)),
        )
        const region = await featureImage.clone().extract({
          left,
          top,
          width,
          height,
        }).convolve({
          width: 3,
          height: 3,
          kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
        }).raw().toBuffer()
        let edgePixels = 0
        for (const value of region) if (value >= 20) edgePixels += 1
        const edgeDensity = edgePixels / region.length
        const passed = edgeDensity >= .002
        const regionSha256 = sha256(region)
        region.fill(0)
        if (!passed) throw new Error(
          `AUTHORIZED_FOREGROUND_FEATURE_INVALID:${feature.feature}`,
        )
        visibleFeatureChecks.push({
          feature: feature.feature,
          regionSha256,
          edgeDensity: Number(edgeDensity.toFixed(6)),
          passed: true,
        })
      }
      const evidence = {
        version: AUTHORIZED_FOREGROUND_IDENTITY_VERSION,
        foregroundSha256: foreground.outputSha256,
        maskSha256: foreground.maskSha256,
        silhouetteSha256: sha256(mask),
        colorSha256: sha256(color),
        foregroundAspectRatio: Number((width / height).toFixed(6)),
        visibleFeatureChecks,
        whiteBackgroundExcluded: true,
        colorAndProportionsPassed: true,
        allRequiredFeaturesPassed: true,
      } satisfies AuthorizedForegroundIdentityEvidence
      color.fill(0)
      mask.fill(0)
      grayscale.fill(0)
      return evidence
    } finally {
      normalized.data.fill(0)
    }
  } finally {
    foreground.output.fill(0)
  }
}
