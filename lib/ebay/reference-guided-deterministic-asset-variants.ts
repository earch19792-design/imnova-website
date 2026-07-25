import { createHash } from "node:crypto"
import sharp from "sharp"

export const PRIMARY_VERTICAL_CENTER_VERSION =
  "DETERMINISTIC_PRIMARY_VERTICAL_CENTER_V1"
export const SIDE_MATERIAL_DETAIL_VERSION =
  "DETERMINISTIC_SOURCE_CROP_SIDE_V1"
export const SIDE_NORMALIZED_WIDTH = 1280
export const SIDE_NORMALIZED_HEIGHT = 897
export const SIDE_DETAIL_CROP = {
  left: 240,
  top: 0,
  width: 800,
  height: 800,
} as const

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

async function rawRgb(input: Buffer) {
  const metadata = await sharp(input).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error("DETERMINISTIC_RAW_DIMENSIONS_INVALID")
  }
  const { data, info } = await sharp(input).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true })
  return { data, info, metadata }
}

export async function auditDeterministicRawPng(input: Buffer) {
  const { data, info, metadata } = await rawRgb(input)
  if (metadata.format !== "png" || info.width !== 1600 || info.height !== 1600 ||
    info.channels < 3) {
    throw new Error("DETERMINISTIC_RAW_PNG_INVALID")
  }
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let bluePixelCount = 0
  let unexpectedChromaticPixelCount = 0
  let nonWhiteBorderPixelCount = 0
  let coloredBorderPixelCount = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      if (Math.min(red, green, blue) < 245 ||
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8) {
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      if (blue > red + 30 && blue > green + 15 && blue > 100) {
        bluePixelCount += 1
      }
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 60) {
        unexpectedChromaticPixelCount += 1
      }
      if ((x === 0 || y === 0 || x === info.width - 1 ||
        y === info.height - 1) &&
        (red !== 255 || green !== 255 || blue !== 255)) {
        nonWhiteBorderPixelCount += 1
        if (Math.max(red, green, blue) - Math.min(red, green, blue) > 60) {
          coloredBorderPixelCount += 1
        }
      }
    }
  }
  const boundingBox = maxX >= 0 ? {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  } : null
  return {
    width: info.width,
    height: info.height,
    boundingBox,
    margins: boundingBox ? {
      left: boundingBox.left,
      right: info.width - 1 - boundingBox.right,
      top: boundingBox.top,
      bottom: info.height - 1 - boundingBox.bottom,
    } : null,
    bluePixelCount,
    unexpectedChromaticPixelCount,
    nonWhiteBorderPixelCount,
    coloredBorderPixelCount,
    exactWhiteCorners: [
      [0, 0], [info.width - 1, 0],
      [0, info.height - 1], [info.width - 1, info.height - 1],
    ].every(([x, y]) => {
      const offset = (y * info.width + x) * info.channels
      return data[offset] === 255 && data[offset + 1] === 255 &&
        data[offset + 2] === 255
    }),
  }
}

export async function createPrimaryVerticalCenterAudit(input: {
  attemptId: string
  revisionId: string
  currentPng: Buffer
  currentSha256: string
  currentStoragePath: string
  protectedMainSha256: string
}) {
  if (sha256(input.currentPng) !== input.currentSha256) {
    throw new Error("PRIMARY_VERTICAL_CENTER_INPUT_HASH_MISMATCH")
  }
  const qa = await auditDeterministicRawPng(input.currentPng)
  if (!qa.boundingBox || !qa.margins || qa.margins.left < 120 ||
    qa.margins.right < 120 || !qa.exactWhiteCorners ||
    qa.bluePixelCount !== 0 || qa.unexpectedChromaticPixelCount !== 0 ||
    qa.nonWhiteBorderPixelCount !== 0) {
    throw new Error("PRIMARY_VERTICAL_CENTER_RAW_QA_FAILED")
  }
  const canvasCenterY = (qa.height - 1) / 2
  const productCenterY = (qa.boundingBox.top + qa.boundingBox.bottom) / 2
  const delta = canvasCenterY - productCenterY
  const translationY = Math.abs(delta) <= 0.5 ? 0 : Math.round(delta)
  if (translationY !== 0) {
    throw new Error("PRIMARY_VERTICAL_CENTER_TRANSLATION_REQUIRED")
  }
  const transformManifest = {
    version: PRIMARY_VERTICAL_CENTER_VERSION,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    assetOrdinal: 0,
    assetRole: "PRIMARY_MAIN",
    input: {
      storagePath: input.currentStoragePath,
      sha256: input.currentSha256,
      protectedMainSha256: input.protectedMainSha256,
    },
    operation: {
      type: "INTEGER_VERTICAL_TRANSLATION_ONLY",
      translationX: 0,
      translationY,
      resampled: false,
      generatedPixels: false,
      background: "#FFFFFF",
    },
    measuredBoundingBox: qa.boundingBox,
    measuredMargins: qa.margins,
    output: { width: 1600, height: 1600, format: "png" },
  }
  const transformManifestText = JSON.stringify(transformManifest)
  return {
    output: Buffer.from(input.currentPng),
    outputSha256: input.currentSha256,
    transformManifest,
    transformManifestText,
    transformManifestHash: sha256(Buffer.from(transformManifestText, "utf8")),
    qa,
    translationY,
  }
}

