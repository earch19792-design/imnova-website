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
  buildLunaCatalogControlledTestCandidateBatchV1,
  buildRadarCandidateEconomicsPreflightV1,
  ensureRadarCandidateEconomicsPreflightsV1,
  RADAR_DISCOVERY_MAXIMUM_ELIGIBLE_FAMILIES,
  RADAR_LUNA_CATALOG_MAX_ROWS,
  RADAR_LUNA_CATALOG_PAGE_SIZE,
  readRadarRevenueFactoryLunaCatalogV1,
  resolveUniversalLunaRequestedProductsV1,
  readAlreadyLiveExactLunaIdentitiesV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
)
const { currentLiveScopeIdV1, CURRENT_LIVE_SOURCE_AUTHORITY } = await import(
  "./ebay-current-live-authority-v1.ts")

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

test("Luna controlled-test selection never queries or invents eBay market evidence", () => {
  const capturedAt = "2026-10-08T12:00:00.000Z"
  const result = buildLunaCatalogControlledTestCandidateBatchV1({
    accountKey: "test-account",
    now: new Date("2026-10-08T12:30:00.000Z"),
    targetCandidates: 4,
    lunaCatalogRows: [
      { product_id: "catalog-1", supplier_product_id: "101",
        supplier_variant_id: "201", sku: "ITEM1", title: "Product one",
        product_type: "Home", price: 10, available: true,
        inventory_quantity: 3, captured_at: capturedAt,
        image_urls: ["https://cdn.example.test/one.jpg"] },
      { product_id: "catalog-2", supplier_product_id: "102",
        supplier_variant_id: "202", sku: "ITEM2", title: "Unknown cost",
        price: null, available: true, inventory_quantity: 2,
        captured_at: capturedAt },
      { product_id: "catalog-3", supplier_product_id: "103",
        supplier_variant_id: "203", sku: "ITEM3", title: "Unavailable",
        price: 5, available: false, inventory_quantity: 0,
        captured_at: capturedAt },
      { product_id: "catalog-4", supplier_product_id: "104",
        supplier_variant_id: "204", sku: "ITEM4", title: "Stale",
        price: 5, available: true, inventory_quantity: 2,
        captured_at: "2026-10-01T12:00:00.000Z" },
    ],
  })
  assert.equal(result.selectionMode, "LUNA_CATALOG_CONTROLLED_TEST")
  assert.equal(result.marketLookupPerformed, false)
  assert.equal(result.marketDemandGateRequired, false)
  assert.equal(result.candidates.length, 1)
  assert.equal(result.catalogRowsRejectedUnknownCost, 1)
  assert.equal(result.catalogRowsRejectedUnavailable, 1)
  assert.equal(result.catalogRowsRejectedStale, 1)
  const candidate = result.candidates[0]
  assert.equal(candidate.source, "LUNA_CATALOG_CONTROLLED_TEST")
  assert.equal(candidate.supplierCostUsd, 10)
  assert.equal(candidate.marketTestPath, true)
  assert.equal(candidate.readyForEconomics, false)
  assert.equal(candidate.exactProductDemandClaimed, false)
  assert.equal(candidate.lineage.familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
  assert.deepEqual(candidate.lineage.priceBand, {
    currency: null, minimum: null, maximum: null, median: null,
  })
  assert.ok(candidate.lineage.limitations.includes(
    "DEMAND_EVIDENCE_ABSENT_NOT_NEGATIVE"))
  const preflight = buildRadarCandidateEconomicsPreflightV1({
    accountKey: "test-account", candidate,
  })
  assert.equal(preflight.frontier.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
  assert.equal(preflight.frontier.quickPickMarketTestV1.marketPriceSupport,
    "UNPROVEN")
  assert.match(preflight.persistence.marketPriceEvidenceReference,
    /^luna-catalog-no-market-evidence:/)
})

function directCatalogClient(catalogRows) {
  return { from() {
    const query = {
      select() { return query }, eq() { return query },
      order() { return query },
      async range(from, to) {
        return { data: catalogRows.slice(from, to + 1), error: null }
      },
    }
    return query
  } }
}

test("universal Luna resolver converts SKU and URL to ordered canonical identities", async () => {
  const captured_at = "2026-10-08T12:00:00.000Z"
  const rows = [
    { product_id: "catalog-1", supplier_product_id: "101",
      supplier_variant_id: "201", sku: "ITEM1", title: "First",
      price: 7, available: true, inventory_quantity: 2,
      product_url: "https://lunaportex.com/products/first?variant=201",
      captured_at },
    { product_id: "catalog-2", supplier_product_id: "102",
      supplier_variant_id: "202", sku: "ITEM2", title: "Second",
      price: 8, available: true, inventory_quantity: 3,
      product_url: "https://lunaportex.com/products/second", captured_at },
  ]
  const result = await resolveUniversalLunaRequestedProductsV1({
    supabase: directCatalogClient(rows),
    references: ["ITEM2", "https://lunaportex.com/products/first"],
    now: new Date("2026-10-08T12:30:00.000Z"),
  })
  assert.deepEqual(result.map((entry) => entry.supplierSku),
    ["ITEM2", "ITEM1"])
  assert.deepEqual(result.map((entry) => entry.productId), ["102", "101"])

  const batch = buildLunaCatalogControlledTestCandidateBatchV1({
    accountKey: "test-account", lunaCatalogRows: rows,
    requestedProducts: result, targetCandidates: 2,
    now: new Date("2026-10-08T12:30:00.000Z"),
  })
  assert.deepEqual(batch.candidates.map((entry) => entry.supplierSku),
    ["ITEM2", "ITEM1"])
  assert.equal(batch.marketLookupPerformed, false)
})

test("universal Luna resolver fails closed for unknown, stale and stock-unknown products", async () => {
  const base = { product_id: "catalog-1", supplier_product_id: "101",
    supplier_variant_id: "201", sku: "ITEM1", title: "First", price: 7,
    available: true, inventory_quantity: 2,
    product_url: "https://lunaportex.com/products/first",
    captured_at: "2026-10-08T12:00:00.000Z" }
  const now = new Date("2026-10-08T12:30:00.000Z")
  await assert.rejects(() => resolveUniversalLunaRequestedProductsV1({
    supabase: directCatalogClient([base]), references: ["MISSING"], now,
  }), /UNIVERSAL_LUNA_PRODUCT_NOT_FOUND/)
  await assert.rejects(() => resolveUniversalLunaRequestedProductsV1({
    supabase: directCatalogClient([{ ...base,
      captured_at: "2026-10-01T12:00:00.000Z" }]),
    references: ["ITEM1"], now,
  }), /UNIVERSAL_LUNA_PRODUCT_STALE/)
  await assert.rejects(() => resolveUniversalLunaRequestedProductsV1({
    supabase: directCatalogClient([{ ...base, inventory_quantity: null }]),
    references: ["ITEM1"], now,
  }), /UNIVERSAL_LUNA_PRODUCT_OUT_OF_STOCK/)
})

test("official LIVE exact tuple blocks a new candidate despite missing registry row", async () => {
  const liveItemId = "366700000001"
  const endedItemId = "366600000001"
  const accountKey = "test-account"
  const ids = [liveItemId]
  const state = { account_key: accountKey,
    current_live_source_state: "CURRENT_FRESH",
    last_certified_live_item_ids: ids,
    last_certified_live_count: 1,
    last_certified_live_observed_at: new Date().toISOString(),
    last_certified_live_fresh_until: new Date(Date.now() + 900_000).toISOString(),
    last_certified_live_scope_id: currentLiveScopeIdV1(ids, accountKey),
    last_certified_live_source_authority: CURRENT_LIVE_SOURCE_AUTHORITY }
  const values = {
    ebay_active_listing_sync_state: [state],
    seller_os_luna_linkage_decisions: [
      { account_key: accountKey, marketplace_id: "EBAY_US",
        ebay_item_id: endedItemId, luna_product_id: "1",
        luna_variant_id: "2", luna_sku: "ITEM3635",
        decision: "APPROVE_EXACT_LINKAGE", decision_version: 1,
        classification: "EXACT_UNIQUE_MATCH" }],
    seller_os_listing_product_link_authorities_v1: [
      { account_key: accountKey, marketplace_id: "EBAY_US",
        ebay_item_id: liveItemId, luna_product_id: "3",
        luna_variant_id: "4", luna_sku: "ITEM3734",
        lifecycle_state: "ACTIVE" }],
    seller_os_listing_identity_quarantines_v1: [],
  }
  const client = { from(table) {
    let data = values[table] ?? []
    const q = { select() { return q }, eq(key, value) {
      data = data.filter((row) => row[key] === value); return q },
    in(key, allowed) { data = data.filter((row) =>
      allowed.includes(row[key])); return q }, order() { return q },
    limit() { return q }, maybeSingle() { return Promise.resolve({
      data: data[0] ?? null, error: null }) },
    then(resolve, reject) { return Promise.resolve({ data,
      error: null }).then(resolve, reject) } }
    return q
  } }
  const result = await readAlreadyLiveExactLunaIdentitiesV1({
    supabase: client, accountKey, identities: [
      { identityKey: "live", supplierSku: "ITEM3734",
        lunaProductId: "3", lunaVariantId: "4" },
      { identityKey: "ended", supplierSku: "ITEM3635",
        lunaProductId: "1", lunaVariantId: "2" },
    ] })
  assert.equal(result.status, "AVAILABLE")
  assert.deepEqual(result.matches.get("live")?.ebayItemIds, [liveItemId])
  assert.equal(result.matches.has("ended"), false)
  state.last_certified_live_fresh_until = new Date(Date.now() - 1000).toISOString()
  values.seller_os_listing_registry_sweeps_v1 = [{
    sweep_id: "11111111-1111-4111-8111-111111111111",
    account_key: accountKey, marketplace_id: "EBAY_US", status: "COMPLETE",
    official_observed_at: new Date().toISOString(),
    official_live_item_count: 1, reconciled_item_count: 1 }]
  values.seller_os_listing_cases_v1 = [{ account_key: accountKey,
    marketplace_id: "EBAY_US", ebay_item_id: liveItemId,
    listing_status: "ACTIVE", last_reconciled_sweep_id:
      "11111111-1111-4111-8111-111111111111" }]
  const sweepFallback = await readAlreadyLiveExactLunaIdentitiesV1({
    supabase: client, accountKey, identities: [{ identityKey: "live",
      supplierSku: "ITEM3734", lunaProductId: "3", lunaVariantId: "4" }] })
  assert.equal(sweepFallback.status, "AVAILABLE")
  assert.deepEqual(sweepFallback.matches.get("live")?.ebayItemIds, [liveItemId])
})

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
    accountKey: "test-account",
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
    accountKey: "test-account",
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

test("family breadth bounds twenty eligible seeds after fail-closed eligibility filtering", () => {
  const familyId = (index) =>
    `market-family-v1:sha256:${index.toString(16).padStart(64, "0")}`
  const caseId = (index) =>
    `opportunity-case-v1:sha256:${(index + 100).toString(16).padStart(64, "0")}`
  const families = Array.from({ length: 25 }, (_, index) => {
    const entry = family(familyId(index + 1), `eligible family ${index + 1}`,
      caseId(index + 1), 4, 6, "7")
    entry.observationSeries[0].attributeProfile = {
      "category id": "155101", "product family": `eligible family ${index + 1}`,
    }
    if (index < 5) entry.observationSeries[0].fresh = false
    return entry
  })
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: { status: "AVAILABLE", families }, frontierPayload: null,
    lunaCatalogRows: [], targetCandidates: 100,
  })
  assert.equal(RADAR_DISCOVERY_MAXIMUM_ELIGIBLE_FAMILIES, 20)
  assert.equal(result.familySeedCount, 20)
  assert.equal(result.familyDiversityCount, 20)
  assert.equal(result.seeds[0].familyName, "eligible family 6")
  assert.equal(result.seeds.at(-1).familyName, "eligible family 25")
})

