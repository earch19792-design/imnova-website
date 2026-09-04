import assert from "node:assert/strict"
import test from "node:test"

import { buildCommercialComparableClusterV1,
  runSellerOsLongitudinalRadarCycleV1 } from
  "./ebay-longitudinal-family-radar-runtime-v1.ts"

const hash = (digit) => digit.repeat(64)

function family({ digit, name, demand, count, fresh }) {
  const observationId = `family-market-observation-v1:sha256:${hash(digit)}`
  return { familyId: `market-family-v1:sha256:${hash(digit)}`,
    opportunityCaseId: `opportunity-case-v1:sha256:${hash(digit)}`,
    familyName: name, marketObservationCount: count,
    familyIdentity: { structuredDefinition: { "category id": "123" } },
    observationSeries: [{ observationId, familyDemandStatus: demand,
      fresh, priceBandMinimum: 10, priceBandMaximum: 900 }],
    monitorEnrollments: [{ status: "ENROLLED", schedulerEnabled: true,
      nextReviewCondition: "TIME_WINDOW_ELAPSED", nextEligibleReviewAt: null,
      lastObservationId: observationId }] }
}

function comparable(id, quality, price, overrides = {}) {
  return { comparableId: id, identityMatchQuality: quality,
    eligibleComparable: true, identityConflicts: [], price,
    evidenceSource: "EBAY_BROWSE_ACTIVE_MARKET_EVIDENCE",
    estimatedSoldQuantity: 1, verifiedSoldQuantity: 0, ...overrides }
}

test("commercial cluster excludes family/conflict rows and robust price outliers", () => {
  const cluster = buildCommercialComparableClusterV1({ sellersAnalyzed: 4,
    comparableEvidence: [
      comparable("1", "EXACT", 20), comparable("2", "STRONG", 21),
      comparable("3", "EXACT_IDENTIFIER", 22), comparable("4", "EXACT", 23),
      comparable("5", "EXACT", 900),
      comparable("6", "WEAK", 19, { eligibleComparable: false }),
      comparable("7", "EXACT", 24, { identityConflicts: ["PACK_CONFLICT"] }),
    ] })
  assert.equal(cluster.status, "AVAILABLE")
  assert.equal(cluster.comparableCount, 4)
  assert.deepEqual([cluster.typicalLow, cluster.median, cluster.typicalHigh],
    [20.75, 21.5, 22.25])
  assert.equal(cluster.outliersExcludedCount, 3)
  assert.ok(cluster.exclusionReasons.includes("ROBUST_PRICE_OUTLIER_EXCLUDED"))
})

test("insufficient commercially equivalent evidence never invents a band", () => {
  const cluster = buildCommercialComparableClusterV1({ sellersAnalyzed: 2,
    comparableEvidence: [comparable("1", "EXACT", 20),
      comparable("2", "WEAK", 900, { eligibleComparable: false })] })
  assert.equal(cluster.status, "UNPROVEN")
  assert.equal(cluster.typicalLow, null)
  assert.equal(cluster.typicalHigh, null)
})

test("certification uses one scheduler cycle, refreshes due A+B and skips fresh C", async () => {
  const families = [
    family({ digit: "1", name: "A", demand: "FAMILY_DEMAND_PROVEN",
      count: 1, fresh: false }),
    family({ digit: "2", name: "B", demand: "FAMILY_DEMAND_SUPPORTED",
      count: 1, fresh: false }),
    family({ digit: "3", name: "C", demand: "FAMILY_DEMAND_PROVEN",
      count: 2, fresh: true }),
  ]
  const rpcCalls = []
  const client = { rpc: async (name, parameters) => {
    rpcCalls.push({ name, parameters })
    if (name === "get_seller_os_family_market_radar_v1") {
      return { data: { status: "AVAILABLE", families }, error: null }
    }
    return { data: { outcome: "CREATED",
      observationId: `family-market-observation-v1:sha256:${hash("a")}`,
      previousObservationId: parameters.p_expected_current_observation_id,
      momentumStatus: "NEEDS_MORE_EVIDENCE",
      duplicateObservationCreated: false }, error: null }
  } }
  let marketReads = 0
  const result = await runSellerOsLongitudinalRadarCycleV1({
    supabase: client, mode: "CERTIFICATION",
    now: new Date("2026-09-03T18:00:00.000Z"),
    marketReader: async () => {
      marketReads += 1
      return { sellersAnalyzed: 3, comparableEvidence: [
        comparable(`${marketReads}-1`, "EXACT", 20),
        comparable(`${marketReads}-2`, "STRONG", 21),
        comparable(`${marketReads}-3`, "EXACT", 22),
      ] }
    },
  })
  assert.equal(result.familiesEvaluated, 3)
  assert.equal(result.marketplaceReadCount, 2)
  assert.equal(result.ineligibleFamiliesSkipped, 1)
  assert.equal(result.observationsCreated, 2)
  assert.equal(result.duplicateObservationCount, 0)
  assert.equal(result.openAiCallCount, 0)
  assert.equal(result.outcomes[2].freshEvidenceReused, true)
  assert.equal(rpcCalls.filter((call) =>
    call.name === "put_seller_os_longitudinal_family_refresh_v1").length, 2)
  assert.ok(result.outcomes.every((entry) =>
    entry.familyDemandStatusBefore === entry.familyDemandStatusAfter ||
      entry.eligibleForRefresh === false))
  assert.equal(result.safety.marketplaceWrites, 0)
  assert.equal(result.safety.lunaSearches, 0)
})