export async function createSideMaterialDetailVariant(input: {
  attemptId: string
  revisionId: string
  source: Buffer
  sourceSha256: string
  sourceStoragePath: string
}) {
  if (sha256(input.source) !== input.sourceSha256) {
    throw new Error("SIDE_DETAIL_SOURCE_HASH_MISMATCH")
  }
  const sourceMetadata = await sharp(input.source).metadata()
  if (sourceMetadata.width !== 1500 || sourceMetadata.height !== 1051) {
    throw new Error("SIDE_DETAIL_SOURCE_DIMENSIONS_INVALID")
  }
  const normalized = await sharp(input.source).resize({
    width: SIDE_NORMALIZED_WIDTH,
    kernel: sharp.kernel.lanczos3,
  }).toBuffer()
  const normalizedMetadata = await sharp(normalized).metadata()
  if (normalizedMetadata.width !== SIDE_NORMALIZED_WIDTH ||
    normalizedMetadata.height !== SIDE_NORMALIZED_HEIGHT) {
    throw new Error("SIDE_DETAIL_NORMALIZATION_INVALID")
  }
  const { data, info } = await sharp(normalized).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  let handleLeft = info.width
  let handleRight = -1
  let handleTop = info.height
  let handleBottom = -1
  // The protected SIDE handle occupies this central band. Restricting the
  // measurement avoids treating the darker rim/base as part of the handle.
  for (let y = 150; y <= 210; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      if (data[offset] < 145 && data[offset + 1] < 145 &&
        data[offset + 2] < 145) {
        handleLeft = Math.min(handleLeft, x); handleRight = Math.max(handleRight, x)
        handleTop = Math.min(handleTop, y); handleBottom = Math.max(handleBottom, y)
      }
    }
  }
  const handleBoundingBox = handleRight >= 0 ? {
    left: handleLeft,
    top: handleTop,
    right: handleRight,
    bottom: handleBottom,
  } : null
  if (!handleBoundingBox ||
    handleBoundingBox.left - SIDE_DETAIL_CROP.left < 24 ||
    SIDE_DETAIL_CROP.left + SIDE_DETAIL_CROP.width - 1 -
      handleBoundingBox.right < 24) {
    throw new Error("SIDE_DETAIL_HANDLE_SAFE_MARGIN_FAILED")
  }
  const crop = await sharp(normalized).extract(SIDE_DETAIL_CROP).toBuffer()
  const output = await sharp(crop).resize(1600, 1600, {
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const outputMetadata = await sharp(output).metadata()
  if (outputMetadata.format !== "png" || outputMetadata.width !== 1600 ||
    outputMetadata.height !== 1600) {
    throw new Error("SIDE_DETAIL_OUTPUT_INVALID")
  }
  const qa = await auditDeterministicRawPng(output)
  if (qa.bluePixelCount !== 0 || qa.unexpectedChromaticPixelCount !== 0 ||
    qa.coloredBorderPixelCount !== 0) {
    throw new Error("SIDE_DETAIL_RAW_QA_FAILED")
  }
  const transformManifest = {
    version: SIDE_MATERIAL_DETAIL_VERSION,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    assetOrdinal: 1,
    assetRole: "SECONDARY_MATERIAL_DETAIL",
    commercialObjective: "MATERIAL_AND_FINISH_DETAIL",
    source: {
      sourceImageId: "SIDE",
      storagePath: input.sourceStoragePath,
      sha256: input.sourceSha256,
      nativeWidth: 1500,
      nativeHeight: 1051,
    },
    deterministicNormalization: {
      width: SIDE_NORMALIZED_WIDTH,
      height: SIDE_NORMALIZED_HEIGHT,
      scaleX: SIDE_NORMALIZED_WIDTH / 1500,
      scaleY: SIDE_NORMALIZED_HEIGHT / 1051,
      generatedPixels: false,
    },
    crop: {
      coordinateSpace: `NORMALIZED_SIDE_${SIDE_NORMALIZED_WIDTH}x${SIDE_NORMALIZED_HEIGHT}`,
      ...SIDE_DETAIL_CROP,
      nativeEquivalent: {
        left: SIDE_DETAIL_CROP.left * 1500 / SIDE_NORMALIZED_WIDTH,
        top: 0,
        width: SIDE_DETAIL_CROP.width * 1500 / SIDE_NORMALIZED_WIDTH,
        height: SIDE_DETAIL_CROP.height * 1051 / SIDE_NORMALIZED_HEIGHT,
      },
    },
    handleBoundingBox,
    handleSafeMargins: {
      left: handleBoundingBox.left - SIDE_DETAIL_CROP.left,
      right: SIDE_DETAIL_CROP.left + SIDE_DETAIL_CROP.width - 1 -
        handleBoundingBox.right,
    },
    output: {
      width: 1600,
      height: 1600,
      format: "png",
      upscaleFactor: 2,
      resizeKernel: "lanczos3",
      generatedPixels: false,
    },
  }
  const transformManifestText = JSON.stringify(transformManifest)
  return {
    output,
    outputSha256: sha256(output),
    transformManifest,
    transformManifestText,
    transformManifestHash: sha256(Buffer.from(transformManifestText, "utf8")),
    qa,
  }
}
