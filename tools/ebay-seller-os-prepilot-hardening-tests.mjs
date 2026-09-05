import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  assertEbayImageAccountScope,
  isIdempotentEbayImageRetry,
} from "../lib/ebay/ebay-image-account-scope.ts"
import {
  EBAY_IMAGE_SOURCE_BUCKET,
  EBAY_IMAGE_STAGING_BUCKET,
  reconcileEbayImageStorageCleanup,
  validateEbayImageStorageCleanupClaim,
} from "../lib/ebay/ebay-image-storage-cleanup.ts"
import { parseSafeListingDefaults } from "../lib/ebay/ebay-manual-listing-domain.ts"
import {
  EBAY_SELLER_OS_API_PATHS,
  EBAY_SELLER_OS_UI_PATHS,
  getEbayDraftWriteEnvironmentBoundary,
  getEbayProRuntimeBoundary,
} from "../lib/ebay/environment-boundaries.ts"
import { getEbaySellerOsEnvironmentPreflight } from "../lib/ebay/ebay-seller-os-env-preflight.ts"

const accountA = `official:${"a".repeat(64)}`
const accountB = `secondary:${"b".repeat(64)}`
const packageId = "123e4567-e89b-42d3-a456-426614174000"
const assetId = "223e4567-e89b-42d3-a456-426614174000"
const actorId = "323e4567-e89b-42d3-a456-426614174000"
const bytes = Buffer.from("private derivative")
const outputHash = createHash("sha256").update(bytes).digest("hex")
const sourceHash = "c".repeat(64)

