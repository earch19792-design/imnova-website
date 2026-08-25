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

const { buildRadarRevenueFactoryCandidateBatchV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
)

const teslaFamilyId = `market-family-v1:sha256:${"1".repeat(64)}`
const microFamilyId = `market-family-v1:sha256:${"2".repeat(64)}`
const teslaCaseId = `opportunity-case-v1:sha256:${"3".repeat(64)}`
const microCaseId = `opportunity-case-v1:sha256:${"4".repeat(64)}`

function family(familyId, familyName, opportunityCaseId, soldComparableCount,
  soldQuantity, digit) {
  return {
    familyId, familyName, opportunityCaseId,
    observationSeries: [{
      familyDemandStatus: "FAMILY_DEMAND_PROVEN",
      demandEvidenceDigest: `sha256:${digit.repeat(64)}`,
      soldComparableCount, soldQuantity,
      priceCurrency: "USD", priceBandMinimum: 10,
      priceBandMaximum: 100, priceMedian: 35,
      evidenceObservedAt: "2026-08-23T10:00:00.000Z",
      sourceUpdatedAt: "2026-08-23T10:00:00.000Z",
      limitations: ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
    }],
  }
}

const radarPayload = {
  status: "AVAILABLE",
  families: [
    family(teslaFamilyId, "Tesla Gen II NEMA adapters", teslaCaseId, 31, 80, "5"),
    family(microFamilyId, "Microcurrent facial devices", microCaseId, 10, 15, "6"),
  ],
}

function frontier(familyId, opportunityCaseId, productId, variantId, sku,
  economicClassification = "ECONOMICALLY_RECOVERABLE") {
  return { opportunityCaseId, frontier: {
    familyId, lunaProductId: productId, lunaVariantId: variantId, lunaSku: sku,
    productFit: "STRONG", economicClassification,
  } }
}

const frontierPayload = { status: "AVAILABLE", frontiers: [
  frontier(teslaFamilyId, teslaCaseId, "9220832329952", "48809643376864", "ITEM3760"),
  frontier(teslaFamilyId, teslaCaseId, "9220840259808", "48809651798240", "TESLA-1450"),
  frontier(microFamilyId, microCaseId, "9220832493792", "48809643540704", "ITEM3734"),
] }

const lunaCatalogRows = [
  { product_id: "catalog-tesla-1430", supplier_product_id: "9220832329952",
    supplier_variant_id: "48809643376864", sku: "ITEM3760", available: true,
    inventory_quantity: 4 },
  { product_id: "catalog-tesla-1450", supplier_product_id: "9220840259808",
    supplier_variant_id: "48809651798240", sku: "TESLA-1450", available: true,
    inventory_quantity: 2 },
  { product_id: "catalog-microcurrent", supplier_product_id: "9220832493792",
    supplier_variant_id: "48809643540704", sku: "ITEM3734", available: true,
    inventory_quantity: 8 },
]

function researchRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    radar_family_id: index % 2 ? microFamilyId : teslaFamilyId,
    identity_hash: `sha256:${(index + 10).toString(16).padStart(2, "0").repeat(32)}`,
    match_classification: "NO_LUNA_MATCH",
    matched_supplier_variant_id: null,
  }))
}

test("Tesla Radar evidence is accepted only as a discovery seed and fans into exact Luna identities", () => {
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload, frontierPayload, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(result.radarSeedAccepted, true)
  assert.equal(result.radarSeedsUsed, 1)
  assert.equal(result.candidatesGenerated, 2)
  assert.equal(result.exactProductFitCount, 2)
  assert.equal(result.lunaMatchCount, 2)
  assert.equal(result.evidenceLineagePreserved, true)
  assert.equal(result.marketplaceWrites, 0)
  assert.ok(result.candidates.every((candidate) =>
    candidate.lineage.exactProductDemandClaimed === false &&
    candidate.lineage.evidenceScope === "FAMILY_DISCOVERY_SEED_ONLY"))
})

test("bounded two-family batch settles all 30 candidates as PASS_TO_LUNA or explicit REJECT", () => {
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload, frontierPayload, lunaCatalogRows,
    productResearchRows: researchRows(40), targetCandidates: 30,
  })
  assert.equal(result.radarSeedsUsed, 2)
  assert.equal(result.candidatesGenerated, 30)
  assert.equal(result.exactProductFitCount, 3)
  assert.equal(result.lunaMatchCount, 3)
  assert.equal(result.stockReadyCount, 3)
  assert.equal(result.readyForEconomicsCount, 3)
  assert.equal(result.rejectedCount, 27)
  assert.equal(result.evidenceLineagePreserved, true)
  assert.ok(result.candidates.every((candidate) =>
    candidate.disposition === "PASS_TO_LUNA" ||
    candidate.disposition === "REJECT" && candidate.dispositionReason.length > 0))
})

test("unproven family demand and fuzzy Product Research rows never enter the candidate input", () => {
  const unproven = structuredClone(radarPayload)
  unproven.families[0].observationSeries[0].familyDemandStatus =
    "FAMILY_DEMAND_UNPROVEN"
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: unproven, frontierPayload, lunaCatalogRows,
    productResearchRows: [{ radar_family_id: teslaFamilyId,
      identity_hash: `sha256:${"9".repeat(64)}`,
      match_classification: "AMBIGUOUS" }], targetCandidates: 30,
  })
  assert.equal(result.seeds.some((seed) => seed.familyId === teslaFamilyId), false)
  assert.equal(result.candidates.some((candidate) =>
    candidate.familyId === teslaFamilyId), false)
  assert.equal(result.marketplaceWrites, 0)
})
