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

const {
  SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1,
  deriveSellerOsFreshnessStatusV1,
  evaluateSellerOsRuntimeCapabilityAssuranceV1,
} = await import("./runtime-capability-assurance-v1.ts")

const NOW = new Date("2026-09-07T01:00:00.000Z")

function runtimeHealth(status = "HEALTHY") {
  return {
    observedAt: NOW.toISOString(), overallStatus: status,
    evidenceCompleteness: status === "HEALTHY" ? "COMPLETE" : "UNAVAILABLE",
    services: {
      mcp: { status }, tunnel: { status }, watchdogTimer: { status },
    },
    watchdog: { lastRunAt: NOW.toISOString(),
      lastSuccessAt: status === "HEALTHY" ? NOW.toISOString() : null,
      lastResult: status === "HEALTHY" ? "success" : null },
    runtimeCatalog: { exactCatalogMatch: status === "HEALTHY" },
  }
}

function evidence(overrides = {}) {
  const stamp = "2026-09-07T00:59:00.000Z"
  return {
    scheduler: [
      { lane: "RUNTIME_CAPABILITY_ASSURANCE", enabled: true,
        last_dispatch_at: stamp },
      { lane: "OPERATIONAL_INTEGRITY_AUDITOR", enabled: true,
        last_dispatch_at: stamp },
      { lane: "DAILY_DOLLAR_RADAR_AUTOPILOT", enabled: true,
        last_dispatch_at: stamp },
      { lane: "PUBLISHER_BATCH_RUNTIME", enabled: true,
        last_dispatch_at: stamp },
    ],
    currentLive: { current_live_source_state: "CURRENT_FRESH",
      current_live_last_attempt_at: stamp,
      last_certified_live_observed_at: stamp,
      last_certified_live_scope_id: "scope", last_success_at: stamp },
    researchCapture: { id: "research-receipt", captured_at: stamp },
    researchPlans: { latestUpdatedAt: stamp },
    researchTasks: { pendingCount: 0, latestCapturedAt: stamp,
      latestProcessedAt: stamp },
    radar: { run_id: "radar-run", status: "COMPLETED",
      completed_at: stamp },
    radarReceipt: { receipt_id: "radar-receipt", recorded_at: stamp },
    economics: { latestCapturedAt: stamp, persistedFreshExpiredCount: 0 },
    economicJobs: { latestUpdatedAt: stamp, retryableCount: 0 },
    economicsReadback: { latestCalculatedAt: stamp, provenCount: 1 },
    shipping: { latestObservedAt: stamp },
    shippingClaims: { latestClaimAt: stamp, latestCompletedAt: stamp },
    productFacts: { latestFetchedAt: stamp, observationCount: 1,
      missingFreshnessPolicyCount: 0 },
    factSources: ["TAXONOMY", "CATALOG", "BROWSE"].map((source_type) =>
      ({ source_type, latest_fetched_at: stamp, available_count: 1 })),
    accountPolicies: { id: "policy", verified_at: stamp },
    orders: { snapshotCount: 1, latestObservedAt: stamp },
    analytics: { snapshotCount: 1, latestObservedAt: stamp },
    mayel: { executionCount: 1, latestAppliedAt: stamp,
      latestReadbackAt: stamp, latestUpdatedAt: stamp },
    publisher: { latestUpdatedAt: stamp, latestVerifiedAt: stamp },
    publisherBatch: { activeCount: 0, latestUpdatedAt: stamp },
    quota: [{ api_family: "SELL", status: "AVAILABLE",
      last_refreshed_at: stamp }, { api_family: "MARKETING",
      status: "AVAILABLE", last_refreshed_at: stamp }],
    integrity: { observed_at: stamp, audit_receipt: { checks: [
      { evidence: { worker: "LUNA_SHIPPING", capabilityProven: true,
        eligiblePendingJobCount: 0 } },
      { evidence: { worker: "PRODUCT_RESEARCH", capabilityProven: true,
        eligiblePendingJobCount: 0 } },
    ] } },
    ...overrides,
  }
}

test("registry covers every required critical capability with a safe canary", () => {
  assert.equal(SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.length, 25)
  assert.equal(new Set(SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.map(
    (entry) => entry.capabilityId)).size, 25)
  assert.ok(SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.every((entry) =>
    ["PASSIVE_HEARTBEAT", "READ_ONLY_PROBE", "SAFE_DRY_RUN"]
      .includes(entry.canaryMode)))
  assert.ok(SELLER_OS_CRITICAL_CAPABILITY_REGISTRY_V1.every((entry) =>
    entry.expectedOutput && entry.maxExpectedSilenceSeconds > 0 &&
      entry.recoveryPolicy && entry.failClosedPolicy))
})

