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

const {
  normalizeLunaQuickPickUrlsV1,
  resolveLunaQuickPickInputV1,
} = await import("./ebay-luna-quick-pick-v1.ts")

const url = "https://www.lunaportex.com/products/test-product"

function row(variantId, sku, available = true) {
  return {
    product_id: "100",
    supplier_product_id: "100",
    supplier_variant_id: variantId,
    sku,
    title: "Exact test product",
    variant_title: `Variant ${variantId}`,
    product_type: "home kitchen",
    tags: [], metadata: {}, price: 12.5,
    available, inventory_quantity: available ? 4 : 0,
    product_url: url, image_urls: [], barcode: null,
    captured_at: "2026-08-31T12:00:00.000Z",
  }
}

test("canonicalizes duplicate multiline input and preserves distinct variants", () => {
  assert.deepEqual(normalizeLunaQuickPickUrlsV1(`${url}\n${url}/\n${url}?variant=2`),
    [url, `${url}?variant=2`])
})

test("rejects malformed Luna input at the canonical normalization boundary", () => {
  assert.throws(() => normalizeLunaQuickPickUrlsV1(`${url}\nhttps://example.com/x`),
    /LUNA_QUICK_PICK_URL_INVALID/)
})

test("requires a selector when multiple eligible variants lack exact intent", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")] })
  assert.equal(result.selected, null)
  assert.equal(result.blocker, "LUNA_QUICK_PICK_VARIANT_SELECTION_REQUIRED")
  assert.equal(result.variants.length, 2)
})

test("cross-checks an explicit URL variant and never picks the first row", async () => {
  const result = await resolveLunaQuickPickInputV1({
    sourceUrl: `${url}?variant=2`,
    catalogRows: [row("1", "SKU1"), row("2", "SKU2")],
  })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.selected?.supplierSku, "SKU2")
  assert.equal(result.blocker, null)
})

test("auto-selects the sole eligible variant while preserving unavailable choices", async () => {
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [row("1", "SKU1", false), row("2", "SKU2", true)] })
  assert.equal(result.selected?.lunaVariantId, "2")
  assert.equal(result.variants.length, 2)
})

test("preserves canonical available stock when quantity is not explicitly supplied", async () => {
  const exact = row("53002139205856", "FL-NHPF3369737")
  exact.inventory_quantity = null
  const result = await resolveLunaQuickPickInputV1({ sourceUrl: url,
    catalogRows: [exact] })
  assert.equal(result.selected?.available, true)
})

test("Quick Pick remains a shared-factory feeder with bounded AI and no publish path", async () => {
  const source = await readFile(new URL("./ebay-luna-quick-pick-v1.ts", import.meta.url), "utf8")
  const route = await readFile(new URL("../../app/api/admin/ebay/luna-quick-pick/route.ts",
    import.meta.url), "utf8")
  const page = await readFile(new URL("../../app/admin/ebay/quick-pick/page.tsx",
    import.meta.url), "utf8")
  assert.match(source, /readAlreadyLiveExactLunaIdentitiesV1/)
  assert.ok(source.indexOf("readAlreadyLiveExactLunaIdentitiesV1") <
    source.indexOf("buildRadarRevenueFactoryCandidateBatchV1({\n    radarPayload"))
  assert.match(source, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(source, /requiredSpecificsAiStages: \["TEXT"\]/)
  assert.match(source, /boundedConcurrency: LUNA_QUICK_PICK_CONCURRENCY/)
  assert.match(source, /EXCLUDED_DUPLICATE_INPUT/)
  assert.match(source, /LUNA_QUICK_PICK_CANONICAL_STOCK_NOT_READY/)
  assert.match(source, /resolutionAttempts\.flatMap/)
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
  assert.match(page, /window\.setInterval\(\(\) => void poll\(\), 2_000\)/)
  assert.match(page, /PUBLICAR EN EBAY/)
  assert.match(page, /listing-workspace\?opportunity=/)
})
