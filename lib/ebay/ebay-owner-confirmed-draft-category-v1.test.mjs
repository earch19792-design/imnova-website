import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(specifier)) {
    try { return nextResolve(`${specifier}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const { exactCategoryAncestryV1 } = await import(
  "./ebay-package-category-fee-binding-v1.ts")
const { resolveOwnerConfirmedDraftCategoryReceiptV1 } = await import(
  "./ebay-owner-confirmed-draft-category-v1.ts")
const { readEbayUsNoStoreFvfPolicyV1,
  resolveEbayUsNoStoreFvfPolicyV1 } = await import(
  "./ebay-us-no-store-fvf-policy-v1.ts")
const now = new Date("2026-09-23T22:05:00Z")
const path = ["Clothing, Shoes & Accessories", "Men", "Men's Accessories",
  "Sunglasses & Sunglasses Accessories", "Sunglasses"]
const suggestion = { category: { categoryId: "79720", categoryName: "Sunglasses" },
  categoryTreeNodeLevel: 5,
  categoryTreeNodeAncestors: path.slice(0, -1).map((categoryName, index) => ({
    categoryId: ["11450", "1059", "4250", "179239"][index],
    categoryName, categoryTreeNodeLevel: index + 1 })) }
const payload = { categoryTreeId: "0", categoryTreeVersion: "fixture-v1",
  categorySuggestions: [suggestion] }
const official = exactCategoryAncestryV1(payload, "79720", "0", now)
const ownerSelection = {
  source: "OWNER_ACTUAL_EBAY_LISTING_EDITOR_SELECTION",
  ownerSelectedInActualEbayListingEditor: true,
  marketplace: "EBAY_US", marketplaceAccountKey: "exact-account",
  productId: "exact-product", variantId: "exact-variant",
  supplierSku: "ITEM-8058-RED-LU-DE", categoryId: "79720",
  fullCategoryPath: path, selectedAt: "2026-09-23T22:04:00Z",
  listingDraftId: "exact-draft-123", selectionEvidenceId: "editor-receipt-123",
}
const bind = (changes = {}, ancestry = official) =>
  resolveOwnerConfirmedDraftCategoryReceiptV1({
    ownerSelection: { ...ownerSelection, ...changes }, officialAncestry: ancestry,
    marketplaceAccountKey: "exact-account", productId: "exact-product",
    variantId: "exact-variant", supplierSku: "ITEM-8058-RED-LU-DE", now })

test("OWNER editor selection and unique official leaf bind exact account/SKU/path", () => {
  assert.equal(bind()?.status, "OWNER_CONFIRMED")
  assert.equal(bind()?.categoryId, "79720")
  assert.equal(bind()?.source, "OWNER_CONFIRMED_DRAFT_CATEGORY_RECEIPT")
  assert.match(bind()?.receiptDigest ?? "", /^[a-f0-9]{64}$/)
})

test("parent path, fuzzy path, wrong SKU/account and missing editor receipt fail closed", () => {
  assert.equal(bind({ fullCategoryPath: path.slice(0, -1), categoryId: "179239" }), null)
  assert.equal(bind({}, { ...official, leafCategoryTreeNode: false }), null)
  assert.equal(bind({ fullCategoryPath: [...path.slice(0, -1), "Sun Glasses"] }), null)
  assert.equal(bind({ supplierSku: "ITEM5674" }), null)
  assert.equal(bind({ marketplaceAccountKey: "another-account" }), null)
  assert.equal(bind({ selectionEvidenceId: null }), null)
  assert.equal(bind({ ownerSelectedInActualEbayListingEditor: false }), null)
})

test("duplicate official category suggestions and stale taxonomy fail closed", () => {
  assert.equal(exactCategoryAncestryV1({ ...payload,
    categorySuggestions: [suggestion, suggestion] }, "79720", "0", now), null)
  assert.equal(bind({}, { ...official, freshUntil: "2026-09-23T22:04:00Z" }), null)
})

test("exact OWNER receipt enters fee policy only for its own SKU/account", async () => {
  const policy = await readEbayUsNoStoreFvfPolicyV1(now)
  const storeAuthority = { status: "PROVEN",
    source: "EBAY_ACCOUNT_OFFICIAL_READONLY", marketplace: "EBAY_US",
    marketplaceAccountKey: "exact-account", storeTier: "NO_STORE",
    observedAt: "2026-09-23T22:04:00Z",
    freshUntil: "2026-09-23T23:04:00Z" }
  const input = { accountKey: "exact-account", categoryId: "79720",
    categoryAuthority: bind(), productId: "exact-product",
    variantId: "exact-variant", supplierSku: "ITEM-8058-RED-LU-DE",
    storeAuthority, policy, now }
  const accepted = resolveEbayUsNoStoreFvfPolicyV1(input)
  assert.equal(accepted.status, "PROVEN")
  assert.equal(accepted.categoryBindingStatus, "OWNER_CONFIRMED")
  assert.equal(accepted.ruleId, "MOST_CATEGORIES")
  const wrongSku = resolveEbayUsNoStoreFvfPolicyV1({ ...input,
    supplierSku: "ITEM5674" })
  assert.equal(wrongSku.status, "MISSING")
  const tampered = resolveEbayUsNoStoreFvfPolicyV1({ ...input,
    categoryAuthority: { ...bind(), receiptDigest: "0".repeat(64) } })
  assert.equal(tampered.status, "MISSING")
})
