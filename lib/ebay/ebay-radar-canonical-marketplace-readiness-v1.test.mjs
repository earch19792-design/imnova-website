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

const {
  resolveRadarCanonicalMarketplaceReadinessV1,
  resolveRadarRequiredItemSpecificsTruthV1,
} = await import(
  "./ebay-radar-canonical-marketplace-readiness-v1.ts")

const OPPORTUNITY_ID = "11111111-1111-4111-8111-111111111111"
const PACKAGE_ID = "22222222-2222-4222-8222-222222222222"
const CANDIDATE_KEY = "luna-portex:9000000000111:9000000000222"
const RADAR_ID = `sha256:${"1".repeat(64)}`
const ACCOUNT_KEY = `seller:${"a".repeat(64)}`

function opportunity(supplierConfirmed = {}) {
  return {
    id: OPPORTUNITY_ID,
    candidate_key: CANDIDATE_KEY,
    supplier_product_id: "9000000000111",
    supplier_variant_id: "9000000000222",
    supplier_sku: "GENERIC-001",
    gtin: null,
    product_title: "Exact supplier necklace",
    assessment: {
      radarFactoryCandidateV1: {
        contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
        authority: "SELLER_OS_DETERMINISTIC_FACTORY",
        candidateId: RADAR_ID,
        demandEvidenceGrain: "FAMILY",
        exactProductDemandClaimed: false,
      },
      productTruth: {
        authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        evidenceDigest: `sha256:${"b".repeat(64)}`,
        candidateKey: RADAR_ID,
        title: "Exact supplier necklace",
      },
      listingIntelligencePackage: {
        titleStrategy: { primarySearchPhrase: "necklace" },
        itemSpecifics: { supplierConfirmed },
      },
    },
  }
}

function listingPackage(overrides = {}) {
  return {
    id: PACKAGE_ID,
    account_key: ACCOUNT_KEY,
    opportunity_id: OPPORTUNITY_ID,
    candidate_key: CANDIDATE_KEY,
    package_data: {
      categoryId: "155101",
      categoryName: "Necklaces & Pendants",
      conditionId: "1000",
      conditionLabel: "New",
      aspects: { Brand: "Supplier is not manufacturer brand" },
    },
    ...overrides,
  }
}

function supabase(profileOverrides = {}, catalogOverrides = {}) {
  const profile = {
    account_key: ACCOUNT_KEY,
    marketplace_id: "EBAY_US",
    fulfillment_policy_id: "F1",
    payment_policy_id: "P1",
    return_policy_id: "R1",
    merchant_location_key: "US_LOCATION",
    verification_source: "EBAY_ACCOUNT_API_GET",
    verified_at: "2026-08-30T12:00:00.000Z",
    expires_at: "2026-09-29T12:00:00.000Z",
    ...profileOverrides,
  }
  const profileQuery = {
    select() { return this },
    eq() { return this },
    gt() { return this },
    order() { return this },
    limit() { return this },
    maybeSingle() { return Promise.resolve({ data: profile, error: null }) },
  }
  const catalog = {
    product_id: "9000000000111",
    supplier_product_id: "9000000000111",
    supplier_variant_id: "9000000000222",
    sku: "GENERIC-001",
    title: "Exact supplier necklace",
    variant_title: "Default Title",
    vendor: "Luna Warehouse",
    product_type: "Jewelry & Accessories",
    tags: [],
    metadata: {},
    captured_at: "2026-08-30T12:30:00.000Z",
    ...catalogOverrides,
  }
  const catalogQuery = {
    select() { return this },
    eq() { return this },
    limit() { return Promise.resolve({ data: [catalog], error: null }) },
  }
  return { from(table) {
    if (table === "ebay_account_policy_profiles") return profileQuery
    if (table === "market_radar_latest_variants") return catalogQuery
    assert.fail(`unexpected table ${table}`)
  } }
}

