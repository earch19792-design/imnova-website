import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  buildRequiredUpcPackageProjectionV1,
  resolveExactLunaUpcEvidenceV1,
} = await import("./ebay-quick-pick-required-upc-resolution-v1.ts")

const productUrl =
  "https://lunaportex.com/products/scan-reader-pen-for-portable-two-way-instant-translator-pen"
const productId = "9220840456416"
const variantId = "48809652158688"
const sourceSku = "Alibaba-ScanReader-DigitalPen-B0CPHN5395"

function lunaFetch(barcode = "740134033771", overrides = {}) {
  return async () => new Response(JSON.stringify({
    id: Number(productId),
    handle:
      "scan-reader-pen-for-portable-two-way-instant-translator-pen",
    title: "Scan Reader Pen for Portable Two-Way Instant Translator Pen",
    vendor: "Luna Warehouse",
    type: "Office Electronics",
    variants: [{ id: Number(variantId), title: "Default Title",
      sku: sourceSku, barcode, price: 2799, available: true,
      grams: 120 }], images: [], ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } })
}

test("accepts only checksum-valid UPC from the exact Luna product variant", async () => {
  const evidence = await resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId: productId, lunaVariantId: variantId, sourceSku,
    fetchImpl: lunaFetch() })
  assert.equal(evidence.upc, "740134033771")
  assert.equal(evidence.sourceClass,
    "PUBLIC_LUNA_PRODUCT_JSON_EXACT_READBACK")
  assert.equal(evidence.exactIdentityMatch, true)
  assert.equal(evidence.checksumValid, true)
  assert.equal(evidence.factInvented, false)

  await assert.rejects(resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId: productId, lunaVariantId: "48809652158689", sourceSku,
    fetchImpl: lunaFetch() }),
  /QUICK_PICK_REQUIRED_UPC_EXACT_IDENTITY_MISMATCH/)
  await assert.rejects(resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId: productId, lunaVariantId: variantId, sourceSku,
    fetchImpl: lunaFetch("740134033770") }),
  /QUICK_PICK_REQUIRED_UPC_EXACT_VALUE_UNAVAILABLE/)
})

test("does not promote a unit UPC to an asserted multipack identity", async () => {
  await assert.rejects(resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId: productId, lunaVariantId: variantId, sourceSku,
    productTitle: "Scan Reader Pen 3 Pack", fetchImpl: lunaFetch() }),
  /QUICK_PICK_REQUIRED_UPC_MULTIPACK_IDENTITY_UNPROVEN/)
})

test("package projection invalidates owner confirmation without a market write", async () => {
  const evidence = await resolveExactLunaUpcEvidenceV1({ productUrl,
    lunaProductId: productId, lunaVariantId: variantId, sourceSku,
    fetchImpl: lunaFetch() })
  const projected = buildRequiredUpcPackageProjectionV1({
    packageData: { quickPickOwnerReviewV1: { status: "CONFIRMED",
      readyForOwnerPublishAuthorization: true,
      marketplaceWriteAuthorized: false } },
    review: { packageDigest: `sha256:${"a".repeat(64)}` },
    evidence, actorUserId: "11111111-1111-4111-8111-111111111111",
    now: "2026-09-01T22:00:00.000Z",
  })
  assert.equal(projected.productIdentifiers.upc, "740134033771")
  assert.equal(projected.quickPickOwnerReviewV1.status,
    "EDITED_PENDING_CONFIRMATION")
  assert.equal(projected.quickPickOwnerReviewV1
    .readyForOwnerPublishAuthorization, false)
  assert.equal(projected.quickPickOwnerReviewV1.marketplaceWriteAuthorized,
    false)
  assert.equal(projected.quickPickOwnerReviewV1.marketplaceWrites, 0)
})
