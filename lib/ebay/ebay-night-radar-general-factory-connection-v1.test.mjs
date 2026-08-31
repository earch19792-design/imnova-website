import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

const { materializeRadarRevenueFactoryCandidateBatchV1,
  resumeRadarFactoryCandidateAfterShippingV1,
  buildRadarAutomaticPriceDistributionContinuationV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
)
const { requiredSpecificBatchEvidenceDigestV1 } = await import(
  "./ebay-marketplace-required-specifics-batch-resolution-v1.ts")

function familySeed(overrides = {}) {
  return {
    familyId: `market-family-v1:sha256:${"1".repeat(64)}`,
    familyName: "Supported family",
    opportunityCaseId: `opportunity-case-v1:sha256:${"2".repeat(64)}`,
    demandEvidenceDigest: `sha256:${"3".repeat(64)}`,
    familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
    soldComparableCount: 3, soldQuantityEvidence: 4,
    priceBand: { currency: "USD", minimum: 20, maximum: 40, median: 30 },
    evidenceObservedAt: "2026-08-28T12:00:00.000Z",
    sourceUpdatedAt: "2026-08-28T12:00:00.000Z",
    maximumAgeSeconds: 2592000, fresh: true,
    limitations: ["EXACT_PRODUCT_DEMAND_NOT_CLAIMED"],
    evidenceScope: "FAMILY_DISCOVERY_SEED_ONLY",
    exactProductDemandClaimed: false,
    ...overrides,
  }
}

function candidate(index, overrides = {}) {
  const identity = String(index)
  return {
    candidateId: `sha256:${identity.repeat(64)}`,
    familyId: familySeed().familyId,
    familyName: "Supported family",
    source: "RADAR_FRONTIER_LUNA_IDENTITY",
    disposition: "PASS_TO_LUNA",
    dispositionReason: "EXACT_LUNA_PRODUCT_VARIANT_IDENTITY_ALREADY_PROVEN",
    exactCandidateIdentity: true, lunaMatch: true, stockReady: true,
    readyForEconomics: true,
    economicsProfit: 8, economicsMargin: 24, economicsNextEvidence: "NONE",
    supplierCostUsd: 5, supplierCostObservedAt: "2026-08-28T12:00:00.000Z",
    productTitle: `Product ${identity}`, variantTitle: "Default",
    gtin: `GTIN-${identity}`,
    canonicalProductUrl: `https://lunaportex.com/products/product-${identity}`,
    imageUrls: ["https://lunaportex.com/image.jpg"],
    supplierInventoryQuantity: null,
    marketRadarProductId: `catalog-${identity}`,
    lunaProductId: `product-${identity}`,
    lunaVariantId: `variant-${identity}`,
    supplierSku: `SKU-${identity}`,
    productResearchIdentityHash: null,
    lineage: familySeed(),
    ...overrides,
  }
}

function batch(candidates) {
  return {
    adapterVersion: "OPPORTUNITY_RADAR_REVENUE_FACTORY_ADAPTER_V1",
    seeds: [familySeed()], candidates,
    radarSeedAccepted: true, radarSeedsUsed: 1,
    candidatesGenerated: candidates.length,
    exactProductFitCount: candidates.length,
    lunaMatchCount: candidates.length,
    stockReadyCount: candidates.length,
    readyForEconomicsCount: candidates.length,
    inputProducts: candidates.length, uniqueInputProducts: candidates.length,
    duplicateCount: 0, ambiguousCount: 0, differentVariantCount: 0,
    noLunaMatchCount: 0, conflictingIdentityGroups: 0,
    familiesWithInput: 1, allFamiliesWithInputReceiveBoundedCoverage: true,
    rejectedCount: 0, evidenceLineagePreserved: true,
    marketplaceWrites: 0,
  }
}

function client(queueRows, decisionRows = [], activeRows = []) {
  return { from(table) {
    const result = table === "ebay_luna_opportunity_queue"
      ? { data: queueRows, error: null }
      : table === "seller_os_luna_linkage_decisions"
        ? { data: decisionRows, error: null }
        : table === "ebay_active_listings"
          ? { data: activeRows, error: null }
          : { data: [], error: null }
    const query = {
      select() { return query }, in() { return query }, eq() { return query },
      order() { return query }, limit() { return Promise.resolve(result) },
    }
    return query
  } }
}

