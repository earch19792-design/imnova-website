import assert from "node:assert/strict"
import test from "node:test"
import { registerHooks } from "node:module"
import { readFileSync } from "node:fs"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const subject = await import("./ebay-demand-first-broad-net-orchestrator-v1.ts")
const familyContracts = await import(
  "./ebay-prelinked-family-market-observation-v1.ts")
const { buildEbaySellerKeywordDemandValidation } = await import(
  "./ebay-seller-keyword-demand-validation.ts")
const {
  buildSellerOsDemandKeywordDnaV1,
  buildPersistedDailyDollarFamiliesV1,
  buildSellerOsDemandFirstFamilyCandidatesV1,
  discoverAndPersistSellerOsOnDemandFamilyDemandV1,
  evaluateSellerOsDemandFirstFamilyCandidatesV1,
  marketEvidenceFromOfficialSoldObservationV1,
  resolveSellerOsOfficialSoldCategoryAuthoritiesV1,
  runSellerOsDemandFirstBroadNetCanaryV1,
  runSellerOsDemandFirstBroadNetNightlyV1,
  runSellerOsDemandFirstBroadNetServerReplayV1,
} = subject

const batchId = "11111111-1111-4111-8111-111111111111"
const taskId = "22222222-2222-4222-8222-222222222222"
const capturedAt = "2026-08-20T12:00:00.000Z"

function task(overrides = {}) {
  return { id: taskId, search_query: "portable usb desk fan",
    category_id: "20612", status: "PROCESSED", capture_batch_id: batchId,
    captured_at: capturedAt, ...overrides }
}

function batch(overrides = {}) {
  return { id: batchId, search_query_hash: `sha256:${"1".repeat(64)}`,
    search_keyword_patterns: ["portable", "usb", "desk", "fan"],
    date_range: { start: Date.parse("2026-07-21T12:00:00.000Z"),
      end: Date.parse(capturedAt) }, captured_at: capturedAt,
    source: "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE", listing_site: "www.ebay.com",
    raw_html_stored: false, pii_stored: false, ...overrides }
}

function observation(id, productName, price, quantity = 2, overrides = {}) {
  return { id, capture_batch_id: batchId,
    source_listing_id: id.replaceAll("-", "").slice(0, 12),
    identity_hash: `sha256:${id.replaceAll("-", "").padEnd(64, "0").slice(0, 64)}`,
    normalized_identity: { normalizedProductName: productName, formFactor: "desk fan" },
    average_sold_price: price, average_shipping: 0,
    confirmed_sold_quantity: quantity, last_sold_date: capturedAt,
    keyword_signals: ["portable usb fan", "desk fan"], evidence_reviewed: true,
    quality_status: "VALID", seller_reference_fingerprint: null, ...overrides }
}

function qualifiedFixture() {
  return {
    tasks: [task()], batches: [batch()], existingCases: [], observations: [
      observation("33333333-3333-4333-8333-333333333333",
        "Portable USB Desk Fan", 22.99, 3),
      observation("44444444-4444-4444-8444-444444444444",
        "USB Portable Desk Fan", 24.99, 4),
    ],
  }
}

test("reviewed official sold evidence builds one bounded canonical family", () => {
  const candidates = buildSellerOsDemandFirstFamilyCandidatesV1(qualifiedFixture())
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].status, "QUALIFIED")
  assert.equal(candidates[0].observation.familyDemandStatus,
    "FAMILY_DEMAND_SUPPORTED")
  assert.equal(candidates[0].observation.soldComparableCount, 2)
  assert.equal(candidates[0].observation.soldQuantityEvidence.quantity, 7)
  assert.equal(candidates[0].familyDefinition.familyQuerySet.includes(
    "portable usb desk fan"), true)
  const dna = candidates[0].familyDefinition.demandKeywordDna
  assert.equal(dna.contractVersion, "SELLER_OS_DEMAND_KEYWORD_DNA_V1")
  assert.equal(dna.primaryDemandKeyword, dna.soldWeightedTerms[0].term)
  assert.equal(dna.keywordEvidenceClass, "OFFICIAL_SOLD_EVIDENCE")
  assert.equal(dna.keywordDemandConfidence.scope, "FAMILY_LEVEL")
  assert.equal(dna.keywordDemandConfidence.exactProductDemandClaimed, false)
  assert.ok(dna.titleTokenStructure.length > 0)
})

