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

const { resolveQuickPickExactSoldProductTruthV1 } = await import(
  "./ebay-quick-pick-exact-sold-product-truth-v1.ts")
const { quickPickExactSoldCandidateIdentityV1 } = await import(
  "./ebay-luna-quick-pick-exact-sold-enrichment-v1.ts")

function listing(overrides = {}) {
  return { sourceClass: "SOLD_COMPLETED", sold: true,
    sourceReference: `listing-${Math.random()}`,
    sellerReference: `seller-${Math.random()}`,
    identity: { model: "AWCS06F", manufacturerBrand: "Aluratek" },
    aspects: [{ name: "Color", value: "Black" }], ...overrides }
}

test("two independent exact sold sellers can promote a corroborated fact", () => {
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { model: "AWCS06F", color: "Black" },
    requiredSpecificNames: ["Brand"],
    observations: [listing({ sourceReference: "one", sellerReference: "a" }),
      listing({ sourceReference: "two", sellerReference: "b" })],
  })
  assert.deepEqual(result.promotedProductTruth, { Brand: "Aluratek" })
  assert.equal(result.factTraces[0].soldExactMatchCount, 2)
  assert.equal(result.factTraces[0].promotionToProductTruthAllowed, true)
  assert.equal(result.factInvented, false)
})

test("title or family evidence never becomes Product Truth", () => {
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { productName: "Marvel Spider-Man Backpack" },
    requiredSpecificNames: ["Material"],
    observations: [listing({ identity: {
      productName: "Marvel Spider-Man Backpack" },
      aspects: [{ name: "Material", value: "Polyester" }] })],
  })
  assert.deepEqual(result.promotedProductTruth, {})
  assert.equal(result.familyOrComparableOnlyCount, 1)
  assert.equal(result.familyEvidencePromotedToProductTruth, false)
})

test("material conflicts are not resolved by blind majority", () => {
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { model: "AKB75855501" }, requiredSpecificNames: ["Brand"],
    observations: [
      listing({ sourceReference: "one", sellerReference: "a",
        identity: { model: "AKB75855501", manufacturerBrand: "LG" } }),
      listing({ sourceReference: "two", sellerReference: "b",
        identity: { model: "AKB75855501", manufacturerBrand: "LG" } }),
      listing({ sourceReference: "three", sellerReference: "c",
        identity: { model: "AKB75855501", manufacturerBrand: "Unbranded" } }),
    ],
  })
  assert.deepEqual(result.promotedProductTruth, {})
  assert.equal(result.factTraces[0].conflictingListingCount, 1)
  assert.equal(result.factTraces[0].resolutionReason,
    "MATERIAL_MARKET_FACT_CONFLICT")
})

test("marketplace condition and identifiers remain protected candidates", () => {
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { model: "AWCS06F" },
    requiredSpecificNames: ["Condition", "UPC"],
    observations: [
      listing({ sourceReference: "one", sellerReference: "a", identity: {
        model: "AWCS06F", manufacturerBrand: "Aluratek",
        condition: "New", gtin: "0812658014946" } }),
      listing({ sourceReference: "two", sellerReference: "b", identity: {
        model: "AWCS06F", manufacturerBrand: "Aluratek",
        condition: "New", gtin: "0812658014946" } }),
    ],
  })
  assert.deepEqual(result.promotedProductTruth, {})
  assert.equal(result.factTraces[0].resolutionReason,
    "CONDITION_REQUIRES_INVENTORY_AUTHORITY")
  assert.equal(result.factTraces[1].resolutionReason,
    "MARKET_IDENTIFIER_CANDIDATE_REQUIRES_CATEGORY_POLICY")
  assert.equal(result.marketIdentifierCandidates[0]
    .promotionToProductTruthAllowed, false)
})

test("active evidence requires two sellers plus the official catalog", () => {
  const active = (reference, seller) => listing({ sourceClass: "ACTIVE_LISTING",
    sold: false, sourceReference: reference, sellerReference: seller })
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { model: "AWCS06F" }, requiredSpecificNames: ["Brand"],
    observations: [active("one", "a"), active("two", "b")],
    catalogProducts: [{ epid: "123", title: "Aluratek AWCS06F",
      brand: "Aluratek", gtins: ["0812658014946"], mpns: ["AWCS06F"],
      categoryId: "4616", aspects: [] }],
  })
  assert.deepEqual(result.promotedProductTruth, { Brand: "Aluratek" })
})

test("a branded or licensed signal prevents an automatic Unbranded value", () => {
  const result = resolveQuickPickExactSoldProductTruthV1({
    candidate: { model: "SPIDER-15" }, requiredSpecificNames: ["Brand"],
    observations: [
      listing({ sourceReference: "one", sellerReference: "a", identity: {
        model: "SPIDER-15", manufacturerBrand: "Unbranded" } }),
      listing({ sourceReference: "two", sellerReference: "b", identity: {
        model: "SPIDER-15", manufacturerBrand: "Unbranded" } }),
      listing({ sourceReference: "family", sellerReference: "c",
        identity: { productName: "Marvel Spider-Man licensed backpack",
          manufacturerBrand: "Marvel" } }),
    ],
  })
  assert.deepEqual(result.promotedProductTruth, {})
  assert.equal(result.factTraces[0].resolutionReason,
    "UNBRANDED_CONTRADICTS_BRAND_OR_LICENSE_SIGNAL")
})

test("bounded sold enrichment remains reusable but full-Luna residuals do not rerun it", async () => {
  const continuation = await readFile(new URL(
    "./ebay-luna-quick-pick-exact-sold-enrichment-v1.ts", import.meta.url),
  "utf8")
  const route = await readFile(new URL(
    "../../app/api/admin/ebay/luna-quick-pick/route.ts", import.meta.url),
  "utf8")
  const requiredSpecifics = await readFile(new URL(
    "./ebay-luna-quick-pick-required-specifics-v1.ts", import.meta.url),
  "utf8")
  assert.match(continuation, /readReviewedOfficialSoldEvidence/)
  assert.match(continuation, /runEbaySellerKeywordDemandValidation/)
  assert.match(continuation, /searchEbayCatalogIdentity/)
  assert.match(continuation, /identityDuplicateDemandShippingEconomicsCategoryRepeated: false/)
  assert.match(continuation, /futureQuickPickExactSoldEnrichment: true/)
  assert.match(continuation, /skuSpecialCases: 0/)
  assert.doesNotMatch(continuation, /ITEM\d+/)
  assert.doesNotMatch(route, /continueLunaQuickPickExactSoldEnrichmentV1/)
  assert.match(requiredSpecifics, /buildLunaFullPageImageReviewV1/)
  assert.doesNotMatch(requiredSpecifics,
    /continueLunaQuickPickExactSoldEnrichmentV1/)
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
})

test("the sold resolver reuses exact facts already certified by the prior resolver", () => {
  const identity = quickPickExactSoldCandidateIdentityV1({
    product_title: "Wireless Camera",
    gtin: null,
    assessment: {
      productTruth: { provenProductValues: { Color: "Black" } },
      marketplaceRequiredSpecificsBatchResolutionV1: { resolutions: [
        { aspectName: "Model", resolvedValue: "AWCS06F",
          humanReviewRequired: false },
        { aspectName: "Brand", resolvedValue: "Guessed Brand",
          humanReviewRequired: true },
      ] },
    },
  })
  assert.equal(identity.model, "AWCS06F")
  assert.equal(identity.color, "Black")
  assert.equal(identity.manufacturerBrand, null)
})
