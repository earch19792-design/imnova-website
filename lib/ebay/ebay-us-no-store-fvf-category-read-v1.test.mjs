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

const { readEbayUsNoStoreFvfCategoryV1 } = await import(
  "./ebay-us-no-store-fvf-category-read-v1.ts")
const now = new Date("2026-09-23T20:30:00Z")
const valid = { categoryTreeId: "0", categoryTreeVersion: "123",
  categorySuggestions: [{ category: { categoryId: "998001",
    categoryName: "Fixture Leaf" }, categoryTreeNodeLevel: 3,
  categoryTreeNodeAncestors: [
    { categoryId: "998002", categoryName: "Fixture Root",
      categoryTreeNodeLevel: 1 },
    { categoryId: "998003", categoryName: "Fixture Branch",
      categoryTreeNodeLevel: 2 },
  ] }] }
function probe(payload = valid) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options.method })
    const data = String(url).includes("get_default_category_tree_id")
      ? { categoryTreeId: "0", categoryTreeVersion: "123" } : payload
    return { ok: true, headers: { get: () => null },
      text: async () => JSON.stringify(data) }
  }
  return { calls, read: readEbayUsNoStoreFvfCategoryV1({
    categoryId: "998001", query: "Synthetic fixture", now,
    tokenReader: async () => "synthetic-token", fetchImpl }) }
}

test("new candidate reads only exact official category path without a package", async () => {
  const input = probe(), result = await input.read
  assert.equal(result.status, "PROVEN")
  assert.equal(result.categoryId, "998001")
  assert.equal(result.path, "Fixture Root:Fixture Branch:Fixture Leaf")
  assert.equal(input.calls.length, 2)
  assert.ok(input.calls.every((call) => call.method === "GET"))
  assert.ok(input.calls.every((call) =>
    call.url.startsWith("https://api.ebay.com/commerce/taxonomy/v1/")))
})

test("wrong ID, mismatched tree version and missing category fail closed", async () => {
  assert.equal(await probe({ ...valid, categoryTreeVersion: "124" }).read, null)
  assert.equal(await probe({ ...valid,
    categorySuggestions: [{ ...valid.categorySuggestions[0],
      category: { categoryId: "other", categoryName: "Fixture Leaf" } }] }).read, null)
  assert.equal(await readEbayUsNoStoreFvfCategoryV1({ categoryId: null,
    query: "perfume", tokenReader: async () => {
      throw Error("TOKEN_SHOULD_NOT_BE_READ")
    } }), null)
})