test("on-demand exact Luna discovery distinguishes unavailable sold authority from missing prior family", async () => {
  let demandReads = 0
  const result = await discoverAndPersistSellerOsOnDemandFamilyDemandV1({
    supabase: { rpc() { throw new Error("UNEXPECTED_PERSISTENCE_WRITE") } },
    accountKey: "seller-test",
    lunaCatalogRow: { supplier_product_id: "9878493888736",
      supplier_variant_id: "53195341725920", sku: "1775139952194002944",
      title: "Clear Over the Door Shoe Organizer with 24 Fabric Pockets",
      variant_title: "Black And White", product_type: "Bags & Storage",
      tags: ["Category: Bags & Storage", "Zendrop"], price: 19.99 },
    async demandReader(candidate) {
      demandReads += 1
      return buildEbaySellerKeywordDemandValidation({ candidate,
        comparables: [], insightsAvailability: "NOT_CONFIGURED",
        asOf: "2026-08-31T12:00:00.000Z" })
    },
  })
  assert.equal(demandReads, 1)
  assert.equal(result.status, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(result.reasonCode,
    "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED")
  assert.equal(result.exactProductDemandClaimed, false)
  assert.equal(result.familyBindingCreatedOrReused, false)
  assert.equal(result.demandNegativeEvidencePresent, false)
  assert.ok(result.marketTestRadarFamily)
  assert.equal(result.marketTestRadarFamily.observationSeries[0]
    .familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(result.marketTestRadarFamily.observationSeries[0]
    .limitations.includes("DEMAND_EVIDENCE_ABSENT_NOT_NEGATIVE"), true)
  assert.equal(result.marketTestRadarFamily.observationSeries[0]
    .limitations.includes("MARKETPLACE_CATEGORY_UNPROVEN"), true)
})

test("active-only evidence creates a bounded in-memory market-test seed without persistence", async () => {
  let persistenceWrites = 0
  const result = await discoverAndPersistSellerOsOnDemandFamilyDemandV1({
    supabase: { rpc() { persistenceWrites += 1
      throw new Error("UNEXPECTED_PERSISTENCE_WRITE") } },
    accountKey: "seller-test",
    lunaCatalogRow: { supplier_product_id: "9878493888736",
      supplier_variant_id: "53195341725920", sku: "1775139952194002944",
      title: "Clear Over the Door Shoe Organizer with 24 Fabric Pockets",
      variant_title: "Black", product_type: "home kitchen",
      tags: ["home kitchen"], price: 19.99 },
    async demandReader(candidate) {
      return buildEbaySellerKeywordDemandValidation({ candidate,
        comparables: [
          { itemId: "111111111111", title: "Over Door Shoe Organizer 24 Pockets",
            price: 34.99, currency: "USD", categoryId: "116019",
            categoryName: "Shoe Organizers", sellerUsername: "seller-a",
            source: "EBAY_BROWSE_ACTIVE_LISTING" },
          { itemId: "222222222222", title: "Clear Hanging Shoe Organizer",
            price: 32.99, currency: "USD", categoryId: "116019",
            categoryName: "Shoe Organizers", sellerUsername: "seller-b",
            source: "EBAY_BROWSE_ACTIVE_LISTING" },
        ], insightsAvailability: "NOT_CONFIGURED",
        asOf: "2026-08-31T12:00:00.000Z" })
    },
  })
  assert.equal(persistenceWrites, 0)
  assert.equal(result.status, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(result.reasonCode,
    "ON_DEMAND_MARKETPLACE_INSIGHTS_NOT_CONFIGURED")
  assert.equal(result.demandNegativeEvidencePresent, false)
  assert.equal(result.familyBindingCreatedOrReused, false)
  assert.equal(result.marketTestRadarFamily?.observationSeries?.[0]
    ?.familyDemandStatus, "FAMILY_DEMAND_UNPROVEN")
  assert.equal(result.marketTestRadarFamily?.observationSeries?.[0]
    ?.limitations?.includes("DEMAND_EVIDENCE_ABSENT_NOT_NEGATIVE"), true)
})

test("available sold authority with no compatible sales is demand not proven", async () => {
  const result = await discoverAndPersistSellerOsOnDemandFamilyDemandV1({
    supabase: { rpc() { throw new Error("UNEXPECTED_PERSISTENCE_WRITE") } },
    accountKey: "seller-test",
    lunaCatalogRow: { supplier_product_id: "9878493888736",
      supplier_variant_id: "53195341725920", sku: "1775139952194002944",
      title: "Clear Over the Door Shoe Organizer with 24 Fabric Pockets",
      variant_title: "Black", product_type: "home kitchen",
      tags: ["home kitchen"], price: 19.99 },
    async demandReader(candidate) {
      return buildEbaySellerKeywordDemandValidation({ candidate,
        comparables: [], insightsAvailability: "AVAILABLE",
        asOf: "2026-08-31T12:00:00.000Z" })
    },
  })
  assert.equal(result.status, "DEMAND_NOT_PROVEN")
  assert.equal(result.reasonCode,
    "ON_DEMAND_OFFICIAL_SOLD_FAMILY_EVIDENCE_INSUFFICIENT")
})

test("qualified on-demand sold evidence reaches the existing family persistence boundary", async () => {
  const result = await discoverAndPersistSellerOsOnDemandFamilyDemandV1({
    supabase: { async rpc() { return { data: null, error: { code: "TEST" } } } },
    accountKey: "seller-test",
    lunaCatalogRow: { supplier_product_id: "9878493888736",
      supplier_variant_id: "53195341725920", sku: "1775139952194002944",
      title: "Clear Over the Door Shoe Organizer with 24 Fabric Pockets",
      variant_title: "Black", product_type: "home kitchen",
      tags: ["home kitchen"], price: 19.99 },
    async demandReader(candidate) {
      return buildEbaySellerKeywordDemandValidation({ candidate,
        comparables: [
          { itemId: "111111111111", title: "Clear Over Door Shoe Organizer 24 Pockets",
            price: 34.99, currency: "USD", categoryId: "116019",
            categoryName: "Shoe Organizers", sellerUsername: "seller-a",
            totalSoldQuantity: 4, lastSoldDate: "2026-08-30T12:00:00.000Z",
            source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY" },
          { itemId: "222222222222", title: "Over The Door Shoe Organizer 24 Pocket Clear",
            price: 36.99, currency: "USD", categoryId: "116019",
            categoryName: "Shoe Organizers", sellerUsername: "seller-b",
            totalSoldQuantity: 5, lastSoldDate: "2026-08-29T12:00:00.000Z",
            source: "EBAY_MARKETPLACE_INSIGHTS_SOLD_HISTORY" },
        ], insightsAvailability: "AVAILABLE",
        asOf: "2026-08-31T12:00:00.000Z" })
    },
  })
  assert.equal(result.status, "DEMAND_DISCOVERY_UNAVAILABLE")
  assert.equal(result.reasonCode, "ON_DEMAND_DEMAND_PERSISTENCE_UNAVAILABLE")
  assert.equal(result.soldComparableCount, 2)
  assert.equal(result.exactProductDemandClaimed, false)
})

test("official sold handoff preserves sold keyword family identity and exact category authority", () => {
  const row = observation("33333333-3333-4333-8333-333333333333", null,
    22.99, 3, { keyword_signals: ["portable", "usb", "desk", "fan"] })
  const evidence = marketEvidenceFromOfficialSoldObservationV1({
    task: task({ search_query: "seed text must not become identity", category_id: null }),
    batch: batch(), observation: row,
    categoryAuthority: { observationId: row.id, categoryId: "20612",
      status: "AVAILABLE", source: "EBAY_BROWSE_LEGACY_ITEM_READONLY" },
  })
  assert.equal(evidence.title, "portable usb desk fan")
  assert.equal(evidence.title.includes("seed text"), false)
  assert.equal(evidence.categoryId, "20612")
  assert.equal(evidence.itemId, row.source_listing_id)
  assert.equal(evidence.source, "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE")
  assert.equal(evidence.confirmedSoldQuantity, 3)
  assert.equal(evidence.confirmedSold, true)
  assert.equal(evidence.activeListing, false)
  assert.deepEqual(evidence.keywordSignals, ["portable", "usb", "desk", "fan"])
})

test("missing normalized names reach clustering through existing sold keyword identity", () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: null })]
  fixture.observations = fixture.observations.map((row) => ({ ...row,
    normalized_identity: { ...row.normalized_identity, normalizedProductName: null },
    keyword_signals: ["portable", "usb", "desk", "fan"],
  }))
  const categoryAuthorities = fixture.observations.map((row) => ({
    observationId: row.id, categoryId: "20612", status: "AVAILABLE",
    source: "EBAY_BROWSE_LEGACY_ITEM_READONLY",
  }))
  const candidates = buildSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, categoryAuthorities,
  })
  assert.equal(candidates[0].status, "QUALIFIED")
  assert.equal(candidates[0].observation.soldComparableCount, 2)
  assert.equal(candidates[0].observation.soldQuantityEvidence.quantity, 7)
  assert.equal(candidates[0].familyDefinition.identity.category,
    "ebay-us-category:20612")
  assert.equal(candidates[0].familyDefinition.demandKeywordDna
    .keywordEvidenceClass, "OFFICIAL_SOLD_EVIDENCE")
})

