import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value === "server-only") {
    return { url: "data:text/javascript,export default {}", shortCircuit: true }
  }
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  buildEbayInventoryManagedImageReplacementV1,
  classifyEbayListingManagementModelEvidenceV1,
} = await import("./ebay-draft-only-gateway.ts")
const { readCanonicalEbayListingManagementResourcesV1 } = await import(
  "./ebay-account-policy-readonly-gateway.ts")
const { buildMayelVisualManifestV1 } = await import(
  "./ebay-mayel-visual-workstation-v1.ts")
const { buildMayelVisualPhaseBPlanV1,
  buildMayelVisualPhaseBRebaseV1 } = await import(
  "./ebay-mayel-visual-phase-b-v1.ts")

const taskId = "11111111-1111-4111-8111-111111111111"
const assetId = "22222222-2222-4222-8222-222222222222"
const itemId = "366643122092"
const main = "https://i.ebayimg.com/images/g/main/s-l1600.jpg"
const oldSecondary = "https://i.ebayimg.com/images/g/old/s-l1600.jpg"
const mayel = "https://project.supabase.co/storage/v1/object/public/ebay-listing-images/mayel-visual/task/asset/hash.jpg"

function fixture(currentImages = [main, oldSecondary]) {
  const manifest = buildMayelVisualManifestV1({ visualTaskId: taskId,
    ebayItemId: itemId, currentImages,
    assets: [{ assetId, role: "DETAIL", outputSha256: "a".repeat(64),
      publicUrl: mayel }],
    productTruthDigest: `sha256:${"b".repeat(64)}`,
    sourceImageSetDigest: `sha256:${"c".repeat(64)}` })
  const assets = [{ id: assetId, status: "approved",
    mayel_approval_status: "APPROVED", owner_approval_status: "PENDING",
    output_sha256: "a".repeat(64), public_url: mayel }]
  return { manifest, assets }
}

test("Phase B binds approval to the exact stable manifest and preserves main plus current images", () => {
  const { manifest, assets } = fixture()
  const plan = buildMayelVisualPhaseBPlanV1({ visualTaskId: taskId,
    ebayItemId: itemId, visualManifest: manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    currentOfficialImageUrls: [main, oldSecondary], approvedAssets: assets,
    canonicalPublicAssetUrlAllowed: (url) => url === mayel })
  assert.equal(plan.ready, true)
  assert.equal(plan.ownerAuthorizationDigest, manifest.visualManifestDigest)
  assert.equal(plan.mainImageChanged, false)
  assert.deepEqual(plan.proposedFinalOrderedImageUrls,
    [main, mayel, oldSecondary])
  assert.deepEqual(plan.fieldsToChange, ["IMAGES_ONLY"])
})

test("official image drift invalidates owner authorization before a write", () => {
  const { manifest, assets } = fixture()
  const plan = buildMayelVisualPhaseBPlanV1({ visualTaskId: taskId,
    ebayItemId: itemId, visualManifest: manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    currentOfficialImageUrls: [main], approvedAssets: assets,
    canonicalPublicAssetUrlAllowed: () => true })
  assert.equal(plan.ready, false)
  assert.equal(plan.blocker, "MAYEL_VISUAL_CURRENT_OFFICIAL_IMAGE_SET_CHANGED")
  assert.equal(plan.ownerAuthorizationDigest, null)
})

test("safe rebase preserves the approved Mayel asset and rebuilds only the material image manifest", () => {
  const { manifest } = fixture()
  const newOfficialSecondary =
    "https://i.ebayimg.com/images/g/new/s-l1600.jpg"
  const assets = [{ id: assetId, status: "approved",
    mayel_approval_status: "APPROVED", owner_approval_status: "PENDING",
    mayel_output_role: "DETAIL", output_sha256: "a".repeat(64),
    public_url: mayel,
    product_truth_digest: `sha256:${"b".repeat(64)}`,
    source_image_set_digest: `sha256:${"c".repeat(64)}` }]
  const rebased = buildMayelVisualPhaseBRebaseV1({
    visualTaskId: taskId, ebayItemId: itemId,
    visualManifest: manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    taskProductTruthDigest: `sha256:${"b".repeat(64)}`,
    taskSourceImageSetDigest: `sha256:${"c".repeat(64)}`,
    currentOfficialImageUrls: [main, newOfficialSecondary],
    approvedAssets: assets,
    canonicalPublicAssetUrlAllowed: (url) => url === mayel,
  })
  assert.equal(rebased.safe, true)
  assert.equal(rebased.mayelAssetPreserved, true)
  assert.equal(rebased.mayelReworkRequired, false)
  assert.equal(rebased.mainImagePreserved, true)
  assert.notEqual(rebased.visualManifestDigest,
    manifest.visualManifestDigest)
  assert.deepEqual(rebased.manifest.proposedOrderedImages.map((entry) =>
    entry.publicUrl), [main, mayel, newOfficialSecondary])
})

