import assert from "node:assert/strict"
import test from "node:test"

import {
  MARKETPLACE_REQUIRED_SPECIFICS_BATCH_RESOLUTION_V1,
  requiredSpecificBatchEvidenceDigestV1,
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
    exactSpecs: { Color: "Blue" },
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

test("exact Luna identity without explicit Brand projects official Unbranded without AI or Product Truth", async () => {
  let aiCalls = 0
  const product = candidate(6, {
    exactProductTitle: "Exact supplier necklace",
    exactDescription: "No explicit manufacturer or brand field",
    exactImageUrls: ["https://images.example/ambiguous-mark.png"],
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
        "OFFICIAL_UNBRANDED_VALUE_WITH_EXACT_LUNA_IDENTITY_AND_NO_EXPLICIT_BRAND",
      imageIndex: null },
    confidence: "HIGH", factInvented: false,
    humanReviewRequired: false,
  })
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

test("durable evidence digest is invariant to JSON object key order", () => {
  assert.equal(requiredSpecificBatchEvidenceDigestV1({ a: 1, nested: { b: 2,
    c: 3 } }), requiredSpecificBatchEvidenceDigestV1({ nested: { c: 3,
    b: 2 }, a: 1 }))
})
