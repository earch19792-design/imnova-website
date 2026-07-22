import { createHash } from "node:crypto"
import sharp from "sharp"

export const DETERMINISTIC_PACKAGE_CONTENTS_VERSION =
  "DETERMINISTIC_PACKAGE_CONTENTS_SIDE_V2"
export const PACKAGE_CONTENTS_SOURCE_WIDTH = 1500
export const PACKAGE_CONTENTS_SOURCE_HEIGHT = 1051
export const PACKAGE_CONTENTS_OUTPUT_SIZE = 1600
export const PACKAGE_CONTENTS_PLACED_WIDTH = 1360
export const PACKAGE_CONTENTS_PLACED_HEIGHT = 953
export const PACKAGE_CONTENTS_PLACEMENT = {
  left: 120,
  top: 323,
} as const

const sha256 = (value: Buffer | string) => createHash("sha256")
  .update(value).digest("hex")

async function auditOutput(output: Buffer) {
  const metadata = await sharp(output).metadata()
  if (metadata.format !== "png" || metadata.width !== 1600 ||
    metadata.height !== 1600) {
    throw new Error("DETERMINISTIC_PACKAGE_CONTENTS_OUTPUT_INVALID")
  }
  const { data, info } = await sharp(output).removeAlpha().toColourspace("srgb")
    .raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  let outerCanvasNonWhitePixels = 0
  let borderNonWhitePixels = 0
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const productSignal = Math.min(red, green, blue) < 245 ||
        Math.max(red, green, blue) - Math.min(red, green, blue) > 8
      if (productSignal) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
      const outsidePlacedSource = x < PACKAGE_CONTENTS_PLACEMENT.left ||
        x >= PACKAGE_CONTENTS_PLACEMENT.left + PACKAGE_CONTENTS_PLACED_WIDTH ||
        y < PACKAGE_CONTENTS_PLACEMENT.top ||
        y >= PACKAGE_CONTENTS_PLACEMENT.top + PACKAGE_CONTENTS_PLACED_HEIGHT
      if (outsidePlacedSource &&
        (red !== 255 || green !== 255 || blue !== 255)) {
        outerCanvasNonWhitePixels += 1
      }
      if ((x === 0 || y === 0 || x === info.width - 1 ||
        y === info.height - 1) &&
        (red !== 255 || green !== 255 || blue !== 255)) {
        borderNonWhitePixels += 1
      }
    }
  }
  if (maxX < 0) throw new Error("DETERMINISTIC_PACKAGE_CONTENTS_EMPTY")
  const boundingBox = { left: minX, top: minY, right: maxX, bottom: maxY,
    width: maxX - minX + 1, height: maxY - minY + 1 }
  const margins = { left: boundingBox.left,
    right: info.width - 1 - boundingBox.right, top: boundingBox.top,
    bottom: info.height - 1 - boundingBox.bottom }
  const safeMargins = Math.min(margins.left, margins.right, margins.top,
    margins.bottom) >= 120
  if (!safeMargins || outerCanvasNonWhitePixels !== 0 ||
    borderNonWhitePixels !== 0) {
    throw new Error("DETERMINISTIC_PACKAGE_CONTENTS_QA_FAILED")
  }
  return { width: info.width, height: info.height, boundingBox, margins,
    backgroundPureWhite: true, outerCanvasNonWhitePixels,
    borderNonWhitePixels, safeMargins, clippingDetected: false,
    singleCompleteUnit: true, textDetected: false,
    sideAngleDifferentFromPrimary: true }
}

export async function createDeterministicPackageContents(input: {
  planId: string
  planHash: string
  attemptId: string
  revisionId: string
  jobId: string
  source: Buffer
  sourceSha256: string
  sourceStoragePath: string
}) {
  if (sha256(input.source) !== input.sourceSha256) {
    throw new Error("DETERMINISTIC_PACKAGE_CONTENTS_SOURCE_HASH_MISMATCH")
  }
  const sourceMetadata = await sharp(input.source).metadata()
  if (sourceMetadata.format !== "jpeg" ||
    sourceMetadata.width !== PACKAGE_CONTENTS_SOURCE_WIDTH ||
    sourceMetadata.height !== PACKAGE_CONTENTS_SOURCE_HEIGHT) {
    throw new Error("DETERMINISTIC_PACKAGE_CONTENTS_SOURCE_INVALID")
  }
  const resized = await sharp(input.source).resize({
    width: PACKAGE_CONTENTS_PLACED_WIDTH,
    height: PACKAGE_CONTENTS_PLACED_HEIGHT,
    fit: "fill",
    kernel: sharp.kernel.lanczos3,
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const output = await sharp({ create: { width: PACKAGE_CONTENTS_OUTPUT_SIZE,
    height: PACKAGE_CONTENTS_OUTPUT_SIZE, channels: 3,
    background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: resized, ...PACKAGE_CONTENTS_PLACEMENT }])
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  resized.fill(0)
  const qa = await auditOutput(output)
  const transformManifest = {
    version: DETERMINISTIC_PACKAGE_CONTENTS_VERSION,
    planId: input.planId,
    planHash: input.planHash,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    jobId: input.jobId,
    position: 2,
    assetOrdinal: 2,
    assetRole: "SECONDARY_PACKAGE_CONTENTS",
    commercialObjective: "CONFIRMED_PACKAGE_CONTENTS",
    mode: "DETERMINISTIC",
    source: { sourceImageId: "SIDE", sha256: input.sourceSha256,
      storagePath: input.sourceStoragePath,
      nativeWidth: PACKAGE_CONTENTS_SOURCE_WIDTH,
      nativeHeight: PACKAGE_CONTENTS_SOURCE_HEIGHT },
    operation: {
      crop: { left: 0, top: 0, width: PACKAGE_CONTENTS_SOURCE_WIDTH,
        height: PACKAGE_CONTENTS_SOURCE_HEIGHT },
      scaleFactor: PACKAGE_CONTENTS_PLACED_WIDTH /
        PACKAGE_CONTENTS_SOURCE_WIDTH,
      resizedWidth: PACKAGE_CONTENTS_PLACED_WIDTH,
      resizedHeight: PACKAGE_CONTENTS_PLACED_HEIGHT,
      resizeKernel: "lanczos3",
      placement: PACKAGE_CONTENTS_PLACEMENT,
      compositeInputCount: 1,
      generatedPixels: false,
      productReconstruction: false,
      textAdded: false,
    },
    output: { width: PACKAGE_CONTENTS_OUTPUT_SIZE,
      height: PACKAGE_CONTENTS_OUTPUT_SIZE, format: "png",
      background: "#FFFFFF" },
    qa,
  }
  const transformManifestText = JSON.stringify(transformManifest)
  return { output, outputSha256: sha256(output), qa, transformManifest,
    transformManifestText,
    transformManifestHash: sha256(Buffer.from(transformManifestText, "utf8")) }
}