test("official category reader is bounded, read-only, and unavailable rows fail closed", async () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: null })]
  const reads = []
  const authorities = await resolveSellerOsOfficialSoldCategoryAuthoritiesV1({
    tasks: fixture.tasks, observations: fixture.observations,
    officialItemReader: async (itemId) => {
      reads.push(itemId)
      return itemId === fixture.observations[0].source_listing_id
        ? { itemId: `v1|${itemId}|0`, categoryId: "20612",
          source: "EBAY_BROWSE_ACTIVE_LISTING" }
        : { itemId: `v1|${itemId}|0`, categoryId: null,
          source: "EBAY_BROWSE_ACTIVE_LISTING" }
    },
  })
  assert.equal(reads.length, 2)
  assert.deepEqual(authorities.map((row) => row.status),
    ["AVAILABLE", "CATEGORY_UNAVAILABLE"])
  const candidates = buildSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, categoryAuthorities: authorities,
  })
  assert.equal(candidates[0].status, "UNQUALIFIED")
  assert.equal(candidates[0].reason, "DEFENSIBLE_FAMILY_EVIDENCE_INSUFFICIENT")
})

test("keyword DNA uses deterministic sold weighting and never promotes active-only terms", () => {
  const input = {
    keywordFamilies: [
      { canonicalPhrase: "portable desk fan", familyType: "CORE",
        soldListingsObserved: 2, soldQuantityObserved: 7, qualityScore: 90,
        evidenceStatus: "SOLD_EVIDENCE_AVAILABLE",
        soldEvidenceReferences: ["evidence:a", "evidence:b"] },
      { canonicalPhrase: "office cooling", familyType: "USE_CASE",
        soldListingsObserved: 1, soldQuantityObserved: 5, qualityScore: 80,
        evidenceStatus: "SOLD_EVIDENCE_AVAILABLE",
        soldEvidenceReferences: ["evidence:a"] },
      { canonicalPhrase: "usb powered", familyType: "ATTRIBUTE",
        soldListingsObserved: 1, soldQuantityObserved: 4, qualityScore: 75,
        evidenceStatus: "SOLD_EVIDENCE_AVAILABLE",
        soldEvidenceReferences: ["evidence:b"] },
      { canonicalPhrase: "compatible with stroller", familyType: "FEATURE",
        soldListingsObserved: 1, soldQuantityObserved: 3, qualityScore: 70,
        evidenceStatus: "SOLD_EVIDENCE_AVAILABLE",
        soldEvidenceReferences: ["evidence:b"] },
      { canonicalPhrase: "unproven active phrase", familyType: "FEATURE",
        soldListingsObserved: 99, soldQuantityObserved: 999, qualityScore: 100,
        evidenceStatus: "ACTIVE_LISTING_EVIDENCE_ONLY",
        soldEvidenceReferences: [] },
    ],
    soldTitles: [
      { title: "Portable Desk Fan Office Cooling", soldQuantityObserved: 5,
        evidenceReference: "evidence:a" },
      { title: "Portable Desk Fan", soldQuantityObserved: 2,
        evidenceReference: "evidence:b" },
    ],
    familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
    evidenceObservedAt: capturedAt,
    maximumAgeSeconds: 2_592_000,
  }
  const first = buildSellerOsDemandKeywordDnaV1(input)
  const replay = buildSellerOsDemandKeywordDnaV1({ ...input,
    keywordFamilies: [...input.keywordFamilies].reverse(),
    soldTitles: [...input.soldTitles].reverse() })
  assert.equal(first.primaryDemandKeyword, "portable desk fan")
  assert.deepEqual(first.highIntentModifiers, ["office cooling"])
  assert.deepEqual(first.attributeTerms, ["usb powered"])
  assert.deepEqual(first.useCaseTerms, ["office cooling"])
  assert.deepEqual(first.compatibilityTerms, ["compatible with stroller"])
  assert.equal(first.soldWeightedTerms.some((term) =>
    term.term === "unproven active phrase"), false)
  assert.deepEqual(replay, first)
  assert.equal(first.keywordDemandConfidence.status, "SUPPORTED")
  assert.equal(first.keywordDemandConfidence.exactProductDemandClaimed, false)
  assert.deepEqual(first.titleTokenStructure[0].tokens,
    ["portable", "desk", "fan", "office", "cooling"])
})

test("migration extends existing family authorities and preserves legacy rows", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260826071102_demand_keyword_dna_durability_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /alter table public\.seller_os_market_family_definitions\s+add column demand_keyword_dna jsonb null/)
  assert.match(migration, /alter table public\.seller_os_family_market_observations\s+add column demand_keyword_dna jsonb null/)
  assert.match(migration, /demand_keyword_dna is null or\s+public\.is_valid_seller_os_demand_keyword_dna_v1/)
  assert.match(migration, /'LEGACY_UNAVAILABLE'/)
  assert.match(migration, /'OFFICIAL_SOLD_EVIDENCE'/)
  assert.doesNotMatch(migration, /create table|create schema|scheduler|cron/i)
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i)
  const readbackMigration = readFileSync(new URL(
    "../../supabase/migrations/20260826073236_demand_keyword_dna_daily_dollar_readback_v1.sql",
    import.meta.url), "utf8")
  assert.match(readbackMigration, /'attributeProfile',stored\.attribute_profile/)
  assert.match(readbackMigration, /'buyerIntentTerms',stored\.buyer_intent_terms/)
  assert.match(readbackMigration, /'demandKeywordDna',stored\.demand_keyword_dna/)
  assert.doesNotMatch(readbackMigration,
    /grant\s+(?:select|insert|update|delete)\s+on\s+table/i)
})

test("title-only or non-sold evidence cannot create a family", () => {
  const noCategory = qualifiedFixture()
  noCategory.tasks = [task({ category_id: null })]
  assert.equal(buildSellerOsDemandFirstFamilyCandidatesV1(noCategory).length, 0)
  const activeOnly = qualifiedFixture()
  activeOnly.observations[0].confirmed_sold_quantity = 0
  activeOnly.observations[1].confirmed_sold_quantity = 0
  assert.equal(buildSellerOsDemandFirstFamilyCandidatesV1(activeOnly).length, 0)
})

test("canonical exact and semantic duplicates are suppressed before persistence", () => {
  const fixture = qualifiedFixture()
  const initial = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  fixture.existingCases = [{ family_id: initial.observation.familyId,
    family_identity: initial.familyDefinition.identity }]
  const replay = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)
  assert.equal(replay[0].status, "DUPLICATE")
  assert.equal(replay[0].reason, "CANONICAL_FAMILY_DUPLICATE_SUPPRESSED")
})

