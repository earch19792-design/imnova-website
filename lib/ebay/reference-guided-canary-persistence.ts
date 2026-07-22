import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import sharp from "sharp"

export const REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET =
  "ebay-listing-image-staging"
export const REFERENCE_GUIDED_CANARY_OUTPUT_MIME = "image/png"
export const REFERENCE_GUIDED_CANARY_OUTPUT_SIZE = 1600
export const REFERENCE_GUIDED_CANARY_OUTPUT_MAX_BYTES = 12 * 1024 * 1024

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function assertPngContract(input: {
  output: Buffer
  expectedSha256: string
  storagePath: string
  contentType: string
}) {
  if (input.contentType !== REFERENCE_GUIDED_CANARY_OUTPUT_MIME) {
    throw new Error("REFERENCE_GUIDED_CANARY_OUTPUT_MIME_INVALID")
  }
  if (!input.storagePath.endsWith(".png") ||
    input.storagePath.includes("..") || input.storagePath.startsWith("/")) {
    throw new Error("REFERENCE_GUIDED_CANARY_OUTPUT_EXTENSION_INVALID")
  }
  if (!Buffer.isBuffer(input.output) || !input.output.length ||
    input.output.length > REFERENCE_GUIDED_CANARY_OUTPUT_MAX_BYTES ||
    !input.output.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("REFERENCE_GUIDED_CANARY_OUTPUT_BYTES_INVALID")
  }
  const actualSha256 = sha256(input.output)
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256) ||
    actualSha256 !== input.expectedSha256) {
    throw new Error("REFERENCE_GUIDED_CANARY_OUTPUT_HASH_MISMATCH")
  }
  return actualSha256
}

export async function runReferenceGuidedCanaryAutomaticQa(output: Buffer) {
  const metadata = await sharp(output).metadata()
  if (metadata.format !== "png" ||
    metadata.width !== REFERENCE_GUIDED_CANARY_OUTPUT_SIZE ||
    metadata.height !== REFERENCE_GUIDED_CANARY_OUTPUT_SIZE ||
    output.length > REFERENCE_GUIDED_CANARY_OUTPUT_MAX_BYTES) {
    throw new Error("REFERENCE_GUIDED_PROVIDER_OUTPUT_DIMENSIONS_INVALID")
  }
  const stats = await sharp(output).removeAlpha().stats()
  const channels = stats.channels.slice(0, 3)
  if (channels.length !== 3 || channels.some((channel) =>
    !Number.isFinite(channel.mean) || !Number.isFinite(channel.stdev))) {
    throw new Error("REFERENCE_GUIDED_CANARY_TECHNICAL_QA_INVALID")
  }
  return {
    automaticStatus: "PARTIAL",
    evaluatorVersion: "REFERENCE_GUIDED_CANARY_QA_V1_2026_07_22",
    technicalChecks: {
      png: true,
      width: REFERENCE_GUIDED_CANARY_OUTPUT_SIZE,
      height: REFERENCE_GUIDED_CANARY_OUTPUT_SIZE,
      square: true,
      decodable: true,
      nonEmptyColorChannels: true,
    },
    identityChecks: {
      sameWhiteColor: "REQUIRES_HUMAN_CONFIRMATION",
      sameHandles: "REQUIRES_HUMAN_CONFIRMATION",
      sameRim: "REQUIRES_HUMAN_CONFIRMATION",
      samePerforations: "REQUIRES_HUMAN_CONFIRMATION",
      sameBaseAndProportions: "REQUIRES_HUMAN_CONFIRMATION",
      noAddedTextOrLogos: "REQUIRES_HUMAN_CONFIRMATION",
      noAccessoriesPresentedAsIncluded: "REQUIRES_HUMAN_CONFIRMATION",
    },
    humanApprovalRequired: true,
    autoApproved: false,
    publicationAuthorized: false,
  }
}

export async function persistReferenceGuidedCanaryPng(input: {
  supabase: SupabaseClient
  output: Buffer
  expectedSha256: string
  storagePath: string
  contentType?: string
}) {
  const contentType = input.contentType ?? REFERENCE_GUIDED_CANARY_OUTPUT_MIME
  const actualSha256 = assertPngContract({ ...input, contentType })
  const qaResult = await runReferenceGuidedCanaryAutomaticQa(input.output)
  const { data: buckets, error: bucketsError } =
    await input.supabase.storage.listBuckets()
  const bucket = buckets?.find((candidate) =>
    candidate.id === REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
  if (bucketsError || !bucket || bucket.public !== false ||
    Number(bucket.file_size_limit) !== REFERENCE_GUIDED_CANARY_OUTPUT_MAX_BYTES ||
    !bucket.allowed_mime_types?.includes(REFERENCE_GUIDED_CANARY_OUTPUT_MIME)) {
    throw new Error("REFERENCE_GUIDED_CANARY_PRIVATE_STORAGE_REQUIRED")
  }
  const upload = await input.supabase.storage
    .from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
    .upload(input.storagePath, input.output, {
      contentType: REFERENCE_GUIDED_CANARY_OUTPUT_MIME,
      cacheControl: "3600",
      upsert: false,
    })
  if (upload.error) {
    throw new Error("REFERENCE_GUIDED_CANARY_PRIVATE_STORAGE_UPLOAD_FAILED")
  }
  try {
    const downloaded = await input.supabase.storage
      .from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
      .download(input.storagePath)
    if (downloaded.error || !downloaded.data) {
      throw new Error("REFERENCE_GUIDED_CANARY_PRIVATE_STORAGE_DOWNLOAD_FAILED")
    }
    const downloadedBytes = Buffer.from(await downloaded.data.arrayBuffer())
    const downloadedMetadata = await sharp(downloadedBytes).metadata()
    if (sha256(downloadedBytes) !== actualSha256 ||
      downloadedMetadata.format !== "png" ||
      downloadedMetadata.width !== REFERENCE_GUIDED_CANARY_OUTPUT_SIZE ||
      downloadedMetadata.height !== REFERENCE_GUIDED_CANARY_OUTPUT_SIZE) {
      throw new Error("REFERENCE_GUIDED_CANARY_STORAGE_ROUNDTRIP_MISMATCH")
    }
    return {
      storagePath: input.storagePath,
      outputSha256: actualSha256,
      dimensions: `${REFERENCE_GUIDED_CANARY_OUTPUT_SIZE}x${REFERENCE_GUIDED_CANARY_OUTPUT_SIZE}`,
      contentType: REFERENCE_GUIDED_CANARY_OUTPUT_MIME,
      uploaded: true,
      downloaded: true,
      hashMatch: true,
      qaResult,
    }
  } catch (error) {
    await input.supabase.storage.from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
      .remove([input.storagePath])
    throw error
  }
}

export async function removeReferenceGuidedCanaryPng(input: {
  supabase: SupabaseClient
  storagePath: string
}) {
  if (!input.storagePath.endsWith(".png") ||
    (!input.storagePath.includes("/reference-guided-canary/") &&
      !input.storagePath.startsWith("reference-guided-canary-fixtures/"))) {
    throw new Error("REFERENCE_GUIDED_CANARY_CLEANUP_SCOPE_INVALID")
  }
  const removed = await input.supabase.storage
    .from(REFERENCE_GUIDED_CANARY_OUTPUT_BUCKET)
    .remove([input.storagePath])
  if (removed.error) {
    throw new Error("REFERENCE_GUIDED_CANARY_FIXTURE_CLEANUP_FAILED")
  }
}
