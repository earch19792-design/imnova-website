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

const { buildRadarRevenueFactoryCandidateBatchV1,
  buildRadarCandidateEconomicsPreflightV1,
  ensureRadarCandidateEconomicsPreflightsV1 } = await import(
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
      maximumAgeSeconds: 2592000, fresh: true,
      attributeProfile: { "category id": digit,
        "product family": familyName },
      demandKeywordDna: { soldWeightedTerms: [] },
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
  economicClassification = "ECONOMICALLY_PROMISING") {
  return { opportunityCaseId, frontier: {
    familyId, lunaProductId: productId, lunaVariantId: variantId, lunaSku: sku,
    productFit: "STRONG", economicClassification,
    shippingStatus: "SHIPPING_DURABLY_PERSISTED", nextBestEvidence: "NONE",
    contributionProfitAtMarketMedian: 8,
    contributionMarginAtMarketMedian: 24, hardBlockers: [],
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

test("fresh FAMILY_DEMAND_SUPPORTED enters only with complementary exact stock and economics evidence", () => {
  const supported = structuredClone(radarPayload)
  supported.families[0].observationSeries[0].familyDemandStatus =
    "FAMILY_DEMAND_SUPPORTED"
  const accepted = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: supported, frontierPayload, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(accepted.seeds[0].familyDemandStatus, "FAMILY_DEMAND_SUPPORTED")
  assert.equal(accepted.candidatesGenerated, 2)
  assert.ok(accepted.candidates.every((candidate) =>
    candidate.exactCandidateIdentity && candidate.stockReady &&
    candidate.readyForEconomics))

  const weakEconomics = structuredClone(frontierPayload)
  weakEconomics.frontiers[0].frontier.economicClassification =
    "ECONOMICALLY_RECOVERABLE"
  const parked = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: supported, frontierPayload: weakEconomics, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(parked.candidates[0].readyForEconomics, false)

  const blocked = structuredClone(frontierPayload)
  blocked.frontiers[0].frontier.currentHardBlockers = ["POLICY_BLOCKER_PRESENT"]
  delete blocked.frontiers[0].frontier.hardBlockers
  const failClosed = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: supported, frontierPayload: blocked, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(failClosed.candidates[0].readyForEconomics, false)
})

test("stale family evidence never enters the durable factory adapter", () => {
  const stale = structuredClone(radarPayload)
  stale.families[0].observationSeries[0].fresh = false
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: stale, frontierPayload, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(result.seeds.some((seed) => seed.familyId === teslaFamilyId), false)
  assert.equal(result.candidates.some((candidate) =>
    candidate.familyId === teslaFamilyId), false)
})

test("exact identities are deduplicated before the candidate cap and every family with input gets bounded coverage", () => {
  const repeatedIdentity = `sha256:${"a".repeat(64)}`
  const rows = [
    ...Array.from({ length: 50 }, () => ({ radar_family_id: teslaFamilyId,
      identity_hash: repeatedIdentity, match_classification: "NO_LUNA_MATCH",
      matched_supplier_variant_id: null })),
    ...Array.from({ length: 5 }, (_, index) => ({ radar_family_id: teslaFamilyId,
      identity_hash: `sha256:${String(index + 11).padStart(2, "0").repeat(32)}`,
      match_classification: "NO_LUNA_MATCH", matched_supplier_variant_id: null })),
    ...Array.from({ length: 3 }, (_, index) => ({ radar_family_id: microFamilyId,
      identity_hash: `sha256:${String(index + 21).padStart(2, "0").repeat(32)}`,
      match_classification: "AMBIGUOUS", matched_supplier_variant_id: null })),
  ]
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload, frontierPayload: null, lunaCatalogRows: [],
    productResearchRows: rows, targetCandidates: 8,
  })
  assert.equal(result.inputProducts, 58)
  assert.equal(result.uniqueInputProducts, 9)
  assert.equal(result.duplicateCount, 49)
  assert.equal(result.candidatesGenerated, 8)
  assert.equal(result.radarSeedsUsed, 2)
  assert.equal(result.allFamiliesWithInputReceiveBoundedCoverage, true)
  assert.equal(result.candidates.some((candidate) =>
    candidate.dispositionReason === "DUPLICATE_PRODUCT_IDENTITY_WITHIN_FAMILY"), false)
})

test("conflicting duplicate evidence remains fail-closed and never becomes a Luna match", () => {
  const identityHash = `sha256:${"b".repeat(64)}`
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload, frontierPayload: null, lunaCatalogRows: [],
    productResearchRows: [
      { radar_family_id: teslaFamilyId, identity_hash: identityHash,
        match_classification: "EXACT_LUNA_MATCH",
        matched_supplier_variant_id: "variant-one" },
      { radar_family_id: teslaFamilyId, identity_hash: identityHash,
        match_classification: "DIFFERENT_VARIANT",
        matched_supplier_variant_id: "variant-two" },
    ], targetCandidates: 10,
  })
  assert.equal(result.inputProducts, 2)
  assert.equal(result.uniqueInputProducts, 1)
  assert.equal(result.duplicateCount, 1)
  assert.equal(result.conflictingIdentityGroups, 1)
  assert.equal(result.lunaMatchCount, 0)
  assert.equal(result.ambiguousCount, 1)
  assert.equal(result.candidates[0].dispositionReason, "FAMILY_SEED_ONLY_AMBIGUOUS")
})