test("due legacy family with exact query lineage receives a bounded canonical refresh", () => {
  const fixture = qualifiedFixture()
  const familyIdentity = familyContracts.normalizeSellerOsMarketFamilyIdentityV1({
    productFunction: "circulate air on a desk",
    buyerUseCase: "cool a small workspace",
    category: "portable desk fans",
    structuredDefinition: { producttype: "desk fan" },
  })
  const familyId = familyContracts.buildSellerOsMarketFamilyIdV1(familyIdentity)
  fixture.existingCases = [{
    family_id: familyId,
    opportunity_case_id: familyContracts.buildSellerOsOpportunityCaseIdV1({ familyId }),
    family_name: "Portable desk fans",
    family_identity: familyIdentity,
    current_family_query_set: ["portable usb desk fan"],
    current_key_product_attributes: ["producttype"],
    observationSeries: [{
      observationId: `family-market-observation-v1:sha256:${"5".repeat(64)}`,
      evidenceObservedAt: "2026-07-01T00:00:00.000Z",
      maximumAgeSeconds: 2_592_000,
      demandEvidenceDigest: `sha256:${"6".repeat(64)}`,
    }],
    monitorEnrollments: [{ status: "ENROLLED",
      enrolledAt: "2026-07-01T00:00:00.000Z",
      monitorPolicyVersion: "SELLER_OS_LEGACY_MONITOR_POLICY_V1",
      nextReviewCondition: "TIME_WINDOW_ELAPSED",
      nextEligibleReviewAt: "2026-07-31T00:00:00.000Z",
      lastObservationId:
        `family-market-observation-v1:sha256:${"5".repeat(64)}` }],
  }]
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, evaluatedAt: "2026-08-31T12:00:00.000Z",
  })
  const candidate = evaluation.candidatesAfterCap[0]
  assert.equal(candidate.status, "REFRESH_EXISTING_FAMILY")
  assert.equal(candidate.existingFamilyId, familyId)
  assert.equal(candidate.observation.familyId, familyId)
  assert.deepEqual(candidate.familyDefinition.identity, familyIdentity)
  assert.equal(candidate.observation.attributeProfile.producttype, "desk fan")
  assert.equal(candidate.observation.attributeProfile["category id"], "20612")
  assert.equal(candidate.observation.attributeProfile["product family"],
    "portable desk fans")
  assert.equal(candidate.legacyCategorySuccessorResolved, true)
  assert.equal(evaluation.existingFamilyRefreshCandidates, 1)
})

test("existing family refresh stays fail-closed without a due enrollment", () => {
  const fixture = qualifiedFixture()
  const initial = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  const observationId =
    `family-market-observation-v1:sha256:${"7".repeat(64)}`
  fixture.existingCases = [{ family_id: initial.observation.familyId,
    opportunity_case_id: initial.observation.opportunityCaseId,
    family_name: initial.familyDefinition.familyName,
    family_identity: initial.familyDefinition.identity,
    current_family_query_set: ["portable usb desk fan"],
    observationSeries: [{ observationId,
      evidenceObservedAt: "2026-08-19T12:00:00.000Z",
      maximumAgeSeconds: 2_592_000,
      demandEvidenceDigest: `sha256:${"8".repeat(64)}` }],
    monitorEnrollments: [] }]
  const candidate = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, evaluatedAt: "2026-08-31T12:00:00.000Z",
  }).candidatesAfterCap[0]
  assert.equal(candidate.status, "DUPLICATE")
  assert.equal(candidate.reason, "CANONICAL_FAMILY_DUPLICATE_SUPPRESSED")
})

test("refresh requires new sold evidence rather than a timestamp touch", () => {
  const fixture = qualifiedFixture()
  const initial = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  const observationId =
    `family-market-observation-v1:sha256:${"9".repeat(64)}`
  fixture.existingCases = [{ family_id: initial.observation.familyId,
    opportunity_case_id: initial.observation.opportunityCaseId,
    family_name: initial.familyDefinition.familyName,
    family_identity: initial.familyDefinition.identity,
    current_family_query_set: ["portable usb desk fan"],
    observationSeries: [{ observationId,
      evidenceObservedAt: capturedAt,
      maximumAgeSeconds: 60,
      demandEvidenceDigest: initial.observation.demandEvidenceDigest }],
    monitorEnrollments: [{ status: "ENROLLED",
      enrolledAt: "2026-08-19T12:00:00.000Z",
      monitorPolicyVersion: "SELLER_OS_LEGACY_MONITOR_POLICY_V1",
      nextReviewCondition: "TIME_WINDOW_ELAPSED",
      nextEligibleReviewAt: "2026-08-20T12:01:00.000Z",
      lastObservationId: observationId }] }]
  const candidate = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, evaluatedAt: "2026-08-31T12:00:00.000Z",
  }).candidatesAfterCap[0]
  assert.equal(candidate.status, "DUPLICATE")
  assert.equal(candidate.reason,
    "EXISTING_FAMILY_REFRESH_NEW_SOLD_EVIDENCE_REQUIRED")
})

test("partial refresh recovery reuses exact evidence and preserves original enrollment time", () => {
  const fixture = qualifiedFixture()
  const initial = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  const priorObservationId =
    `family-market-observation-v1:sha256:${"4".repeat(64)}`
  fixture.existingCases = [{
    family_id: initial.observation.familyId,
    opportunity_case_id: initial.observation.opportunityCaseId,
    family_name: initial.familyDefinition.familyName,
    family_identity: initial.familyDefinition.identity,
    current_family_query_set: initial.familyDefinition.familyQuerySet,
    current_key_product_attributes: initial.familyDefinition.keyProductAttributes,
    current_enrollment_enrolled_at: "2026-07-01T00:00:00.000Z",
    observationSeries: [{
      observationId: initial.observation.observationId,
      evidenceObservedAt: initial.observation.evidenceObservedAt,
      maximumAgeSeconds: initial.observation.maximumAgeSeconds,
      demandEvidenceDigest: `sha256:${"e".repeat(64)}`,
    }],
    monitorEnrollments: [{
      status: "ENROLLED",
      monitorPolicyVersion: "SELLER_OS_LEGACY_MONITOR_POLICY_V1",
      nextReviewCondition: "TIME_WINDOW_ELAPSED",
      nextEligibleReviewAt: "2026-07-31T00:00:00.000Z",
      lastObservationId: priorObservationId,
    }],
  }]
  const candidate = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, evaluatedAt: "2026-08-31T12:00:00.000Z",
  }).candidatesAfterCap[0]
  assert.equal(candidate.status, "REFRESH_EXISTING_FAMILY")
  assert.equal(candidate.observation.observationId,
    initial.observation.observationId)
  assert.equal(candidate.existingEnrollmentEnrolledAt,
    "2026-07-01T00:00:00.000Z")
  assert.equal(candidate.existingMonitorPolicyVersion,
    "SELLER_OS_LEGACY_MONITOR_POLICY_V1")
})

