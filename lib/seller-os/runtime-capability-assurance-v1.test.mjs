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
  SELLER_OS_RUNTIME_FAILURE_LEARNING_V1,
  deriveSellerOsWatchdogCadenceV1,
  detectSellerOsRuntimeHealthContradictionsV1,
  deriveSellerOsFreshnessStatusV1,
  evaluateSellerOsRuntimeCapabilityAssuranceV1,
} = await import("./runtime-capability-assurance-v1.ts")

const NOW = new Date("2026-09-07T01:00:00.000Z")

function runtimeHealth(status = "HEALTHY") {
  return {
    contractVersion: "SELLER_OS_RUNTIME_HEALTH_V1",
    observedAt: NOW.toISOString(), overallStatus: status,
    evidenceCompleteness: status === "HEALTHY" ? "COMPLETE" : "UNAVAILABLE",
    services: {
      mcp: { service: "imnova-seller-os-mcp.service", status },
      tunnel: { service: "imnova-seller-os-tunnel.service", status },
      watchdogTimer: { service: "imnova-seller-os-watchdog.timer", status,
        lastTrigger: "2026-09-07T00:58:00.000Z",
        nextTrigger: "2026-09-07T01:00:00.000Z" },
    },
    port3000: { host: "127.0.0.1", port: 3000,
      status: status === "HEALTHY" ? "AVAILABLE" : "UNKNOWN",
      observedAt: NOW.toISOString() },
    watchdog: { lastRunAt: NOW.toISOString(),
      lastSuccessAt: status === "HEALTHY" ? NOW.toISOString() : null,
      lastResult: status === "HEALTHY" ? "success" : null },
    runtimeCatalog: { exactCatalogMatch: status === "HEALTHY",
      workspaceRuntimeBindingStatus: status === "HEALTHY" ? "MATCHED"
        : "UNAVAILABLE" },
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
    accountPolicies: { id: "policy", verified_at: stamp,
      expires_at: "2026-09-08T00:59:00.000Z" },
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

test("all known historical runtime failures have durable learning policy", () => {
  assert.deepEqual(SELLER_OS_RUNTIME_FAILURE_LEARNING_V1.map((entry) =>
    entry.failureClass), ["FALSE_ZERO_ON_SOURCE_FAILURE",
    "RUNNER_PARKED_AFTER_FAILURE", "DOWNSTREAM_INCOMPLETE_NOT_RECLAIMABLE",
    "STALE_EVIDENCE_WITHOUT_REFRESH", "WORKER_CAPABILITY_EXPIRED",
    "SCHEDULER_TICK_WITHOUT_OUTPUT", "FRESH_LABEL_AFTER_EXPIRY",
    "HEALTH_OBSERVATION_CONTEXT_MISMATCH",
    "UNAVAILABLE_READ_MAPPED_TO_FAILED", "HEALTH_AUTHORITY_CONTRADICTION",
    "CADENCE_CONFIGURATION_DIVERGENCE"])
  assert.ok(SELLER_OS_RUNTIME_FAILURE_LEARNING_V1.every((entry) =>
    entry.detectionRule && entry.recoveryPolicy && entry.regressionGuard))
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

test("healthy fixed infrastructure is not classified disconnected", () => {
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: evidence() })
  for (const capabilityId of ["MCP", "TUNNEL", "WATCHDOG"]) {
    const current = result.capabilityMatrix.find((entry) =>
      entry.capabilityId === capabilityId)
    assert.equal(current.finalHealthState, "HEALTHY", capabilityId)
    assert.equal(current.connectionHealth, "PASS", capabilityId)
  }
})

test("unobservable infrastructure becomes UNKNOWN rather than failed", () => {
  const unavailable = runtimeHealth("UNAVAILABLE")
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: unavailable, evidence: evidence() })
  for (const capabilityId of ["MCP", "TUNNEL", "WATCHDOG"]) {
    const current = result.capabilityMatrix.find((entry) =>
      entry.capabilityId === capabilityId)
    assert.equal(current.finalHealthState, "UNKNOWN", capabilityId)
    assert.equal(current.connectionHealth, "UNKNOWN", capabilityId)
  }
  assert.equal(result.counts.disconnected, 0)
  assert.equal(result.assurances.unobservableNotFailed, true)
})

test("a fresh proven service failure becomes disconnected", () => {
  const failed = structuredClone(runtimeHealth())
  failed.services.mcp.status = "FAILED"
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: failed, evidence: evidence() })
  const mcp = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "MCP")
  assert.equal(mcp.finalHealthState, "DISCONNECTED")
  assert.equal(mcp.blockerCode, "MCP_SERVICE_PROVEN_FAILED")
})