function queueRow(index) {
  const value = candidate(index)
  return { id: `00000000-0000-4000-8000-00000000000${index}`,
    candidate_key: `luna-portex:product-${index}:variant-${index}`,
    supplier_product_id: `product-${index}`,
    supplier_variant_id: `variant-${index}`,
    supplier_sku: `SKU-${index}`, gtin: `GTIN-${index}`,
    assessment: {
      radarFactoryCandidateV1: {
        contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
        authority: "SELLER_OS_DETERMINISTIC_FACTORY",
        candidateId: value.candidateId,
        familyId: value.familyId,
        demandEvidenceGrain: "FAMILY",
        exactProductDemandClaimed: false,
      },
      candidate: {
        candidateKey: value.candidateId,
        supplierProductId: value.lunaProductId,
        supplierVariantId: value.lunaVariantId,
        sku: value.supplierSku,
        gtin: value.gtin,
      },
      productTruth: {
        authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        candidateKey: value.candidateId,
        evidenceDigest: `sha256:${"a".repeat(64)}`,
        lunaProductId: value.lunaProductId,
        lunaVariantId: value.lunaVariantId,
        supplierSku: value.supplierSku,
        gtin: value.gtin,
        stock: { exactIdentityVerified: true },
      },
      radarAutomaticLunaShippingContinuationV1: {
      candidateId: value.candidateId,
      lunaProductId: `product-${index}`,
      lunaVariantId: `variant-${index}`,
      supplierSku: `SKU-${index}`,
    } } }
}

function factoryResult(input, packageCreated = true) {
  return {
    opportunityId: input.opportunityId, candidateKey: input.candidateKey,
    listingPackageId: "10000000-0000-4000-8000-000000000001",
    listingReady: true, firstBlocker: null, packageCreated,
    stageStatuses: {
      SMART_STOCKING: "READY", PRODUCT_TRUTH_READY: "READY",
      DEMAND_READY: "READY", ECONOMICS_READY: "READY",
      LISTING_PACKAGE_READY: "READY", LISTING_READY: "READY",
    },
    packageSeed: { title: "Ready product", categoryId: "123",
      imageUrls: ["https://example.test/hero.jpg"],
      pricing: { supplierCost: 5, targetPrice: 25 } },
    factoryPreparationAuthority: { authority: "SELLER_OS_DETERMINISTIC_FACTORY" },
    smartStockingListingIntakeV1: null,
  }
}

test("fresh supported Radar evidence enters the existing durable factory with zero human clicks", async () => {
  let calls = 0
  const taxonomyReader = async () => ({ status: "UNAVAILABLE" })
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1)]), accountKey: "account",
    batch: batch([candidate(1)]),
    taxonomyReader,
    materializeCandidate: async (input) => {
      calls += 1
      assert.equal(input.taxonomyReader, taxonomyReader)
      return factoryResult(input)
    },
  })
  assert.equal(calls, 1)
  assert.equal(result.authority, "SELLER_OS_DETERMINISTIC_FACTORY")
  assert.equal(result.targetSpecificAllowlistUsed, false)
  assert.equal(result.factoryCandidatesCreated, 1)
  assert.equal(result.lunaMatchRate, 100)
  assert.equal(result.listingReady, 1)
  assert.equal(result.humanClicksRequired, 0)
  assert.equal(result.dollarCheck.triggered, true)
  assert.deepEqual(result.safety, { marketplaceWrites: 0, publishCalls: 0,
    newEbayOffers: 0, withdrawCalls: 0 })
})