async function withEnvironment(values, callback) {
  const prior = new Map()
  for (const [name, next] of Object.entries(values)) {
    prior.set(name, process.env[name])
    if (next === undefined) delete process.env[name]
    else process.env[name] = next
  }
  try {
    return await callback()
  } finally {
    for (const [name, previous] of prior) {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  }
}

test("image account scope accepts A/A and rejects cross-account, default and missing", () => {
  assert.equal(assertEbayImageAccountScope(accountA, accountA), accountA)
  assert.throws(
    () => assertEbayImageAccountScope(accountA, accountB),
    /EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH/,
  )
  assert.throws(
    () => assertEbayImageAccountScope("default", "default"),
    /EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED/,
  )
  assert.throws(
    () => assertEbayImageAccountScope("", accountA),
    /EBAY_IMAGE_ACCOUNT_SCOPE_REQUIRED/,
  )
  assert.equal(isIdempotentEbayImageRetry({
    requestedAccountKey: accountA,
    existingAccountKey: accountA,
    requestedPackageId: packageId,
    existingPackageId: packageId,
    requestedSha256: outputHash,
    existingSha256: outputHash,
  }), true)
  assert.equal(isIdempotentEbayImageRetry({
    requestedAccountKey: accountA,
    existingAccountKey: accountA,
    requestedPackageId: "523e4567-e89b-42d3-a456-426614174000",
    existingPackageId: packageId,
    requestedSha256: outputHash,
    existingSha256: outputHash,
  }), false)
  assert.throws(() => isIdempotentEbayImageRetry({
    requestedAccountKey: accountA,
    existingAccountKey: accountB,
    requestedPackageId: packageId,
    existingPackageId: packageId,
    requestedSha256: outputHash,
    existingSha256: outputHash,
  }), /EBAY_IMAGE_ACCOUNT_SCOPE_MISMATCH/)
})

test("image account migration fails closed and exposes only scoped RPC signatures", () => {
  const migration = readFileSync(
    "supabase/migrations/20260713075000_scope_ebay_listing_images_by_account.sql",
    "utf8",
  )
  assert.match(migration, /EBAY_IMAGE_ACCOUNT_SCOPE_BACKFILL_REQUIRED/)
  assert.match(migration, /foreign key \(listing_package_id, account_key\)/)
  assert.match(migration, /p_account_key text/)
  assert.match(migration, /from public, anon, authenticated, service_role/)
  assert.match(migration, /to service_role/)
  assert.doesNotMatch(migration, /to anon|to authenticated/)
})

test("reusable defaults accept exactly five fields", () => {
  const allowed = {
    categoryId: "261003",
    conditionId: "1000",
    fulfillmentPolicyId: "fulfillment-1",
    paymentPolicyId: "payment-1",
    returnPolicyId: "return-1",
  }
  assert.deepEqual(parseSafeListingDefaults(allowed), allowed)
  for (const excluded of [
    "merchantLocationKey",
    "categorySchemaVersion",
    "dimensionUnit",
    "weightUnit",
    "condition",
    "title",
    "description",
    "images",
    "brand",
    "model",
    "claims",
    "compatibilities",
    "itemSpecifics",
  ]) {
    assert.throws(
      () => parseSafeListingDefaults({ [excluded]: "forbidden" }),
      /MANUAL_LISTING_UNSAFE_DEFAULT_FIELD/,
    )
  }
  const commandCenter = readFileSync("app/api/admin/ebay/command-center/route.ts", "utf8")
  assert.doesNotMatch(commandCenter, /defaults\.(?:merchantLocationKey|categorySchemaVersion|dimensionUnit|weightUnit|condition)\b/)
})

test("canonical boundary covers all requested UI and API surfaces", () => {
  for (const path of [
    "/admin/ebay-seller-os",
    "/admin/ebay/mobile-review",
    "/admin/ebay/opportunity-queue",
    "/admin/ebay/listing-workspace",
    "/admin/ebay/listings/register",
    "/admin/ebay-image-generator",
    "/admin/ebay/seller-performance",
    "/admin/ebay-pro",
  ]) assert.equal(EBAY_SELLER_OS_UI_PATHS.includes(path), true, path)
  for (const path of [
    "/api/admin/ebay/images",
    "/api/admin/ebay/listings/register",
    "/api/admin/ebay/draft-only",
    "/api/admin/ebay/active-listings/sync",
    "/api/admin/ebay/command-center",
    "/api/admin/ebay/seller-performance",
    "/api/admin/ebay/seller-whatsapp-alerts",
  ]) assert.equal(EBAY_SELLER_OS_API_PATHS.includes(path), true, path)
})

test("boundary separates development, exact Preview branch and Production", () => {
  assert.equal(getEbayProRuntimeBoundary({
    vercelEnv: "development",
    pathname: "/api/admin/ebay/images",
    method: "POST",
  }).blocked, false)
  assert.equal(getEbayDraftWriteEnvironmentBoundary({
    vercelEnv: "preview",
    draftTarget: "PRODUCTION",
    vercelGitCommitRef: "feature/centralize-ebay-mobile-command-center",
    allowedProductionBranch: "feature/centralize-ebay-mobile-command-center",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
  }).writeAllowed, true)
  assert.equal(getEbayDraftWriteEnvironmentBoundary({
    vercelEnv: "preview",
    draftTarget: "PRODUCTION",
    vercelGitCommitRef: "wrong-branch",
    allowedProductionBranch: "feature/centralize-ebay-mobile-command-center",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
  }).writeAllowed, false)
  assert.equal(getEbayDraftWriteEnvironmentBoundary({
    vercelEnv: "production",
    draftTarget: "PRODUCTION",
    vercelGitCommitRef: "feature/centralize-ebay-mobile-command-center",
    allowedProductionBranch: "feature/centralize-ebay-mobile-command-center",
    draftMasterEnabled: true,
    draftProductionEnabled: true,
  }).writeAllowed, false)
  assert.equal(getEbayDraftWriteEnvironmentBoundary({
    vercelEnv: "preview",
    draftTarget: "PRODUCTION",
    vercelGitCommitRef: "feature/centralize-ebay-mobile-command-center",
    allowedProductionBranch: "feature/centralize-ebay-mobile-command-center",
  }).writeAllowed, false)
  assert.equal(getEbayProRuntimeBoundary({
    vercelEnv: "production",
    pathname: "/admin/ebay/opportunity-queue",
    method: "GET",
  }).blocked, true)
  assert.equal(getEbayProRuntimeBoundary({
    vercelEnv: "production",
    ebayProRuntime: "staging",
    pathname: "/api/admin/ebay/draft-only",
    method: "POST",
  }).blocked, true)
})

test("direct draft service boundary cannot bypass Production or disabled flags", () => withEnvironment({
  EBAY_DRAFT_ONLY_TARGET: "PRODUCTION",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "feature/centralize-ebay-mobile-command-center",
  EBAY_DRAFT_ONLY_PRODUCTION_ALLOWED_GIT_BRANCH: "feature/centralize-ebay-mobile-command-center",
  EBAY_DRAFT_ONLY_WRITES_ENABLED: "true",
  EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: "true",
}, () => {
  const config = getEbayDraftWriteEnvironmentBoundary()
  assert.equal(config.environmentAllowed, false)
  assert.equal(config.writeAllowed, false)
  const gateway = readFileSync("lib/ebay/ebay-draft-only-gateway.ts", "utf8")
  assert.match(gateway, /getEbayDraftWriteEnvironmentBoundary/)
}))

function cleanupAsset(status = "approved", accountKey = accountA) {
  return {
    id: assetId,
    listing_package_id: packageId,
    account_key: accountKey,
    status,
    output_storage_path: `${actorId}/candidate/${assetId}-optimized.jpg`,
    source_storage_path: `${actorId}/candidate/${assetId}-source.jpg`,
    output_sha256: outputHash,
    source_sha256: sourceHash,
  }
}

function cleanupJob(overrides = {}) {
  const asset = cleanupAsset()
  return {
    id: "423e4567-e89b-42d3-a456-426614174000",
    account_key: accountA,
    image_asset_id: assetId,
    listing_package_id: packageId,
    cleanup_kind: "approved_staging",
    bucket_id: EBAY_IMAGE_STAGING_BUCKET,
    storage_key: asset.output_storage_path,
    expected_sha256: outputHash,
    attempts: 1,
    ...overrides,
  }
}

test("cleanup validation blocks wrong hash, bucket, account and approved source", () => {
  const asset = cleanupAsset()
  const listingPackage = { id: packageId, account_key: accountA }
  assert.equal(
    validateEbayImageStorageCleanupClaim(cleanupJob(), asset, listingPackage, accountA).bucketId,
    EBAY_IMAGE_STAGING_BUCKET,
  )
  assert.throws(() => validateEbayImageStorageCleanupClaim(
    cleanupJob({ expected_sha256: "d".repeat(64) }),
    asset,
    listingPackage,
    accountA,
  ), /EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID/)
  assert.throws(() => validateEbayImageStorageCleanupClaim(
    cleanupJob({ bucket_id: "ebay-listing-images" }),
    asset,
    listingPackage,
    accountA,
  ), /EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID/)
  assert.throws(() => validateEbayImageStorageCleanupClaim(
    cleanupJob(),
    asset,
    { id: packageId, account_key: accountB },
    accountA,
  ), /EBAY_IMAGE_CLEANUP_ACCOUNT_SCOPE_MISMATCH/)
  assert.throws(() => validateEbayImageStorageCleanupClaim(
    cleanupJob({
      cleanup_kind: "rejected_source",
      bucket_id: EBAY_IMAGE_SOURCE_BUCKET,
      storage_key: asset.source_storage_path,
      expected_sha256: sourceHash,
    }),
    asset,
    listingPackage,
    accountA,
  ), /EBAY_IMAGE_CLEANUP_ASSET_STATE_INVALID/)
})

function mockCleanupSupabase({ missing = false, corrupt = false, claimed = true } = {}) {
  const completed = []
  const failed = []
  const asset = cleanupAsset()
  const job = cleanupJob()
  const query = (data) => ({
    select() { return this },
    eq() { return this },
    async maybeSingle() { return { data, error: null } },
  })
  return {
    completed,
    failed,
    client: {
      async rpc(name, args) {
        if (name === "claim_ebay_image_storage_cleanup_jobs") {
          return { data: claimed ? [job] : [], error: null }
        }
        if (name === "complete_ebay_image_storage_cleanup_job") {
          completed.push(args.p_outcome); return { data: [{}], error: null }
        }
        if (name === "fail_ebay_image_storage_cleanup_job") {
          failed.push(args.p_error_code); return { data: [{}], error: null }
        }
        throw new Error(`unexpected rpc ${name}`)
      },
      from(table) {
        if (table === "ebay_listing_image_assets") return query(asset)
        if (table === "ebay_listing_packages") return query({ id: packageId, account_key: accountA })
        throw new Error(`unexpected table ${table}`)
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, EBAY_IMAGE_STAGING_BUCKET)
          return {
            async download() {
              if (missing) return { data: null, error: { statusCode: 404, message: "not found" } }
              const body = corrupt ? Buffer.from("wrong bytes") : bytes
              return { data: new Blob([body]), error: null }
            },
            async remove() { return { data: [], error: null } },
          }
        },
      },
    },
  }
}

