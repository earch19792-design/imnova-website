import assert from "node:assert/strict"
import test from "node:test"

import {
  SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1,
  createSellerOsLunaPublicExactStockAuthorityV1,
  evaluateSellerOsLunaPublicExactBundleCapacityV1,
} from "./ebay-luna-public-exact-stock-authority-v1.ts"

const canonicalSourceUrl = "https://lunaportex.com/products/exact-product"
const linkageId = "certified-linkage-1"
const componentIdentityId = "component-1"
const productId = "9220832362720"
const variantId = "48809643409632"
const sku = "ITEM3752"

function linkage() {
  return {
    linkageId,
    status: "CERTIFIED",
    components: [{
      componentIdentityId,
      productId,
      variantId,
      variantSemantics: "EXACT_VARIANT_REQUIRED",
      sku,
      canonicalSourceUrl,
      supplierQuantityRequired: 1,
    }],
  }
}

function product(variant = {}) {
  return {
    productId,
    canonicalUrl: canonicalSourceUrl,
    sourceMode: "PUBLIC_READ_ONLY_PRODUCT_PAGE",
    sourceParserVersion: "SELLER_OS_LUNA_PUBLIC_PRODUCT_PARSER_V1",
    variants: [{
      id: variantId,
      sku,
      available: null,
      sourceInventoryQuantity: null,
      sourceInventoryQuantityExplicit: false,
      ...variant,
    }],
  }
}

function authority(readFixedProduct) {
  return createSellerOsLunaPublicExactStockAuthorityV1({
    loadLinkageById: async (requestedId) =>
      requestedId === linkageId ? linkage() : null,
    readFixedProduct,
    now: () => "2026-08-23T23:00:00.000Z",
  })
}

async function read(readFixedProduct) {
  return authority(readFixedProduct)({ linkageId, componentIdentityId })
}

test("exact product SOLD OUT and OUT OF STOCK certify OOS with capacity zero", async () => {
  for (const availabilityMarker of ["SOLD_OUT", "OUT_OF_STOCK"]) {
    const result = await read(async () => product({
      available: false,
      availabilityMarker,
    }))
    assert.equal(result.source, SELLER_OS_LUNA_PUBLIC_EXACT_STOCK_SOURCE_V1)
    assert.equal(result.stockState, "CERTIFIED_OOS")
    assert.equal(result.certifiedOos, true)
    assert.equal(result.safeSalesCapacity, 0)
    assert.equal(result.authenticationUsed, false)
  }
})

test("exact explicit public quantity is preserved and computes component capacity", async () => {
  const result = await read(async () => product({
    available: true,
    availabilityMarker: "AVAILABLE",
    sourceInventoryQuantity: 7,
    sourceInventoryQuantityExplicit: true,
  }))
  assert.equal(result.stockState, "IN_STOCK")
  assert.equal(result.observedSupplierQuantity, 7)
  assert.equal(result.safeSalesCapacity, 7)
  assert.equal(result.quantityExplicit, true)
})

test("IN STOCK without quantity proves availability but not numeric safe capacity", async () => {
  const result = await read(async () => product({
    available: true,
    availabilityMarker: "IN_STOCK",
  }))
  assert.equal(result.stockState, "IN_STOCK")
  assert.equal(result.safeSalesCapacity, null)
  assert.equal(result.limitationCode, "NUMERIC_SAFE_CAPACITY_UNPROVEN")
})

test("missing stock marker fails closed", async () => {
  const result = await read(async () => product())
  assert.equal(result.stockState, "STOCK_UNKNOWN")
  assert.equal(result.certifiedOos, false)
  assert.equal(result.safeSalesCapacity, null)
})

test("exact product or variant identity mismatch fails closed", async () => {
  const wrongProduct = await read(async () => ({
    ...product({ available: false }), productId: "999999",
  }))
  assert.equal(wrongProduct.stockState, "STOCK_UNKNOWN")
  assert.equal(wrongProduct.sourceStatus, "IDENTITY_MISMATCH")

  const wrongVariant = await read(async () => product({
    id: "999999", available: false,
  }))
  assert.equal(wrongVariant.stockState, "STOCK_UNKNOWN")
  assert.equal(wrongVariant.sourceStatus, "IDENTITY_MISMATCH")
})

test("challenge, login redirect and malformed public responses are never OOS", async () => {
  for (const code of [
    "LUNA_PUBLIC_CLOUDFLARE_CHALLENGE",
    "LUNA_PUBLIC_LOGIN_REQUIRED",
    "LUNA_DIRECTED_IMPORT_RESPONSE_INVALID",
  ]) {
    const result = await read(async () => { throw new Error(code) })
    assert.equal(result.stockState, "STOCK_UNKNOWN")
    assert.equal(result.certifiedOos, false)
    assert.equal(result.safeSalesCapacity, null)
  }
})

test("malformed or conflicting explicit quantity fails closed", async () => {
  for (const variant of [
    { available: true, sourceInventoryQuantity: -1,
      sourceInventoryQuantityExplicit: true },
    { available: false, availabilityMarker: "OUT_OF_STOCK",
      sourceInventoryQuantity: 4, sourceInventoryQuantityExplicit: true },
  ]) {
    const result = await read(async () => product(variant))
    assert.equal(result.stockState, "STOCK_UNKNOWN")
    assert.equal(result.sourceStatus, "MALFORMED_EVIDENCE")
  }
})

test("mandatory exact bundle component OOS zeroes the bundle capacity", async () => {
  const oos = await read(async () => product({ available: false }))
  const capacityUnproven = await read(async () => product({ available: true }))
  const result = evaluateSellerOsLunaPublicExactBundleCapacityV1([
    { componentIdentityId: "backpack", mandatory: true, observation: oos },
    { componentIdentityId: "sunglasses", mandatory: true,
      observation: capacityUnproven },
  ])
  assert.equal(result.bundleStockState, "CERTIFIED_OOS")
  assert.equal(result.safeSalesCapacity, 0)
  assert.equal(result.certifiedOos, true)
  assert.deepEqual(result.limitingComponentIdentityIds, ["backpack"])
})

test("caller cannot provide a URL and uncertified linkage is rejected", async () => {
  const inspect = authority(async () => product({ available: false }))
  await assert.rejects(
    inspect({ linkageId, componentIdentityId, url: "https://attacker.test" }),
    /LUNA_CANONICAL_SERVER_READ_CALLER_INPUT_REJECTED/,
  )
  await assert.rejects(
    inspect({ linkageId: "unknown", componentIdentityId }),
    /LINKAGE_NOT_CERTIFIED/,
  )
})

test("bounded public authority exposes no raw payload, session material, or writes", async () => {
  const result = await read(async () => product({ available: false }))
  assert.equal(result.rawHtmlIncluded, false)
  assert.equal(result.sessionMaterialIncluded, false)
  assert.equal(result.arbitraryUrlAccepted, false)
  assert.equal(result.databaseWrites, 0)
  assert.equal(result.ebayWrites, 0)
  assert.equal(result.lunaWrites, 0)
  assert.equal(JSON.stringify(result).match(/cookie|token|password|rawHtml/gi)?.length, 1)
})
