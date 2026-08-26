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
const {
  buildSellerOsDemandKeywordDnaV1,
  buildPersistedDailyDollarFamiliesV1,
  buildSellerOsDemandFirstFamilyCandidatesV1,
  runSellerOsDemandFirstBroadNetCanaryV1,
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
  assert.equal(buildSellerOsDemandFirstFamilyCandidatesV1(noCategory)[0].status,
    "UNQUALIFIED")
  const activeOnly = qualifiedFixture()
  activeOnly.observations[0].confirmed_sold_quantity = 0
  activeOnly.observations[1].confirmed_sold_quantity = 0
  assert.equal(buildSellerOsDemandFirstFamilyCandidatesV1(activeOnly)[0].status,
    "UNQUALIFIED")
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
