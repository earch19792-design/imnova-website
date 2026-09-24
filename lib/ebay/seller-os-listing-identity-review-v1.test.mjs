import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {}
  }
  return nextResolve(specifier, context)
} })

const { buildListingIdentityReviewQueueV1 } = await import(
  "./seller-os-listing-identity-review-v1.ts")

function listing(itemId, label, status, origin = "IMPORTED_LEGACY") {
  return { case_id: itemId, ebay_item_id: itemId,
    ebay_custom_label: label, ebay_title: "Official current title",
    identity_status: status, origin }
}

test("duplicate live Custom Labels stay blocked even when one has a canonical authority", () => {
  const queue = buildListingIdentityReviewQueueV1({
    cases: [{ ...listing("366666581320", "IMN-LST-000027", "DUPLICATE_IDENTITY"),
      luna_product_id: "9220815749344", luna_variant_id: "48809620930784",
      supplier_sku: "ITEM5195", opportunity_id: null,
      identity_source: "STOCKGUARD_LINK_AUTHORITY_AND_OFFICIAL_EBAY" },
      listing("366672502737", "IMN-LST-000027", "DUPLICATE_IDENTITY")],
    catalog: [], decisions: [], packages: [], opportunities: [],
  })
  assert.equal(queue.length, 2)
  assert.equal(queue.every((row) => row.classification === "DUPLICATE"), true)
  assert.deepEqual(queue[0].conflictingItemIds, ["366672502737"])
  assert.equal(queue[0].candidates[0].source,
    "STOCKGUARD_LINK_AUTHORITY_AND_OFFICIAL_EBAY")
})

test("exact catalog and package lineage remain a guarded candidate until linked", () => {
  const queue = buildListingIdentityReviewQueueV1({
    cases: [listing("366672504715", "IMNOVAA992EE275EB640A2A74E771D79B3FE6C",
      "MISSING_LUNA_IDENTITY")],
    catalog: [{ product_id: "9220840980704", variant_id: "48809652846816",
      sku: "FL-2PACK-OVEN-LINERS", preflight_status: "PREFLIGHT_PASS" }],
    decisions: [],
    packages: [{ id: "a992ee27-5eb6-40a2-a74e-771d79b3fe6c",
      opportunity_id: "opportunity", candidate_key: "luna-portex:9220840980704:48809652846816" }],
    opportunities: [{ id: "opportunity",
      candidate_key: "luna-portex:9220840980704:48809652846816",
      supplier_product_id: "9220840980704", supplier_variant_id: "48809652846816",
      supplier_sku: "FL-2PACK-OVEN-LINERS" }],
  })
  assert.equal(queue[0].classification, "NEEDS_OWNER_REVIEW")
  assert.equal(queue[0].reasonCode, "EXACT_CANDIDATE_REQUIRES_GUARDED_LINK")
  assert.equal(queue[0].candidates[0].opportunityId, "opportunity")
})

test("missing label and unproven Luna source do not become fabricated links", () => {
  const queue = buildListingIdentityReviewQueueV1({
    cases: [listing("366672501251", null, "MISSING_LUNA_IDENTITY"),
      listing("366685490525", "FL-DRAIN-BUCKET", "MISSING_LUNA_IDENTITY")],
    catalog: [], decisions: [], packages: [], opportunities: [],
  })
  assert.deepEqual(queue.map((row) => row.classification),
    ["SOURCE_MISSING", "SOURCE_MISSING"])
  assert.equal(queue.every((row) => row.candidates.length === 0), true)
})

test("unique direct supplier SKU exposes its canonical opportunity without linking", () => {
  const queue = buildListingIdentityReviewQueueV1({
    cases: [listing("366687725313", "ITEM-8058-RED-LU-DE", "MISSING_LUNA_IDENTITY")],
    catalog: [{ product_id: "10211942072544", variant_id: "54943494865120",
      sku: "ITEM-8058-RED-LU-DE", preflight_status: "PREFLIGHT_PASS" }],
    decisions: [], packages: [],
    opportunities: [{ id: "ad6671f6-81b1-4d76-a1fd-a3f6408e8842",
      candidate_key: "luna-portex:10211942072544:54943494865120",
      supplier_product_id: "10211942072544", supplier_variant_id: "54943494865120",
      supplier_sku: "ITEM-8058-RED-LU-DE" }],
  })
  assert.equal(queue[0].candidates[0].opportunityId,
    "ad6671f6-81b1-4d76-a1fd-a3f6408e8842")
  assert.equal(queue[0].classification, "NEEDS_OWNER_REVIEW")
})
