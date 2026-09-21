import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
registerHooks({ resolve(s, c, next) {
  if (s.startsWith(".") && !/\.(ts|mjs|js|json)$/.test(s)) {
    try { return next(`${s}.ts`, c) } catch { /* normal resolution below */ }
  }
  return next(s, c)
} })
const { prepareCurrentPackageRequiredAspectsV1 } = await import("./current-package-required-aspects-v1.ts")
function fixture() {
  const packageId = "8a4fdc9d-e99f-4faf-9a81-464db8d54165"
  const opportunityId = "28c92290-58c7-4c25-80e5-202b68a3c1cf"
  const candidateKey = "luna-portex:100:200"
  const title = "CFS Replacement Water Filters 7pk For Watts Premier WPRL-58"
  const aspects = ["Brand", "Model", "Compatible Model"].map(name => ({ name,
    required: true, mode: "FREE_TEXT", cardinality: "SINGLE", dataType: "STRING",
    usage: "RECOMMENDED", values: [], suggestedValues: [], valuesComplete: true, constraintsComplete: true }))
  return { accountKey: "account", now: new Date("2026-09-21T05:00:00Z"),
    listingPackage: { id: packageId, account_key: "account", opportunity_id: opportunityId,
      candidate_key: candidateKey, status: "draft", readiness: 0, package_data: {
        currentPublicationFactoryV1: { version: "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1", packageId,
          accountKey: "account", generation: "generation", productId: "100", variantId: "200", supplierSku: "sku",
          authorityPolicy: "CURRENT_ONLY", reuseLegacyPreparation: false, publicationAuthorized: false },
        pricing: { status: "WAITING_ON_PRICING", targetPrice: null }, economics: { status: "WAITING_ON_PRICING" },
        productTruth: { fieldTruthV1: { evidenceDigest: "original-immutable-receipt" } }, aspects: {},
      } },
    opportunity: { id: opportunityId, candidate_key: candidateKey, supplier_product_id: "100",
      supplier_variant_id: "200", supplier_sku: "sku", product_title: title, assessment: { productTruth: { title } } },
    catalogRow: { supplier_product_id: "100", supplier_variant_id: "200", sku: "sku", title,
      body_html: "", captured_at: "2026-09-21T04:00:00Z", image_urls: [] },
    taxonomy: { status: "AVAILABLE", source: "EBAY_TAXONOMY_OFFICIAL_READONLY", categoryResolution: "KNOWN_CATEGORY",
      categoryId: "20684", categoryName: "Water Filters", categoryTreeId: "0", categoryTreeVersion: "134",
      taxonomyMarketplaceId: "EBAY_US", observedAt: "2026-09-21T04:00:00Z", aspects, requiredAspects: aspects },
  }
}
test("official category/aspect binding preserves commercial hold and truth provenance", () => {
  const f = fixture()
  const before = structuredClone(f)
  const p = prepareCurrentPackageRequiredAspectsV1(f)
  assert.deepEqual(f, before)
  assert.equal(p.categoryId, "20684")
  assert.deepEqual(p.aspects, { "Compatible Model": "Watts Premier WPRL-58" })
  const receipt = p.productTruth.sourceEvidence.requiredItemSpecificsTruthV1
  assert.equal(receipt.exactIdentity, true)
  assert.match(receipt.evidenceDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(receipt.resolutions["Compatible Model"].semanticClass, "SUPPLIER_CLAIM")
  assert.equal(receipt.resolutions["Compatible Model"].sourceExcerpt, "For Watts Premier WPRL-58")
  assert.equal(receipt.resolutions.Brand.value, null)
  assert.equal(receipt.resolutions.Model.value, null)
  assert.deepEqual(p.pricing, before.listingPackage.package_data.pricing)
  assert.deepEqual(p.economics, before.listingPackage.package_data.economics)
  assert.deepEqual(p.productTruth.fieldTruthV1, before.listingPackage.package_data.productTruth.fieldTruthV1)
  assert.equal(p.preparationStatus.readyToPublish, false)
  assert.equal(Object.hasOwn(p, "publicationDigest"), false)
})
test("future products cannot inherit another product's compatibility", () => {
  const f = fixture()
  f.catalogRow.title = "Hot and Cold Insulated Bags for Food Delivery"
  f.opportunity.product_title = f.catalogRow.title
  f.opportunity.assessment.productTruth.title = f.catalogRow.title
  const p = prepareCurrentPackageRequiredAspectsV1(f)
  assert.deepEqual(p.aspects, {})
})
test("wrong account/variant, noncurrent package and stale unofficial category fail closed", () => {
  for (const change of [f => f.accountKey = "other", f => f.catalogRow.supplier_variant_id = "999",
    f => f.listingPackage.status = "published", f => f.taxonomy.source = "MARKET_COMPARABLE",
    f => f.taxonomy.observedAt = "2026-09-20T00:00:00Z", f => f.taxonomy.taxonomyMarketplaceId = "EBAY_GB",
    f => f.listingPackage.package_data.currentPublicationFactoryV1.reuseLegacyPreparation = true]) {
    const f = fixture(); change(f)
    assert.throws(() => prepareCurrentPackageRequiredAspectsV1(f))
  }
})
