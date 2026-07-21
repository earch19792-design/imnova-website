import assert from "node:assert/strict"
import test from "node:test"

import { evaluateEbayListingWorkspaceEligibility } from "./ebay-first-luna-opportunity-queue.ts"
import {
  buildDirectedLunaPackRows,
  fetchDirectedLunaProduct,
  normalizeDirectedPackSizes,
  parseDirectedLunaProductUrl,
} from "./ebay-luna-directed-product-import.ts"

const lunaUrl = "https://lunaportex.com/products/lysol-disinfecting-wipes-to-go-pack-lemon-scent?_pos=1"
const sourcePayload = {
  id: 9220829970656,
  title: "Lysol Disinfecting Wipes To-Go Pack, Lemon Scent",
  handle: "lysol-disinfecting-wipes-to-go-pack-lemon-scent",
  vendor: "Luna Warehouse",
  type: "Personal Care",
  variants: [{
    id: 48809640722656,
    title: "Default Title",
    sku: "ITEM3995",
    barcode: "740136480733",
    price: 150,
    compare_at_price: 225,
    available: true,
    grams: 74,
    weight: 74,
    weight_unit: null,
  }],
  images: ["//lunawarehouse.com/cdn/shop/files/example.jpg"],
}

function lunaFetch(payload = sourcePayload, status = 200) {
  return async (url, options) => {
    assert.equal(url, "https://lunaportex.com/products/lysol-disinfecting-wipes-to-go-pack-lemon-scent.js")
    assert.equal(options.method, "GET")
    assert.equal(options.redirect, "manual")
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })
  }
}

test("only accepts canonical Luna HTTPS product URLs and fixed commercial packs", () => {
  assert.equal(parseDirectedLunaProductUrl(lunaUrl).handle, sourcePayload.handle)
  const unicodeHandle = "🧽-safe-product"
  assert.deepEqual(
    parseDirectedLunaProductUrl(
      `https://lunaportex.com/products/${encodeURIComponent(unicodeHandle)}`,
    ),
    {
      handle: unicodeHandle,
      canonicalUrl: `https://lunaportex.com/products/${encodeURIComponent(unicodeHandle)}`,
      jsonUrl: `https://lunaportex.com/products/${encodeURIComponent(unicodeHandle)}.js`,
    },
  )
  for (const unsafe of [
    "http://lunaportex.com/products/example",
    "https://lunaportex.com.attacker.test/products/example",
    "https://lunaportex.com/collections/example",
    "https://lunaportex.com/products/../../admin",
    "https://lunaportex.com/products/%2Fadmin",
    "https://lunaportex.com/products/%00example",
    "https://lunaportex.com/products/%20example",
    "https://lunaportex.com/products/_example",
  ]) {
    assert.throws(() => parseDirectedLunaProductUrl(unsafe), /LUNA_DIRECTED_IMPORT_URL_INVALID/)
  }
  assert.deepEqual(normalizeDirectedPackSizes([12, 3, 6, 3]), [3, 6, 12])
  assert.throws(() => normalizeDirectedPackSizes([1, 3]), /LUNA_DIRECTED_IMPORT_PACKS_INVALID/)
  assert.throws(() => normalizeDirectedPackSizes([]), /LUNA_DIRECTED_IMPORT_PACKS_INVALID/)
})

test("reads the official public product without trusting redirects or malformed identity", async () => {
  const product = await fetchDirectedLunaProduct(lunaUrl, lunaFetch())
  assert.equal(product.productId, "9220829970656")
  assert.equal(product.variants[0].sku, "ITEM3995")
  assert.equal(product.variants[0].sourceUnitPrice, 1.5)
  assert.equal(product.variants[0].sourceCompareAtPrice, 2.25)
  assert.equal(product.variants[0].weight, 74)
  assert.equal(product.variants[0].weightUnit, "g")
  assert.deepEqual(product.imageUrls, [])

  const productWithAuthorizedImages = await fetchDirectedLunaProduct(
    lunaUrl,
    lunaFetch({
      ...sourcePayload,
      images: [
        "https://cdn.shopify.com/s/files/authorized.jpg",
        "https://lunaportex.com/cdn/shop/files/authorized.jpg",
        "https://evilshopify.com/not-authorized.jpg",
      ],
    }),
  )
  assert.deepEqual(productWithAuthorizedImages.imageUrls, [
    "https://cdn.shopify.com/s/files/authorized.jpg",
    "https://lunaportex.com/cdn/shop/files/authorized.jpg",
  ])

  await assert.rejects(
    fetchDirectedLunaProduct(lunaUrl, lunaFetch({ ...sourcePayload, handle: "another-product" })),
    /LUNA_DIRECTED_IMPORT_PRODUCT_INVALID/,
  )
  await assert.rejects(
    fetchDirectedLunaProduct(lunaUrl, lunaFetch({
      ...sourcePayload,
      variants: [{ ...sourcePayload.variants[0], available: undefined }],
    })),
    /LUNA_DIRECTED_IMPORT_VARIANT_REQUIRED/,
  )
})