test("exact Luna assignments preserve family round-robin diversity before the candidate cap", () => {
  const families = structuredClone(radarPayload)
  families.families[0].familyName = "alpha necklace"
  families.families[0].observationSeries[0].attributeProfile = {
    "category id": "155101", "product family": "alpha necklace",
  }
  families.families[0].observationSeries[0].demandKeywordDna = {
    soldWeightedTerms: [
      { term: "alpha necklace", familyType: "CORE" },
      { term: "necklace", familyType: "ATTRIBUTE" },
    ],
  }
  families.families[1].familyName = "beta bracelet"
  families.families[1].observationSeries[0].attributeProfile = {
    "category id": "155101", "product family": "beta bracelet",
  }
  families.families[1].observationSeries[0].demandKeywordDna = {
    soldWeightedTerms: [
      { term: "beta bracelet", familyType: "CORE" },
      { term: "bracelet", familyType: "ATTRIBUTE" },
    ],
  }
  const catalogRows = [
    ["alpha necklace one", "A-1"], ["alpha necklace two", "A-2"],
    ["beta bracelet one", "B-1"], ["beta bracelet two", "B-2"],
  ].map(([title, sku], index) => ({
    product_id: `catalog-${sku}`,
    supplier_product_id: `product-${index}`,
    supplier_variant_id: `variant-${index}`,
    sku, title, product_type: "Jewelry & Accessories",
    tags: ["Category: Jewelry & Accessories"], available: true,
  }))
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: families, frontierPayload: null, lunaCatalogRows: catalogRows,
    targetCandidates: 2,
  })
  assert.equal(result.candidates.length, 2)
  assert.deepEqual(new Set(result.candidates.map((candidate) => candidate.familyId)),
    new Set([teslaFamilyId, microFamilyId]))
  assert.equal(result.marketplaceWrites, 0)
})

