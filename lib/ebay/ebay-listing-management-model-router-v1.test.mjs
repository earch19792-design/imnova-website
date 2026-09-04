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
  buildEbayInventoryManagedTitleReplacementV1,
  classifyEbayListingManagementModelEvidenceV1,
} = await import("./ebay-draft-only-gateway.ts")

const sku = "IMNOVA-EXACT-SKU"
const itemId = "366634810965"
const currentTitle = "Existing title"
const targetTitle = "Existing title Black"

test("exact Inventory Item and published Offer prove Inventory management", () => {
  const inventoryItemPayload = {
    sku,
    condition: "NEW",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: { title: currentTitle, aspects: { Color: ["Black"] },
      imageUrls: ["https://img.test/1.jpg"] },
  }
  const evidence = classifyEbayListingManagementModelEvidenceV1({
    sku,
    itemId,
    inventory: { ok: true, status: 200, body: inventoryItemPayload },
    offers: { ok: true, status: 200, body: { total: 1, size: 1,
      offers: [{ sku, marketplaceId: "EBAY_US", status: "PUBLISHED",
        listing: { listingId: itemId } }] } },
  })
  assert.equal(evidence.managementModel, "INVENTORY_API_MANAGED")
  assert.equal(evidence.exactPublishedOfferCount, 1)
  assert.match(evidence.inventoryEvidenceDigest, /^sha256:[0-9a-f]{64}$/)

  const replacement = buildEbayInventoryManagedTitleReplacementV1({
    sku,
    currentTitle,
    targetTitle,
    inventoryItemPayload,
    expectedEvidenceDigest: evidence.inventoryEvidenceDigest,
  })
  assert.equal(replacement.payload.product.title, targetTitle)
  assert.equal(replacement.payload.condition, "NEW")
  assert.deepEqual(replacement.payload.availability,
    inventoryItemPayload.availability)
  assert.deepEqual(replacement.payload.product.aspects,
    inventoryItemPayload.product.aspects)
  assert.deepEqual(replacement.payload.product.imageUrls,
    inventoryItemPayload.product.imageUrls)
  assert.equal(replacement.nonAuthorizedFieldsPreserved, true)
})

test("authoritative Inventory absence and complete empty Offers prove Trading", () => {
  const evidence = classifyEbayListingManagementModelEvidenceV1({
    sku,
    itemId,
    inventory: { ok: false, status: 404, body: {} },
    offers: { ok: true, status: 200,
      body: { total: 0, size: 0, offers: [] } },
  })
  assert.equal(evidence.managementModel, "TRADING_MANAGED")
  assert.equal(evidence.inventoryItemAuthoritativelyAbsent, true)
  assert.equal(evidence.offersReadComplete, true)
})

test("ambiguous, incomplete, or grouped Inventory evidence fails closed", () => {
  const fixtures = [
    {
      inventory: { ok: false, status: 503, body: {} },
      offers: { ok: false, status: 503, body: {} },
    },
    {
      inventory: { ok: true, status: 200,
        body: { sku, groupIds: ["group-1"], product: { title: currentTitle } } },
      offers: { ok: true, status: 200, body: { total: 1, size: 1,
        offers: [{ sku, marketplaceId: "EBAY_US", status: "PUBLISHED",
          listingId: itemId }] } },
    },
    {
      inventory: { ok: true, status: 200,
        body: { sku, product: { title: currentTitle } } },
      offers: { ok: true, status: 200, body: { total: 2, size: 1,
        offers: [{ sku, marketplaceId: "EBAY_US", status: "PUBLISHED",
          listingId: itemId }] } },
    },
  ]
  for (const fixture of fixtures) {
    assert.equal(classifyEbayListingManagementModelEvidenceV1({
      sku, itemId, ...fixture,
    }).managementModel, "MANAGEMENT_MODEL_UNPROVEN")
  }
})

test("full replace rejects unknown fields instead of dropping them", () => {
  const inventoryItemPayload = {
    sku,
    product: { title: currentTitle },
    futureWritableField: { mustNotBeLost: true },
  }
  const evidence = classifyEbayListingManagementModelEvidenceV1({
    sku,
    itemId,
    inventory: { ok: true, status: 200, body: inventoryItemPayload },
    offers: { ok: true, status: 200, body: { total: 1, size: 1,
      offers: [{ sku, marketplaceId: "EBAY_US", status: "PUBLISHED",
        listingId: itemId }] } },
  })
  assert.throws(() => buildEbayInventoryManagedTitleReplacementV1({
    sku,
    currentTitle,
    targetTitle,
    inventoryItemPayload,
    expectedEvidenceDigest: evidence.inventoryEvidenceDigest,
  }), /EBAY_INVENTORY_TITLE_REPLACEMENT_PRECONDITION_FAILED/)
})
