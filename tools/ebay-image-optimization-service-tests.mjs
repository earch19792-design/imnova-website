import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import sharp from "sharp"

import {
  EBAY_IMAGE_MAX_SOURCE_BYTES,
  EBAY_IMAGE_OUTPUT_SIZE,
  EBAY_IMAGE_TRANSFORMATION_VERSION,
  fetchAuthorizedImageSource,
  optimizeAuthorizedEbayMainImage,
  validateAuthorizedImageSourceUrl,
  validateImageRightsEvidence,
} from "../lib/ebay/ebay-image-optimization-service.ts"

async function productOnBackground(background) {
  const product = await sharp({
    create: { width: 360, height: 440, channels: 3, background: "#1877c9" },
  }).png().toBuffer()
  return sharp({
    create: { width: 900, height: 900, channels: 3, background },
  }).composite([{ input: product, left: 270, top: 230 }]).jpeg({ quality: 96 }).toBuffer()
}

test("normalizes a light authorized product photo to a reviewed 1600px white canvas", async () => {
  const source = await productOnBackground("#f5f4f2")
  const result = await optimizeAuthorizedEbayMainImage(source)
  const metadata = await sharp(result.output).metadata()

  assert.equal(metadata.width, EBAY_IMAGE_OUTPUT_SIZE)
  assert.equal(metadata.height, EBAY_IMAGE_OUTPUT_SIZE)
  assert.equal(result.transformation.version, EBAY_IMAGE_TRANSFORMATION_VERSION)
  assert.equal(result.transformation.generativeAiUsed, false)
  assert.equal(result.qa.humanApprovalRequired, true)
  assert.equal(result.qa.automaticStatus, "PASSED")
  assert.match(result.sourceSha256, /^[0-9a-f]{64}$/)
  assert.match(result.outputSha256, /^[0-9a-f]{64}$/)
  assert.notEqual(result.sourceSha256, result.outputSha256)
})

test("fails closed when the edge is complex instead of erasing a product", async () => {
  const source = await productOnBackground("#252b35")
  await assert.rejects(
    optimizeAuthorizedEbayMainImage(source),
    /EBAY_IMAGE_BACKGROUND_REQUIRES_MANUAL_REMOVAL/,
  )
})

test("allows only documented HTTPS supplier hosts and explicit rights evidence", () => {
  assert.equal(
    validateAuthorizedImageSourceUrl("https://cdn.shopify.com/s/files/product.jpg").hostname,
    "cdn.shopify.com",
  )
  assert.throws(
    () => validateAuthorizedImageSourceUrl("https://competitor.example/product.jpg"),
    /EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED/,
  )
  assert.throws(
    () => validateAuthorizedImageSourceUrl("https://user:secret@cdn.shopify.com/product.jpg"),
    /EBAY_IMAGE_SOURCE_CREDENTIALS_NOT_ALLOWED/,
  )
  assert.throws(
    () => validateAuthorizedImageSourceUrl("https://cdn.shopify.com:8443/product.jpg"),
    /EBAY_IMAGE_SOURCE_PORT_NOT_ALLOWED/,
  )
  assert.deepEqual(validateImageRightsEvidence({
    rightsBasis: "owned",
    authorizationReference: "photo-session-2026-07-13",
    rightsEvidenceConfirmed: true,
  }), {
    rightsBasis: "owned",
    authorizationReference: "photo-session-2026-07-13",
    rightsEvidenceConfirmed: true,
  })
  assert.throws(
    () => validateImageRightsEvidence({ rightsBasis: "unknown", authorizationReference: "reference", rightsEvidenceConfirmed: true }),
    /EBAY_IMAGE_RIGHTS_BASIS_INVALID/,
  )
  assert.throws(
    () => validateImageRightsEvidence({ rightsBasis: "licensed", authorizationReference: "license-document-2026" }),
    /EBAY_IMAGE_RIGHTS_EVIDENCE_CONFIRMATION_REQUIRED/,
  )
})