const scopedEnvironment = {
  EBAY_SELLER_ACCOUNT_KEY: "official",
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: undefined,
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT: "a".repeat(64),
  EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT: undefined,
}

test("cleanup deletes correct bytes and treats a missing object idempotently", async () => {
  await withEnvironment(scopedEnvironment, async () => {
    const deletion = mockCleanupSupabase()
    const deleted = await reconcileEbayImageStorageCleanup(deletion.client, { accountKey: accountA, workerId: "test" })
    assert.equal(deleted.deleted, 1)
    assert.deepEqual(deletion.completed, ["deleted"])

    const missing = mockCleanupSupabase({ missing: true })
    const absent = await reconcileEbayImageStorageCleanup(missing.client, { accountKey: accountA, workerId: "test" })
    assert.equal(absent.alreadyMissing, 1)
    assert.deepEqual(missing.completed, ["already_missing"])
  })
})

test("cleanup hash mismatch is recorded for retry without deleting", async () => {
  await withEnvironment(scopedEnvironment, async () => {
    const mocked = mockCleanupSupabase({ corrupt: true })
    const result = await reconcileEbayImageStorageCleanup(mocked.client, { accountKey: accountA, workerId: "test" })
    assert.equal(result.failed, 1)
    assert.deepEqual(mocked.failed, ["EBAY_IMAGE_CLEANUP_HASH_MISMATCH"])
    assert.deepEqual(mocked.completed, [])
  })
})

