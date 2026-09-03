import assert from "node:assert/strict"
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

const { resolveTopSellerMarketplaceFieldMappingV1 } = await import(
  "./top-seller-marketplace-field-mapping-v1.ts")

function classified(reference, seller, sold, type, overrides = {}) {
  return { classification: "EXACT_PRODUCT_MATCH",
    physicalIdentityConfidence: "HIGH", conflictCount: 0,
    candidate: { candidateReference: reference,
      sourceClass: "SOLD_COMPLETED", itemId: reference,
      sellerReference: seller, title: "Wireless clip-on microphone",
      imageUrl: "https://i.ebayimg.com/example.jpg", categoryId: "29946",
      model: null, brand: null, dimensions: [], colorOrVariant: [],
      material: [], includedAccessories: [], distinctiveFeatures: [],
      aspects: [{ name: "Type", value: type }], gtin: null, mpn: null,
      soldVolume: sold, salesVelocity: sold / 2,
      observedAt: "2026-08-30T00:00:00.000Z" }, ...overrides }
}

test("the highest-performing exact listing becomes primary and field votes are volume weighted", () => {
  const result = resolveTopSellerMarketplaceFieldMappingV1({
    classifiedCandidates: [
      classified("111111111111", "seller-a", 50, "Wireless Microphone"),
      classified("222222222222", "seller-b", 20, "Wireless Microphone"),
      classified("333333333333", "seller-c", 1, "Other"),
    ], residualSpecificNames: ["Type"],
    exactEvidence: [{ sourceField: "TITLE",
      text: "3 in 1 wireless clip-on microphone for iPhone and camera" }],
    existingProductTruth: {}, now: new Date("2026-09-02T00:00:00.000Z"),
  })
  assert.equal(result.primaryReference.itemId, "111111111111")
  assert.equal(result.semanticMappings[0].resolvedValue,
    "Wireless Microphone")
  assert.ok(result.fieldConsensus[0].consensusShare > .9)
  assert.equal(result.physicalIdentitySeparatedFromMarketplaceFieldInterpretation,
    true)
})

test("one high-volume seller is a primary reference, never a field consensus", () => {
  const result = resolveTopSellerMarketplaceFieldMappingV1({
    classifiedCandidates: [classified("111111111111", "seller-a", 500,
      "Wireless Microphone")], residualSpecificNames: ["Type"],
    exactEvidence: [{ sourceField: "TITLE",
      text: "wireless clip-on microphone" }], existingProductTruth: {},
  })
  assert.equal(result.primaryReference.itemId, "111111111111")
  assert.deepEqual(result.semanticMappings, [])
  assert.equal(result.fieldConsensus[0].sufficient, false)
})

test("market success cannot overwrite a contradictory strict Product Truth fact", () => {
  const entries = [
    classified("111111111111", "seller-a", 100, "Other", {
      candidate: { ...classified("x", "x", 1, "Other").candidate,
        candidateReference: "111111111111", itemId: "111111111111",
        sellerReference: "seller-a", material: ["Aluminum"],
        aspects: [{ name: "Material", value: "Aluminum" }] } }),
    classified("222222222222", "seller-b", 90, "Other", {
      candidate: { ...classified("x", "x", 1, "Other").candidate,
        candidateReference: "222222222222", itemId: "222222222222",
        sellerReference: "seller-b", material: ["Aluminum"],
        aspects: [{ name: "Material", value: "Aluminum" }] } }),
  ]
  const result = resolveTopSellerMarketplaceFieldMappingV1({
    classifiedCandidates: entries, residualSpecificNames: ["Material"],
    exactEvidence: [{ sourceField: "SPECS", text: "Material: ABS" }],
    existingProductTruth: { Material: "ABS" },
  })
  assert.deepEqual(result.strictPromotions, {})
  assert.equal(result.productTruthOverrideBySeller, false)
})

test("LG compatibility can map without changing a generic replacement into Brand LG", () => {
  const reference = (id, seller, sold) => {
    const base = classified(id, seller, sold, "Remote Control")
    return { ...base, candidate: { ...base.candidate, brand: "LG",
      aspects: [{ name: "Compatible Brand", value: "LG" }] } }
  }
  const result = resolveTopSellerMarketplaceFieldMappingV1({
    classifiedCandidates: [reference("111111111111", "seller-a", 20),
      reference("222222222222", "seller-b", 10)],
    residualSpecificNames: ["Compatible Brand", "Brand"],
    exactEvidence: [{ sourceField: "DESCRIPTION",
      text: "Generic replacement remote compatible for LG AKB75855501" }],
    existingProductTruth: {},
  })
  assert.equal(result.semanticMappings.find((entry) =>
    entry.specificName === "Compatible Brand").resolvedValue, "LG")
  assert.equal(result.strictPromotions.Brand, undefined)
})