function taxonomy() {
  const aspect = (name, { mode = "FREE_TEXT", cardinality = "SINGLE",
    values = [] } = {}) => ({
    name,
    mode,
    cardinality,
    maxLength: 65,
    dataType: "STRING",
    format: null,
    advancedDataType: null,
    expectedRequiredByDate: null,
    required: true,
    enabledForVariations: false,
    usage: "REQUIRED",
    suggestedValues: values,
    values: values.map((value) => ({ value, valueConstraints: [] })),
    valuesComplete: true,
    constraintsComplete: true,
  })
  const aspects = [
    aspect("Brand", { mode: "SELECTION_ONLY",
      values: ["Unbranded", "Betsey Johnson", "Other"] }),
    aspect("Style", { cardinality: "MULTI",
      values: ["Charm", "Layered", "Pendant"] }),
    aspect("Type", { values: ["Necklace", "Pendant"] }),
  ]
  return {
    status: "AVAILABLE",
    categoryTreeId: "0",
    categoryTreeVersion: "2026-08-30",
    categoryId: "155101",
    categoryName: "Necklaces & Pendants",
    taxonomyMarketplaceId: "EBAY_US",
    observedAt: "2026-08-30T13:00:00.000Z",
    aspects,
    requiredAspects: aspects,
    recommendedAspects: [],
    categoryResolution: "KNOWN_CATEGORY",
    failureCode: null,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  }
}

test("exact supplier title resolves Style and Type but supplier vendor cannot fabricate Brand", () => {
  const base = opportunity()
  const result = resolveRadarRequiredItemSpecificsTruthV1({
    opportunity: base,
    productTruth: base.assessment.productTruth,
    taxonomy: taxonomy(),
    catalogRow: {
      supplier_product_id: "9000000000111",
      supplier_variant_id: "9000000000222",
      sku: "GENERIC-001",
      title: "Women's Butterfly & Heart Layered Necklace - Adjustable Chain",
      vendor: "Luna Warehouse",
      captured_at: "2026-08-30T12:30:00.000Z",
    },
  })
  assert.equal(result.exactIdentity, true)
  assert.deepEqual(result.productTruth.provenProductValues, {
    Style: "Layered", Type: "Necklace",
  })
  assert.deepEqual(result.resolutions.Style, {
    value: "Layered", source: "LUNA_EXACT_PRODUCT_TITLE",
    exactProductSupported: true,
  })
  assert.deepEqual(result.resolutions.Type, {
    value: "Necklace", source: "LUNA_EXACT_PRODUCT_TITLE",
    exactProductSupported: true,
  })
  assert.deepEqual(result.resolutions.Brand, {
    value: null, source: null, exactProductSupported: false,
  })
  assert.deepEqual(result.evidence.unsupportedRequiredSpecifics, ["Brand"])
  assert.equal(result.evidence.demandEvidenceGrain, "FAMILY")
  assert.equal(result.evidence.exactProductDemandClaimed, false)
  assert.equal(result.evidence.marketplaceWrites, 0)
})

test("readiness persists exact title aspects and parks only the unproven Brand", async () => {
  const base = opportunity()
  const result = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase({}, {
      title: "Women's Butterfly & Heart Layered Necklace - Adjustable Chain",
    }),
    accountKey: ACCOUNT_KEY,
    opportunity: base,
    listingPackage: listingPackage(),
    productTruthExact: true,
    productTruth: base.assessment.productTruth,
    taxonomyReader: async () => taxonomy(),
    now: new Date("2026-08-30T13:10:00.000Z"),
  })
  assert.equal(result.evidence.requiredItemSpecificsCount, 3)
  assert.equal(result.evidence.requiredItemSpecificsSatisfied, 2)
  assert.deepEqual(result.evidence.unsupportedRequiredSpecifics, ["Brand"])
  assert.deepEqual(result.evidence.taxonomyPreflight.resolvedAspects, {
    Style: "Layered", Type: "Necklace",
  })
  assert.deepEqual(result.productTruth.provenProductValues, {
    Style: "Layered", Type: "Necklace",
  })
  assert.deepEqual(result.evidence.blockers,
    ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand"])
  assert.equal(result.evidence.ready, false)
})