test("unproven family demand and fuzzy Product Research rows never enter the candidate input", () => {
  const unproven = structuredClone(radarPayload)
  unproven.families[0].observationSeries[0].familyDemandStatus =
    "FAMILY_DEMAND_UNPROVEN"
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
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

test("Quick Pick explicitly admits non-negative unproven demand without changing Radar defaults", () => {
  const marketTest = structuredClone(radarPayload)
  const observation = marketTest.families[0].observationSeries[0]
  marketTest.families[0].familyName = "shoe organizer"
  observation.familyDemandStatus = "FAMILY_DEMAND_UNPROVEN"
  observation.soldComparableCount = null
  observation.soldQuantity = null
  observation.priceCurrency = null
  observation.priceBandMinimum = null
  observation.priceBandMaximum = null
  observation.priceMedian = null
  observation.attributeProfile = { "category id": "261600",
    "product family": "shoe organizer",
    "supplier product type": "home kitchen" }
  observation.demandKeywordDna = null
  observation.limitations = ["DEMAND_EVIDENCE_ABSENT_NOT_NEGATIVE",
    "MARKET_PRICE_SUPPORT_UNPROVEN"]
  const row = { product_id: "9220999999999",
    supplier_product_id: "9220999999999",
    supplier_variant_id: "48809999999999", sku: "SHOE-TEST",
    title: "Shoe organizer", variant_title: "Black",
    product_type: "home kitchen", tags: ["home kitchen"], price: 12.5,
    available: true, inventory_quantity: 3,
    product_url: "https://www.lunaportex.com/products/shoe-organizer",
    image_urls: ["https://cdn.example.test/shoe.webp"], barcode: null,
    captured_at: "2026-08-31T12:00:00.000Z" }
  const defaultBatch = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: marketTest, frontierPayload: { frontiers: [] },
    lunaCatalogRows: [row], targetCandidates: 2,
  })
  assert.equal(defaultBatch.candidates.length, 0)
  const quickPickBatch = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: marketTest, frontierPayload: { frontiers: [] },
    lunaCatalogRows: [row], targetCandidates: 2,
    allowUnprovenMarketTest: true,
  })
  assert.equal(quickPickBatch.candidates.length, 1)
  assert.equal(quickPickBatch.candidates[0].marketTestPath, true)
  const preflight = buildRadarCandidateEconomicsPreflightV1({
    accountKey: "seller-os-preprod", candidate: quickPickBatch.candidates[0],
  })
  assert.equal(preflight.frontier.familyDemandStatus,
    "FAMILY_DEMAND_UNPROVEN")
  assert.equal(preflight.frontier.nextBestEvidence, "ACTUAL_LUNA_SHIPPING")
  assert.equal(preflight.frontier.marketPriceMedian, null)
  assert.equal(preflight.frontier.quickPickMarketTestV1.marketPriceSupport,
    "UNPROVEN")
  assert.equal(preflight.frontier.quickPickMarketTestV1
    .demandNegativeEvidencePresent, false)
})