test("cleanup concurrent lease returns an empty idempotent batch", async () => {
  await withEnvironment(scopedEnvironment, async () => {
    const mocked = mockCleanupSupabase({ claimed: false })
    const result = await reconcileEbayImageStorageCleanup(
      mocked.client,
      { accountKey: accountA, workerId: "second-worker" },
    )
    assert.equal(result.claimed, 0)
    assert.equal(result.deleted, 0)
    assert.deepEqual(mocked.completed, [])
    assert.deepEqual(mocked.failed, [])
  })
})

test("cleanup migration uses leases, SKIP LOCKED and retry dates", () => {
  const migration = readFileSync(
    "supabase/migrations/20260713077000_create_ebay_image_storage_cleanup_reconciliation.sql",
    "utf8",
  )
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /lease_expires_at <= now\(\)/)
  assert.match(migration, /next_attempt_at/)
  assert.match(migration, /already_missing/)
  assert.doesNotMatch(migration, /bucket_id in \([^)]*ebay-listing-images'/s)
})

test("constraint validation migration checks violations before VALIDATE", () => {
  const migration = readFileSync(
    "supabase/migrations/20260713078000_validate_ebay_active_listing_constraints.sql",
    "utf8",
  )
  assert.ok(migration.indexOf("ACCOUNT_SCOPE_VIOLATIONS")
    < migration.indexOf("validate constraint ebay_active_listings_account_scope_check"))
  assert.ok(migration.indexOf("SYNC_GENERATION_VIOLATIONS")
    < migration.indexOf("validate constraint ebay_active_listings_sync_generation_check"))
  assert.doesNotMatch(migration, /\bdelete\b|\bupdate\b/i)
})