test("exact Product Truth, official category and account policies produce canonical readiness", async () => {
  const result = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase(),
    accountKey: ACCOUNT_KEY,
    opportunity: opportunity({
      Brand: "Unbranded", Style: "Pendant", Type: "Necklace",
    }),
    listingPackage: listingPackage(),
    productTruthExact: true,
    productTruth: opportunity().assessment.productTruth,
    taxonomyReader: async () => taxonomy(),
    now: new Date("2026-08-30T13:10:00.000Z"),
  })
  assert.equal(result.evidence.ready, true)
  assert.equal(result.evidence.categoryReady, true)
  assert.equal(result.evidence.conditionReady, true)
  assert.equal(result.evidence.requiredItemSpecificsCount, 3)
  assert.equal(result.evidence.requiredItemSpecificsSatisfied, 3)
  assert.deepEqual(result.evidence.unsupportedRequiredSpecifics, [])
  assert.equal(result.evidence.listingPolicyReady, true)
  assert.equal(result.evidence.marketplaceWrites, 0)
})

test("legacy package aspects never fill required specifics beyond exact title truth", async () => {
  const result = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase(),
    accountKey: ACCOUNT_KEY,
    opportunity: opportunity(),
    listingPackage: listingPackage(),
    productTruthExact: true,
    productTruth: opportunity().assessment.productTruth,
    taxonomyReader: async () => taxonomy(),
    now: new Date("2026-08-30T13:10:00.000Z"),
  })
  assert.equal(result.evidence.categoryReady, true)
  assert.equal(result.evidence.requiredItemSpecificsReady, false)
  assert.equal(result.evidence.requiredItemSpecificsSatisfied, 1)
  assert.deepEqual(result.evidence.unsupportedRequiredSpecifics,
    ["Brand", "Style"])
  assert.deepEqual(result.evidence.taxonomyPreflight.resolvedAspects,
    { Type: "Necklace" })
  assert.match(result.evidence.blockers[0],
    /^MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:/)
})

test("a mismatched durable package cannot authorize category or condition", async () => {
  let taxonomyCalls = 0
  const result = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase(),
    accountKey: ACCOUNT_KEY,
    opportunity: opportunity(),
    listingPackage: listingPackage({ candidate_key: "wrong-candidate" }),
    productTruthExact: true,
    productTruth: opportunity().assessment.productTruth,
    taxonomyReader: async () => { taxonomyCalls += 1; return taxonomy() },
    now: new Date("2026-08-30T13:10:00.000Z"),
  })
  assert.equal(taxonomyCalls, 0)
  assert.equal(result.evidence.categoryReady, false)
  assert.equal(result.evidence.conditionReady, false)
  assert.equal(result.evidence.sellerAccountBindingReady, false)
})

test("same exact candidate and evidence reuse the durable readiness binding", async () => {
  const firstOpportunity = opportunity({
    Brand: "Unbranded", Style: "Pendant", Type: "Necklace",
  })
  const first = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase(), accountKey: ACCOUNT_KEY,
    opportunity: firstOpportunity,
    listingPackage: listingPackage(), productTruthExact: true,
    productTruth: firstOpportunity.assessment.productTruth,
    taxonomyReader: async () => taxonomy(),
    now: new Date("2026-08-30T13:10:00.000Z"),
  })
  let taxonomyCalls = 0
  const rebound = {
    ...firstOpportunity,
    assessment: {
      ...firstOpportunity.assessment,
      productTruth: first.productTruth,
      canonicalMarketplaceReadinessV1: first.evidence,
    },
  }
  const second = await resolveRadarCanonicalMarketplaceReadinessV1({
    supabase: supabase(), accountKey: ACCOUNT_KEY,
    opportunity: rebound,
    listingPackage: listingPackage(), productTruthExact: true,
    productTruth: rebound.assessment.productTruth,
    taxonomyReader: async () => { taxonomyCalls += 1; return taxonomy() },
    now: new Date("2026-08-30T13:20:00.000Z"),
  })
  assert.equal(second.acquisitionRequired, false)
  assert.equal(second.reused, true)
  assert.equal(taxonomyCalls, 0)
})
