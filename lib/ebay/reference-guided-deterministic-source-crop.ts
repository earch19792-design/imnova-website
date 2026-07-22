import { createHash } from "node:crypto"
import sharp from "sharp"

export const DETERMINISTIC_SOURCE_CROP_VERSION =
  "DETERMINISTIC_SOURCE_CROP_V1"
export const DETERMINISTIC_PRIMARY_MAIN_VERSION =
  "DETERMINISTIC_PRIMARY_MAIN_V1"
export const MATERIAL_AND_FINISH_DETAIL_OBJECTIVE =
  "MATERIAL_AND_FINISH_DETAIL"
export const POSITION_ONE_CROP = {
  left: 0,
  top: 0,
  width: 800,
  height: 800,
} as const
export const DETERMINISTIC_CROP_OUTPUT_SIZE = 1600
export const DETERMINISTIC_CROP_MAX_UPSCALE = 2

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

export function referenceGuidedRenderingContract(objective: string) {
  if (objective === MATERIAL_AND_FINISH_DETAIL_OBJECTIVE) {
    return {
      renderingMode: DETERMINISTIC_SOURCE_CROP_VERSION,
      providerAllowed: false,
      generatedContextAllowed: false,
      compatibleCategorySignals: [] as string[],
    }
  }
  return {
    renderingMode: "REFERENCE_GUIDED_PROVIDER",
    providerAllowed: true,
    generatedContextAllowed: true,
    compatibleCategorySignals: ["OBJECTIVE_COMPATIBLE_ONLY"],
  }
}

export function assertReferenceGuidedProviderAllowed(objective: string) {
  if (!referenceGuidedRenderingContract(objective).providerAllowed) {
    throw new Error(
      "REFERENCE_GUIDED_POSITION_REQUIRES_DETERMINISTIC_SOURCE_CROP",
    )
  }
}

export async function createDeterministicPrimaryMain(input: {
  source: Buffer
  sourceSha256: string
}) {
  if (sha256(input.source) !== input.sourceSha256) {
    throw new Error("DETERMINISTIC_PRIMARY_MAIN_SOURCE_HASH_MISMATCH")
  }
  const metadata = await sharp(input.source).metadata()
  if (!metadata.width || !metadata.height || metadata.width < 500 ||
    metadata.height < 500) {
    throw new Error("DETERMINISTIC_PRIMARY_MAIN_SOURCE_INVALID")
  }
  const output = await sharp(input.source)
    .flatten({ background: "#FFFFFF" })
    .removeAlpha()
    .toColourspace("srgb")
    .resize(1360, 1360, {
      fit: "contain",
      background: "#FFFFFF",
      kernel: sharp.kernel.lanczos3,
    })
    .extend({ top: 120, right: 120, bottom: 120, left: 120,
      background: "#FFFFFF" })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const outputMetadata = await sharp(output).metadata()
  if (outputMetadata.format !== "png" || outputMetadata.width !== 1600 ||
    outputMetadata.height !== 1600) {
    throw new Error("DETERMINISTIC_PRIMARY_MAIN_OUTPUT_INVALID")
  }
  return {
    output,
    outputSha256: sha256(output),
    transform: {
      version: DETERMINISTIC_PRIMARY_MAIN_VERSION,
      assetOrdinal: 0,
      assetRole: "PRIMARY_MAIN",
      sourceImageId: "MAIN",
      sourceSha256: input.sourceSha256,
      canvas: { width: 1600, height: 1600, background: "#FFFFFF" },
      safeMarginPixels: 120,
      fullProductCentered: true,
      textAllowed: false,
      propsAllowed: false,
      contextAllowed: false,
      generatedPixels: false,
    },
  }
}

