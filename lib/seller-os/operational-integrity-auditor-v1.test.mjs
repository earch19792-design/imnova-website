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

const { auditSellerOsOperationalIntegrityV1 } = await import(
  "./operational-integrity-auditor-v1.ts")

function base(overrides = {}) {
  return {
    observedAt: "2026-09-05T12:00:00.000Z",
    ready: { authorityAvailable: true, authoritativeCount: 3,
      readModelCount: 3, visibleCount: 3, actionableCount: 3,
      batchEligibleCount: 3, batchButtonCount: 3,
      explicitLegitimateBlockerCount: 0 },
    candidateIntegrity: { readyWithoutActionPathCount: 0,
      shippingProvenAndZeroCount: 0, candidateCount: 3,
      provenanceClassifiedCount: 3, ownerRuntimeContinueRequiredCount: 0 },
    numericProjections: [{ field: "activeListings",
      authorityAvailable: true, authoritativeValue: 17,
      presentedValue: 17 }],
    workers: [{ worker: "LUNA_SHIPPING", authorityAvailable: true,
      connected: true, capabilityProven: true, capabilityFresh: true,
      eligiblePendingJobCount: 0,
      presentationState: "SIN_TRABAJO" }],
    actions: [{ capability: "PUBLISH_PREPARATION", uiReady: true,
      actionable: true, explicitBlocker: null }],
    publisher: { internalPass: true, physicalPass: false,
      presentationPhysicalPass: false, uiReady: true, publishable: false,
      explicitBlocker: "FAILED_PHYSICAL_ACCEPTANCE" },
    marketplaceResults: [],
    getBusinessMutationCount: 0,
    ...overrides,
  }
}

test("passes coherent projections while Publisher remains physically blocked", () => {
  const result = auditSellerOsOperationalIntegrityV1(base())
  assert.equal(result.status, "PASS")
  assert.equal(result.summary.violationCount, 0)
  assert.equal(result.safety.marketplaceWrites, 0)
})

test("unknown authority cannot be presented as zero", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    numericProjections: [{ field: "orders", authorityAvailable: true,
      authoritativeValue: null, presentedValue: 0 }],
  }))
  const guard = result.checks.find((entry) =>
    entry.invariantCode === "UNKNOWN_NOT_ZERO:orders")
  assert.equal(guard?.status, "VIOLATION")
  assert.equal(guard?.failureClass, "FALSE_ZERO_PRESENTATION")
  assert.match(guard?.evidenceFingerprint ?? "", /^sha256:[0-9a-f]{64}$/)
})

test("connected worker is not advertised capable without queue authority", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    workers: [{ worker: "LUNA_SHIPPING", authorityAvailable: false,
      connected: true, capabilityProven: false, capabilityFresh: false,
      eligiblePendingJobCount: null,
      presentationState: "SIN_TRABAJO" }],
  }))
  assert.equal(result.checks.find((entry) =>
    entry.invariantCode.startsWith("CONNECTED_NOT_WORKER_CAPABLE"))
    ?.failureClass, "WORKER_CAPABILITY_FALSE_POSITIVE")
})

test("ready without an action or explicit blocker fails closed", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    actions: [{ capability: "PUBLISH", uiReady: true, actionable: false,
      explicitBlocker: null }],
  }))
  assert.equal(result.status, "VIOLATION")
  assert.equal(result.checks.find((entry) =>
    entry.invariantCode.includes("UI_READY_REQUIRES_ACTION"))
    ?.retrySafety, "SAFE_READ_ONLY_RECONCILIATION")
})

test("fresh worker capability with authority cannot render unknown", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    workers: [{ worker: "PRODUCT_RESEARCH", authorityAvailable: true,
      connected: true, capabilityProven: true, capabilityFresh: true,
      eligiblePendingJobCount: 0, presentationState: "DESCONOCIDO" }],
  }))
  const guard = result.checks.find((entry) => entry.invariantCode ===
    "FRESH_WORKER_CAPABILITY_PASS_AND_AUTHORITY_AVAILABLE:PRODUCT_RESEARCH")
  assert.equal(guard?.status, "VIOLATION")
  assert.equal(guard?.failureClass,
    "FRESH_WORKER_CAPABILITY_PRESENTED_UNKNOWN")
})

test("expired worker receipt may remain unknown", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    workers: [{ worker: "LUNA_SHIPPING", authorityAvailable: true,
      connected: false, capabilityProven: false, capabilityFresh: false,
      eligiblePendingJobCount: 0, presentationState: "DESCONOCIDO" }],
  }))
  const guard = result.checks.find((entry) => entry.invariantCode ===
    "FRESH_WORKER_CAPABILITY_PASS_AND_AUTHORITY_AVAILABLE:LUNA_SHIPPING")
  assert.equal(guard?.status, "PASS")
})

test("batch button count must equal exact actionable membership", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    ready: { authorityAvailable: true, authoritativeCount: 3,
      readModelCount: 3, visibleCount: 3, actionableCount: 3,
      batchEligibleCount: 2, batchButtonCount: 3,
      explicitLegitimateBlockerCount: 0 },
  }))
  const guard = result.checks.find((entry) =>
    entry.invariantCode ===
      "ACTIONABLE_READY_EQUALS_BATCH_ELIGIBLE_AND_BUTTON_N")
  assert.equal(guard?.status, "VIOLATION")
  assert.equal(guard?.failureClass,
    "BATCH_AUTHORIZATION_SCOPE_DIVERGENCE")
})

test("contradictory economics and unclassified provenance are durable violations", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    candidateIntegrity: { readyWithoutActionPathCount: 1,
      shippingProvenAndZeroCount: 1, candidateCount: 3,
      provenanceClassifiedCount: 2, ownerRuntimeContinueRequiredCount: 1 },
  }))
  const failures = new Set(result.checks.filter((entry) =>
    entry.status === "VIOLATION").map((entry) => entry.failureClass))
  assert.equal(failures.has("READY_WITHOUT_ACTION_PATH"), true)
  assert.equal(failures.has("CONTRADICTORY_ECONOMICS_PRESENTATION"), true)
  assert.equal(failures.has("CANDIDATE_PROVENANCE_UNCLASSIFIED"), true)
  assert.equal(failures.has(
    "OWNER_RUNTIME_CONTINUE_REQUIRED_FOR_NORMAL_PROGRESS"), true)
})

test("HTTP success never substitutes official marketplace success", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    marketplaceResults: [{ operation: "PUBLISHER", httpStatus: 200,
      ownerPresentationSuccess: true, officialSuccess: null,
      durableReceipt: false, officialReadback: false }],
  }))
  assert.equal(result.checks.filter((entry) =>
    entry.status === "VIOLATION").length, 2)
})

test("GET business continuation is an engineering violation", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    getBusinessMutationCount: 1,
  }))
  assert.equal(result.checks.find((entry) =>
    entry.invariantCode === "GET_BUSINESS_MUTATIONS_ZERO")?.status,
  "VIOLATION")
})
