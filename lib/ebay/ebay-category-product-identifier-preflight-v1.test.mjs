import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const {
  evaluateEbayCategoryProductIdentifierPreflightV1,
} = await import("./ebay-category-product-identifier-preflight-v1.ts")

function policy(overrides = {}) {
  return {
    categoryPolicies: [{
      categoryId: "94861",
      upcSupport: "REQUIRED",
      eanSupport: "DISABLED",
      isbnSupport: "DISABLED",
      ...overrides,
    }],
  }
}

function evaluate(policyResponse, product = {}) {
  return evaluateEbayCategoryProductIdentifierPreflightV1({
    marketplaceId: "EBAY_US",
    categoryId: "94861",
    policyResponse,
    inventoryItemPayload: { product },
  })
}

test("category 94861 blocks before write when official Metadata requires UPC", () => {
  const result = evaluate(policy())
  assert.equal(result.safe, false)
  assert.equal(result.blocker, "EBAY_CATEGORY_REQUIRED_UPC_MISSING")
  assert.deepEqual(result.missingRequiredIdentifiers, ["UPC"])
  assert.equal(result.source, "EBAY_METADATA_GET_CATEGORY_POLICIES_READONLY")
})

test("an explicitly projected identifier satisfies the matching required field", () => {
  const result = evaluate(policy(), { upc: ["Does not apply"] })
  assert.equal(result.safe, true)
  assert.equal(result.blocker, null)
  assert.deepEqual(result.missingRequiredIdentifiers, [])
})

test("a category that does not require GTIN passes without identifiers", () => {
  const result = evaluate(policy({
    upcSupport: "DISABLED",
    eanSupport: "DISABLED",
    isbnSupport: "DISABLED",
  }))
  assert.equal(result.safe, true)
  assert.deepEqual(result.missingRequiredIdentifiers, [])
})

test("missing or partial official category policy fails closed", () => {
  assert.equal(evaluate({ categoryPolicies: [] }).safe, false)
  const partial = evaluate(policy({ isbnSupport: undefined }))
  assert.equal(partial.safe, false)
  assert.equal(
    partial.blocker,
    "EBAY_CATEGORY_PRODUCT_IDENTIFIER_POLICY_UNAVAILABLE",
  )
})

test("the preflight runs before Inventory, Offer, and publishOffer writes", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts",
    "utf8",
  )
  const executeStart = route.indexOf("async function executeDraft")
  const executeEnd = route.indexOf(
    "async function compensateFinalPublicationAttachmentFailure",
    executeStart,
  )
  const execute = route.slice(executeStart, executeEnd)
  const publishStart = route.indexOf("async function publishFinalPublication")
  const publishEnd = route.indexOf(
    "async function rearmFinalPublication",
    publishStart,
  )
  const publish = route.slice(publishStart, publishEnd)
  assert.ok(
    execute.indexOf("readCategoryProductIdentifierPreflight(currentPayload)")
      < execute.indexOf("createOrReplaceEbayDraftInventoryItem"),
  )
  assert.ok(
    execute.indexOf("readCategoryProductIdentifierPreflight(currentPayload)")
      < execute.indexOf("createEbayUnpublishedOffer"),
  )
  assert.ok(
    publish.indexOf("readCategoryProductIdentifierPreflight(approvedPayload)")
      < publish.indexOf("claim_ebay_authorized_listing_publication"),
  )
  assert.ok(
    publish.indexOf("readCategoryProductIdentifierPreflight(approvedPayload)")
      < publish.indexOf("publishEbayOfferOnce"),
  )
})

test("the official rejected-offer reconciliation remains GET-only", () => {
  const route = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts",
    "utf8",
  )
  const start = route.indexOf(
    "async function readRejectedPublishOfficialReadback",
  )
  const end = route.indexOf("function buildFinalPublicationPreview", start)
  const helper = route.slice(start, end)
  assert.match(helper, /verifyEbayDraftInventoryItem/)
  assert.match(helper, /verifyEbayUnpublishedOffer/)
  assert.match(helper, /verifyEbayPublishedOffer/)
  assert.match(helper, /inspectEbayDraftSkuState/)
  assert.doesNotMatch(
    helper,
    /publishEbayOfferOnce|createEbayUnpublishedOffer|createOrReplaceEbayDraftInventoryItem|\.insert\(|\.update\(|\.delete\(/,
  )
})