export async function createDeterministicPositionOneCrop(input: {
  attemptId: string
  revisionId: string
  jobId: string
  source: Buffer
  sourceSha256: string
  sourceStoragePath: string
  sourceNativeWidth: number
  sourceNativeHeight: number
}) {
  if (sha256(input.source) !== input.sourceSha256) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_SOURCE_HASH_MISMATCH")
  }
  const sourceMetadata = await sharp(input.source).metadata()
  if (sourceMetadata.width !== input.sourceNativeWidth ||
    sourceMetadata.height !== input.sourceNativeHeight ||
    POSITION_ONE_CROP.left + POSITION_ONE_CROP.width > input.sourceNativeWidth ||
    POSITION_ONE_CROP.top + POSITION_ONE_CROP.height > input.sourceNativeHeight) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_SOURCE_DIMENSIONS_INVALID")
  }
  const upscaleFactor = DETERMINISTIC_CROP_OUTPUT_SIZE /
    POSITION_ONE_CROP.width
  if (POSITION_ONE_CROP.width !== POSITION_ONE_CROP.height ||
    upscaleFactor > DETERMINISTIC_CROP_MAX_UPSCALE) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_SCALE_INVALID")
  }
  const transformManifest = {
    version: DETERMINISTIC_SOURCE_CROP_VERSION,
    attemptId: input.attemptId,
    revisionId: input.revisionId,
    jobId: input.jobId,
    position: 1,
    commercialObjective: MATERIAL_AND_FINISH_DETAIL_OBJECTIVE,
    categorySignalsApplied: [],
    generatedPixels: false,
    source: {
      sourceImageId: "MAIN",
      sha256: input.sourceSha256,
      storagePath: input.sourceStoragePath,
      nativeWidth: input.sourceNativeWidth,
      nativeHeight: input.sourceNativeHeight,
    },
    crop: POSITION_ONE_CROP,
    output: {
      width: DETERMINISTIC_CROP_OUTPUT_SIZE,
      height: DETERMINISTIC_CROP_OUTPUT_SIZE,
      format: "png",
      resizeKernel: "lanczos3",
      upscaleFactor,
    },
  }
  const transformManifestText = JSON.stringify(transformManifest)
  const output = await sharp(input.source)
    .extract(POSITION_ONE_CROP)
    .resize(DETERMINISTIC_CROP_OUTPUT_SIZE, DETERMINISTIC_CROP_OUTPUT_SIZE, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer()
  const outputMetadata = await sharp(output).metadata()
  if (outputMetadata.format !== "png" ||
    outputMetadata.width !== DETERMINISTIC_CROP_OUTPUT_SIZE ||
    outputMetadata.height !== DETERMINISTIC_CROP_OUTPUT_SIZE) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_OUTPUT_INVALID")
  }
  return {
    output,
    outputSha256: sha256(output),
    upscaleFactor,
    transformManifest,
    transformManifestText,
    transformManifestHash: sha256(Buffer.from(transformManifestText, "utf8")),
  }
}

export async function persistDeterministicPositionOneCrop(input: {
  supabase: any
  output: Buffer
  outputSha256: string
  storagePath: string
}) {
  if (!input.storagePath.endsWith(`/${input.outputSha256}.png`) ||
    !input.storagePath.includes("/reference-guided-deterministic/")) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_STORAGE_PATH_INVALID")
  }
  const { data: buckets, error: bucketError } = await input.supabase.storage
    .listBuckets()
  const bucket = buckets?.find((item: { id?: string }) =>
    item.id === "ebay-listing-image-staging")
  if (bucketError || !bucket || bucket.public !== false ||
    !bucket.allowed_mime_types?.includes("image/png")) {
    throw new Error("DETERMINISTIC_SOURCE_CROP_PRIVATE_BUCKET_REQUIRED")
  }
  const upload = await input.supabase.storage.from("ebay-listing-image-staging")
    .upload(input.storagePath, input.output, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: false,
    })
  if (upload.error) throw new Error("DETERMINISTIC_SOURCE_CROP_UPLOAD_FAILED")
  try {
    const downloaded = await input.supabase.storage
      .from("ebay-listing-image-staging").download(input.storagePath)
    if (downloaded.error || !downloaded.data) {
      throw new Error("DETERMINISTIC_SOURCE_CROP_DOWNLOAD_FAILED")
    }
    const roundtrip = Buffer.from(await downloaded.data.arrayBuffer())
    const metadata = await sharp(roundtrip).metadata()
    if (sha256(roundtrip) !== input.outputSha256 || metadata.format !== "png" ||
      metadata.width !== 1600 || metadata.height !== 1600) {
      throw new Error("DETERMINISTIC_SOURCE_CROP_ROUNDTRIP_MISMATCH")
    }
    return { roundtrip: true, dimensions: "1600x1600" }
  } catch (error) {
    await input.supabase.storage.from("ebay-listing-image-staging")
      .remove([input.storagePath])
    throw error
  }
}