test("safe rebase fails closed when Product Truth binding changed", () => {
  const { manifest, assets } = fixture()
  const rebound = assets.map((asset) => ({ ...asset,
    mayel_output_role: "DETAIL",
    product_truth_digest: `sha256:${"d".repeat(64)}`,
    source_image_set_digest: `sha256:${"c".repeat(64)}` }))
  const rebased = buildMayelVisualPhaseBRebaseV1({
    visualTaskId: taskId, ebayItemId: itemId,
    visualManifest: manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    taskProductTruthDigest: `sha256:${"b".repeat(64)}`,
    taskSourceImageSetDigest: `sha256:${"c".repeat(64)}`,
    currentOfficialImageUrls: [main], approvedAssets: rebound,
    canonicalPublicAssetUrlAllowed: () => true,
  })
  assert.equal(rebased.safe, false)
  assert.equal(rebased.blocker,
    "MAYEL_VISUAL_REBASE_EVIDENCE_BINDING_CONFLICT")
  assert.equal(rebased.mayelReworkRequired, true)
})

test("authoritative Inventory zero-result envelope classifies an exact Trading-managed listing", () => {
  const result = classifyEbayListingManagementModelEvidenceV1({ sku: "SKU-1",
    itemId, inventory: { ok: false, status: 404, body: {} },
    offers: { ok: true, status: 200, body: { total: 0, size: 0 } } })
  assert.equal(result.managementModel, "TRADING_MANAGED")
  assert.equal(result.offersReadComplete, true)
})

test("canonical account-bound management reader performs only OAuth plus bounded official GET reads", async () => {
  const previous = {
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET,
    expectedUserId: process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID,
    credentialFingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT,
    accountFingerprint:
      process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT,
  }
  process.env.EBAY_CLIENT_ID = "client"
  process.env.EBAY_CLIENT_SECRET = "secret"
  process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID = "seller"
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT
  delete process.env.EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const href = String(url)
    calls.push({ href, method: init.method ?? "GET" })
    if (href.endsWith("/identity/v1/oauth2/token")) {
      return Response.json({ access_token: "access", expires_in: 7_200 })
    }
    if (href.includes("/inventory_item/")) {
      return Response.json({ sku: "SKU-1", product: { imageUrls: [main] } })
    }
    if (href.includes("/offer?")) {
      return Response.json({ total: 1, size: 1, offers: [{ sku: "SKU-1",
        marketplaceId: "EBAY_US", status: "PUBLISHED", listingId: itemId }] })
    }
    throw new Error("UNEXPECTED_REQUEST")
  }
  try {
    const resources = await readCanonicalEbayListingManagementResourcesV1({
      sku: "SKU-1", durableAccountIdentityProven: true,
      refreshTokenOverride: "refresh", fetchImpl,
    })
    assert.equal(resources.inventory.ok, true)
    assert.equal(resources.offers.ok, true)
    assert.equal(resources.sourceAuthority,
      "FRESH_ACCOUNT_BOUND_EBAY_INVENTORY_READONLY_V1")
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"])
    assert.equal(calls.filter((call) => call.href.includes("/sell/inventory/"))
      .every((call) => call.method === "GET"), true)
  } finally {
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore("EBAY_CLIENT_ID", previous.clientId)
    restore("EBAY_CLIENT_SECRET", previous.clientSecret)
    restore("EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_USER_ID",
      previous.expectedUserId)
    restore("EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_CREDENTIAL_FINGERPRINT",
      previous.credentialFingerprint)
    restore("EBAY_DRAFT_ONLY_PRODUCTION_EXPECTED_ACCOUNT_FINGERPRINT",
      previous.accountFingerprint)
  }
})

test("canonical management reader fails closed before network without account authority", async () => {
  let calls = 0
  await assert.rejects(() => readCanonicalEbayListingManagementResourcesV1({
    sku: "SKU-1", durableAccountIdentityProven: false,
    refreshTokenOverride: "refresh",
    fetchImpl: async () => { calls += 1; return Response.json({}) },
  }), /EBAY_LISTING_MANAGEMENT_ACCOUNT_IDENTITY_UNPROVEN/)
  assert.equal(calls, 0)
})

test("image capacity fails closed and the manifest is never silently truncated", () => {
  const current = Array.from({ length: 24 }, (_, index) =>
    `https://i.ebayimg.com/images/g/${index}/s-l1600.jpg`)
  const { manifest, assets } = fixture(current)
  assert.equal(manifest.proposedOrderedImages.length, 25)
  assert.equal(manifest.capacityExceeded, true)
  const plan = buildMayelVisualPhaseBPlanV1({ visualTaskId: taskId,
    ebayItemId: itemId, visualManifest: manifest,
    visualManifestDigest: manifest.visualManifestDigest,
    currentOfficialImageUrls: current, approvedAssets: assets,
    canonicalPublicAssetUrlAllowed: () => true })
  assert.equal(plan.ready, false)
  assert.equal(plan.capacityExceeded, true)
  assert.equal(plan.blocker, "MAYEL_VISUAL_IMAGE_CAPACITY_DECISION_REQUIRED")
})