test("durable refresh contract preserves legacy identity and bounds category overlay", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260831154500_radar_existing_family_refresh_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration,
    /p_attribute_profile @>[\s\S]*v_case\.family_identity -> 'structuredDefinition'/)
  assert.match(migration,
    /\(p_attribute_profile ->> 'category id'\) ~ '\^\[0-9\]\+\$'/)
  assert.match(migration,
    /key\.value not in \('category id','product family'\)/)
  assert.match(migration,
    /v_definition\.adapter_contract =[\s\S]*SELLER_OS_DEMAND_FIRST_BROAD_NET_ORCHESTRATOR_V1/)
  assert.match(migration, /'familyIdentity',opportunity_case\.family_identity/)
  assert.match(migration, /'currentFamilyQuerySet'/)
  assert.match(migration, /'existingFamilyRefreshContractVersion'/)
  assert.doesNotMatch(migration, /create\s+table/i)
  assert.doesNotMatch(migration, /cron\.|create\s+type/i)
})

test("Radar refresh readback exposes only the persisted enrollment instant", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260831193500_radar_existing_family_enrollment_readback_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /'currentMonitorEnrolledAt',current_enrollment\.enrolled_at/)
  assert.match(migration,
    /from public\.seller_os_opportunity_monitor_enrollments enrollment/)
  assert.doesNotMatch(migration, /create\s+table|cron\.|create\s+type/i)
})

test("rolling cumulative refresh permits only a newer bounded source snapshot", () => {
  const migration = readFileSync(new URL(
    "../../supabase/migrations/20260831191000_radar_existing_family_cumulative_snapshot_refresh_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /v_cumulative_refresh boolean := false/)
  assert.match(migration,
    /p_aggregation_semantics = 'CUMULATIVE_SNAPSHOT'[\s\S]*previous\.aggregation_semantics = 'CUMULATIVE_SNAPSHOT'/)
  assert.match(migration,
    /p_source_adapter =[\s\S]*SELLER_OS_PRODUCT_RESEARCH_FAMILY_ADAPTER_V1/)
  assert.match(migration,
    /p_observation_window_end > previous\.observation_window_end/)
  assert.match(migration,
    /p_evidence_observed_at > previous\.evidence_observed_at/)
  assert.match(migration,
    /v_demand_evidence_digest is distinct from[\s\S]*previous\.demand_evidence_digest/)
  assert.match(migration,
    /if not v_cumulative_refresh and exists \([\s\S]*SELLER_OS_FAMILY_MARKET_OBSERVATION_WINDOW_CONFLICT/)
  assert.match(migration,
    /if not v_cumulative_refresh and exists \([\s\S]*SELLER_OS_FAMILY_MARKET_OBSERVATION_BACKFILL_REJECTED/)
  assert.doesNotMatch(migration, /create\s+table|cron\.|create\s+type/i)
})

test("category 31387 identity is reconciled only from official sold keyword evidence", () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: "31387",
    search_query: "women mother of pearl dial quartz watch" })]
  fixture.observations = fixture.observations.map((row) => ({ ...row,
    normalized_identity: { normalizedProductName: "Round Pearl Bracelet for Women",
      formFactor: "watch" },
    keyword_signals: ["women", "watch", "mother_of_pearl", "dial", "quartz"],
  }))
  const candidate = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  assert.equal(candidate.status, "QUALIFIED")
  assert.equal(candidate.familyDefinition.familyName,
    "Women's Mother-of-Pearl Dial Quartz Watches")
  assert.equal(candidate.familyDefinition.identity.productFunction,
    "women's mother-of-pearl dial quartz watches")
  assert.equal(candidate.familyDefinition.identity.category,
    "ebay-us-category:31387")

  const incomplete = qualifiedFixture()
  incomplete.tasks = fixture.tasks
  incomplete.observations = fixture.observations.map((row) => ({ ...row,
    keyword_signals: ["women", "mother_of_pearl", "dial", "quartz"],
  }))
  assert.notEqual(buildSellerOsDemandFirstFamilyCandidatesV1(incomplete)[0]
    .familyDefinition.familyName,
  "Women's Mother-of-Pearl Dial Quartz Watches")
})

test("reviewed Tesla and Microcurrent concepts reuse existing canonical families", () => {
  for (const reviewed of [{
    categoryId: "177702", query: "tesla nema connector smart adapter",
    candidateName: "Connector Smart Adapter",
    signals: ["tesla", "nema", "connector", "smart adapter"],
    existingName: "Tesla Gen II NEMA adapters",
  }, {
    categoryId: "33164", query: "microcurrent facial device",
    candidateName: "5 in 1 Microcurrent Facial Device",
    signals: ["microcurrent", "facial", "device"],
    existingName: "Microcurrent facial devices",
  }]) {
    const fixture = qualifiedFixture()
    fixture.tasks = [task({ category_id: reviewed.categoryId,
      search_query: reviewed.query })]
    fixture.observations = fixture.observations.map((row) => ({ ...row,
      normalized_identity: { normalizedProductName: reviewed.candidateName,
        formFactor: "adapter" }, keyword_signals: reviewed.signals,
    }))
    fixture.existingCases = [{ family_name: reviewed.existingName,
      family_identity: { productFunction: reviewed.existingName,
        buyerUseCase: reviewed.existingName,
        category: `ebay-us-category:${reviewed.categoryId}`,
        structuredDefinition: { "category id": reviewed.categoryId,
          "product family": reviewed.existingName } } }]
    const candidate = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
    assert.equal(candidate.status, "DUPLICATE")
    assert.equal(candidate.reason, "CANONICAL_FAMILY_DUPLICATE_SUPPRESSED")
  }
})

function queryResult(data) {
  const chain = {
    select() { return chain }, eq() { return chain }, in() { return chain },
    order() { return chain }, limit() { return chain },
    then(resolve, reject) {
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    },
  }
  return chain
}

