import assert from "node:assert/strict"
import test from "node:test"

import {
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  requiredSpecificBatchEvidenceDigestV1,
  revalidateCompatiblePriorAiResolutionsV1,
  resolveMarketplaceRequiredSpecificsBatchV1,
} from "./ebay-marketplace-required-specifics-batch-resolution-v1.ts"

const candidate = (index, overrides = {}) => {
  const core = {
    radarCandidateId: `sha256:${String(index).repeat(64)}`,
    lunaProductId: `product-${index}`,
    lunaVariantId: `variant-${index}`,
    supplierSku: `SKU-${index}`,
    marketplaceId: "EBAY_US",
    categoryId: "155101",
    exactProductIdentityProven: true,
    exactProductTitle: "Exact supplier necklace",
    exactDescription: "Botanical motif on exact product",
    exactSpecs: {},
    exactVariantData: {},
    exactImageUrls: [],
    unresolvedRequiredAspects: ["Pattern"],
    officialAspectDefinitions: [{
      name: "Pattern", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Floral", "Solid"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
    ...overrides,
  }
  return { ...core, inputEvidenceDigest:
    requiredSpecificBatchEvidenceDigestV1(core) }
}

test("one text AI call resolves multiple products in the same marketplace/category batch", async () => {
  const products = [candidate(1), candidate(2)]
  const calls = []
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products,
    aiResolver: async (input) => {
      calls.push(input)
      return {
        model: "test-model", inputTokens: 100, outputTokens: 30,
        candidates: input.products.map((product) => ({
          radarCandidateId: product.radarCandidateId,
          lunaProductId: product.lunaProductId,
          lunaVariantId: product.lunaVariantId,
          supplierSku: product.supplierSku,
          marketplaceId: product.marketplaceId,
          categoryId: product.categoryId,
          inputEvidenceDigest: product.inputEvidenceDigest,
          resolutions: [{
            aspectName: "Pattern", resolvedValue: "Floral",
            resolutionClass: "AI_MAPPING",
            sourceEvidence: { sourceField: "DESCRIPTION",
              sourceExcerpt: "Botanical motif", imageIndex: null },
            confidence: "HIGH", factInvented: false,
            humanReviewRequired: false,
          }],
        })),
      }
    },
  })
  assert.equal(result.contractVersion,
    MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1)
  assert.equal(result.productCount, 2)
  assert.equal(result.aiResolutionRequiredCount, 2)
  assert.equal(result.aiCallCount, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].products.length, 2)
  assert.ok(result.candidates.every((entry) =>
    entry.resolutions[0].resolvedValue === "Floral"))
  assert.ok(result.candidates.every((entry) =>
    entry.resolutions[0].factInvented === false))
})