test("fresh FAMILY_DEMAND_SUPPORTED enters only with complementary exact stock and economics evidence", () => {
  const supported = structuredClone(radarPayload)
  supported.families[0].observationSeries[0].familyDemandStatus =
    "FAMILY_DEMAND_SUPPORTED"
  const accepted = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
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
    accountKey: "test-account",
    radarPayload: supported, frontierPayload: weakEconomics, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(parked.candidates[0].readyForEconomics, false)

  const blocked = structuredClone(frontierPayload)
  blocked.frontiers[0].frontier.currentHardBlockers = ["POLICY_BLOCKER_PRESENT"]
  delete blocked.frontiers[0].frontier.hardBlockers
  const failClosed = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: supported, frontierPayload: blocked, lunaCatalogRows,
    allowedFamilyNames: ["Tesla Gen II NEMA adapters"], targetCandidates: 30,
  })
  assert.equal(failClosed.candidates[0].readyForEconomics, false)
})

test("stale family evidence never enters the durable factory adapter", () => {
  const stale = structuredClone(radarPayload)
  stale.families[0].observationSeries[0].fresh = false
  const result = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
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
    accountKey: "test-account",
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
    accountKey: "test-account",
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
    accountKey: "test-account",
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

test("Revenue Factory reads every explicit catalog page and recovers an exact identity after row 1000", async () => {
  const firstPage = Array.from({ length: RADAR_LUNA_CATALOG_PAGE_SIZE },
    (_, index) => ({
      product_id: `catalog-${index}`,
      supplier_product_id: `product-${index}`,
      supplier_variant_id: `variant-${index}`,
      sku: `SKU-${index}`,
      title: `Unrelated craft product ${index}`,
      product_type: "Craft & DIY",
      tags: ["Category: Craft & DIY"],
      available: true,
      captured_at: "2026-08-31T06:00:00.000Z",
    }))
  const recovered = {
    product_id: "catalog-rainbow-agate",
    supplier_product_id: "9220860051680",
    supplier_variant_id: "53002139205856",
    sku: "FL-NHPF3369737",
    title: "Rainbow Natural Agate Stone Necklace",
    variant_title: "Default",
    product_type: "Jewelry & Accessories",
    tags: ["Category: Jewelry & Accessories"],
    price: "8.50",
    available: true,
    inventory_quantity: 7,
    captured_at: "2026-08-31T05:00:00.000Z",
  }
  const ranges = []
  const supabase = { from(table) {
    assert.equal(table, "market_radar_latest_variants")
    const query = {
      select() { return query },
      eq() { return query },
      order() { return query },
      async range(from, to) {
        ranges.push([from, to])
        return { data: from === 0 ? firstPage : [recovered, recovered],
          error: null }
      },
    }
    return query
  } }
  const catalog = await readRadarRevenueFactoryLunaCatalogV1(supabase)
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
  assert.equal(catalog.pageCount, 2)
  assert.equal(catalog.rowsRead, 1002)
  assert.equal(catalog.uniqueIdentities, 1001)
  assert.equal(catalog.truncated, false)

  const agateFamily = family(teslaFamilyId, "rainbow natural agate stone",
    teslaCaseId, 8, 12, "5")
  agateFamily.observationSeries[0].attributeProfile = {
    "category id": "155101",
    "product family": "rainbow natural agate stone",
  }
  agateFamily.observationSeries[0].demandKeywordDna = { soldWeightedTerms: [
    { term: "rainbow natural agate stone", familyType: "CORE" },
    { term: "necklace", familyType: "ATTRIBUTE" },
  ] }
  const batch = buildRadarRevenueFactoryCandidateBatchV1({
    accountKey: "test-account",
    radarPayload: { status: "AVAILABLE", families: [agateFamily] },
    frontierPayload: null,
    lunaCatalogRows: catalog.rows,
    catalogReadMetadata: catalog,
    targetCandidates: 10,
  })
  assert.equal(batch.catalogPageCount, 2)
  assert.equal(batch.catalogRowsRead, 1002)
  assert.equal(batch.catalogUniqueIdentities, 1001)
  assert.equal(batch.catalogTruncated, false)
  assert.equal(batch.familyToLunaCompatibleCount, 1)
  assert.equal(batch.candidates[0].supplierSku, "FL-NHPF3369737")
  assert.equal(batch.candidates[0].lunaProductId, "9220860051680")
  assert.equal(batch.candidates[0].lunaVariantId, "53002139205856")
  assert.equal(batch.candidates[0].exactCandidateIdentity, true)
  assert.equal(batch.candidates[0].stockReady, true)
})

test("Revenue Factory catalog pagination stops at its explicit safe bound", async () => {
  const fullPage = Array.from({ length: RADAR_LUNA_CATALOG_PAGE_SIZE },
    (_, index) => ({ supplier_product_id: `product-${index}`,
      supplier_variant_id: `variant-${index}`, sku: `SKU-${index}` }))
  let pageCount = 0
  const catalog = await readRadarRevenueFactoryLunaCatalogV1({ from() {
    const query = {
      select() { return query }, eq() { return query }, order() { return query },
      async range() { pageCount += 1; return { data: fullPage, error: null } },
    }
    return query
  } })
  assert.equal(pageCount,
    RADAR_LUNA_CATALOG_MAX_ROWS / RADAR_LUNA_CATALOG_PAGE_SIZE)
  assert.equal(catalog.rowsRead, RADAR_LUNA_CATALOG_MAX_ROWS)
  assert.equal(catalog.truncated, true)
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
    accountKey: "test-account",
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
    accountKey: "test-account",
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
    accountKey: "test-account",
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