test("creates distinct 3, 6 and 12 pack rows without inventing GTIN, inventory or demand", async () => {
  const product = await fetchDirectedLunaProduct(lunaUrl, lunaFetch())
  const rows = buildDirectedLunaPackRows({
    product,
    sourceVariantId: "48809640722656",
    packSizes: [3, 6, 12],
    humanConfirmedCommercialPacks: true,
    observedAt: new Date("2026-07-15T12:00:00.000Z"),
  })
  assert.deepEqual(rows.map((row) => row.supplier_price), [4.5, 9, 18])
  assert.equal(new Set(rows.map((row) => row.candidate_key)).size, 3)
  for (const row of rows) {
    assert.equal(row.gtin, null)
    assert.equal(row.supplier_inventory_quantity, null)
    assert.equal(row.opportunity_score, 0)
    assert.equal(row.demand_score, 0)
    assert.equal(row.assessment.identity.exactIdentityConfirmed, false)
    assert.equal(row.assessment.economics.ready, false)
    assert.equal(row.assessment.identity.sourceUnitBarcodeExcludedFromMultipackGtin, true)
    assert.ok(row.hard_gates.includes("NEED_EXACT_PACK_INVENTORY_CONFIRMATION"))
    assert.ok(row.hard_gates.includes("NEED_EBAY_EXACT_IDENTITY_CONFIRMATION"))
    assert.ok(row.hard_gates.includes("NEED_UNIT_ECONOMICS_VALIDATION"))
  }
})

test("directed intake may open Workspace but cannot claim listing readiness", async () => {
  const product = await fetchDirectedLunaProduct(lunaUrl, lunaFetch())
  const [row] = buildDirectedLunaPackRows({
    product,
    sourceVariantId: "48809640722656",
    packSizes: [3],
    humanConfirmedCommercialPacks: true,
  })
  const eligibility = evaluateEbayListingWorkspaceEligibility(row)
  assert.equal(eligibility.allowed, true)
  assert.equal(row.assessment.canProceedToListingPackage, false)
  assert.ok(eligibility.resolvableHardGates.includes("NEED_AUTHORIZED_PRODUCT_IMAGES"))
  assert.ok(eligibility.resolvableHardGates.includes("NEED_EXACT_PACK_INVENTORY_CONFIRMATION"))

  assert.equal(evaluateEbayListingWorkspaceEligibility({
    ...row,
    assessment: { ...row.assessment, sourceVerification: {} },
  }).allowed, false)
})

test("fails closed without explicit human pack confirmation or with unavailable source", async () => {
  const product = await fetchDirectedLunaProduct(lunaUrl, lunaFetch())
  assert.throws(() => buildDirectedLunaPackRows({
    product,
    sourceVariantId: "48809640722656",
    packSizes: [3, 6, 12],
    humanConfirmedCommercialPacks: false,
  }), /LUNA_DIRECTED_IMPORT_HUMAN_CONFIRMATION_REQUIRED/)
  assert.throws(() => buildDirectedLunaPackRows({
    product: { ...product, variants: [{ ...product.variants[0], available: false }] },
    sourceVariantId: "48809640722656",
    packSizes: [3],
    humanConfirmedCommercialPacks: true,
  }), /LUNA_DIRECTED_IMPORT_SOURCE_UNAVAILABLE/)
})