test("family demand discovers exact Luna identity from bounded structured supplier evidence", () => {
  const familyDemand = structuredClone(radarPayload)
  familyDemand.families[1].observationSeries[0].attributeProfile = {
    "category id": "10968",
    "product family": "women butterfly heart layered",
  }
  familyDemand.families[1].observationSeries[0].demandKeywordDna = {
    soldWeightedTerms: [
      { term: "butterfly heart layered", familyType: "CORE" },
      { term: "necklace", familyType: "ATTRIBUTE" },
    ],
  }
  familyDemand.families[1].familyName = "women butterfly heart layered"
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: familyDemand, frontierPayload: null,
    lunaCatalogRows: [{ product_id: "catalog-butterfly",
      supplier_product_id: "9220832755936",
      supplier_variant_id: "48809643802848", sku: "ITEM3704",
      title: "Women's Butterfly & Heart Layered Necklace - Adjustable Chain",
      product_type: "Jewelry & Accessories",
      tags: ["Category: Jewelry & Accessories", "Jewelry"],
      available: true, inventory_quantity: null }],
    allowedFamilyNames: ["women butterfly heart layered"],
    targetCandidates: 10,
  })
  assert.equal(result.familyToLunaCompatibleCount, 1)
  assert.equal(result.uniqueLunaCandidates, 1)
  assert.equal(result.ambiguousFamilyAssignments, 0)
  assert.equal(result.stockSafeCount, 1)
  assert.equal(result.candidates[0].source,
    "RADAR_FAMILY_LUNA_SUPPLY_IDENTITY")
  assert.equal(result.candidates[0].familyAssignmentConfidence, "SUPPORTED")
  assert.equal(result.candidates[0].demandEvidenceGrain, "FAMILY")
  assert.equal(result.candidates[0].exactProductDemandClaimed, false)
  assert.equal(result.candidates[0].exactCandidateIdentity, true)
})

test("title-only family overlap never becomes Luna supply authority", () => {
  const familyDemand = structuredClone(radarPayload)
  familyDemand.families[1].observationSeries[0].attributeProfile = {
    "category id": "10968", "product family": "butterfly necklace",
  }
  familyDemand.families[1].observationSeries[0].demandKeywordDna = {
    soldWeightedTerms: [
      { term: "butterfly necklace", familyType: "CORE" },
      { term: "necklace", familyType: "ATTRIBUTE" },
    ],
  }
  familyDemand.families[1].familyName = "butterfly necklace"
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: familyDemand, frontierPayload: null,
    lunaCatalogRows: [{ product_id: "catalog-title-only",
      supplier_product_id: "9220000000001",
      supplier_variant_id: "48800000000001", sku: "TITLE-ONLY",
      title: "Butterfly Necklace", product_type: "Craft & DIY", tags: [],
      available: true }],
    allowedFamilyNames: ["butterfly necklace"], targetCandidates: 10,
  })
  assert.equal(result.familyToLunaCompatibleCount, 0)
  assert.equal(result.candidatesGenerated, 0)
})

