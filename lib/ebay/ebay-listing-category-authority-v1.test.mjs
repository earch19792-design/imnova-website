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
const { createEbayListingCategoryReceiptV1,
  reconcileEbayListingCategoryReceiptV1,
  readEbayListingCategoryAuthorityV1 } = await import(
  "./ebay-listing-category-authority-v1.ts")
const { readEbayUsNoStoreFvfPolicyV1,
  resolveEbayUsNoStoreFvfPolicyV1 } = await import(
  "./ebay-us-no-store-fvf-policy-v1.ts")

const now = new Date("2026-09-23T22:40:00Z")
const account = "imnova-ebay-us-primary:cd8fd3dc2b4102d4aff320268c647fa895c6416df01013f9bb06b3a587709e12"
const identity = { accountKey: account, sku: "FUTURE-A",
  productId: "product-a", variantId: "variant-a", categoryId: "100" }
const selection = (id = identity, selectedAt = "2026-09-23T22:39:00Z") => ({
  source: "OWNER_SELLER_OS_PACKAGE_SELECTION",
  ...id, sourceId: "package-12345678", actorUserId: "owner-user-1234",
  selectedAt,
})
const reordered = (value) => Array.isArray(value) ? value.map(reordered)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse()
      .map(([key, item]) => [key, reordered(item)])) : value
function ancestry(id, names, ancestorIds) {
  const categorySuggestions = [{
    category: { categoryId: id, categoryName: names.at(-1) },
    categoryTreeNodeLevel: names.length,
    categoryTreeNodeAncestors: names.slice(0, -1).map((categoryName, i) => ({
      categoryId: ancestorIds[i], categoryName,
      categoryTreeNodeLevel: i + 1,
    })),
  }]
  return exactCategoryAncestryV1({ categoryTreeId: "0",
    categoryTreeVersion: "fixture-tree-v1", categorySuggestions }, id, "0", now)
}

test("future SKU A: exact owner selection and official leaf yield durable MOST_CATEGORIES receipt", async () => {
  const official = ancestry("100", ["Home & Garden", "Home Décor", "Frames"],
    ["1", "2"])
  const receipt = createEbayListingCategoryReceiptV1({ identity,
    selection: selection(), officialAncestry: official, now })
  assert.equal(receipt?.status, "PROVEN")
  assert.equal(receipt?.leafStatus, "SELECTABLE_LEAF")
  assert.equal(receipt?.categoryPath, "Home & Garden:Home Décor:Frames")
  const stored = reconcileEbayListingCategoryReceiptV1({ categoryId: "100" },
    receipt)
  assert.deepEqual(reconcileEbayListingCategoryReceiptV1(stored, receipt), stored)
  const read = readEbayListingCategoryAuthorityV1({ packageData: stored,
    identity, now, currentTreeVersion: "fixture-tree-v1" })
  assert.equal(read.status, "PROVEN")
  assert.equal(readEbayListingCategoryAuthorityV1({
    packageData: reordered(stored), identity, now,
    currentTreeVersion: "fixture-tree-v1" }).status, "PROVEN")
  const policy = await readEbayUsNoStoreFvfPolicyV1(now)
  assert.equal(resolveEbayUsNoStoreFvfPolicyV1({ accountKey: identity.accountKey,
    categoryId: identity.categoryId,
    categoryAuthority: read.receipt.officialAncestry,
    policy, now }).ruleId, "MOST_CATEGORIES")
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: stored,
    identity: { ...identity, sku: "WRONG" }, now }).status, "CONTRADICTED")
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: stored,
    identity: { ...identity, accountKey: "WRONG" }, now }).status,
  "CONTRADICTED")
})

test("future SKU B: exact exception leaf maps to category exception", async () => {
  const second = { accountKey: account, sku: "FUTURE-B",
    productId: "product-b", variantId: "variant-b", categoryId: "200" }
  const official = ancestry("200", ["Books & Magazines", "Books"], ["10"])
  const receipt = createEbayListingCategoryReceiptV1({ identity: second,
    selection: selection(second), officialAncestry: official, now })
  const read = readEbayListingCategoryAuthorityV1({
    packageData: reconcileEbayListingCategoryReceiptV1({ categoryId: "200" },
      receipt), identity: second, now })
  const policy = await readEbayUsNoStoreFvfPolicyV1(now)
  assert.equal(resolveEbayUsNoStoreFvfPolicyV1({ accountKey: second.accountKey,
    categoryId: second.categoryId,
    categoryAuthority: read.receipt.officialAncestry,
    policy, now }).ruleId, "BOOKS_MOVIES_MUSIC")
})

test("future SKU C: parent-only, fuzzy path and recommendation do not bind", () => {
  const official = ancestry("100", ["Home & Garden", "Home Décor", "Frames"],
    ["1", "2"])
  assert.equal(createEbayListingCategoryReceiptV1({ identity,
    selection: selection(), officialAncestry: {
      ...official, leafCategoryTreeNode: false }, now }), null)
  assert.equal(createEbayListingCategoryReceiptV1({ identity,
    selection: { ...selection(), categoryPath: "Home & Garden:Almost Frames" },
    officialAncestry: official, now }), null)
  assert.equal(createEbayListingCategoryReceiptV1({ identity,
    selection: { ...selection(), source: "MARKET_RECOMMENDATION" },
    officialAncestry: official, now }), null)
})

test("changed category supersedes history; stale tree cannot authorize", () => {
  const firstOfficial = ancestry("100", ["Home & Garden", "Home Décor", "Frames"],
    ["1", "2"])
  const first = createEbayListingCategoryReceiptV1({ identity,
    selection: selection(), officialAncestry: firstOfficial, now })
  const firstData = reconcileEbayListingCategoryReceiptV1({ categoryId: "100" },
    first)
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: firstData,
    identity, now, currentTreeVersion: "new-tree" }).status, "STALE")
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: firstData,
    identity, now: new Date("2026-09-24T05:00:00Z") }).status, "STALE")
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: {
    ...firstData, categoryId: "200" }, identity, now }).status, "CONTRADICTED")
  const nextIdentity = { ...identity, categoryId: "200" }
  const next = createEbayListingCategoryReceiptV1({ identity: nextIdentity,
    selection: selection(nextIdentity, "2026-09-23T22:39:30Z"),
    officialAncestry: ancestry("200", ["Books & Magazines", "Books"],
      ["10"]), now })
  const changed = reconcileEbayListingCategoryReceiptV1({ ...firstData,
    categoryId: "200" }, next)
  assert.equal(changed.categoryAuthorityV1.history.length, 1)
  assert.equal(changed.categoryAuthorityV1.history[0].status, "SUPERSEDED")
  assert.equal(changed.categoryAuthorityV1.history[0].receiptId,
    first.receiptId)
  assert.equal(readEbayListingCategoryAuthorityV1({ packageData: changed,
    identity: nextIdentity, now }).status, "PROVEN")
})
