import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
  compareEbayInventoryItemReadbackV1,
  compareEbayOfferReadbackV1,
} = await import("./ebay-publisher-semantic-readback-v1.ts")

const gatewaySource = readFileSync(new URL(
  "./ebay-draft-only-gateway.ts",
  import.meta.url,
), "utf8")
const routeSource = readFileSync(new URL(
  "../../app/api/admin/ebay/draft-only/route.ts",
  import.meta.url,
), "utf8")
const workspaceSource = readFileSync(new URL(
  "../../app/admin/ebay/listing-workspace/page.tsx",
  import.meta.url,
), "utf8")

const authorizedOffer = {
  sku: "IMNOVA-PACKAGE",
  marketplaceId: "EBAY_US",
  format: "FIXED_PRICE",
  availableQuantity: 1,
  categoryId: "20664",
  merchantLocationKey: "canonical-location",
  listingPolicies: {
    fulfillmentPolicyId: "FULFILLMENT",
    paymentPolicyId: "PAYMENT",
    returnPolicyId: "RETURN",
  },
  pricingSummary: { price: { currency: "USD", value: "37.90" } },
}

test("eBay decimal formatting and server readback metadata are equivalent", () => {
  const comparison = compareEbayOfferReadbackV1({
    ...authorizedOffer,
    pricingSummary: { price: { currency: "USD", value: "37.9" } },
    offerId: "256435635011",
    status: "UNPUBLISHED",
  }, authorizedOffer)
  assert.equal(comparison.equivalent, true)
  assert.deepEqual(comparison.materialMismatchFields, [])
  assert.ok(comparison.normalizationRulesApplied.includes("NUMERIC_NORMALIZATION"))
  assert.ok(comparison.normalizationRulesApplied.includes(
    "DEFAULT_VALUE_INSERTED_BY_EBAY",
  ))
})

test("optional empty authorized values may be omitted but not populated", () => {
  const omitted = compareEbayOfferReadbackV1(
    authorizedOffer,
    { ...authorizedOffer, tax: {} },
  )
  assert.equal(omitted.equivalent, true)
  assert.ok(omitted.normalizationRulesApplied.includes("OPTIONAL_EMPTY_OMITTED"))

  const populated = compareEbayOfferReadbackV1(
    { ...authorizedOffer, tax: { applyTax: true } },
    { ...authorizedOffer, tax: {} },
  )
  assert.equal(populated.equivalent, false)
  assert.deepEqual(populated.materialMismatchFields, ["$.tax.applyTax"])
})

test("unordered aspect values match but authorized image order remains exact", () => {
  const aspects = compareEbayInventoryItemReadbackV1({
    product: { aspects: { Features: ["B", "A"] } },
  }, {
    product: { aspects: { Features: ["A", "B"] } },
  })
  assert.equal(aspects.equivalent, true)
  assert.ok(aspects.normalizationRulesApplied.includes("ORDERING_ONLY"))

  const images = compareEbayInventoryItemReadbackV1({
    product: { imageUrls: ["https://img.test/two", "https://img.test/one"] },
  }, {
    product: { imageUrls: ["https://img.test/one", "https://img.test/two"] },
  })
  assert.equal(images.equivalent, false)
  assert.deepEqual(images.materialMismatchFields, [
    "$.product.imageUrls[0]",
    "$.product.imageUrls[1]",
  ])
})

test("all commercial identity fields remain fail closed", () => {
  const mutations = [
    ["sku", "OTHER"],
    ["marketplaceId", "EBAY_GB"],
    ["format", "AUCTION"],
    ["availableQuantity", 2],
    ["categoryId", "539"],
    ["merchantLocationKey", "other-location"],
  ]
  for (const [field, value] of mutations) {
    const comparison = compareEbayOfferReadbackV1(
      { ...authorizedOffer, [field]: value },
      authorizedOffer,
    )
    assert.equal(comparison.equivalent, false, String(field))
    assert.ok(comparison.materialMismatchFields.includes(`$.${field}`), String(field))
  }

  for (const field of ["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"]) {
    const comparison = compareEbayOfferReadbackV1({
      ...authorizedOffer,
      listingPolicies: { ...authorizedOffer.listingPolicies, [field]: "OTHER" },
    }, authorizedOffer)
    assert.equal(comparison.equivalent, false, field)
    assert.ok(comparison.materialMismatchFields.includes(`$.listingPolicies.${field}`))
  }

  const price = compareEbayOfferReadbackV1({
    ...authorizedOffer,
    pricingSummary: { price: { currency: "USD", value: "38.90" } },
  }, authorizedOffer)
  assert.equal(price.equivalent, false)
  assert.deepEqual(price.materialMismatchFields, ["$.pricingSummary.price.value"])

  const condition = compareEbayInventoryItemReadbackV1(
    { condition: "USED_GOOD" },
    { condition: "NEW" },
  )
  assert.equal(condition.equivalent, false)
  assert.deepEqual(condition.materialMismatchFields, ["$.condition"])
})

test("outcome-unknown readback exposes a structured owner truth contract", () => {
  assert.match(routeSource,
    /\["completed", "offer_create_in_flight", "offer_outcome_unknown"\]/)
  for (const field of [
    "stage",
    "errorClass",
    "ebayErrorIds",
    "mismatchFields",
    "retrySafety",
    "offerId",
    "itemId",
    "officialCurrentState",
    "ownerActionState",
  ]) assert.match(routeSource, new RegExp(`${field}:`), field)
  for (const state of [
    "SAFE_TO_RETRY",
    "WAITING_FOR_READBACK",
    "AMBIGUOUS_FAIL_CLOSED",
  ]) assert.match(workspaceSource, new RegExp(state), state)
})

test("one-shot publish ambiguity remains GET-only and never retries POST", () => {
  const start = gatewaySource.indexOf("export async function publishEbayOfferOnce")
  const end = gatewaySource.indexOf("export function ebayDraftOnlyRuntimeStatus", start)
  const publish = gatewaySource.slice(start, end)
  assert.equal((publish.match(/method: "POST"/g) ?? []).length, 1)
  assert.match(publish, /GET_ONLY_RECONCILIATION_REQUIRED/)
  assert.match(publish, /FINAL_OFFICIAL_ACTIVE_READBACK/)
  assert.match(routeSource, /fail_ebay_authorized_listing_publication/)
  assert.match(routeSource, /p_error_details: record\(publishResult\.body\)/)
})

test("systemic contract contains no product, package, offer, or SKU special case", () => {
  const sources = `${gatewaySource}\n${routeSource}\n${workspaceSource}`
  assert.doesNotMatch(sources, /Alibaba-StoneDish-Mat-B0CKYYSYWL/)
  assert.doesNotMatch(sources, /2d1b0b04-b4bc-43db-894a-56920bcbfb0f/)
  assert.doesNotMatch(sources, /256435635011/)
  assert.doesNotMatch(sources, /aec429a08199b22c0790ff1fd2092c55948ab0171a173e2413820391e09d790b/)
})