test("manual canary persists through existing case observation enrollment RPCs", async () => {
  const fixture = qualifiedFixture()
  const expected = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)[0]
  const rpcCalls = []
  const client = {
    from(table) {
      if (table === "marketplace_product_research_query_tasks") {
        return queryResult(fixture.tasks)
      }
      if (table === "marketplace_product_research_capture_batches") {
        return queryResult(fixture.batches)
      }
      if (table === "marketplace_product_research_capture_observations") {
        return queryResult(fixture.observations)
      }
      throw new Error(`UNEXPECTED_TABLE_${table}`)
    },
    rpc(name, parameters = {}) {
      rpcCalls.push({ name, parameters })
      if (name === "put_seller_os_market_opportunity_case_v1") {
        return Promise.resolve({ data: { outcome: "DEFINITION_ADVANCED",
          familyId: expected.observation.familyId,
          opportunityCaseId: expected.observation.opportunityCaseId,
          familyDefinitionVersionId: expected.observation.familyDefinitionVersionId },
        error: null })
      }
      if (name === "put_seller_os_family_market_observation_v1") {
        return Promise.resolve({ data: { outcome: "CREATED",
          observationId: expected.observation.observationId }, error: null })
      }
      if (name === "put_seller_os_opportunity_monitor_enrollment_v1") {
        return Promise.resolve({ data: { outcome: "CREATED", schedulerEnabled: false,
          lastObservationId: expected.observation.observationId }, error: null })
      }
      if (name === "get_seller_os_family_market_radar_v1") {
        const persisted = rpcCalls.some((call) =>
          call.name === "put_seller_os_market_opportunity_case_v1")
        return Promise.resolve({ data: { status: "AVAILABLE", families: persisted ? [{
          familyId: expected.observation.familyId,
          familyName: expected.familyDefinition.familyName,
          opportunityCaseId: expected.observation.opportunityCaseId,
          observationSeries: [{ observationId: expected.observation.observationId,
            demandKeywordDna: expected.observation.demandKeywordDna }],
        }] : [] }, error: null })
      }
      throw new Error(`UNEXPECTED_RPC_${name}`)
    },
  }
  const result = await runSellerOsDemandFirstBroadNetCanaryV1({
    supabase: client,
    accountKey: `canonical:${"a".repeat(64)}`,
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.newFamiliesPersisted, 1)
  assert.equal(result.opportunityCasesCreated, 1)
  assert.equal(result.observationsCreated, 1)
  assert.equal(result.enrollmentsCreated, 1)
  assert.equal(result.nightlyPolicyEnabled, false)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(result.shippingRuns, 0)
  assert.deepEqual(rpcCalls.slice(0, 3).map((call) => call.name), [
    "get_seller_os_family_market_radar_v1",
    "put_seller_os_market_opportunity_case_v1",
    "put_seller_os_family_market_observation_v1",
  ])
  assert.deepEqual(rpcCalls.find((call) =>
    call.name === "put_seller_os_market_opportunity_case_v1")
    .parameters.p_demand_keyword_dna, expected.observation.demandKeywordDna)
  assert.deepEqual(rpcCalls.find((call) =>
    call.name === "put_seller_os_family_market_observation_v1")
    .parameters.p_demand_keyword_dna, expected.observation.demandKeywordDna)
})

test("nightly orchestration persists every bounded qualified family before Radar readback", async () => {
  const secondBatchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  const secondTaskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
  const fixture = qualifiedFixture()
  fixture.tasks.push(task({ id: secondTaskId, capture_batch_id: secondBatchId,
    search_query: "memory foam travel neck pillow", category_id: "16687" }))
  fixture.batches.push(batch({ id: secondBatchId,
    search_query_hash: `sha256:${"9".repeat(64)}`,
    search_keyword_patterns: ["memory", "foam", "travel", "neck", "pillow"] }))
  fixture.observations.push(
    observation("cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "Memory Foam Travel Neck Pillow", 26.99, 3, {
        capture_batch_id: secondBatchId,
        keyword_signals: ["memory foam travel pillow", "neck pillow"],
      }),
    observation("dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "Travel Neck Pillow Memory Foam", 28.99, 4, {
        capture_batch_id: secondBatchId,
        keyword_signals: ["memory foam travel pillow", "neck pillow"],
      }),
  )
  const expected = buildSellerOsDemandFirstFamilyCandidatesV1(fixture)
    .filter((candidate) => candidate.status === "QUALIFIED")
  assert.equal(expected.length, 2)
  const byName = new Map(expected.map((candidate) =>
    [candidate.familyDefinition.familyName, candidate]))
  const persisted = new Set()
  const rpcCalls = []
  const radarFamilies = () => [...persisted].map((name) => {
    const candidate = byName.get(name)
    return { familyId: candidate.observation.familyId,
      familyName: candidate.familyDefinition.familyName,
      familyIdentity: candidate.familyDefinition.identity,
      opportunityCaseId: candidate.observation.opportunityCaseId,
      observationSeries: [{ observationId: candidate.observation.observationId,
        demandKeywordDna: candidate.observation.demandKeywordDna }] }
  })
  const client = {
    from(table) {
      if (table === "marketplace_product_research_query_tasks") {
        return queryResult(fixture.tasks)
      }
      if (table === "marketplace_product_research_capture_batches") {
        return queryResult(fixture.batches)
      }
      if (table === "marketplace_product_research_capture_observations") {
        return queryResult(fixture.observations)
      }
      throw new Error(`UNEXPECTED_TABLE_${table}`)
    },
    rpc(name, parameters = {}) {
      rpcCalls.push({ name, parameters })
      if (name === "get_seller_os_family_market_radar_v1") {
        const families = parameters.p_family_id
          ? radarFamilies().filter((family) => family.familyId === parameters.p_family_id)
          : radarFamilies()
        return Promise.resolve({ data: { status: "AVAILABLE", families }, error: null })
      }
      if (name === "put_seller_os_market_opportunity_case_v1") {
        assert.equal(parameters.p_family_identity.productFunction,
          parameters.p_family_identity.productFunction.toLowerCase())
        assert.deepEqual(parameters.p_family_identity.structuredDefinition,
          Object.fromEntries(Object.entries(
            parameters.p_family_identity.structuredDefinition).map(
            ([key, value]) => [key.toLowerCase(), value.toLowerCase()])))
        const candidate = byName.get(parameters.p_family_name)
        persisted.add(parameters.p_family_name)
        return Promise.resolve({ data: { outcome: "DEFINITION_ADVANCED",
          familyId: candidate.observation.familyId,
          opportunityCaseId: candidate.observation.opportunityCaseId,
          familyDefinitionVersionId: candidate.observation.familyDefinitionVersionId },
        error: null })
      }
      if (name === "put_seller_os_family_market_observation_v1") {
        const candidate = expected.find((entry) =>
          entry.observation.opportunityCaseId === parameters.p_opportunity_case_id)
        return Promise.resolve({ data: { outcome: "CREATED",
          observationId: candidate.observation.observationId }, error: null })
      }
      if (name === "put_seller_os_opportunity_monitor_enrollment_v1") {
        return Promise.resolve({ data: { outcome: "CREATED", schedulerEnabled: false,
          lastObservationId: parameters.p_last_observation_id }, error: null })
      }
      throw new Error(`UNEXPECTED_RPC_${name}`)
    },
  }
  const result = await runSellerOsDemandFirstBroadNetNightlyV1({
    supabase: client, accountKey: `canonical:${"a".repeat(64)}`,
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.newFamiliesPersisted, 2)
  assert.equal(result.opportunityCasesCreated, 2)
  assert.equal(result.observationsCreated, 2)
  assert.equal(result.enrollmentsCreated, 2)
  assert.equal(result.radarReadback, "PASS")
  assert.equal(result.nightlyPolicyEnabled, true)
  assert.equal(result.shippingRuns, 0)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(rpcCalls.filter((call) =>
    call.name === "put_seller_os_market_opportunity_case_v1").length, 2)
})

