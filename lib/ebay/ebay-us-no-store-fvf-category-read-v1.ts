import { getEbayBaseApplicationTokenV1 } from "./ebay-seller-keyword-demand-gateway"
import { exactCategoryAncestryV1 } from "./ebay-package-category-fee-binding-v1"

/** Exact-ID Taxonomy read for a new candidate; an unrelated suggestion never
 * supplies a category path. Two GETs, bounded responses, no offer/package. */
export async function readEbayUsNoStoreFvfCategoryV1(input: Readonly<{
  categoryId: string | null; query: string; now?: Date
  tokenReader?: typeof getEbayBaseApplicationTokenV1
  fetchImpl?: typeof fetch
}>) {
  if (!input.categoryId || !/^\d{1,20}$/.test(input.categoryId) ||
      !input.query.trim()) return null
  const token = await (input.tokenReader ?? getEbayBaseApplicationTokenV1)()
  const read = async (url: URL) => {
    if (url.origin !== "https://api.ebay.com" ||
        !url.pathname.startsWith("/commerce/taxonomy/v1/")) return null
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET", headers: { Authorization: `Bearer ${token}`,
        "Accept-Language": "en-US" }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok || Number(response.headers.get("content-length")) > 500_000) return null
    const body = await response.text()
    return body.length <= 500_000 ? JSON.parse(body) : null
  }
  const root = new URL("https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id")
  root.searchParams.set("marketplace_id", "EBAY_US")
  const tree = await read(root)
  if (!tree || !/^\d{1,10}$/.test(String(tree.categoryTreeId)) ||
      !tree.categoryTreeVersion) return null
  const suggestions = new URL(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions`)
  suggestions.searchParams.set("q", input.query.trim().slice(0, 350))
  const result = await read(suggestions)
  return result?.categoryTreeVersion === tree.categoryTreeVersion
    ? exactCategoryAncestryV1(result, input.categoryId,
    String(tree.categoryTreeId), input.now ?? new Date()) : null
}