test("deterministic and marketplace fallback stages run before AI", async () => {
  let aiCalls = 0
  const product = candidate(3, {
    exactDescription: "",
    exactSpecs: { Color: "Blue",
      productTruthNoManufacturerBrandClaim: "PROVEN",
      productTruthEbayBrandSemantics: "UNBRANDED_SUPPORTED",
      productTruthVisibleManufacturerBrandingPresent: "false",
      productTruthSupplierImageBrandConflictFound: "false" },
    unresolvedRequiredAspects: ["Color", "Brand"],
    officialAspectDefinitions: [{
      name: "Color", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Blue", "Red"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }, {
      name: "Brand", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Unbranded", "Other"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.deterministicResolvedCount, 1)
  assert.equal(result.marketplaceFallbackResolvedCount, 1)
  assert.equal(result.aiResolutionRequiredCount, 0)
  assert.deepEqual(result.candidates[0].resolutions.map((entry) =>
    [entry.aspectName, entry.resolutionClass]), [
    ["Color", "EXPLICIT_PRODUCT_TRUTH"],
    ["Brand", "MARKETPLACE_ALLOWED_FALLBACK"],
  ])
})

test("an exact product phrase resolves one slash-delimited official value without AI", async () => {
  let aiCalls = 0
  const product = candidate(9, {
    exactProductTitle: "3 in 1 Wireless Clip-on Microphones",
    exactDescription:
      "Wireless Lavalier Microphone for iPhone and iPad (Dual Set)",
    unresolvedRequiredAspects: ["Form Factor"],
    officialAspectDefinitions: [{
      name: "Form Factor", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Desktop Microphone", "Lavalier/Lapel", "Headset"],
      allowedValueCount: 3, allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.candidates[0].resolutions[0].resolvedValue,
    "Lavalier/Lapel")
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "DETERMINISTIC_DERIVATION")
  assert.equal(result.candidates[0].resolutions[0].sourceEvidence.sourceField,
    "DESCRIPTION")
  assert.equal(result.candidates[0].resolutions[0].factInvented, false)
})

test("exact identity with no manufacturer MPN uses the official US marketplace substitute", async () => {
  let aiCalls = 0
  const product = candidate(31, {
    exactProductTitle: "Exact supplier scan reader pen",
    exactDescription: "No manufacturer part number is declared",
    exactSpecs: { supplierSku: "SUPPLIER-ONLY-31",
      asin: "B000000031" },
    unresolvedRequiredAspects: ["MPN"],
    officialAspectDefinitions: [{
      name: "MPN", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 0,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("MPN_AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.marketplaceFallbackResolvedCount, 1)
  assert.deepEqual(result.candidates[0].resolutions[0], {
    aspectName: "MPN", resolvedValue: "Does not apply",
    resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
    sourceEvidence: { sourceField: "MARKETPLACE_POLICY",
      sourceExcerpt:
        "EBAY_US_PRODUCT_IDENTIFIER_UNAVAILABLE_AFTER_EXACT_MPN_SWEEP",
      imageIndex: null },
    confidence: "HIGH", factInvented: false,
    humanReviewRequired: false,
  })
})

test("an explicitly labeled manufacturer part number wins over the absence fallback", async () => {
  const product = candidate(311, {
    exactProductTitle: "Exact reader pen",
    exactDescription: "Manufacturer Part Number: PEN-X311",
    exactSpecs: { supplierSku: "NOT-THE-MPN", asin: "B000000311" },
    unresolvedRequiredAspects: ["MPN"],
    officialAspectDefinitions: [{
      name: "MPN", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 0,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: null, aiStages: [],
  })
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "PEN-X311")
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "EXPLICIT_PRODUCT_TRUTH")
})

test("an exact supplier Product model label resolves free-text Model", async () => {
  const product = candidate(313, {
    exactDescription: "Product model: JM05 Bluetooth earphone",
    unresolvedRequiredAspects: ["Model"],
    officialAspectDefinitions: [{
      name: "Model", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 816,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: null, aiStages: [],
  })
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "JM05")
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "EXPLICIT_PRODUCT_TRUTH")
  assert.equal(result.candidates[0].resolutions[0].sourceEvidence.sourceField,
    "DESCRIPTION")
})

test("explicit Aluminum in exact Luna text resolves free-text Material without AI", async () => {
  let aiCalls = 0
  const product = candidate(312, {
    exactProductTitle: "Black anti-rust aluminum tissue roll holder",
    exactDescription: "Exact wall-mounted holder",
    unresolvedRequiredAspects: ["Material"],
    officialAspectDefinitions: [{
      name: "Material", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "MULTI", freeTextAllowed: true,
      allowedValues: ["Metal", "Plastic"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("MATERIAL_AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "Aluminum")
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "DETERMINISTIC_DERIVATION")
  assert.equal(result.candidates[0].resolutions[0].factInvented, false)
})

test("a single multimodal call can cite exact text or an exact image", async () => {
  const product = candidate(32, {
    exactProductTitle: "Black adjustable windshield phone holder",
    exactDescription: "Universal holder compatible with smartphones",
    exactImageUrls: ["https://images.example/exact-phone-holder.png"],
    unresolvedRequiredAspects: ["Color", "Compatible Brand"],
    officialAspectDefinitions: [{
      name: "Color", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Black", "White"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }, {
      name: "Compatible Brand", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 0,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const calls = []
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiStages: ["VISION"],
    aiResolver: async (input) => {
      calls.push(input)
      return { model: "test-model", inputTokens: 20, outputTokens: 20,
        candidates: [{ radarCandidateId: product.radarCandidateId,
          lunaProductId: product.lunaProductId,
          lunaVariantId: product.lunaVariantId,
          supplierSku: product.supplierSku,
          marketplaceId: product.marketplaceId,
          categoryId: product.categoryId,
          inputEvidenceDigest: product.inputEvidenceDigest,
          resolutions: [{ aspectName: "Color", resolvedValue: "Black",
            resolutionClass: "AI_CLASSIFICATION",
            sourceEvidence: { sourceField: "TITLE",
              sourceExcerpt: "Black", imageIndex: null },
            confidence: "HIGH", factInvented: false,
            humanReviewRequired: false },
          { aspectName: "Compatible Brand", resolvedValue: "Universal",
            resolutionClass: "AI_MAPPING",
            sourceEvidence: { sourceField: "DESCRIPTION",
              sourceExcerpt: "Universal holder", imageIndex: null },
            confidence: "MEDIUM", factInvented: false,
            humanReviewRequired: true }],
        }] }
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].stage, "VISION")
  assert.equal(result.aiCallCount, 1)
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "Black")
  assert.equal(result.candidates[0].resolutions[1].resolvedValue, "Universal")
  assert.equal(result.candidates[0].resolutions[1].humanReviewRequired, true)
})

test("text residuals with exact images share a second vision batch", async () => {
  const product = candidate(4, {
    exactDescription: "No textual material fact",
    exactImageUrls: ["https://images.example/exact.png"],
    unresolvedRequiredAspects: ["Material"],
    officialAspectDefinitions: [{
      name: "Material", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Metal", "Plastic"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const stages = []
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async (input) => {
      stages.push(input.stage)
      const resolution = input.stage === "TEXT" ? {
        aspectName: "Material", resolvedValue: null,
        resolutionClass: "HUMAN_REVIEW",
        sourceEvidence: { sourceField: "NONE", sourceExcerpt: null,
          imageIndex: null }, confidence: "LOW", factInvented: false,
        humanReviewRequired: true,
      } : {
        aspectName: "Material", resolvedValue: "Metal",
        resolutionClass: "AI_MAPPING",
        sourceEvidence: { sourceField: "IMAGE",
          sourceExcerpt: "visible exact brand mark", imageIndex: 0 },
        confidence: "HIGH", factInvented: false,
        humanReviewRequired: false,
      }
      return { model: "test-model", inputTokens: 10, outputTokens: 10,
        candidates: [{
          radarCandidateId: product.radarCandidateId,
          lunaProductId: product.lunaProductId,
          lunaVariantId: product.lunaVariantId,
          supplierSku: product.supplierSku,
          marketplaceId: product.marketplaceId,
          categoryId: product.categoryId,
          inputEvidenceDigest: product.inputEvidenceDigest,
          resolutions: [resolution],
        }] }
    },
  })
  assert.deepEqual(stages, ["TEXT", "VISION"])
  assert.equal(result.aiCallCount, 2)
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "Metal")
  assert.equal(result.candidates[0].resolutions[0].humanReviewRequired, false)
})

test("canonical no-brand Product Truth projects official Unbranded without AI", async () => {
  let aiCalls = 0
  const product = candidate(6, {
    exactProductTitle: "Exact supplier necklace",
    exactDescription: "No explicit manufacturer or brand field",
    exactImageUrls: ["https://images.example/ambiguous-mark.png"],
    exactSpecs: {
      productTruthNoManufacturerBrandClaim: "PROVEN",
      productTruthEbayBrandSemantics: "UNBRANDED_SUPPORTED",
      productTruthVisibleManufacturerBrandingPresent: "false",
      productTruthSupplierImageBrandConflictFound: "false",
    },
    unresolvedRequiredAspects: ["Brand"],
    officialAspectDefinitions: [{
      name: "Brand", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: ["Unbranded", "Other"], allowedValueCount: 10_726,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("BRAND_AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.marketplaceFallbackResolvedCount, 1)
  assert.equal(result.aiResolutionRequiredCount, 0)
  assert.deepEqual(result.candidates[0].resolutions[0], {
    aspectName: "Brand", resolvedValue: "Unbranded",
    resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
    sourceEvidence: { sourceField: "MARKETPLACE_POLICY",
      sourceExcerpt:
        "OFFICIAL_UNBRANDED_VALUE_WITH_CANONICAL_NO_BRAND_PROOF",
      imageIndex: null },
    confidence: "HIGH", factInvented: false,
    humanReviewRequired: false,
  })
})

test("licensed or otherwise unproven brand evidence never auto-falls back to Unbranded", async () => {
  const product = candidate(61, {
    exactProductTitle: "Marvel Spider-Man backpack",
    exactDescription: "Spider-Man Webbed Wonder school backpack",
    exactImageUrls: ["https://images.example/licensed-product.png"],
    unresolvedRequiredAspects: ["Brand"],
    officialAspectDefinitions: [{
      name: "Brand", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: ["Unbranded"], allowedValueCount: 13_408,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: null, aiStages: [],
  })
  assert.equal(result.marketplaceFallbackResolvedCount, 0)
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, null)
  assert.equal(result.candidates[0].resolutions[0].humanReviewRequired, true)
})

test("bounded AI can propose but cannot auto-assert Unbranded without canonical proof", async () => {
  const product = candidate(62, {
    exactProductTitle: "Generic exact supplier pillow",
    exactImageUrls: ["https://images.example/exact-pillow.png"],
    unresolvedRequiredAspects: ["Brand"],
    officialAspectDefinitions: [{
      name: "Brand", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: ["Unbranded"], allowedValueCount: 4_000,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiStages: ["VISION"],
    aiResolver: async () => ({ model: "test", inputTokens: 1,
      outputTokens: 1, candidates: [{
        radarCandidateId: product.radarCandidateId,
        lunaProductId: product.lunaProductId,
        lunaVariantId: product.lunaVariantId,
        supplierSku: product.supplierSku,
        marketplaceId: product.marketplaceId,
        categoryId: product.categoryId,
        inputEvidenceDigest: product.inputEvidenceDigest,
        resolutions: [{ aspectName: "Brand", resolvedValue: "Unbranded",
          resolutionClass: "AI_CLASSIFICATION",
          sourceEvidence: { sourceField: "IMAGE",
            sourceExcerpt: "no visible brand mark", imageIndex: 0 },
          confidence: "MEDIUM", factInvented: false,
          humanReviewRequired: false }],
      }],
    }),
  })
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, "Unbranded")
  assert.equal(result.candidates[0].resolutions[0].humanReviewRequired, true)
  assert.equal(result.candidates[0].resolutions[0].factInvented, false)
})

test("Brand remains fail-closed when exact Luna product identity is unproven", async () => {
  let aiCalls = 0
  const product = candidate(7, {
    exactProductIdentityProven: false,
    unresolvedRequiredAspects: ["Brand"],
    officialAspectDefinitions: [{
      name: "Brand", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Unbranded"], allowedValueCount: 1,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      aiCalls += 1
      throw new Error("UNPROVEN_IDENTITY_AI_MUST_NOT_RUN")
    },
  })
  assert.equal(aiCalls, 0)
  assert.equal(result.marketplaceFallbackResolvedCount, 0)
  assert.equal(result.deterministicResolvedCount, 0)
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "HUMAN_REVIEW")
  assert.equal(result.candidates[0].resolutions[0].factInvented, false)
})

test("a non-official or invented AI value fails closed per candidate", async () => {
  const product = candidate(5)
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => ({
      model: "test-model", inputTokens: null, outputTokens: null,
      candidates: [{
        radarCandidateId: product.radarCandidateId,
        lunaProductId: product.lunaProductId,
        lunaVariantId: product.lunaVariantId,
        supplierSku: product.supplierSku,
        marketplaceId: product.marketplaceId,
        categoryId: product.categoryId,
        inputEvidenceDigest: product.inputEvidenceDigest,
        resolutions: [{
          aspectName: "Pattern", resolvedValue: "Invented pattern",
          resolutionClass: "AI_MAPPING",
          sourceEvidence: { sourceField: "DESCRIPTION",
            sourceExcerpt: "Botanical motif", imageIndex: null },
          confidence: "HIGH", factInvented: false,
          humanReviewRequired: false,
        }],
      }],
    }),
  })
  assert.equal(result.candidates[0].resolutions[0].resolvedValue, null)
  assert.equal(result.candidates[0].resolutions[0].humanReviewRequired, true)
})

test("an exhausted one-shot AI budget persists residuals as human review without retry", async () => {
  const product = candidate(8)
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: null, aiStages: [],
  })
  assert.equal(result.aiCallCount, 0)
  assert.equal(result.candidates[0].resolutions[0].aspectName, "Pattern")
  assert.equal(result.candidates[0].resolutions[0].resolutionClass,
    "HUMAN_REVIEW")
  assert.equal(result.candidates[0].resolutions[0].humanReviewRequired, true)
  assert.equal(result.candidates[0].resolutions[0].factInvented, false)
})

test("missing AI preserves deterministic facts and only parks the true residual", async () => {
  const product = candidate(82, {
    exactDescription: "Bluetooth exact product",
    exactSpecs: { Color: "Blue" },
    unresolvedRequiredAspects: ["Color", "Model"],
    officialAspectDefinitions: [{
      name: "Color", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Blue"], allowedValueCount: 1,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }, {
      name: "Model", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 0,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: null,
  })
  assert.equal(result.aiCallCount, 0)
  assert.deepEqual(result.candidates[0].resolutions.map((entry) => [
    entry.aspectName, entry.resolvedValue, entry.humanReviewRequired,
  ]), [["Color", "Blue", false], ["Model", null, true]])
})

test("one bounded AI failure cannot erase deterministic exact facts", async () => {
  const product = candidate(83, {
    exactSpecs: { Color: "Blue" },
    unresolvedRequiredAspects: ["Color", "Model"],
    officialAspectDefinitions: [{
      name: "Color", dataType: "STRING", mode: "SELECTION_ONLY",
      cardinality: "SINGLE", freeTextAllowed: false,
      allowedValues: ["Blue"], allowedValueCount: 1,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }, {
      name: "Model", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "SINGLE", freeTextAllowed: true,
      allowedValues: [], allowedValueCount: 0,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const result = await resolveMarketplaceRequiredSpecificsBatchV1({
    products: [product], aiResolver: async () => {
      throw new Error("REQUIRED_SPECIFICS_AI_HTTP_503")
    },
  })
  assert.equal(result.aiCallCount, 1)
  assert.deepEqual(result.aiFailureCodes,
    ["REQUIRED_SPECIFICS_AI_HTTP_503"])
  assert.deepEqual(result.candidates[0].resolutions.map((entry) => [
    entry.aspectName, entry.resolvedValue, entry.humanReviewRequired,
  ]), [["Color", "Blue", false], ["Model", null, true]])
})

test("a compatible paid AI result survives a policy digest upgrade without another call", () => {
  const product = candidate(81, {
    exactProductTitle: "Black anti-rust aluminum tissue roll holder",
    exactDescription: "Exact toilet paper holder description",
    unresolvedRequiredAspects: ["Material"],
    officialAspectDefinitions: [{
      name: "Material", dataType: "STRING", mode: "FREE_TEXT",
      cardinality: "MULTI", freeTextAllowed: true,
      allowedValues: ["Metal", "Plastic"], allowedValueCount: 2,
      allowedValuesComplete: true,
      source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
    }],
  })
  const reused = revalidateCompatiblePriorAiResolutionsV1({
    product, stage: "TEXT", resolutions: [{ aspectName: "Material",
      resolvedValue: "Metal", resolutionClass: "AI_MAPPING",
      sourceEvidence: { sourceField: "TITLE",
        sourceExcerpt: "Black anti-rust aluminum tissue roll holder",
        imageIndex: null }, confidence: "HIGH", factInvented: false,
      humanReviewRequired: false }],
  })
  assert.equal(reused.length, 1)
  assert.equal(reused[0].resolvedValue, "Metal")
  assert.equal(reused[0].humanReviewRequired, false)
  assert.equal(revalidateCompatiblePriorAiResolutionsV1({
    product: { ...product, exactProductTitle: "Different product" },
    stage: "TEXT", resolutions: reused,
  }).length, 0)
})

test("durable evidence digest is invariant to JSON object key order", () => {
  assert.equal(requiredSpecificBatchEvidenceDigestV1({ a: 1, nested: { b: 2,
    c: 3 } }), requiredSpecificBatchEvidenceDigestV1({ nested: { c: 3,
    b: 2 }, a: 1 }))
})