test("server replay uses the fixed cohort and official category reads with zero persistence", async () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: null })]
  const rpcCalls = []
  const reads = []
  const client = {
    from(table) {
      if (table === "marketplace_product_research_query_tasks") {
        return queryResult(fixture.tasks)
      }
      if (table === "marketplace_product_research_capture_batches") {
        return queryResult(fixture.batches)
      }
      if (table === "marketplace_product_research_capture_observations") {
        return queryResult(fixture.observations)
      }
      throw new Error(`UNEXPECTED_TABLE_${table}`)
    },
    rpc(name) {
      rpcCalls.push(name)
      if (name !== "get_seller_os_family_market_radar_v1") {
        throw new Error(`UNEXPECTED_RPC_${name}`)
      }
      return Promise.resolve({ data: { status: "AVAILABLE", families: [] },
        error: null })
    },
  }
  const result = await runSellerOsDemandFirstBroadNetServerReplayV1({
    supabase: client, accountKey: `canonical:${"a".repeat(64)}`,
    officialItemReader: async (itemId) => {
      reads.push(itemId)
      return { itemId: `v1|${itemId}|0`, categoryId: "20612",
        source: "EBAY_BROWSE_ACTIVE_LISTING" }
    },
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.replayCohortId, "latest-processed-20-tasks:100-signals")
  assert.equal(result.signalsTotal, 2)
  assert.equal(result.signalsWithValidIdentity, 2)
  assert.equal(result.browseItemLookupsAttempted, 2)
  assert.equal(result.browseItemLookupsSucceeded, 2)
  assert.equal(result.signalsWithCategoryAuthority, 2)
  assert.equal(result.categoryUnavailable, 0)
  assert.equal(result.signalsRelevant, 2)
  assert.equal(result.signalsEnteringClustering, 2)
  assert.equal(result.rawClustersFormed, 1)
  assert.equal(result.crossBatchClustersAggregated, 1)
  assert.equal(result.clustersAfterDedupe, 1)
  assert.equal(result.numericStringWindowsParsed, 0)
  assert.equal(result.secondaryClustersEvaluated, 0)
  assert.equal(result.capAppliedPostClustering, true)
  assert.equal(result.crossBatchAggregation, true)
  assert.equal(result.clusterSoldQuantityScoped, true)
  assert.equal(result.candidateFamiliesBeforeCap, 1)
  assert.equal(result.candidateFamiliesAfterCap, 1)
  assert.equal(result.qualifiedFamilies, 1)
  assert.deepEqual(result.topCandidateClusters[0], {
    family: "Desk Fan", category: "20612", signals: 2,
    uniqueSoldItems: 2, soldQuantity: 7, priceEvidence: "AVAILABLE",
    windowEvidence: "AVAILABLE", keywordDna: "AVAILABLE",
    qualification: "QUALIFIED", rejectionReason: null,
  })
  assert.deepEqual(rpcCalls, ["get_seller_os_family_market_radar_v1"])
  assert.equal(reads.length, 2)
  assert.deepEqual(result.safety, {
    readOnly: true, credentialsIncluded: false, environmentValuesIncluded: false,
    familyPersistenceWrites: 0, observationPersistenceWrites: 0,
    enrollmentWrites: 0, shippingRuns: 0, externalAlerts: 0,
    marketplaceWrites: 0, nightlyPolicyEnabled: false,
  })
})

test("numeric-string epoch windows preserve the existing window contract", () => {
  const fixture = qualifiedFixture()
  fixture.batches = [batch({ date_range: {
    start: String(Date.parse("2026-07-21T12:00:00.000Z")),
    end: String(Date.parse(capturedAt)),
  } })]
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1(fixture)
  const candidate = evaluation.candidatesAfterCap[0]
  assert.equal(evaluation.numericStringWindowsParsed, 2)
  assert.equal(candidate.status, "QUALIFIED")
  assert.equal(candidate.clusterMetrics.windowEvidenceStatus, "AVAILABLE")
  assert.equal(candidate.observation.observationWindowStart,
    "2026-07-21T12:00:00.000Z")
  assert.equal(candidate.observation.observationWindowEnd, capturedAt)
})

test("all evidence-backed secondary clusters are evaluated", () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: null,
    search_query: "portable desk fan pearl bracelet" })]
  fixture.observations = [
    ...fixture.observations,
    observation("55555555-5555-4555-8555-555555555555",
      "Round Pearl Bracelet for Women", 19.99, 6,
      { keyword_signals: ["round pearl bracelet", "bracelet for women"] }),
    observation("66666666-6666-4666-8666-666666666666",
      "Pearl Round Bracelet for Women", 21.99, 7,
      { keyword_signals: ["round pearl bracelet", "bracelet for women"] }),
  ]
  const categoryAuthorities = fixture.observations.map((row, index) => ({
    observationId: row.id, categoryId: index < 2 ? "20612" : "31387",
    status: "AVAILABLE", source: "EBAY_BROWSE_LEGACY_ITEM_READONLY",
  }))
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, categoryAuthorities,
  })
  assert.equal(evaluation.rawClustersFormed, 2)
  assert.equal(evaluation.secondaryClustersEvaluated, 1)
  assert.equal(evaluation.allCandidates.length, 2)
  assert.deepEqual(evaluation.allCandidates.map((candidate) =>
    candidate.clusterMetrics.categoryId).sort(), ["20612", "31387"])
})

