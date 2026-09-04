import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSellerOsLongitudinalOpportunityCaseV1,
  buildSellerOsLongitudinalOpportunityRadarV1,
  collectSellerOsLongitudinalOpportunityReadV1,
} from "./ebay-longitudinal-opportunity-radar-read-v1.ts"

const TESLA_CASE =
  "opportunity-case-v1:sha256:eda23a561eac22520f9f8476edea6fe4f87cbe16454c7a8072970bbc0a96b11d"

function family(index, overrides = {}) {
  const digit = String(index).padStart(2, "0")
  const observationId = `family-market-observation-v1:sha256:${digit.repeat(32)}`
  return {
    familyId: `market-family-v1:sha256:${digit.repeat(32)}`,
    opportunityCaseId: index === 1 ? TESLA_CASE
      : `opportunity-case-v1:sha256:${digit.repeat(32)}`,
    familyName: index === 1 ? "Tesla Gen II / NEMA adapter family"
      : `Family ${index}`,
    marketObservationCount: 1,
    observationSeries: [{
      observationId,
      observationWindowStart: "2026-08-01T00:00:00.000Z",
      observationWindowEnd: "2026-08-22T00:00:00.000Z",
      familyDemandStatus: index <= 2
        ? "FAMILY_DEMAND_PROVEN" : "FAMILY_DEMAND_SUPPORTED",
      demandEvidenceClass: "OFFICIAL_SOLD_EVIDENCE",
      demandEvidenceDigest: `sha256:${digit.repeat(32)}`,
      soldComparableCount: index === 1 ? 31 : index,
      soldQuantity: index === 1 ? 80 : index,
      activeComparableCount: null,
      sellerDiversity: null,
      priceCurrency: "USD",
      priceBandMinimum: 1,
      priceBandMaximum: 179.95,
      priceMedian: 35.99,
      competitionState: "UNPROVEN",
      momentumStatus: "INSUFFICIENT_HISTORY",
      previousObservationId: null,
      evidenceObservedAt: "2026-08-22T14:30:00.000Z",
      sourceUpdatedAt: "2026-08-22T14:00:00.000Z",
      fresh: true,
      limitations: ["FAMILY_LEVEL_ONLY"],
      rawCapturePayload: { password: "must-not-propagate" },
      ...(overrides.observation ?? {}),
    }],
    monitorEnrollments: [{
      enrollmentId: `opportunity-monitor-enrollment-v1:sha256:${digit.repeat(32)}`,
      status: "ENROLLED",
      nextReviewCondition: "TIME_WINDOW_ELAPSED",
      nextEligibleReviewAt: null,
      lastObservationId: observationId,
      lastEvaluatedAt: "2026-08-22T14:31:00.000Z",
      monitorPolicyVersion: "MONITOR_POLICY_V1",
      schedulerEnabled: false,
    }],
    ...(overrides.family ?? {}),
  }
}

function payload(count = 5) {
  return { contractVersion: "SELLER_OS_FAMILY_MARKET_RADAR_READ_V1",
    status: "AVAILABLE", familyCount: count,
    families: Array.from({ length: count }, (_, index) => family(index + 1)) }
}

function runtimePayload(count = 5) {
  const value = payload(count)
  value.longitudinalRuntimeContractVersion =
    "SELLER_OS_LONGITUDINAL_RADAR_RUNTIME_V1"
  value.schedulerTrigger = "VERCEL_CRON_MARKET_RADAR_LUNA_SYNC"
  value.schedulerEnabled = true
  for (const entry of value.families) {
    entry.monitorEnrollments[0].schedulerEnabled = true
  }
  return value
}

test("no persisted observations remains fail-closed and never fakes availability", () => {
  const empty = buildSellerOsLongitudinalOpportunityRadarV1({
    status: "AVAILABLE", families: [],
  })
  assert.equal(empty.status, "UNPROVEN")
  assert.equal(empty.persistedMarketObservationSeriesAvailable, false)
  assert.equal(empty.resultCount, null)
  assert.equal(empty.reason,
    "PERSISTED_MARKET_OBSERVATION_SERIES_UNAVAILABLE")
})

test("one T0 is available but never becomes a sold momentum claim", () => {
  const result = buildSellerOsLongitudinalOpportunityRadarV1(payload(1))
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.resultCount, 1)
  assert.equal(result.persistedMarketObservationSeriesAvailable, true)
  assert.equal(result.entries[0].familyDemandStatus, "FAMILY_DEMAND_PROVEN")
  assert.equal(result.entries[0].momentumStatus, "INSUFFICIENT_HISTORY")
  assert.equal(result.entries[0].soldMomentumClaimed, false)
  assert.equal(result.soldMomentumClaimed, false)
})