test("freshness derives from time and rejects a persisted FRESH label", () => {
  assert.equal(deriveSellerOsFreshnessStatusV1({ persistedStatus: "FRESH",
    freshUntil: "2026-09-07T00:00:00.000Z", expiresAt: null,
    nonExpiringByPolicy: false, now: NOW }), "STALE")
  assert.equal(deriveSellerOsFreshnessStatusV1({ persistedStatus: "FRESH",
    freshUntil: null, expiresAt: null, nonExpiringByPolicy: false, now: NOW }),
  "FRESHNESS_POLICY_MISSING")
  assert.equal(deriveSellerOsFreshnessStatusV1({ persistedStatus: "FRESH",
    freshUntil: null, expiresAt: null, nonExpiringByPolicy: true, now: NOW }),
  "NON_EXPIRING_BY_POLICY")
})

test("a fresh scheduler tick cannot make stale Radar output healthy", () => {
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: evidence({
      radar: { run_id: "old", status: "COMPLETED",
        completed_at: "2026-08-23T08:00:12.139Z" },
      radarReceipt: { receipt_id: "old-receipt",
        recorded_at: "2026-08-23T08:00:12.139Z" },
    }) })
  const radar = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "RADAR")
  assert.equal(radar.finalHealthState, "MISSED_SCHEDULE")
  assert.equal(result.checks.find((entry) => entry.invariantCode ===
    "CAPABILITY_EXPECTED_OUTPUT:RADAR").failureClass,
  "SCHEDULER_TICK_WITHOUT_OUTPUT")
  assert.equal(result.assurances.schedulerTickFalseHealth, false)
})

test("expired worker capability preserves pending work as waiting dependency", () => {
  const stale = "2026-09-06T07:19:33.350Z"
  const input = evidence({ researchCapture: { id: "old", captured_at: stale },
    researchTasks: { pendingCount: 13, latestCapturedAt: stale,
      latestProcessedAt: stale }, integrity: { observed_at: stale,
      audit_receipt: { checks: [{ evidence: { worker: "PRODUCT_RESEARCH",
        capabilityProven: false, eligiblePendingJobCount: 13 } },
      { evidence: { worker: "LUNA_SHIPPING", capabilityProven: true,
        eligiblePendingJobCount: 0 } }] } } })
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: input })
  const worker = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "PRODUCT_RESEARCH_BROWSER_WORKER")
  assert.equal(worker.finalHealthState, "WAITING_DEPENDENCY")
  assert.equal(worker.selfRecovery, true)
  assert.equal(worker.safeFallback, "WAITING_DEPENDENCY")
})

test("economic FRESH-after-expiry is an internal violation", () => {
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: evidence({ economics: {
      latestCapturedAt: "2026-09-06T14:16:01.779Z",
      persistedFreshExpiredCount: 114,
    } }) })
  const economics = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "ECONOMICS_REFRESH")
  assert.equal(economics.finalHealthState, "DEGRADED_INTERNAL")
  assert.equal(economics.blockerCode, "FRESH_LABEL_AFTER_EXPIRY")
  assert.equal(result.assurances.freshLabelAfterExpiryPossible, false)
})

test("runtime route is POST-only and never invokes marketplace executors", () => {
  const route = readFileSync(new URL("../../app/api/runtime/capability-assurance/route.ts",
    import.meta.url), "utf8")
  const runtime = readFileSync(new URL("./runtime-capability-assurance-v1.ts",
    import.meta.url), "utf8")
  assert.match(route, /sellerOsPostOnlyGetResponseV1/)
  assert.match(runtime, /marketplaceWrites:\s*0/)
  assert.doesNotMatch(runtime, /publishOffer|ReviseFixedPriceItem|createOffer|runMayelVisualDelegatedRuntime/)
})

test("migration reuses the integrity ledger and aggregates evidence in one RPC", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260907002720_seller_os_runtime_capability_assurance_v1.sql",
    import.meta.url), "utf8")
  assert.match(migration, /get_seller_os_runtime_capability_evidence_v1/)
  assert.match(migration, /RUNTIME_CAPABILITY_ASSURANCE/)
  assert.doesNotMatch(migration, /create table public\.seller_os_runtime_capability/)
  assert.match(migration, /is_seller_os_service_role_request_v1/)
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/)
})
