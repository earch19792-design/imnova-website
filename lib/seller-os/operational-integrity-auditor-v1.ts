import { createHash } from "node:crypto"

export const SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION =
  "SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_V1" as const
export const SELLER_OS_OPERATIONAL_INTEGRITY_RECOVERY_POLICY_VERSION =
  "SELLER_OS_OPERATIONAL_INTEGRITY_RECOVERY_POLICY_V1" as const

export type SellerOsIntegrityCheckStatusV1 =
  "PASS" | "VIOLATION" | "UNKNOWN"
export type SellerOsRetrySafetyV1 =
  | "SAFE_READ_ONLY_RECONCILIATION"
  | "SAFE_IDEMPOTENT_RUNTIME_RESUME"
  | "OWNER_COMMERCIAL_AUTHORIZATION_REQUIRED"
  | "ENGINEERING_REQUIRED"
  | "NOT_APPLICABLE"
export type SellerOsRecoveryClassV1 =
  "AUTO_RECOVERABLE" | "OWNER_COMMERCIAL" | "ENGINEERING_REQUIRED" |
  "OBSERVATION_ONLY"

export type SellerOsOperationalIntegrityInputV1 = Readonly<{
  observedAt?: string
  ready?: Readonly<{
    authorityAvailable: boolean
    authoritativeCount: number | null
    readModelCount: number | null
    visibleCount: number | null
    actionableCount: number | null
    batchEligibleCount?: number | null
    batchButtonCount?: number | null
    explicitLegitimateBlockerCount: number | null
  }>
  candidateIntegrity?: Readonly<{
    readyWithoutActionPathCount: number | null
    readyWithStalePackageCount: number | null
    readyWithContradictoryEconomicsCount: number | null
    shippingProvenAndZeroCount: number | null
    candidateCount: number | null
    provenanceClassifiedCount: number | null
    ownerRuntimeContinueRequiredCount: number | null
  }>
  numericProjections?: readonly Readonly<{
    field: string
    authorityAvailable: boolean
    authoritativeValue: number | null
    presentedValue: number | null
  }>[]
  workers?: readonly Readonly<{
    worker: string
    authorityAvailable: boolean
    connected: boolean
    connectionState?: string
    capabilityProven: boolean
    capabilityFresh: boolean
    eligiblePendingJobCount: number | null
    presentationState: string
  }>[]
  salesIntegrity?: Readonly<{
    sourceIsOfficialOrders: boolean
    orderDedupeProven: boolean
    unknownRevenueRenderedAsZero: boolean
    cancelledUnpaidExcluded: boolean
    refundIncreasesNetSales: boolean
    chartTotalReconciles: boolean | null
    ownerTimeZone: string | null
  }>
  categoryIntegrity?: Readonly<{
    categoryTotalReconciles: boolean | null
    unmappedSalesVisible: boolean
    marketOpportunitySeparate: boolean
    insufficientSampleProducesTrend: boolean
    staleDataPresentedCurrent: boolean
  }>
  actions?: readonly Readonly<{
    capability: string
    uiReady: boolean
    actionable: boolean
    explicitBlocker: string | null
  }>[]
  publisher?: Readonly<{
    internalPass: boolean
    physicalPass: boolean
    presentationPhysicalPass: boolean
    uiReady: boolean
    publishable: boolean
    explicitBlocker: string | null
  }>
  publisherAuthorizationIntegrity?: Readonly<{
    authorityAvailable: boolean
    authorizedPackageCount: number | null
    postAuthorizationPackageMutationCount: number | null
    authorizedDigestMismatchCount: number | null
    authorizedImagesDigestMismatchCount: number | null
    readOnlyPreflightPackageMutationCount: number | null
    technicalConfirmationAfterAuthPackageWriteCount: number | null
    childMaterialChangeInvalidatesOnlyChild: boolean | null
    oldAuthorizationBoundToNewDigestCount: number | null
  }>
  marketplaceResults?: readonly Readonly<{
    operation: string
    httpStatus: number | null
    ownerPresentationSuccess: boolean
    officialSuccess: boolean | null
    durableReceipt: boolean
    officialReadback: boolean
  }>[]
  getBusinessMutationCount: number
}>