test("Inventory image replacement preserves every non-image writable field", () => {
  const sku = "IMNOVA-IMAGE-TEST"
  const inventoryItemPayload = { sku, condition: "NEW",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    packageWeightAndSize: { packageType: "MAILING_BOX" },
    product: { title: "Exact title", description: "Exact description",
      aspects: { Brand: ["Unbranded"] }, imageUrls: [main] } }
  const management = classifyEbayListingManagementModelEvidenceV1({ sku,
    itemId, inventory: { ok: true, status: 200, body: inventoryItemPayload },
    offers: { ok: true, status: 200, body: { total: 1, size: 1,
      offers: [{ sku, marketplaceId: "EBAY_US", status: "PUBLISHED",
        listingId: itemId }] } } })
  const replacement = buildEbayInventoryManagedImageReplacementV1({ sku,
    targetImageUrls: [main, mayel], inventoryItemPayload,
    expectedEvidenceDigest: management.inventoryEvidenceDigest })
  assert.deepEqual(replacement.payload.product.imageUrls, [main, mayel])
  assert.equal(replacement.payload.product.title, "Exact title")
  assert.equal(replacement.payload.product.description, "Exact description")
  assert.deepEqual(replacement.payload.product.aspects,
    inventoryItemPayload.product.aspects)
  assert.deepEqual(replacement.payload.availability,
    inventoryItemPayload.availability)
  assert.equal(replacement.nonAuthorizedFieldsPreserved, true)
})

test("Phase B surface is read-only on GET, legacy per-listing owner dispatch is disabled, and Trading is explicitly gated", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/mayel-visual-workstation/route.ts",
    import.meta.url), "utf8")
  const ui = readFileSync(new URL(
    "../../app/admin/mayel-visual-workstation.tsx", import.meta.url), "utf8")
  const server = readFileSync(new URL(
    "./ebay-mayel-visual-phase-b-server-v1.ts", import.meta.url), "utf8")
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260904092900_mayel_visual_workstation_phase_b_owner_gated_ebay_write_v1.sql",
    import.meta.url), "utf8")
  assert.match(route, /MAYEL_VISUAL_OWNER_AUTHORITY_REQUIRED/)
  assert.match(route, /APPLY_VISUAL_MANIFEST/)
  assert.match(route, /REBASE_VISUAL_MANIFEST/)
  assert.match(route,
    /MAYEL_VISUAL_LEGACY_PER_LISTING_AUTHORIZATION_DISABLED/)
  assert.doesNotMatch(ui, /Autorizar actualización de imágenes/)
  assert.match(ui, /AUTORIZAR MAYEL · CONTROL VISUAL/)
  assert.match(server, /rebaseMayelVisualPhaseBPreviewV1/)
  assert.match(server, /MAYEL_VISUAL_REBASE_DURABLE_READBACK_FAILED/)
  assert.match(server, /MAYEL_VISUAL_PHASE_B_READ_MODEL_V1/)
  assert.match(server, /readCanonicalEbayListingManagementResourcesV1/)
  assert.match(server, /safeToExecuteVisualChange/)
  assert.doesNotMatch(server.slice(0, server.indexOf(
    "export async function rebaseMayelVisualPhaseBPreviewV1")),
  /\.insert\(|\.update\(|\.delete\(/)
  assert.doesNotMatch(server,
    /safeRebaseAvailable[\s\S]{0,260}managementModel !== "MANAGEMENT_MODEL_UNPROVEN"/)
  const rebaseStart = server.indexOf(
    "export async function rebaseMayelVisualPhaseBPreviewV1")
  const applyStart = server.indexOf(
    "export async function applyMayelVisualManifestToEbayV1")
  assert.doesNotMatch(server.slice(rebaseStart, applyStart),
    /MAYEL_VISUAL_MANAGEMENT_MODEL_UNPROVEN/)
  assert.match(server, /MAYEL_VISUAL_TRADING_EXECUTOR_EXPLICITLY_GATED_SINGLE_WRITE_CONTRACT/)
  assert.match(server, /eq\("marketplace_write_count", 0\)/)
  assert.match(server, /verifyOfficialOrderedImageSetV1/)
  assert.match(server, /canonicalAssetsRecoverable/)
  assert.match(server, /Range: "bytes=0-0"/)
  assert.match(migration, /marketplace_write_count between 0 and 1/)
  assert.match(migration, /owner_authorization_digest = visual_manifest_digest/)
  assert.match(migration, /force row level security/)
  assert.doesNotMatch(route.slice(route.indexOf("export async function GET"),
    route.indexOf("export async function POST")),
  /executeEbayInventoryManagedImageMutationV1|applyMayelVisualManifestToEbayV1/)
})
