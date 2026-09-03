import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
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

const module = await import(
  "./ebay-luna-quick-pick-visual-top-seller-enrichment-v1.ts")

test("market comparables retain commercial signals and sanitize seller provenance", () => {
  const result = module.quickPickMarketComparableToVisualCandidateV1({
    comparableId: "123456789012", title: "Wireless microphone",
    sellerUsername: "seller-name", imageUrl:
      "https://i.ebayimg.com/images/g/example/s-l1600.jpg",
    categoryId: "29946", estimatedSoldQuantity: 30,
    itemOriginDate: "2026-08-03T00:00:00.000Z",
    localizedAspects: [{ name: "Type", value: "Lavalier Microphone" }],
  }, "2026-09-02T00:00:00.000Z")
  assert.equal(result.itemId, "123456789012")
  assert.equal(result.soldVolume, 30)
  assert.equal(result.salesVelocity, 30)
  assert.match(result.sellerReference, /^sha256:[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(result).includes("seller-name"), false)
})

test("the systemic continuation reuses the existing queue and avoids SKU/batch exceptions", async () => {
  const source = await readFile(new URL(
    "./ebay-luna-quick-pick-visual-top-seller-enrichment-v1.ts",
    import.meta.url), "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-quick-pick/route.ts",
    import.meta.url), "utf8")
  assert.match(source, /ebay_luna_opportunity_queue/)
  assert.match(source, /marketplaceRequiredSpecificsBatchResolutionV1/)
  assert.match(source, /EXACT_PRODUCT_VISUAL_MATCHING/)
  assert.match(source, /maximumMarketLookupsPerProduct: 1/)
  assert.match(source, /store: false/)
  assert.match(source, /newOperationCount: 0/)
  assert.doesNotMatch(source, /ITEM3177|ITEM3355|ITEM3499/)
  assert.doesNotMatch(source, /GetSellerList|GetMyeBaySelling/)
  assert.doesNotMatch(source, /insert\([^)]*ebay_luna_opportunity_queue/)
  assert.match(route, /continueLunaQuickPickVisualTopSellerEnrichmentV1/)
  assert.ok(route.indexOf("continueLunaQuickPickExactSoldEnrichmentV1({") <
    route.indexOf("continueLunaQuickPickVisualTopSellerEnrichmentV1({"))
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
})