test("exact certified LIVE product is excluded before new-listing materialization while the next candidate continues", async () => {
  const decisions = [{
    decision_id: "linkage-decision-1", ebay_item_id: "366582671136",
    luna_product_id: "product-1", luna_variant_id: "variant-1",
    luna_sku: "SKU-1", decision: "APPROVE_EXACT_LINKAGE",
    decision_version: 1, classification: "EXACT_UNIQUE_MATCH",
    contract_version: "SELLER_OS_LUNA_LINKAGE_DECISION_V1",
  }]
  const active = [{ ebay_item_id: "366582671136", listing_status: "active" }]
  const materialized = []
  let aiCalls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1), queueRow(2)], decisions, active),
    accountKey: "account", batch: batch([candidate(1), candidate(2)]),
    requiredSpecificsAiResolver: async () => {
      aiCalls += 1
      throw new Error("ALREADY_LIVE_MUST_NOT_REACH_AI")
    },
    materializeCandidate: async (input) => {
      materialized.push(input.candidateKey)
      return factoryResult(input)
    },
  })
  assert.equal(aiCalls, 0)
  assert.deepEqual(materialized, [queueRow(2).candidate_key])
  assert.equal(result.alreadyLiveExactProductCount, 1)
  assert.equal(result.alreadyLiveExcludedCount, 1)
  assert.equal(result.nextCandidateContinued, true)
  assert.equal(result.outcomes[0].status, "EXCLUDED_ALREADY_LIVE")
  assert.equal(result.outcomes[0].alreadyLiveExactProduct, true)
  assert.deepEqual(result.outcomes[0].linkedLiveItemIds, ["366582671136"])
  assert.equal(result.outcomes[1].status, "LISTING_READY")
  assert.equal(result.listingReady, 1)
  assert.equal(result.dollarCheck.triggered, true)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("legacy packages sharing SKU, variant and GTIN never compete with the exact Radar binding", async () => {
  let materialized = null
  const legacy = [1, 2].map((index) => ({
    id: `20000000-0000-4000-8000-00000000000${index}`,
    status: "GENERATED",
    package_payload: {
      supplierSku: "SKU-1",
      supplierVariantId: "variant-1",
      productIdentity: { identity: { gtin: "GTIN-1" } },
    },
  }))
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1)], legacy), accountKey: "account",
    batch: batch([candidate(1)]),
    materializeCandidate: async (input) => {
      materialized = input
      return { ...factoryResult(input),
        decisionPackageId: "30000000-0000-4000-8000-000000000001",
        decisionPackageIdentityResolved: true,
        identityAmbiguityReason: null,
        productTruthAcquisitionRequired: false,
        productTruthReused: true,
        productTruthExactIdentityMatch: true,
        productTruthProductId: "product-1",
        productTruthVariantId: "variant-1",
        productTruthSource: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        productTruthDurable: true,
        productTruthReadbackMatch: true,
        unsupportedAttributeCount: 0,
        unsupportedAttributesPersisted: 0,
        marketplaceReadinessAcquisitionRequired: true,
        marketplaceReadinessReused: false,
        categoryId: "155101",
        categorySource:
          "EXISTING_DURABLE_LISTING_PACKAGE_EXACT_OPPORTUNITY_BINDING",
        categoryReady: true,
        conditionId: "1000",
        conditionReady: true,
        requiredItemSpecificsCount: 3,
        requiredItemSpecificsSatisfied: 0,
        unsupportedRequiredSpecifics: ["Brand", "Style", "Type"],
        requiredItemSpecificsReady: false,
        fulfillmentPolicyBound: true,
        paymentPolicyBound: true,
        returnPolicyBound: true,
        listingPolicyReady: true,
        locationOrInventoryContextReady: true,
        sellerAccountBindingReady: true,
        marketplaceIdentityReady: true,
        canonicalMarketplaceReadinessReady: false }
    },
  })
  assert.equal(materialized.decisionPackageId, null)
  assert.equal(result.outcomes[0].decisionPackageIdentityResolved, true)
  assert.equal(result.outcomes[0].identityAmbiguityReason, null)
  assert.equal(result.outcomes[0].productTruthReused, true)
  assert.equal(result.outcomes[0].productTruthExactIdentityMatch, true)
  assert.equal(result.outcomes[0].unsupportedAttributesPersisted, 0)
  assert.equal(result.outcomes[0].categoryReady, true)
  assert.equal(result.outcomes[0].requiredItemSpecificsReady, false)
  assert.deepEqual(result.outcomes[0].unsupportedRequiredSpecifics,
    ["Brand", "Style", "Type"])
  assert.equal(result.outcomes[0].listingPolicyReady, true)
  assert.equal(result.outcomes[0].reasonCode, null)
})

test("one candidate exception does not stop the remaining independent factory batch", async () => {
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1), queueRow(2)]), accountKey: "account",
    batch: batch([candidate(1), candidate(2)]),
    materializeCandidate: async (input) => {
      if (input.candidateKey.endsWith("variant-1")) {
        throw new Error("PRODUCT_TRUTH_NOT_READY")
      }
      return factoryResult(input, false)
    },
  })
  assert.equal(result.exceptions, 1)
  assert.equal(result.factoryCandidatesReused, 1)
  assert.equal(result.listingReady, 1)
  assert.equal(result.outcomes[0].reasonCode, "PRODUCT_TRUTH_NOT_READY")
  assert.equal(result.outcomes[1].status, "LISTING_READY")
})