test("misconfigured local or IP hosts cannot expand the remote allowlist", () => {
  const previous = process.env.EBAY_IMAGE_SOURCE_HOSTS
  try {
    process.env.EBAY_IMAGE_SOURCE_HOSTS = "localhost,127.0.0.1"
    assert.throws(
      () => validateAuthorizedImageSourceUrl("https://localhost/private.jpg"),
      /EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED/,
    )
    assert.throws(
      () => validateAuthorizedImageSourceUrl("https://127.0.0.1/private.jpg"),
      /EBAY_IMAGE_SOURCE_HOST_NOT_ALLOWED/,
    )
  } finally {
    if (previous === undefined) delete process.env.EBAY_IMAGE_SOURCE_HOSTS
    else process.env.EBAY_IMAGE_SOURCE_HOSTS = previous
  }
})

test("aborts a streamed remote body above 15 MB even without Content-Length", async () => {
  const originalFetch = globalThis.fetch
  let requestSignal
  globalThis.fetch = async (_input, init) => {
    requestSignal = init?.signal
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024))
        controller.enqueue(new Uint8Array(EBAY_IMAGE_MAX_SOURCE_BYTES - (8 * 1024 * 1024) + 1))
        controller.close()
      },
    }), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    })
  }
  try {
    await assert.rejects(
      fetchAuthorizedImageSource("https://cdn.shopify.com/product.jpg"),
      /EBAY_IMAGE_SOURCE_TOO_LARGE/,
    )
    assert.equal(requestSignal?.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("the protected API stores originals privately and only attaches human-approved outputs", () => {
  const route = readFileSync(new URL("../app/api/admin/ebay/images/route.ts", import.meta.url), "utf8")
  const service = readFileSync(
    new URL("../lib/ebay/ebay-image-optimization-service.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(
    new URL("../supabase/migrations/20260713070000_create_ebay_image_optimization_pipeline.sql", import.meta.url),
    "utf8",
  )
  assert.match(route, /validateAdminApiRequest/)
  assert.match(route, /EBAY_IMAGE_PACKAGE_REQUIRED/)
  assert.match(route, /new Set\(orderedAssetIds\)\.size/)
  assert.match(route, /SOURCE_BUCKET/)
  assert.match(route, /STAGING_BUCKET/)
  assert.match(route, /\.rpc\(\s*"ebay_create_pending_listing_image"/)
  assert.match(route, /\.rpc\(\s*"ebay_review_listing_image_and_attach"/)
  assert.match(route, /\.rpc\(\s*"ebay_reorder_listing_images_and_attach"/)
  assert.doesNotMatch(route, /package_data:\s*\{\s*\.\.\.packageData/)
  assert.doesNotMatch(route, /\.from\("ebay_listing_image_assets"\)\s*\.insert\(/)
  assert.doesNotMatch(route, /\.from\("ebay_listing_image_assets"\)\s*\.update\(/)
  assert.doesNotMatch(service, /response\.arrayBuffer\(\)/)
  assert.match(migration, /'ebay-listing-image-sources',[\s\S]*?false/)
  assert.match(migration, /'ebay-listing-image-staging',[\s\S]*?false/)
  assert.match(
    migration,
    /status = 'pending_review'[\s\S]*?published_storage_path is null and public_url is null/,
  )
  assert.match(
    route,
    /\.from\(STAGING_BUCKET\)[\s\S]*?\.upload\(outputPath,[\s\S]*?ebay_create_pending_listing_image/,
  )
  assert.match(
    route,
    /action === "approve"[\s\S]*?\.from\(STAGING_BUCKET\)[\s\S]*?\.download\(stagingPath\)[\s\S]*?createHash\("sha256"\)[\s\S]*?\.from\(OUTPUT_BUCKET\)[\s\S]*?\.upload\(publishedPath/,
  )
  assert.match(
    route,
    /publishError[\s\S]*?\.from\(OUTPUT_BUCKET\)\.download\(publishedPath\)[\s\S]*?EBAY_IMAGE_PUBLICATION_CONFLICT/,
  )
  assert.match(
    route,
    /reconciledAsset\.status === "rejected"[\s\S]*?\.from\(OUTPUT_BUCKET\)\.remove\(\[publishedPath\]\)/,
  )
  assert.match(
    route,
    /action === "reject"[\s\S]*?\.from\(STAGING_BUCKET\)\.remove\(\[stagingPath\]\)[\s\S]*?\.from\(SOURCE_BUCKET\)\.remove\(\[sourcePath\]\)/,
  )
  assert.match(migration, /revoke all on table public\.ebay_listing_image_assets from anon, authenticated/)
  assert.match(migration, /create or replace function public\.ebay_create_pending_listing_image/)
  assert.match(migration, /create or replace function public\.ebay_attach_approved_listing_images/)
  assert.match(migration, /create or replace function public\.ebay_review_listing_image_and_attach/)
  assert.match(migration, /create or replace function public\.ebay_reorder_listing_images_and_attach/)
  assert.match(migration, /for update/)
  assert.match(migration, /jsonb_set\([\s\S]*?'\{imageUrls\}'[\s\S]*?'\{imageAssetManifest\}'/)
  assert.match(migration, /status = 'draft',[\s\S]*?readiness = 0/)
  assert.match(migration, /revoke all on function public\.ebay_attach_approved_listing_images\(uuid, uuid\)/)
  assert.match(migration, /EBAY_IMAGE_APPROVAL_EVIDENCE_INVALID/)
  assert.match(migration, /EBAY_IMAGE_ACTIVE_CAP_REACHED/)
  assert.match(migration, /EBAY_IMAGE_APPROVED_CAP_REACHED/)
  assert.match(
    migration,
    /create unique index if not exists ebay_listing_image_assets_active_position_uidx/,
  )
  assert.match(
    migration,
    /create unique index if not exists ebay_listing_image_assets_active_main_uidx/,
  )
  assert.match(
    migration,
    /revoke all on function public\.ebay_create_pending_listing_image\([\s\S]*?from public, anon, authenticated/,
  )
  assert.doesNotMatch(route, /publishOffer|createOffer|createOrReplaceInventoryItem/)
})

test("listing package writes are server-only and atomically derive the protected image manifest", () => {
  const route = readFileSync(
    new URL("../app/api/admin/ebay/command-center/route.ts", import.meta.url),
    "utf8",
  )
  const migration = readFileSync(
    new URL("../supabase/migrations/20260713070000_create_ebay_image_optimization_pipeline.sql", import.meta.url),
    "utf8",
  )

  assert.match(
    migration,
    /create or replace function public\.ebay_save_listing_package_guarded\(/,
  )
  assert.match(
    migration,
    /where package_row\.id = p_package_id[\s\S]*?for update;/,
  )
  assert.match(
    migration,
    /v_package\.updated_at is distinct from p_expected_updated_at[\s\S]*?EBAY_LISTING_PACKAGE_STALE_VERSION/,
  )
  assert.match(
    migration,
    /image_asset\.status = 'approved'[\s\S]*?rights_evidence_confirmed = true[\s\S]*?automaticStatus' = 'PASSED'/,
  )
  assert.match(
    migration,
    /v_next_data := coalesce\(p_package_patch, '\{\}'::jsonb\)[\s\S]*?- 'imageUrls' - 'imageAssetManifest'/,
  )
  assert.match(
    migration,
    /drop policy if exists "admin manage ebay listing packages"[\s\S]*?for select[\s\S]*?revoke insert, update, delete on table public\.ebay_listing_packages[\s\S]*?from anon, authenticated/,
  )
  assert.match(
    migration,
    /package_data = coalesce\(package_data, '\{\}'::jsonb\) - 'imageAssetManifest'/,
  )
  assert.match(
    migration,
    /revoke all on function public\.ebay_save_listing_package_guarded\([\s\S]*?from public, anon, authenticated/,
  )

  const guardedCalls = route.match(
    /\.rpc\(\s*"ebay_save_listing_package_guarded"/g,
  ) ?? []
  assert.equal(guardedCalls.length, 2)
  assert.equal(
    (route.match(/p_expected_updated_at:/g) ?? []).length,
    2,
  )
  assert.doesNotMatch(
    route,
    /\.from\("ebay_listing_packages"\)[\s\S]{0,160}?\.update\(/,
  )
})