test("multiple bounded family assignments remain ambiguous and excluded", () => {
  const firstFamily = structuredClone(radarPayload.families[0])
  const duplicateFamily = structuredClone(radarPayload.families[1])
  const commonTerms = { soldWeightedTerms: [
    { term: "butterfly necklace", familyType: "CORE" },
    { term: "necklace", familyType: "ATTRIBUTE" },
  ] }
  for (const entry of [firstFamily, duplicateFamily]) {
    entry.observationSeries[0].attributeProfile = {
      "category id": "10968", "product family": "butterfly necklace",
    }
    entry.observationSeries[0].demandKeywordDna = commonTerms
    entry.familyName = "butterfly necklace"
  }
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: { status: "AVAILABLE",
      families: [firstFamily, duplicateFamily] },
    frontierPayload: null,
    lunaCatalogRows: [{ product_id: "catalog-ambiguous",
      supplier_product_id: "9220000000002",
      supplier_variant_id: "48800000000002", sku: "AMBIGUOUS",
      title: "Butterfly Necklace", product_type: "Jewelry & Accessories",
      tags: ["Category: Jewelry & Accessories"], available: true }],
    targetCandidates: 10,
  })
  assert.equal(result.ambiguousFamilyAssignments, 1)
  assert.equal(result.familyToLunaCompatibleCount, 0)
  assert.equal(result.candidatesGenerated, 0)
})

function stockSafeButterflyBatch(overrides = {}) {
  const familyDemand = structuredClone(radarPayload)
  familyDemand.families[1].observationSeries[0].attributeProfile = {
    "category id": "10968",
    "product family": "women butterfly heart layered",
  }
  familyDemand.families[1].observationSeries[0].demandKeywordDna = {
    soldWeightedTerms: [
      { term: "butterfly heart layered", familyType: "CORE" },
      { term: "necklace", familyType: "ATTRIBUTE" },
    ],
  }
  familyDemand.families[1].familyName = "women butterfly heart layered"
  return buildRadarRevenueFactoryCandidateBatchV1({
    radarPayload: familyDemand, frontierPayload: null,
    lunaCatalogRows: [{ product_id: "11111111-1111-4111-8111-111111111111",
      supplier_product_id: "9220832755936",
      supplier_variant_id: "48809643802848", sku: "ITEM3704",
      title: "Women's Butterfly & Heart Layered Necklace - Adjustable Chain",
      variant_title: "Default", product_type: "Jewelry & Accessories",
      tags: ["Category: Jewelry & Accessories", "Jewelry"],
      price: "6.52", product_url: "https://lunaportex.com/products/example",
      captured_at: "2026-08-23T10:00:00.000Z",
      available: true, inventory_quantity: null, ...overrides }],
    allowedFamilyNames: ["women butterfly heart layered"], targetCandidates: 10,
  })
}

test("stock-safe generic Radar candidate builds the existing durable economics preflight with shipping unproven", () => {
  const batch = stockSafeButterflyBatch()
  const preflight = buildRadarCandidateEconomicsPreflightV1({
    accountKey: `seller:${"a".repeat(64)}`, candidate: batch.candidates[0],
  })
  assert.equal(preflight.frontier.lunaProductId, "9220832755936")
  assert.equal(preflight.frontier.lunaVariantId, "48809643802848")
  assert.equal(preflight.frontier.lunaSku, "ITEM3704")
  assert.equal(preflight.frontier.familyDemandStatus, "FAMILY_DEMAND_PROVEN")
  assert.equal(preflight.frontier.productFit, "STRONG")
  assert.equal(preflight.frontier.lunaUnitCost, 6.52)
  assert.equal(preflight.frontier.shippingStatus, "SHIPPING_UNPROVEN")
  assert.equal(preflight.frontier.unknownShippingTreatedAsZero, false)
  assert.equal(preflight.frontier.listingAuthorized, false)
  assert.equal(preflight.marketplaceWrites, 0)
})

test("economics preflight persists idempotently and one failure does not stop the next candidate", async () => {
  const first = stockSafeButterflyBatch().candidates[0]
  const second = { ...first,
    candidateId: `sha256:${"9".repeat(64)}`,
    lunaProductId: "9220832755937",
    lunaVariantId: "48809643802849",
    supplierSku: "ITEM3705" }
  const calls = []
  const result = await ensureRadarCandidateEconomicsPreflightsV1({
    accountKey: `seller:${"a".repeat(64)}`,
    batch: { ...stockSafeButterflyBatch(), candidates: [
      { ...first, supplierCostUsd: null }, second,
    ] },
    supabase: { async rpc(name, parameters) {
      calls.push({ name, parameters })
      return { data: { outcome: "CREATED" }, error: null }
    } },
  })
  assert.equal(result.attempted, 2)
  assert.equal(result.parkedEconomics, 1)
  assert.equal(result.created, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, "put_seller_os_profitability_frontier_v1")
  assert.equal(calls[0].parameters.p_frontier.shippingStatus,
    "SHIPPING_UNPROVEN")
  assert.equal(result.marketplaceWrites, 0)
})