export type SellerOsOperationalIntegrityCheckV1 = Readonly<{
  invariantCode: string
  status: SellerOsIntegrityCheckStatusV1
  failureClass: string | null
  retrySafety: SellerOsRetrySafetyV1
  recoveryClass: SellerOsRecoveryClassV1
  evidenceFingerprint: string
  evidence: Readonly<Record<string, unknown>>
  regressionGuard: Readonly<Record<string, unknown>>
}>

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, normalized(entry)]))
}

function fingerprint(code: string, evidence: Record<string, unknown>) {
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized({
    code, evidence,
  }))).digest("hex")}`
}

function check(input: Readonly<{
  invariantCode: string
  status: SellerOsIntegrityCheckStatusV1
  failureClass?: string | null
  retrySafety?: SellerOsRetrySafetyV1
  recoveryClass?: SellerOsRecoveryClassV1
  evidence: Record<string, unknown>
  regressionGuard: Record<string, unknown>
}>): SellerOsOperationalIntegrityCheckV1 {
  const failed = input.status === "VIOLATION"
  return Object.freeze({
    invariantCode: input.invariantCode,
    status: input.status,
    failureClass: failed ? input.failureClass ?? "UNCLASSIFIED_INVARIANT" : null,
    retrySafety: input.retrySafety ?? "NOT_APPLICABLE",
    recoveryClass: input.recoveryClass ?? "OBSERVATION_ONLY",
    evidenceFingerprint: fingerprint(input.invariantCode, input.evidence),
    evidence: Object.freeze(input.evidence),
    regressionGuard: Object.freeze(input.regressionGuard),
  })
}

function countStatus(available: boolean, ...values: (number | null)[]) {
  if (!available || values.some((value) => value === null)) return "UNKNOWN"
  return "PASS"
}

export function auditSellerOsOperationalIntegrityV1(
  input: SellerOsOperationalIntegrityInputV1,
) {
  const checks: SellerOsOperationalIntegrityCheckV1[] = []
  const ready = input.ready
  if (ready) {
    const availability = countStatus(ready.authorityAvailable,
      ready.authoritativeCount, ready.readModelCount, ready.visibleCount)
    const parity = availability === "UNKNOWN" ? "UNKNOWN"
      : ready.authoritativeCount === ready.readModelCount &&
        ready.readModelCount === ready.visibleCount ? "PASS" : "VIOLATION"
    checks.push(check({
      invariantCode: "AUTHORITATIVE_READY_COUNT_EQUALS_VISIBLE_READY_COUNT",
      status: parity,
      failureClass: "READY_COUNT_READ_MODEL_DIVERGENCE",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { authorityAvailable: ready.authorityAvailable,
        authoritativeCount: ready.authoritativeCount,
        readModelCount: ready.readModelCount,
        visibleCount: ready.visibleCount },
      regressionGuard: {
        authoritativeReadyCountEqualsVisibleReadyCount: true,
        unknownIsNotZero: true,
      },
    }))
    const actionableAvailability = countStatus(ready.authorityAvailable,
      ready.visibleCount, ready.actionableCount,
      ready.explicitLegitimateBlockerCount)
    const actionable = actionableAvailability === "UNKNOWN" ? "UNKNOWN"
      : ready.visibleCount === (ready.actionableCount ?? 0) +
          (ready.explicitLegitimateBlockerCount ?? 0)
        ? "PASS" : "VIOLATION"
    checks.push(check({
      invariantCode: "VISIBLE_READY_EQUALS_ACTIONABLE_PLUS_EXPLICIT_BLOCKERS",
      status: actionable,
      failureClass: "READY_ACTIONABILITY_DIVERGENCE",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { visibleCount: ready.visibleCount,
        actionableCount: ready.actionableCount,
        explicitLegitimateBlockerCount:
          ready.explicitLegitimateBlockerCount },
      regressionGuard: {
        readyRequiresActionOrExplicitBlocker: true,
        hiddenOwnerBurdenForbidden: true,
      },
    }))
    const batchEligibleCount = ready.batchEligibleCount === undefined
      ? ready.actionableCount : ready.batchEligibleCount
    const batchButtonCount = ready.batchButtonCount === undefined
      ? batchEligibleCount : ready.batchButtonCount
    const batchAvailability = countStatus(ready.authorityAvailable,
      ready.actionableCount, batchEligibleCount, batchButtonCount)
    const batchParity = batchAvailability === "UNKNOWN" ? "UNKNOWN"
      : ready.actionableCount === batchEligibleCount
        && batchEligibleCount === batchButtonCount
        ? "PASS" : "VIOLATION"
    checks.push(check({
      invariantCode: "ACTIONABLE_READY_EQUALS_BATCH_ELIGIBLE_AND_BUTTON_N",
      status: batchParity,
      failureClass: "BATCH_AUTHORIZATION_SCOPE_DIVERGENCE",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { actionableCount: ready.actionableCount,
        batchEligibleCount, batchButtonCount },
      regressionGuard: { batchButtonUsesExactEligibleMembership: true,
        visibleReadyCountIsNotBatchAuthority: true },
    }))
  }

  const sales = input.salesIntegrity
  if (sales) for (const [code, failureClass, passes] of [
    ["OFFICIAL_ORDER_COUNT_MUST_NOT_BE_DERIVED_FROM_ANALYTICS",
      "NON_OFFICIAL_SALES_AUTHORITY", sales.sourceIsOfficialOrders],
    ["ORDER_DEDUPE_REQUIRED", "ORDER_IDENTITY_DEDUPE_UNPROVEN",
      sales.orderDedupeProven],
    ["UNKNOWN_REVENUE_MUST_NOT_RENDER_AS_ZERO",
      "UNKNOWN_REVENUE_RENDERED_ZERO", !sales.unknownRevenueRenderedAsZero],
    ["REFUND_MUST_NOT_INCREASE_NET_SALES", "REFUND_NET_SALES_INVERSION",
      !sales.refundIncreasesNetSales],
    ["CANCELLED_UNPAID_ORDER_MUST_NOT_COUNT_AS_CONFIRMED_REVENUE",
      "UNCONFIRMED_ORDER_COUNTED_AS_REVENUE", sales.cancelledUnpaidExcluded],
    ["SALES_CHART_TOTAL_MUST_RECONCILE_WITH_OFFICIAL_ORDER_AUTHORITY",
      "SALES_CHART_TOTAL_DIVERGENCE", sales.chartTotalReconciles],
    ["OWNER_TIME_BUCKETS_MUST_USE_DECLARED_OPERATIONAL_TIMEZONE",
      "OWNER_SALES_TIMEZONE_DIVERGENCE",
      sales.ownerTimeZone === "America/Managua"],
  ] as const) checks.push(check({ invariantCode: code,
    status: passes === null ? "UNKNOWN" : passes ? "PASS" : "VIOLATION",
    failureClass, retrySafety: "ENGINEERING_REQUIRED",
    recoveryClass: "ENGINEERING_REQUIRED", evidence: { passes,
      ownerTimeZone: sales.ownerTimeZone },
    regressionGuard: { officialOrdersOnly: true, unknownIsNotZero: true,
      ownerTimeZone: "America/Managua" } }))

  const categories = input.categoryIntegrity
  if (categories) for (const [code, failureClass, passes] of [
    ["CATEGORY_SALES_TOTAL_MUST_RECONCILE_WITH_OFFICIAL_ORDER_TOTAL",
      "CATEGORY_SALES_TOTAL_DIVERGENCE", categories.categoryTotalReconciles],
    ["UNMAPPED_LISTING_CATEGORY_MUST_NOT_BE_SILENTLY_DROPPED",
      "UNMAPPED_CATEGORY_SILENTLY_DROPPED", categories.unmappedSalesVisible],
    ["MARKET_OPPORTUNITY_MUST_NOT_BE_MERGED_WITH_ACCOUNT_SALES",
      "MARKET_AND_ACCOUNT_SALES_MERGED", categories.marketOpportunitySeparate],
    ["INSUFFICIENT_SAMPLE_MUST_NOT_PRODUCE_FALSE_TREND",
      "FALSE_CATEGORY_TREND", !categories.insufficientSampleProducesTrend],
    ["STALE_CATEGORY_DATA_MUST_NOT_BE_PRESENTED_AS_CURRENT",
      "STALE_CATEGORY_PRESENTED_CURRENT", !categories.staleDataPresentedCurrent],
  ] as const) checks.push(check({ invariantCode: code,
    status: passes === null ? "UNKNOWN" : passes ? "PASS" : "VIOLATION",
    failureClass, retrySafety: "ENGINEERING_REQUIRED",
    recoveryClass: "ENGINEERING_REQUIRED", evidence: { passes },
    regressionGuard: { unmappedMustRemainVisible: true,
      accountSalesSeparatedFromMarketOpportunity: true } }))

  const candidates = input.candidateIntegrity
  if (candidates) {
    for (const [code, failureClass, value] of [
      ["READY_WITHOUT_ACTION_PATH_ZERO", "READY_WITHOUT_ACTION_PATH",
        candidates.readyWithoutActionPathCount],
      ["READY_WITH_STALE_PACKAGE_ZERO", "READY_WITH_STALE_PACKAGE",
        candidates.readyWithStalePackageCount],
      ["READY_WITH_CONTRADICTORY_ECONOMICS_ZERO",
        "READY_WITH_CONTRADICTORY_ECONOMICS",
        candidates.readyWithContradictoryEconomicsCount],
      ["SHIPPING_PROVEN_AND_SHIPPING_ZERO_ZERO",
        "CONTRADICTORY_ECONOMICS_PRESENTATION",
        candidates.shippingProvenAndZeroCount],
      ["OWNER_RUNTIME_CONTINUE_REQUIRED_ZERO",
        "OWNER_RUNTIME_CONTINUE_REQUIRED_FOR_NORMAL_PROGRESS",
        candidates.ownerRuntimeContinueRequiredCount],
    ] as const) checks.push(check({
      invariantCode: code,
      status: value === null ? "UNKNOWN" : value === 0 ? "PASS" : "VIOLATION",
      failureClass,
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { violationCount: value },
      regressionGuard: { expectedViolationCount: 0 },
    }))
    const provenance = candidates.candidateCount === null
      || candidates.provenanceClassifiedCount === null ? "UNKNOWN"
      : candidates.candidateCount === candidates.provenanceClassifiedCount
        ? "PASS" : "VIOLATION"
    checks.push(check({
      invariantCode: "EVERY_CANDIDATE_HAS_PROVENANCE_OR_EXPLICIT_UNKNOWN",
      status: provenance,
      failureClass: "CANDIDATE_PROVENANCE_UNCLASSIFIED",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { candidateCount: candidates.candidateCount,
        provenanceClassifiedCount: candidates.provenanceClassifiedCount },
      regressionGuard: { unknownProvenanceMustBeExplicit: true },
    }))
  }

  for (const projection of input.numericProjections ?? []) {
    const violation = projection.authorityAvailable &&
      projection.authoritativeValue === null &&
      projection.presentedValue === 0
    checks.push(check({
      invariantCode: `UNKNOWN_NOT_ZERO:${projection.field}`,
      status: !projection.authorityAvailable ? "UNKNOWN"
        : violation ? "VIOLATION" : "PASS",
      failureClass: "FALSE_ZERO_PRESENTATION",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { field: projection.field,
        authorityAvailable: projection.authorityAvailable,
        authoritativeValue: projection.authoritativeValue,
        presentedValue: projection.presentedValue },
      regressionGuard: { unknownIsNotZero: true,
        missingEvidenceRendersUnavailable: true },
    }))
  }

  for (const worker of input.workers ?? []) {
    const claimsCapability = ["OPERANDO", "SIN_TRABAJO"].includes(
      worker.presentationState)
    const violation = claimsCapability && (!worker.capabilityProven ||
      worker.eligiblePendingJobCount === null)
    checks.push(check({
      invariantCode: `CONNECTED_NOT_WORKER_CAPABLE:${worker.worker}`,
      status: violation ? "VIOLATION" : "PASS",
      failureClass: "WORKER_CAPABILITY_FALSE_POSITIVE",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { worker: worker.worker, connected: worker.connected,
        capabilityProven: worker.capabilityProven,
        eligiblePendingJobCount: worker.eligiblePendingJobCount,
        presentationState: worker.presentationState },
      regressionGuard: { connectedDoesNotEqualWorkerCapable: true,
        noPendingWorkRequiresAuthoritativeZero: true },
    }))
    const freshAuthorityUnknown = worker.authorityAvailable
      && worker.capabilityProven && worker.capabilityFresh
      && worker.presentationState === "DESCONOCIDO"
    checks.push(check({
      invariantCode:
        `FRESH_WORKER_CAPABILITY_PASS_AND_AUTHORITY_AVAILABLE:${worker.worker}`,
      status: freshAuthorityUnknown ? "VIOLATION" : "PASS",
      failureClass: "FRESH_WORKER_CAPABILITY_PRESENTED_UNKNOWN",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { worker: worker.worker,
        authorityAvailable: worker.authorityAvailable,
        capabilityProven: worker.capabilityProven,
        capabilityFresh: worker.capabilityFresh,
        presentationState: worker.presentationState },
      regressionGuard: {
        freshWorkerCapabilityPassMustNotBeUnknown: true,
        expiredOrMissingCapabilityMayRemainUnknown: true,
      },
    }))
    const freshHandshakeUnknown = worker.authorityAvailable
      && worker.capabilityFresh && worker.connected
      && worker.connectionState === "DESCONOCIDA"
    checks.push(check({
      invariantCode: `FRESH_HANDSHAKE_AND_IDENTITY_NOT_UNKNOWN:${worker.worker}`,
      status: freshHandshakeUnknown ? "VIOLATION" : "PASS",
      failureClass: "FRESH_EXTENSION_CONNECTION_PRESENTED_UNKNOWN",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { worker: worker.worker, connected: worker.connected,
        capabilityFresh: worker.capabilityFresh,
        connectionState: worker.connectionState ?? null },
      regressionGuard: { freshHandshakePassMustNotRenderUnknown: true,
        unknownDoesNotEqualDisconnected: true },
    }))
  }

  for (const action of input.actions ?? []) {
    const violation = action.uiReady && !action.actionable &&
      !action.explicitBlocker
    checks.push(check({
      invariantCode: `UI_READY_REQUIRES_ACTION_OR_BLOCKER:${action.capability}`,
      status: violation ? "VIOLATION" : "PASS",
      failureClass: "UI_ACTIONABILITY_DIVERGENCE",
      retrySafety: "SAFE_READ_ONLY_RECONCILIATION",
      recoveryClass: "AUTO_RECOVERABLE",
      evidence: { capability: action.capability, uiReady: action.uiReady,
        actionable: action.actionable,
        explicitBlocker: action.explicitBlocker },
      regressionGuard: { uiReadyDoesNotEqualPublishable: true,
        missingCtaRequiresExplicitClassification: true },
    }))
  }

  if (input.publisher) {
    const publisher = input.publisher
    checks.push(check({
      invariantCode: "INTERNAL_PASS_NOT_PHYSICAL_PASS",
      status: publisher.presentationPhysicalPass && !publisher.physicalPass
        ? "VIOLATION" : "PASS",
      failureClass: "PHYSICAL_ACCEPTANCE_FALSE_POSITIVE",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { internalPass: publisher.internalPass,
        physicalPass: publisher.physicalPass,
        presentationPhysicalPass: publisher.presentationPhysicalPass },
      regressionGuard: { internalPassDoesNotEqualPhysicalPass: true },
    }))
    checks.push(check({
      invariantCode: "UI_READY_NOT_PUBLISHABLE",
      status: publisher.uiReady && !publisher.publishable &&
          !publisher.explicitBlocker ? "VIOLATION" : "PASS",
      failureClass: "PUBLISHABILITY_FALSE_POSITIVE",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { uiReady: publisher.uiReady,
        publishable: publisher.publishable,
        explicitBlocker: publisher.explicitBlocker },
      regressionGuard: { uiReadyDoesNotEqualPublishable: true,
        publisherFailsClosed: true },
    }))
  }

  const authorization = input.publisherAuthorizationIntegrity
  if (authorization) {
    for (const [code, failureClass, value] of [
      ["AUTHORIZED_PACKAGE_MUST_BE_IMMUTABLE",
        "POST_AUTH_PACKAGE_MUTATION",
        authorization.postAuthorizationPackageMutationCount],
      ["POST_AUTH_PACKAGE_MUTATION_ZERO",
        "POST_AUTH_PACKAGE_MUTATION",
        authorization.postAuthorizationPackageMutationCount],
      ["AUTHORIZED_DIGEST_MUST_EQUAL_EXECUTION_DIGEST",
        "AUTHORIZED_EXECUTION_DIGEST_MISMATCH",
        authorization.authorizedDigestMismatchCount],
      ["AUTHORIZED_IMAGES_DIGEST_MUST_EQUAL_EXECUTION_IMAGES_DIGEST",
        "AUTHORIZED_EXECUTION_IMAGES_DIGEST_MISMATCH",
        authorization.authorizedImagesDigestMismatchCount],
      ["READ_ONLY_PREFLIGHT_MUST_NOT_MUTATE_PACKAGE",
        "READ_ONLY_PREFLIGHT_PACKAGE_MUTATION",
        authorization.readOnlyPreflightPackageMutationCount],
      ["TECHNICAL_CONFIRMATION_AFTER_AUTH_MUST_NOT_WRITE_PACKAGE",
        "TECHNICAL_CONFIRMATION_AFTER_AUTH_PACKAGE_WRITE",
        authorization.technicalConfirmationAfterAuthPackageWriteCount],
      ["OLD_AUTHORIZATION_MUST_NEVER_BIND_TO_NEW_DIGEST",
        "STALE_AUTHORIZATION_REBOUND_TO_NEW_DIGEST",
        authorization.oldAuthorizationBoundToNewDigestCount],
    ] as const) checks.push(check({ invariantCode: code,
      status: !authorization.authorityAvailable || value === null
        ? "UNKNOWN" : value === 0 ? "PASS" : "VIOLATION",
      failureClass, retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { authorityAvailable: authorization.authorityAvailable,
        authorizedPackageCount: authorization.authorizedPackageCount,
        violationCount: value },
      regressionGuard: { expectedViolationCount: 0,
        packageMutationAllowedAfterAuthorization: false },
    }))
    checks.push(check({
      invariantCode: "CHILD_MATERIAL_CHANGE_INVALIDATES_ONLY_CHILD_AUTHORIZATION",
      status: !authorization.authorityAvailable ||
          authorization.childMaterialChangeInvalidatesOnlyChild === null
        ? "UNKNOWN"
        : authorization.childMaterialChangeInvalidatesOnlyChild
          ? "PASS" : "VIOLATION",
      failureClass: "BATCH_WIDE_AUTHORIZATION_INVALIDATION",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { authorityAvailable: authorization.authorityAvailable,
        childScopedInvalidation:
          authorization.childMaterialChangeInvalidatesOnlyChild },
      regressionGuard: { invalidateOnlyChangedChild: true,
        unchangedChildrenRemainBoundToExactDigest: true },
    }))
  }

  for (const result of input.marketplaceResults ?? []) {
    const falseSuccess = result.ownerPresentationSuccess &&
      result.officialSuccess !== true
    checks.push(check({
      invariantCode: `HTTP_200_NOT_MARKETPLACE_SUCCESS:${result.operation}`,
      status: falseSuccess ? "VIOLATION" : "PASS",
      failureClass: "MARKETPLACE_SUCCESS_FALSE_POSITIVE",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { operation: result.operation, httpStatus: result.httpStatus,
        ownerPresentationSuccess: result.ownerPresentationSuccess,
        officialSuccess: result.officialSuccess },
      regressionGuard: { http200DoesNotEqualMarketplaceSuccess: true },
    }))
    checks.push(check({
      invariantCode: `DURABLE_RECEIPT_AND_OFFICIAL_READBACK:${result.operation}`,
      status: result.ownerPresentationSuccess &&
          (!result.durableReceipt || !result.officialReadback)
        ? "VIOLATION" : "PASS",
      failureClass: !result.durableReceipt
        ? "DURABLE_RECEIPT_MISSING" : "FINAL_OFFICIAL_READBACK_MISSING",
      retrySafety: "ENGINEERING_REQUIRED",
      recoveryClass: "ENGINEERING_REQUIRED",
      evidence: { operation: result.operation,
        durableReceipt: result.durableReceipt,
        officialReadback: result.officialReadback },
      regressionGuard: { durableReceiptRequired: true,
        officialReadbackRequired: true },
    }))
  }

  checks.push(check({
    invariantCode: "GET_BUSINESS_MUTATIONS_ZERO",
    status: input.getBusinessMutationCount === 0 ? "PASS" : "VIOLATION",
    failureClass: "GET_BUSINESS_MUTATION",
    retrySafety: "ENGINEERING_REQUIRED",
    recoveryClass: "ENGINEERING_REQUIRED",
    evidence: { getBusinessMutationCount: input.getBusinessMutationCount },
    regressionGuard: { getBusinessMutations: 0,
      renderBusinessMutations: 0, refreshBusinessMutations: 0 },
  }))

  const violationCount = checks.filter((entry) =>
    entry.status === "VIOLATION").length
  const unknownCount = checks.filter((entry) =>
    entry.status === "UNKNOWN").length
  const observedAt = input.observedAt &&
      Number.isFinite(Date.parse(input.observedAt))
    ? new Date(input.observedAt).toISOString() : new Date().toISOString()
  return Object.freeze({
    contractVersion: SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION,
    mechanismVersion: SELLER_OS_OPERATIONAL_INTEGRITY_AUDITOR_VERSION,
    recoveryPolicyVersion:
      SELLER_OS_OPERATIONAL_INTEGRITY_RECOVERY_POLICY_VERSION,
    observedAt,
    status: violationCount > 0 ? "VIOLATION" as const
      : unknownCount > 0 ? "UNKNOWN" as const : "PASS" as const,
    checks: Object.freeze(checks),
    summary: Object.freeze({ checkCount: checks.length, violationCount,
      unknownCount, passCount: checks.length - violationCount - unknownCount }),
    safety: Object.freeze({ marketplaceWrites: 0 as const,
      productDecisions: 0 as const, categorySelections: 0 as const,
      manualCandidatePatches: 0 as const }),
  })
}