test("active listing pilot route is manual, leased and not a new cron", () => {
  const route = readFileSync("app/api/admin/ebay/active-listings/sync/route.ts", "utf8")
  const vercel = readFileSync("vercel.json", "utf8")
  const scheduler = readFileSync(
    "supabase/migrations/20260905090044_seller_os_post_only_runtime_dispatch_v1.sql",
    "utf8",
  )
  assert.match(route, /claim_ebay_active_listing_sync_run/)
  assert.match(route, /last_success_at/)
  assert.match(route, /last_error_code/)
  assert.doesNotMatch(route, /CRON_SECRET/)
  assert.doesNotMatch(vercel, /active-listings\/sync/)
  assert.doesNotMatch(scheduler, /active-listings\/sync/)
  assert.match(scheduler, /MARKET_RADAR_LUNA_SYNC[\s\S]*0 9 \* \* \*/)
  assert.match(scheduler,
    /EBAY_LUNA_OPPORTUNITY_SCAN[\s\S]*17 9 \* \* \*/)
})

test("environment preflight returns enums only and never values", () => {
  const statuses = getEbaySellerOsEnvironmentPreflight({
    EBAY_CLIENT_ID: "client",
    EBAY_CLIENT_SECRET: "super-secret-value",
    EBAY_SELLER_REFRESH_TOKEN: "refresh-secret-value",
    EBAY_SELLER_ACCOUNT_KEY: "official",
    EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID: "seller",
    EBAY_DRAFT_ONLY_WRITES_ENABLED: "false",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  })
  const allowed = new Set([
    "PRESENT",
    "MISSING",
    "INVALID_FORMAT",
    "IDENTITY_UNBOUND",
    "SCOPE_NOT_VERIFIED",
  ])
  assert.ok(Object.values(statuses).every((status) => allowed.has(status)))
  assert.equal(statuses.EBAY_SELLER_REFRESH_TOKEN, "SCOPE_NOT_VERIFIED")
  assert.equal(JSON.stringify(statuses).includes("super-secret-value"), false)
  assert.equal(JSON.stringify(statuses).includes("refresh-secret-value"), false)

  const legacyAccountStatus = getEbaySellerOsEnvironmentPreflight({
    EBAY_SELLER_ACCOUNT_KEY: "official:UNTRUSTED-LEGACY-SUFFIX",
  }).EBAY_SELLER_ACCOUNT_KEY
  assert.equal(legacyAccountStatus, "PRESENT")
})

test("WhatsApp and Production draft writes remain off by default", () => withEnvironment({
  EBAY_SELLER_WHATSAPP_ENABLED: undefined,
  EBAY_DRAFT_ONLY_WRITES_ENABLED: undefined,
  EBAY_DRAFT_ONLY_PRODUCTION_WRITES_ENABLED: undefined,
  VERCEL_ENV: "preview",
}, () => {
  assert.equal(getEbaySellerOsEnvironmentPreflight(process.env).EBAY_SELLER_WHATSAPP_ENABLED, "MISSING")
  const whatsapp = readFileSync("lib/ebay/ebay-seller-whatsapp-gateway.ts", "utf8")
  assert.match(whatsapp, /environmentBoundary\.blocked/)
  assert.equal(getEbayDraftWriteEnvironmentBoundary({
    vercelEnv: "preview",
    draftTarget: "PRODUCTION",
    vercelGitCommitRef: "allowed",
    allowedProductionBranch: "allowed",
  }).writeAllowed, false)
}))