test("residual specifics are batched, persisted, and the same candidate resumes readiness", async () => {
  const durable = queueRow(1)
  const state = { row: structuredClone(durable), updates: 0 }
  const supabase = { from(table) {
    if (table !== "ebay_luna_opportunity_queue") {
      const empty = { data: [], error: null }
      const read = { select() { return read }, in() { return read },
        eq() { return read }, order() { return read },
        limit() { return Promise.resolve(empty) } }
      return read
    }
    const query = {
      select() { return query }, in() { return query }, eq() { return query },
      limit() { return Promise.resolve({ data: [state.row], error: null }) },
      maybeSingle() { return Promise.resolve({ data: state.row, error: null }) },
      update(patch) {
        state.updates += 1
        state.row = { ...state.row, ...patch }
        return { eq() { return this }, select() { return this },
          single() { return Promise.resolve({ data: state.row, error: null }) } }
      },
    }
    return query
  } }
  const aspect = {
    name: "Pattern", dataType: "STRING", mode: "SELECTION_ONLY",
    cardinality: "SINGLE", freeTextAllowed: false,
    allowedValues: ["Floral", "Solid"], allowedValueCount: 2,
    allowedValuesComplete: true,
    source: "EBAY_TAXONOMY_OFFICIAL_READONLY",
  }
  const core = {
    radarCandidateId: candidate(1).candidateId,
    lunaProductId: "product-1", lunaVariantId: "variant-1",
    supplierSku: "SKU-1", marketplaceId: "EBAY_US", categoryId: "155101",
    exactProductIdentityProven: true,
    exactProductTitle: "Exact product", exactDescription: "Botanical motif",
    exactSpecs: {}, exactVariantData: {}, exactImageUrls: [],
    unresolvedRequiredAspects: ["Pattern"],
    officialAspectDefinitions: [aspect],
  }
  const batchInput = { ...core,
    inputEvidenceDigest: requiredSpecificBatchEvidenceDigestV1(core) }
  let materializeCalls = 0
  let aiCalls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase, accountKey: "account", batch: batch([candidate(1)]),
    requiredSpecificsAiResolver: async (input) => {
      aiCalls += 1
      assert.equal(input.products.length, 1)
      return { model: "test", inputTokens: 20, outputTokens: 10,
        candidates: [{
          radarCandidateId: core.radarCandidateId,
          lunaProductId: core.lunaProductId,
          lunaVariantId: core.lunaVariantId,
          supplierSku: core.supplierSku,
          marketplaceId: "EBAY_US", categoryId: core.categoryId,
          inputEvidenceDigest: batchInput.inputEvidenceDigest,
          resolutions: [{ aspectName: "Pattern", resolvedValue: "Floral",
            resolutionClass: "AI_MAPPING",
            sourceEvidence: { sourceField: "DESCRIPTION",
              sourceExcerpt: "Botanical motif", imageIndex: null },
            confidence: "HIGH", factInvented: false,
            humanReviewRequired: false }],
        }] }
    },
    materializeCandidate: async (input) => {
      materializeCalls += 1
      if (materializeCalls === 1) return { ...factoryResult(input),
        listingReady: false,
        firstBlocker: "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Pattern",
        requiredItemSpecificsCount: 1, requiredItemSpecificsSatisfied: 0,
        unsupportedRequiredSpecifics: ["Pattern"],
        requiredItemSpecificsReady: false,
        canonicalMarketplaceReadinessReady: false,
        requiredSpecificsBatchInput: batchInput }
      return { ...factoryResult(input), requiredItemSpecificsCount: 1,
        requiredItemSpecificsSatisfied: 1,
        unsupportedRequiredSpecifics: [], requiredItemSpecificsReady: true,
        canonicalMarketplaceReadinessReady: true }
    },
  })
  assert.equal(aiCalls, 1)
  assert.equal(materializeCalls, 2)
  assert.equal(state.updates, 1)
  assert.equal(result.requiredSpecificsBatch.productCount, 1)
  assert.equal(result.requiredSpecificsBatch.aiCallCount, 1)
  assert.equal(result.requiredSpecificsBatch.candidateReadinessReevaluated, 1)
  assert.equal(result.outcomes[0].listingReady, true)
  assert.equal(result.listingReady, 1)
  assert.equal(result.dollarCheck.triggered, true)
})

