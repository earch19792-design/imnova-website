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
      readyWithStalePackageCount: 0,
      readyWithContradictoryEconomicsCount: 0,
      shippingProvenAndZeroCount: 0, candidateCount: 3,
      provenanceClassifiedCount: 3, ownerRuntimeContinueRequiredCount: 0 },
    numericProjections: [{ field: "activeListings",
      authorityAvailable: true, authoritativeValue: 17,
      presentedValue: 17 }],
    currentLiveAuthority: { currentState: "CURRENT_FRESH",
      currentListingCount: 17, authoritativeZero: false,
      lastCertifiedState: "LAST_CERTIFIED_AVAILABLE",
      lastCertifiedListingCount: 17, presentedCurrentCount: 17 },
    workers: [{ worker: "LUNA_SHIPPING", authorityAvailable: true,
      connected: true, connectionState: "CONECTADA",
      capabilityProven: true, capabilityFresh: true,
      eligiblePendingJobCount: 0,
      presentationState: "SIN_TRABAJO" }],
    actions: [{ capability: "PUBLISH_PREPARATION", uiReady: true,
      actionable: true, explicitBlocker: null }],
    publisher: { internalPass: true, physicalPass: false,
      presentationPhysicalPass: false, uiReady: true, publishable: false,
      explicitBlocker: "FAILED_PHYSICAL_ACCEPTANCE" },
    publisherAuthorizationIntegrity: { authorityAvailable: true,
      authorizedPackageCount: 0, postAuthorizationPackageMutationCount: 0,
      authorizedDigestMismatchCount: 0,
      authorizedImagesDigestMismatchCount: 0,
      readOnlyPreflightPackageMutationCount: 0,
      technicalConfirmationAfterAuthPackageWriteCount: 0,
      childMaterialChangeInvalidatesOnlyChild: true,
      oldAuthorizationBoundToNewDigestCount: 0 },
    marketplaceResults: [],
    salesIntegrity: { sourceIsOfficialOrders: true,
      orderDedupeProven: true, unknownRevenueRenderedAsZero: false,
      cancelledUnpaidExcluded: true, refundIncreasesNetSales: false,
      chartTotalReconciles: true, ownerTimeZone: "America/Managua" },
    categoryIntegrity: { categoryTotalReconciles: true,
      unmappedSalesVisible: true, marketOpportunitySeparate: true,
      insufficientSampleProducesTrend: false,
      staleDataPresentedCurrent: false },
    productJourney: { traceAvailable: true,
      everyStageHasHumanStatus: true,
      everyStageHasSourceAuthority: true,
      everyStageHasFreshness: true,
      everyStageHasOutputOrExplicitFailure: true,
      technicalDetailsSecondary: true, falseZeroCount: 0,
      falseCompletedCount: 0, ownerTechnicalRecoveryCount: 0 },
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

test("an unavailable current LIVE source cannot project a zero cohort", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    currentLiveAuthority: { currentState: "CURRENT_UNAVAILABLE",
      currentListingCount: null, authoritativeZero: false,
      lastCertifiedState: "LAST_CERTIFIED_STALE",
      lastCertifiedListingCount: 23, presentedCurrentCount: 0 },
  }))
  const guard = result.checks.find((entry) => entry.invariantCode ===
    "CURRENT_SOURCE_FAILURE_DOES_NOT_ZERO_COHORT")
  assert.equal(guard?.status, "VIOLATION")
  assert.equal(guard?.failureClass, "CURRENT_LIVE_AUTHORITY_FALSE_ZERO")
})

test("an unavailable source preserves certified history separately", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    currentLiveAuthority: { currentState: "CURRENT_UNAVAILABLE",
      currentListingCount: null, authoritativeZero: false,
      lastCertifiedState: "LAST_CERTIFIED_STALE",
      lastCertifiedListingCount: 23, presentedCurrentCount: null },
  }))
  assert.equal(result.checks.find((entry) => entry.invariantCode ===
    "CURRENT_SOURCE_FAILURE_DOES_NOT_ZERO_COHORT")?.status, "PASS")
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
      readyWithStalePackageCount: 1,
      readyWithContradictoryEconomicsCount: 1,
      shippingProvenAndZeroCount: 1, candidateCount: 3,
      provenanceClassifiedCount: 2, ownerRuntimeContinueRequiredCount: 1 },
  }))
  const failures = new Set(result.checks.filter((entry) =>
    entry.status === "VIOLATION").map((entry) => entry.failureClass))
  assert.equal(failures.has("READY_WITHOUT_ACTION_PATH"), true)
  assert.equal(failures.has("READY_WITH_STALE_PACKAGE"), true)
  assert.equal(failures.has("READY_WITH_CONTRADICTORY_ECONOMICS"), true)
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

test("authorized package or image drift is a fail-closed violation", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    publisherAuthorizationIntegrity: { authorityAvailable: true,
      authorizedPackageCount: 2, postAuthorizationPackageMutationCount: 1,
      authorizedDigestMismatchCount: 1,
      authorizedImagesDigestMismatchCount: 1,
      readOnlyPreflightPackageMutationCount: 1,
      technicalConfirmationAfterAuthPackageWriteCount: 1,
      childMaterialChangeInvalidatesOnlyChild: false,
      oldAuthorizationBoundToNewDigestCount: 1 },
  }))
  const failures = new Set(result.checks.filter((entry) =>
    entry.status === "VIOLATION").map((entry) => entry.failureClass))
  assert.equal(failures.has("POST_AUTH_PACKAGE_MUTATION"), true)
  assert.equal(failures.has("AUTHORIZED_EXECUTION_DIGEST_MISMATCH"), true)
  assert.equal(failures.has("AUTHORIZED_EXECUTION_IMAGES_DIGEST_MISMATCH"), true)
  assert.equal(failures.has("READ_ONLY_PREFLIGHT_PACKAGE_MUTATION"), true)
  assert.equal(failures.has("STALE_AUTHORIZATION_REBOUND_TO_NEW_DIGEST"), true)
  assert.equal(failures.has("BATCH_WIDE_AUTHORIZATION_INVALIDATION"), true)
})

test("product journey guards human truth and owner burden", () => {
  const result = auditSellerOsOperationalIntegrityV1(base({
    productJourney: { traceAvailable: true,
      everyStageHasHumanStatus: true,
      everyStageHasSourceAuthority: false,
      everyStageHasFreshness: true,
      everyStageHasOutputOrExplicitFailure: false,
      technicalDetailsSecondary: true, falseZeroCount: 1,
      falseCompletedCount: 1, ownerTechnicalRecoveryCount: 1 },
  }))
  const failures = new Set(result.checks.filter((entry) =>
    entry.status === "VIOLATION").map((entry) => entry.failureClass))
  assert.equal(failures.has("PRODUCT_JOURNEY_SOURCE_AUTHORITY_MISSING"), true)
  assert.equal(failures.has("PRODUCT_JOURNEY_OUTPUT_OR_FAILURE_MISSING"), true)
  assert.equal(failures.has("PRODUCT_JOURNEY_FALSE_ZERO"), true)
  assert.equal(failures.has("PRODUCT_JOURNEY_FALSE_COMPLETED"), true)
  assert.equal(failures.has("OWNER_PRODUCT_TECHNICAL_RECOVERY_REQUIRED"), true)
})