test("identical compatible cross-batch clusters aggregate before qualification", () => {
  const secondTaskId = "77777777-7777-4777-8777-777777777777"
  const secondBatchId = "88888888-8888-4888-8888-888888888888"
  const fixture = qualifiedFixture()
  fixture.tasks = [task(), task({ id: secondTaskId,
    capture_batch_id: secondBatchId })]
  fixture.batches = [batch(), batch({ id: secondBatchId })]
  fixture.observations = [fixture.observations[0],
    observation("99999999-9999-4999-8999-999999999999",
      "Portable USB Desk Fan", 24.99, 4,
      { capture_batch_id: secondBatchId })]
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1(fixture)
  assert.equal(evaluation.rawClustersFormed, 2)
  assert.equal(evaluation.crossBatchClustersAggregated, 1)
  assert.equal(evaluation.allCandidates[0].status, "QUALIFIED")
  assert.equal(evaluation.allCandidates[0].clusterMetrics.rawClusterCount, 2)
  assert.equal(evaluation.allCandidates[0].clusterMetrics.signalCount, 2)
  assert.equal(evaluation.allCandidates[0].clusterMetrics.soldQuantity, 7)
})

test("candidate cap is applied after cluster qualification and ranking", () => {
  const tasks = []
  const batches = []
  const observations = []
  for (let index = 0; index < 12; index += 1) {
    const suffix = String(index + 10).padStart(2, "0")
    const currentTaskId = `${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-8${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`
    const currentBatchId = `${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-9${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`
    const family = `Portable Desk Fan Model ${index}`
    tasks.push(task({ id: currentTaskId, capture_batch_id: currentBatchId,
      category_id: String(20_000 + index), search_query: family }))
    batches.push(batch({ id: currentBatchId }))
    observations.push(
      observation(`${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-a${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`,
        family, 20 + index, 2, { capture_batch_id: currentBatchId }),
      observation(`${suffix.repeat(4)}-${suffix.repeat(2)}-4${suffix.slice(1).repeat(3)}-b${suffix.slice(1).repeat(3)}-${suffix.repeat(6)}`,
        family, 21 + index, 3, { capture_batch_id: currentBatchId }),
    )
  }
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    tasks, batches, observations, existingCases: [],
  })
  assert.equal(evaluation.rawClustersFormed, 12)
  assert.equal(evaluation.candidateFamiliesBeforeCap, 12)
  assert.equal(evaluation.candidateFamiliesAfterCap, 10)
  assert.equal(evaluation.candidatesAfterCap.length, 10)
  assert.equal(evaluation.candidatesAfterCap.every((candidate) =>
    candidate.status === "QUALIFIED"), true)
})

test("cluster sold quantity excludes irrelevant same-category evidence", () => {
  const fixture = qualifiedFixture()
  fixture.tasks = [task({ category_id: null })]
  fixture.observations.push(observation(
    "77777777-7777-4777-8777-777777777777",
    "Unrelated Replacement Faucet Cartridge", 18.99, 999,
    { keyword_signals: ["replacement faucet cartridge"] },
  ))
  const categoryAuthorities = fixture.observations.map((row) => ({
    observationId: row.id, categoryId: "20612", status: "AVAILABLE",
    source: "EBAY_BROWSE_LEGACY_ITEM_READONLY",
  }))
  const evaluation = evaluateSellerOsDemandFirstFamilyCandidatesV1({
    ...fixture, categoryAuthorities,
  })
  const fan = evaluation.allCandidates.find((candidate) =>
    candidate.clusterMetrics.familyName.toLowerCase().includes("fan"))
  assert.ok(fan)
  assert.equal(fan.clusterMetrics.signalCount, 2)
  assert.equal(fan.clusterMetrics.soldQuantity, 7)
})

test("persisted eligible Radar families replace the deliberate empty handoff", () => {
  const familyId = `market-family-v1:sha256:${"1".repeat(64)}`
  const caseId = `opportunity-case-v1:sha256:${"2".repeat(64)}`
  const observationId = `family-market-observation-v1:sha256:${"3".repeat(64)}`
  const evidenceDigest = `sha256:${"4".repeat(64)}`
  const families = buildPersistedDailyDollarFamiliesV1({
    radarPayload: { status: "AVAILABLE", families: [{ familyId,
      familyName: "Portable USB Desk Fans", opportunityCaseId: caseId,
      observationSeries: [{ observationId,
        familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
        demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE", demandEvidenceDigest: evidenceDigest,
        soldComparableCount: 2, soldQuantity: 7, priceMedian: 23.99,
        competitionState: "UNPROVEN", momentumStatus: "INSUFFICIENT_HISTORY",
        evidenceObservedAt: capturedAt, maximumAgeSeconds: 2_592_000,
        limitations: ["EXACT_PRODUCT_DEMAND_NOT_CLAIMED"],
        attributeProfile: { "category id": "20612",
        "product family": "portable usb desk fans" },
        buyerIntentTerms: ["portable usb fan"], demandKeywordDna: null }],
    }] },
  })
  assert.equal(families.length, 1)
  assert.equal(families[0].radar.familyId, familyId)
  assert.equal(families[0].lunaMatches.length, 0)
  assert.equal(families[0].targetProfile.authority,
    "SERVER_DERIVED_FROM_CURRENT_MARKET_OBSERVATION")
  assert.equal(families[0].keywordSource.demandKeywordDna, null)
})

test("durable structured DNA is read through Radar into Daily Dollar", () => {
  const expected = buildSellerOsDemandFirstFamilyCandidatesV1(
    qualifiedFixture())[0]
  const familyId = expected.observation.familyId
  const caseId = expected.observation.opportunityCaseId
  const observationId = expected.observation.observationId
  const evidenceDigest = expected.observation.demandEvidenceDigest
  const families = buildPersistedDailyDollarFamiliesV1({
    radarPayload: { status: "AVAILABLE", families: [{ familyId,
      familyName: expected.familyDefinition.familyName,
      opportunityCaseId: caseId, observationSeries: [{ observationId,
        familyDemandStatus: expected.observation.familyDemandStatus,
        demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE", evidenceDigest,
        demandEvidenceDigest: evidenceDigest, soldComparableCount: 2,
        soldQuantity: 7, priceMedian: 23.99, competitionState: "UNPROVEN",
        momentumStatus: "INSUFFICIENT_HISTORY", evidenceObservedAt: capturedAt,
        maximumAgeSeconds: 2_592_000, limitations: [],
        attributeProfile: expected.observation.attributeProfile,
        buyerIntentTerms: expected.observation.buyerIntentTerms,
        demandKeywordDna: expected.observation.demandKeywordDna }] }] },
  })
  assert.equal(families.length, 1)
  assert.deepEqual(families[0].keywordSource.demandKeywordDna,
    expected.observation.demandKeywordDna)
})

test("incomplete persisted family graphs remain fail-closed", () => {
  const families = buildPersistedDailyDollarFamiliesV1({
    radarPayload: { status: "AVAILABLE", families: [{
      familyId: `market-family-v1:sha256:${"1".repeat(64)}`,
      observationSeries: [],
    }] },
  })
  assert.deepEqual(families, [])
})
