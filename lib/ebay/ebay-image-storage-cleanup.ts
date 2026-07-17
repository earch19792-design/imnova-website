import { createHash, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export const EBAY_IMAGE_SOURCE_BUCKET = "ebay-listing-image-sources"
export const EBAY_IMAGE_STAGING_BUCKET = "ebay-listing-image-staging"

type JsonRecord = Record<string, unknown>

export type EbayImageStorageCleanupJob = {
  id: string
  account_key: string
  image_asset_id: string
  listing_package_id: string
  cleanup_kind: "approved_staging" | "rejected_staging" | "rejected_source"
  bucket_id: string
  storage_key: string
  expected_sha256: string | null
  attempts: number
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function rows<T>(value: unknown) {
  return (Array.isArray(value) ? value : value ? [value] : []) as T[]
}

function databaseCode(error: unknown, fallback: string) {
  const value = record(error)
  for (const candidate of [value.message, value.details, value.hint]) {
    if (typeof candidate !== "string") continue
    const match = candidate.match(/EBAY_IMAGE_[A-Z0-9_]+/)
    if (match) return match[0]
  }
  return fallback
}

function storageObjectMissing(error: unknown) {
  const value = record(error)
  const status = Number(value.statusCode ?? value.status)
  const message = text(value.message).toLowerCase()
  return status === 404 || message.includes("not found") || message.includes("not_found")
}

export function validateEbayImageStorageCleanupClaim(
  job: EbayImageStorageCleanupJob,
  assetValue: unknown,
  packageValue: unknown,
  expectedAccountKey: string,
) {
  const asset = record(assetValue)
  const listingPackage = record(packageValue)
  if (
    !expectedAccountKey
    || expectedAccountKey === "default"
    || text(job.account_key) !== expectedAccountKey
    || text(asset.account_key) !== expectedAccountKey
    || text(listingPackage.account_key) !== expectedAccountKey
    || text(asset.id) !== text(job.image_asset_id)
    || text(asset.listing_package_id) !== text(job.listing_package_id)
    || text(listingPackage.id) !== text(job.listing_package_id)
  ) {
    throw new Error("EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_MISMATCH")
  }

  const status = text(asset.status)
  const sourcePath = text(asset.source_storage_path)
  const outputPath = text(asset.output_storage_path)
  const sourceHash = text(asset.source_sha256)
  const outputHash = text(asset.output_sha256)
  const expected = text(job.expected_sha256)

  if (job.cleanup_kind === "approved_staging") {
    if (
      status !== "approved"
      || job.bucket_id !== EBAY_IMAGE_STAGING_BUCKET
      || job.storage_key !== outputPath
      || expected !== outputHash
    ) throw new Error("EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID")
  } else if (job.cleanup_kind === "rejected_staging") {
    if (
      status !== "rejected"
      || job.bucket_id !== EBAY_IMAGE_STAGING_BUCKET
      || job.storage_key !== outputPath
      || expected !== outputHash
    ) throw new Error("EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID")
  } else if (job.cleanup_kind === "rejected_source") {
    if (
      status !== "rejected"
      || job.bucket_id !== EBAY_IMAGE_SOURCE_BUCKET
      || job.storage_key !== sourcePath
      || expected !== sourceHash
    ) throw new Error("EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID")
  } else {
    throw new Error("EBAY_IMAGE_CLEANUP_BUCKET_FORBIDDEN")
  }

  if (
    !job.storage_key
    || job.storage_key.startsWith("/")
    || job.storage_key.includes("..")
    || job.storage_key.includes("//")
    || !/^[A-Za-z0-9._/-]+$/.test(job.storage_key)
    || !/^[0-9a-f]{64}$/.test(expected)
  ) throw new Error("EBAY_IMAGE_CLEANUP_OBJECT_INVALID")

  return {
    bucketId: job.bucket_id,
    storageKey: job.storage_key,
    expectedSha256: expected,
  }
}

export async function enqueueEbayImageStorageCleanup(
  supabase: SupabaseClient,
  input: {
    accountKey: string
    assetId: string
    packageId: string
    cleanupKind: EbayImageStorageCleanupJob["cleanup_kind"]
    bucketId: string
    storageKey: string
    expectedSha256: string
    requestedBy: string
  },
) {
  const { data, error } = await supabase.rpc(
    "enqueue_ebay_image_storage_cleanup",
    {
      p_account_key: input.accountKey,
      p_image_asset_id: input.assetId,
      p_listing_package_id: input.packageId,
      p_cleanup_kind: input.cleanupKind,
      p_bucket_id: input.bucketId,
      p_storage_key: input.storageKey,
      p_expected_sha256: input.expectedSha256,
      p_requested_by: input.requestedBy,
    },
  )
  const job = rows<EbayImageStorageCleanupJob>(data)[0]
  if (error || !job?.id) {
    throw new Error(databaseCode(error, "EBAY_IMAGE_CLEANUP_ENQUEUE_FAILED"))
  }
  return job
}

async function recordSuccess(
  supabase: SupabaseClient,
  jobId: string,
  workerId: string,
  outcome: "deleted" | "already_missing",
) {
  const { error } = await supabase.rpc(
    "complete_ebay_image_storage_cleanup_job",
    { p_job_id: jobId, p_worker_id: workerId, p_outcome: outcome },
  )
  if (error) throw new Error(databaseCode(error, "EBAY_IMAGE_CLEANUP_COMPLETE_FAILED"))
}

async function recordFailure(
  supabase: SupabaseClient,
  job: EbayImageStorageCleanupJob,
  workerId: string,
  errorCode: string,
) {
  const retryAfterSeconds = Math.min(86_400, 300 * 2 ** Math.min(job.attempts, 8))
  const { error } = await supabase.rpc(
    "fail_ebay_image_storage_cleanup_job",
    {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error_code: errorCode,
      p_retry_after_seconds: retryAfterSeconds,
    },
  )
  if (error) throw new Error(databaseCode(error, "EBAY_IMAGE_CLEANUP_FAIL_RECORD_FAILED"))
}

export async function reconcileEbayImageStorageCleanup(
  supabase: SupabaseClient,
  input: { accountKey?: string; limit?: number; workerId?: string } = {},
) {
  const accountKey = input.accountKey?.trim() ?? ""
  if (!/^[A-Za-z0-9._-]{1,80}:[0-9a-f]{64}$/.test(accountKey)) {
    throw new Error("EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_REQUIRED")
  }
  const workerId = input.workerId?.trim() || `admin:${randomUUID()}`
  const limit = Math.min(25, Math.max(1, Math.trunc(input.limit ?? 10)))
  const { data, error } = await supabase.rpc(
    "claim_ebay_image_storage_cleanup_jobs",
    {
      p_account_key: accountKey,
      p_worker_id: workerId,
      p_limit: limit,
      p_lease_seconds: 120,
    },
  )
  if (error) throw new Error(databaseCode(error, "EBAY_IMAGE_CLEANUP_CLAIM_FAILED"))

  const claimed = rows<EbayImageStorageCleanupJob>(data)
  let deleted = 0
  let alreadyMissing = 0
  let failed = 0
  const failures: Array<{ jobId: string; error: string }> = []

  for (const job of claimed) {
    try {
      const [assetResult, packageResult] = await Promise.all([
        supabase.from("ebay_listing_image_assets").select("*")
          .eq("id", job.image_asset_id).eq("account_key", accountKey).maybeSingle(),
        supabase.from("ebay_listing_packages").select("id,account_key")
          .eq("id", job.listing_package_id).eq("account_key", accountKey).maybeSingle(),
      ])
      if (assetResult.error || packageResult.error || !assetResult.data || !packageResult.data) {
        throw new Error("EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_MISMATCH")
      }
      const object = validateEbayImageStorageCleanupClaim(
        job,
        assetResult.data,
        packageResult.data,
        accountKey,
      )
      const download = await supabase.storage.from(object.bucketId)
        .download(object.storageKey)
      if (download.error || !download.data) {
        if (storageObjectMissing(download.error)) {
          await recordSuccess(supabase, job.id, workerId, "already_missing")
          alreadyMissing += 1
          continue
        }
        throw new Error("EBAY_IMAGE_CLEANUP_DOWNLOAD_FAILED")
      }
      const bytes = Buffer.from(await download.data.arrayBuffer())
      const actualHash = createHash("sha256").update(bytes).digest("hex")
      if (actualHash !== object.expectedSha256) {
        throw new Error("EBAY_IMAGE_CLEANUP_HASH_MISMATCH")
      }
      const removal = await supabase.storage.from(object.bucketId)
        .remove([object.storageKey])
      if (removal.error && !storageObjectMissing(removal.error)) {
        throw new Error("EBAY_IMAGE_CLEANUP_DELETE_FAILED")
      }
      await recordSuccess(
        supabase,
        job.id,
        workerId,
        removal.error ? "already_missing" : "deleted",
      )
      if (removal.error) alreadyMissing += 1
      else deleted += 1
    } catch (jobError) {
      const code = jobError instanceof Error && /^[A-Z0-9_]{3,100}$/.test(jobError.message)
        ? jobError.message
        : "EBAY_IMAGE_CLEANUP_FAILED"
      failed += 1
      failures.push({ jobId: job.id, error: code })
      await recordFailure(supabase, job, workerId, code)
    }
  }

  return {
    accountKey,
    claimed: claimed.length,
    deleted,
    alreadyMissing,
    failed,
    failures,
    cronEnabled: false as const,
  }
}