test("watchdog cadence is derived from the authoritative timer schedule", () => {
  const health = runtimeHealth()
  assert.equal(deriveSellerOsWatchdogCadenceV1(health), 120)
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: health, evidence: evidence() })
  for (const capabilityId of ["MCP", "TUNNEL", "WATCHDOG"]) {
    const current = result.capabilityMatrix.find((entry) =>
      entry.capabilityId === capabilityId)
    assert.equal(current.expectedCadenceSeconds, 120, capabilityId)
    assert.equal(current.cadenceAuthority, "SELLER_OS_RUNTIME_HEALTH_V1")
  }
  assert.equal(result.assurances.cadenceAuthorityUnified, true)
})

test("on-demand account authority is governed by expiry, not missed schedule", () => {
  const input = evidence({ accountPolicies: { id: "policy",
    verified_at: "2026-09-05T19:02:00.000Z",
    expires_at: "2026-09-08T19:02:00.000Z" } })
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: input })
  const policies = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "EBAY_ACCOUNT_POLICIES")
  assert.equal(policies.expectedMode, "ON_DEMAND")
  assert.equal(policies.finalHealthState, "HEALTHY")
  assert.equal(policies.nextExpectedRunAt, null)
})

test("cross-authority contradiction blocks HEALTHY", () => {
  const failed = structuredClone(runtimeHealth())
  failed.services.tunnel.status = "FAILED"
  const contradictions = detectSellerOsRuntimeHealthContradictionsV1({
    primary: { authority: "SELLER_OS_RUNTIME_HEALTH_V1",
      runtimeHealth: runtimeHealth() },
    comparisons: [{ authority: "SECOND_CURRENT_AUTHORITY",
      runtimeHealth: failed }], now: NOW })
  assert.equal(contradictions.length, 1)
  assert.equal(contradictions[0].capability, "TUNNEL")
  const result = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(),
    comparisonRuntimeHealthAuthorities: [{
      authority: "SECOND_CURRENT_AUTHORITY", runtimeHealth: failed }],
    evidence: evidence() })
  const tunnel = result.capabilityMatrix.find((entry) =>
    entry.capabilityId === "TUNNEL")
  assert.equal(tunnel.finalHealthState, "DEGRADED_INTERNAL")
  assert.equal(tunnel.blockerCode, "HEALTH_AUTHORITY_CONTRADICTION")
  assert.equal(result.assurances.healthContradictionDetected, true)
  assert.equal(result.systemicRuntimeAssurancePass, false)
})

test("incident fingerprint is stable while timestamps and lag advance", () => {
  const first = evaluateSellerOsRuntimeCapabilityAssuranceV1({ now: NOW,
    runtimeHealth: runtimeHealth(), evidence: evidence({ radar: {
      run_id: "old", status: "COMPLETED",
      completed_at: "2026-08-23T08:00:12.139Z" }, radarReceipt: {
      receipt_id: "old-receipt", recorded_at: "2026-08-23T08:00:12.139Z" },
    }) })
  const second = evaluateSellerOsRuntimeCapabilityAssuranceV1({
    now: new Date("2026-09-07T01:15:00.000Z"),
    runtimeHealth: runtimeHealth(), evidence: evidence({ radar: {
      run_id: "old", status: "COMPLETED",
      completed_at: "2026-08-23T08:00:12.139Z" }, radarReceipt: {
      receipt_id: "old-receipt", recorded_at: "2026-08-23T08:00:12.139Z" },
    }) })
  const fingerprint = (result) => result.checks.find((entry) =>
    entry.invariantCode === "CAPABILITY_EXPECTED_OUTPUT:RADAR")
    .evidenceFingerprint
  assert.equal(fingerprint(first), fingerprint(second))
})

test("runtime route is POST-only and never invokes marketplace executors", () => {
  const route = readFileSync(new URL("../../app/api/runtime/capability-assurance/route.ts",
    import.meta.url), "utf8")
  const runtime = readFileSync(new URL("./runtime-capability-assurance-v1.ts",
    import.meta.url), "utf8")
  const ledger = readFileSync(new URL("./operational-integrity-ledger-v1.ts",
    import.meta.url), "utf8")
  assert.match(route, /sellerOsPostOnlyGetResponseV1/)
  assert.match(runtime, /marketplaceWrites:\s*0/)
  assert.match(runtime, /readLatestSellerOsRuntimeHealthAuthorityV1/)
  assert.doesNotMatch(runtime, /collectSellerOsRuntimeHealthV1/)
  assert.doesNotMatch(runtime, /publishOffer|ReviseFixedPriceItem|createOffer|runMayelVisualDelegatedRuntime/)
  assert.match(ledger, /SELLER_OS_OPERATIONAL_LEARNING_SUPERSEDE_FAILED/)
  assert.match(ledger, /\.neq\("evidence_fingerprint"/)
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
