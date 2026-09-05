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
      explicitLegitimateBlockerCount: 0 },
    numericProjections: [{ field: "activeListings",
      authorityAvailable: true, authoritativeValue: 17,
      presentedValue: 17 }],
    workers: [{ worker: "LUNA_SHIPPING", connected: true,
      capabilityProven: true, eligiblePendingJobCount: 0,
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
    workers: [{ worker: "LUNA_SHIPPING", connected: true,
      capabilityProven: false, eligiblePendingJobCount: null,
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