test("economics-ready Radar identity is created idempotently in the existing Smart Stocking store", async () => {
  const durable = queueRow(1)
  let upserts = 0
  const supabase = { from(table) {
    if (table === "ebay_luna_opportunity_queue") {
      const initial = { data: [], error: null }
      const query = {
        select() { return query }, in() { return query }, eq() { return query },
        order() { return query }, limit() { return Promise.resolve(initial) },
        upsert() { upserts += 1; return {
          select() { return { async single() {
            return { data: durable, error: null }
          } } },
        } },
      }
      return query
    }
    const query = { select() { return query }, eq() { return query },
      in() { return query },
      order() { return query }, limit() {
        return Promise.resolve({ data: [], error: null })
      } }
    return query
  } }
  let calls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase, accountKey: "account", batch: batch([candidate(1)]),
    materializeCandidate: async (input) => {
      calls += 1
      return factoryResult(input)
    },
  })
  assert.equal(upserts, 1)
  assert.equal(calls, 1)
  assert.equal(result.listingReady, 1)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("weak economics is parked explicitly and does not enter durable materialization", async () => {
  let calls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1)]), accountKey: "account",
    batch: batch([candidate(1, { readyForEconomics: false })]),
    materializeCandidate: async (input) => {
      calls += 1
      return factoryResult(input)
    },
  })
  assert.equal(calls, 0)
  assert.equal(result.deterministicallyRejected, 1)
  assert.equal(result.parked, 1)
  assert.equal(result.outcomes[0].status, "PARKED_ECONOMICS")
  assert.equal(result.outcomes[0].reasonCode, "PARKED_ECONOMICS")
})

test("shipping-only economics blocker becomes a durable waiting browser job without an exception", async () => {
  let calls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1)]), accountKey: "account",
    batch: batch([candidate(1, { readyForEconomics: false,
      economicsProfit: null, economicsMargin: null,
      economicsNextEvidence: "ACTUAL_LUNA_SHIPPING" })]),
    materializeCandidate: async (input) => {
      calls += 1
      return factoryResult(input)
    },
  })
  assert.equal(calls, 0)
  assert.equal(result.waitingBrowserWorker, 1)
  assert.equal(result.shippingJobsReused, 1)
  assert.equal(result.exceptions, 0)
  assert.equal(result.deterministicallyRejected, 0)
  assert.equal(result.outcomes[0].status, "PARKED_ECONOMICS")
  assert.equal(result.outcomes[0].reasonCode, "WAITING_BROWSER_WORKER")
  assert.equal(result.outcomes[0].shippingJobIdentityMatch, true)
})

test("legacy Smart Stocking key is reused while exact Radar shipping identity is hydrated", async () => {
  const legacy = { ...queueRow(1), assessment: {},
    decision: "MATCH_REVIEW_REQUIRED", queue_status: "watchlist" }
  let updateCount = 0
  let hydratedRow = null
  const supabase = { from(table) {
    if (table !== "ebay_luna_opportunity_queue") {
      const query = { select() { return query }, eq() { return query },
        in() { return query },
        order() { return query }, limit() {
          return Promise.resolve({ data: [], error: null }) } }
      return query
    }
    const query = {
      select() { return query }, in() { return query }, eq() { return query },
      order() { return query },
      limit() { return Promise.resolve({ data: [legacy], error: null }) },
      update(values) {
        updateCount += 1
        const hydrated = { ...legacy, ...values }
        hydratedRow = hydrated
        const write = { eq() { return write }, select() { return write },
          single() { return Promise.resolve({ data: hydrated, error: null }) } }
        return write
      },
    }
    return query
  } }
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase, accountKey: "account",
    batch: batch([candidate(1, { readyForEconomics: false,
      economicsProfit: null, economicsMargin: null,
      economicsNextEvidence: "ACTUAL_LUNA_SHIPPING" })]),
  })
  assert.equal(updateCount, 1)
  assert.equal(hydratedRow.assessment.productTruth.authorityClass,
    "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1")
  assert.equal(hydratedRow.assessment.productTruth.candidateKey,
    candidate(1).candidateId)
  assert.equal(hydratedRow.assessment.productTruth.lunaProductId,
    candidate(1).lunaProductId)
  assert.equal(hydratedRow.assessment.productTruth.lunaVariantId,
    candidate(1).lunaVariantId)
  assert.equal(result.shippingJobsReused, 1)
  assert.equal(result.waitingBrowserWorker, 1)
  assert.equal(result.outcomes[0].shippingJobIdentityMatch, true)
  assert.equal(result.outcomes[0].candidateId, `sha256:${"1".repeat(64)}`)
  assert.equal(legacy.candidate_key, "luna-portex:product-1:variant-1")
})