test("owner read model separates global automatic runtime from raw enrollment field", () => {
  const result = buildSellerOsLongitudinalOpportunityRadarV1(runtimePayload(1))
  assert.equal(result.automaticReviewRuntime.status, "ACTIVE")
  assert.equal(result.entries[0].automaticReviewRuntime.effectiveState,
    "ACTIVE")
  assert.equal(result.entries[0].automaticReviewRuntime
    .legacyEnrollmentFieldUsedAloneAsOwnerAuthority, false)
  assert.equal(result.entries[0].monitorEnrollment.schedulerEnabled, true)
  assert.equal(result.entries[0].monitorEnrollment.schedulerEnabledAuthority,
    "STORED_PER_ENROLLMENT_ELIGIBILITY_DIAGNOSTIC")

  const legacyOnly = payload(1)
  legacyOnly.families[0].monitorEnrollments[0].schedulerEnabled = true
  const legacyProjection = buildSellerOsLongitudinalOpportunityRadarV1(
    legacyOnly)
  assert.equal(legacyProjection.automaticReviewRuntime.status, "UNPROVEN")
  assert.equal(legacyProjection.entries[0].automaticReviewRuntime
    .effectiveState, "INACTIVE_OR_UNPROVEN")
})

test("five families and limit are bounded without inventing extra entries", () => {
  const all = buildSellerOsLongitudinalOpportunityRadarV1(payload(5), 20)
  const one = buildSellerOsLongitudinalOpportunityRadarV1(payload(5), 1)
  const oversized = buildSellerOsLongitudinalOpportunityRadarV1(payload(5), 100)
  assert.equal(all.resultCount, 5)
  assert.equal(one.resultCount, 1)
  assert.equal(oversized.resultCount, 5)
  assert.equal(all.entries.filter((entry) =>
    entry.familyDemandStatus === "FAMILY_DEMAND_SUPPORTED").length, 3)
  assert.ok(all.entries.every((entry) =>
    entry.momentumStatus === "INSUFFICIENT_HISTORY"))
})

test("known Tesla Opportunity Case resolves exact persisted family and T0", () => {
  const result = buildSellerOsLongitudinalOpportunityCaseV1(payload(5), TESLA_CASE)
  assert.equal(result.status, "AVAILABLE")
  assert.equal(result.opportunityCaseId, TESLA_CASE)
  assert.equal(result.familyDemandStatus, "FAMILY_DEMAND_PROVEN")
  assert.equal(result.observationCount, 1)
  assert.equal(result.momentumStatus, "INSUFFICIENT_HISTORY")
  assert.equal(result.monitorEnrollment.status, "ENROLLED")
  assert.equal(result.soldMomentumClaimed, false)
})

test("unknown exact case is not found and malformed or injected identifiers are rejected", () => {
  const missing = buildSellerOsLongitudinalOpportunityCaseV1(
    payload(1),
    `opportunity-case-v1:sha256:${"f".repeat(64)}`,
  )
  assert.equal(missing.status, "NOT_FOUND")
  assert.equal(missing.reason, "OPPORTUNITY_CASE_NOT_FOUND")
  for (const id of ["", "x'.select * from secrets--", "public.table",
    "opportunity-case-v1:sha256:" + "g".repeat(64)]) {
    assert.throws(() => buildSellerOsLongitudinalOpportunityCaseV1(
      payload(1), id), /OPPORTUNITY_CASE_ID_INVALID/)
  }
})

test("future multiple observations remain bounded and current observation is explicit", () => {
  const value = payload(1)
  const second = { ...value.families[0].observationSeries[0],
    observationId: `family-market-observation-v1:sha256:${"f".repeat(64)}`,
    momentumStatus: "STRENGTHENING",
    previousObservationId: value.families[0].observationSeries[0].observationId,
    observationWindowEnd: "2026-08-23T00:00:00.000Z" }
  value.families[0].observationSeries.unshift(second)
  value.families[0].marketObservationCount = 2
  const result = buildSellerOsLongitudinalOpportunityRadarV1(value)
  assert.equal(result.entries[0].observationCount, 2)
  assert.equal(result.entries[0].currentObservationId, second.observationId)
  assert.equal(result.entries[0].momentumStatus, "STRENGTHENING")
})

test("collector calls only the fixed read RPC and projects no raw payload or secrets", async () => {
  const calls = []
  const client = { rpc: async (name, parameters) => {
    calls.push({ name, parameters })
    return { data: payload(5), error: null }
  } }
  const result = await collectSellerOsLongitudinalOpportunityReadV1({
    toolName: "seller_os_get_opportunity_radar",
    arguments: { limit: 20 },
    client,
  })
  assert.deepEqual(calls, [{ name: "get_seller_os_family_market_radar_v1",
    parameters: { p_family_id: null, p_limit: 20 } }])
  assert.equal(result.resultCount, 5)
  assert.equal(result.safety.databaseWrites, 0)
  assert.doesNotMatch(JSON.stringify(result),
    /must-not-propagate|rawCapturePayload|password|authorization|cookie/i)
})

test("case collector uses the same fixed RPC and validates before database access", async () => {
  let reads = 0
  const client = { rpc: async () => {
    reads += 1
    return { data: payload(5), error: null }
  } }
  const result = await collectSellerOsLongitudinalOpportunityReadV1({
    toolName: "seller_os_get_opportunity_case",
    arguments: { opportunityCaseId: TESLA_CASE }, client,
  })
  assert.equal(result.status, "AVAILABLE")
  assert.equal(reads, 1)
  await assert.rejects(collectSellerOsLongitudinalOpportunityReadV1({
    toolName: "seller_os_get_opportunity_case",
    arguments: { opportunityCaseId: "public.secrets;select" }, client,
  }), /OPPORTUNITY_CASE_ID_INVALID/)
  assert.equal(reads, 1)
})
