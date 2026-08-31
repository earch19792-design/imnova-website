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

const { materializeRadarRevenueFactoryCandidateBatchV1 } = await import(
  "./ebay-opportunity-radar-revenue-factory-adapter-v1.ts"
)

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
    productTitle: `Product ${identity}`, variantTitle: "Default", gtin: null,
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

function client(queueRows, decisionRows = []) {
  return { from(table) {
    const result = table === "ebay_luna_opportunity_queue"
      ? { data: queueRows, error: null }
      : { data: decisionRows, error: null }
    const query = {
      select() { return query }, in() { return query }, eq() { return query },
      order() { return query }, limit() { return Promise.resolve(result) },
    }
    return query
  } }
}

function queueRow(index) {
  return { id: `00000000-0000-4000-8000-00000000000${index}`,
    candidate_key: `luna-portex:product-${index}:variant-${index}`,
    supplier_product_id: `product-${index}`,
    supplier_variant_id: `variant-${index}`,
    supplier_sku: `SKU-${index}`, gtin: `GTIN-${index}`, assessment: {} }
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
  }
}

test("fresh supported Radar evidence enters the existing durable factory with zero human clicks", async () => {
  let calls = 0
  const result = await materializeRadarRevenueFactoryCandidateBatchV1({
    supabase: client([queueRow(1)]), accountKey: "account",
    batch: batch([candidate(1)]),
    materializeCandidate: async (input) => {
      calls += 1
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
})