test("durable shipping result resumes only the same exact Smart Stocking candidate", async () => {
  const durable = { ...queueRow(1), candidate_key: `sha256:${"1".repeat(64)}`,
    assessment: { ...queueRow(1).assessment,
      radarFactoryCandidateV1: { itemSpecificLogicUsed: false } } }
  let materialized = null
  let storedAssessment = null
  const supabase = { from(table) {
    assert.equal(table, "ebay_luna_opportunity_queue")
    const read = {
      select() { return read }, eq() { return read },
      limit() { return Promise.resolve({ data: [durable], error: null }) },
      update(value) {
        storedAssessment = value.assessment
        const write = { eq() { return write }, select() { return write },
          single() { return Promise.resolve({ data: { id: durable.id,
            candidate_key: durable.candidate_key,
            assessment: storedAssessment }, error: null }) } }
        return write
      },
    }
    return read
  } }
  const result = await resumeRadarFactoryCandidateAfterShippingV1({
    supabase, accountKey: "account", candidateId: durable.candidate_key,
    lunaProductId: durable.supplier_product_id,
    lunaVariantId: durable.supplier_variant_id,
    supplierSku: durable.supplier_sku,
    materializeCandidate: async (input) => {
      materialized = input
      return factoryResult(input)
    },
    continuePriceDistribution: async () => ({
      applicable: true,
      frontier: {},
      continuation: {
        contractVersion: "RADAR_AUTOMATIC_PRICE_DISTRIBUTION_CONTINUATION_V1",
        economicsReady: true,
      },
      durableReadback: true,
    }),
  })
  assert.equal(materialized.candidateKey, durable.candidate_key)
  assert.equal(materialized.opportunityId, durable.id)
  assert.equal(result.applicable, true)
  assert.equal(result.economicsResumed, true)
  assert.equal(result.economicsReady, true)
  assert.equal(result.listingReady, true)
  assert.equal(result.durableReadback, true)
  assert.equal(result.marketplaceWrites, 0)
  assert.equal(storedAssessment.radarAutomaticLunaShippingContinuationV1
    .shippingJobStatus, "SHIPPING_EVIDENCE_DURABLE")
})

test("durable family distribution selects the lowest robust quantile passing canonical economics", () => {
  const prices = [14.86, 17.99, 18.99, 18.99, 52.38, 52.77, 59.82]
  const result = buildRadarAutomaticPriceDistributionContinuationV1({
    familyId: familySeed().familyId,
    demandEvidenceDigest: familySeed().demandEvidenceDigest,
    evidenceObservedAt: familySeed().evidenceObservedAt,
    priceDistributionSource:
      "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE_FAMILY_DISTRIBUTION",
    priceEvidence: prices.map((price, index) => ({
      evidenceId: `marketplace_product_research_capture_observations:00000000-0000-4000-8000-00000000000${index}`,
      price,
      currency: "USD",
    })),
    supplierCostUsd: 6.52,
    shippingUsd: 6.99,
  })
  assert.equal(result.priceSampleCount, 7)
  assert.equal(result.demandEvidenceGrain, "FAMILY")
  assert.equal(result.exactProductDemandClaimed, false)
  assert.equal(result.outlierPolicy, "PRICE_REPRESENTATIVENESS_V2_IQR_1_5")
  assert.equal(result.outlierCount, 0)
  assert.equal(result.targetPrice, 52.58)
  assert.equal(result.targetPriceWithinSupportedDistribution, true)
  assert.equal(result.marginFloorPass, true)
  assert.equal(result.finalDisposition, "ECONOMICS_READY")
  assert.equal(result.targetEconomics.profit, 25.89)
  assert.equal(result.targetEconomics.marginPercent, 49.25)
  assert.equal(result.targetEconomics.roiPercent, 397.13)
})

test("unsupported family prices park one candidate without manufacturing a target", () => {
  const result = buildRadarAutomaticPriceDistributionContinuationV1({
    familyId: familySeed().familyId,
    demandEvidenceDigest: familySeed().demandEvidenceDigest,
    evidenceObservedAt: familySeed().evidenceObservedAt,
    priceDistributionSource:
      "EBAY_PRODUCT_RESEARCH_BROWSER_CAPTURE_FAMILY_DISTRIBUTION",
    priceEvidence: [10, 11, 12, 13].map((price, index) => ({
      evidenceId: `marketplace_product_research_capture_observations:10000000-0000-4000-8000-00000000000${index}`,
      price,
      currency: "USD",
    })),
    supplierCostUsd: 10,
    shippingUsd: 6.99,
  })
  assert.equal(result.targetPrice, null)
  assert.equal(result.economicsReady, false)
  assert.equal(result.finalDisposition, "PARKED_ECONOMICS")
  assert.equal(result.finalReason, "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR")
})

test("one unsupported distribution parks while the next independent candidate continues", async () => {
  const recoverable = (index) => candidate(index, {
    readyForEconomics: false,
    economicsProfit: 0.47,
    economicsMargin: 2.45,
    economicsNextEvidence: "BETTER_PRICE_DISTRIBUTION",
  })
  let materialized = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1), queueRow(2)]),
    accountKey: "account",
    batch: batch([recoverable(1), recoverable(2)]),
    continuePriceDistribution: async (input) => ({
      applicable: true,
      frontier: {},
      durableReadback: true,
      continuation: {
        economicsReevaluated: true,
        economicsReady: input.candidateId.endsWith("2".repeat(64)),
        finalReason: input.candidateId.endsWith("1".repeat(64))
          ? "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR" : null,
      },
    }),
    materializeCandidate: async (input) => {
      materialized += 1
      const base = factoryResult(input)
      return { ...base, listingReady: false,
        firstBlocker: "PRODUCT_TRUTH_NOT_READY",
        stageStatuses: { ...base.stageStatuses,
          PRODUCT_TRUTH_READY: "BLOCKED",
          LISTING_PACKAGE_READY: "BLOCKED",
          LISTING_READY: "BLOCKED" } }
    },
  })
  assert.equal(materialized, 1)
  assert.equal(result.priceDistributionAcquired, 2)
  assert.equal(result.economicsReevaluated, 2)
  assert.equal(result.economicsReadyCount, 1)
  assert.equal(result.outcomes[0].status, "PARKED_ECONOMICS")
  assert.equal(result.outcomes[0].reasonCode,
    "NO_SUPPORTED_PRICE_MEETS_MARGIN_FLOOR")
  assert.equal(result.outcomes[1].stages.ECONOMICS_READY, "READY")
  assert.equal(result.listingReady, 0)
})

test("shipping capture route invokes exact Radar continuation after durable readback", () => {
  const route = readFileSync(
    "app/api/admin/ebay/luna-shipping-capture/route.ts", "utf8")
  assert.match(route, /persistLunaChromeShippingCaptureV1/)
  assert.match(route, /resumeRadarFactoryCandidateAfterShippingV1/)
  assert.ok(route.indexOf("persistLunaChromeShippingCaptureV1") <
    route.lastIndexOf("resumeRadarFactoryCandidateAfterShippingV1"))
  assert.match(route, /marketplaceWrites: 0/)
})

test("existing 09:00 UTC cron is connected without adding a Preview scheduler", () => {
  const route = readFileSync(
    "app/api/cron/market-radar-luna-sync/route.ts", "utf8")
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"))
  assert.match(route, /ensureRadarCandidateEconomicsPreflightsV1/)
  assert.match(route, /economicsPreflightCreated/)
  assert.match(route, /materializeRadarRevenueFactoryCandidateBatchV1/)
  assert.match(route, /runSellerOsDemandFirstBroadNetNightlyV1/)
  const radarCrons = vercel.crons.filter((entry) =>
    entry.path === "/api/cron/market-radar-luna-sync")
  assert.deepEqual(radarCrons, [{ path: "/api/cron/market-radar-luna-sync",
    schedule: "0 9 * * *" }])
  assert.equal(vercel.crons.some((entry) => /preview/i.test(entry.path)), false)
  const migration = readFileSync(
    "supabase/migrations/20260831040941_radar_automatic_price_distribution_continuation_v1.sql",
    "utf8",
  )
  assert.match(migration, /priceDistributionEvidence/)
  assert.match(migration, /stored\.price_distribution_evidence/)
  assert.match(migration, /get_seller_os_family_market_radar_v1/)
  assert.doesNotMatch(migration, /create table|create schedule|cron\.schedule/i)
})
