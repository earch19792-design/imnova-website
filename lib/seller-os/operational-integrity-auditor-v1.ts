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
    explicitLegitimateBlockerCount: number | null
  }>
  numericProjections?: readonly Readonly<{
    field: string
    authorityAvailable: boolean
    authoritativeValue: number | null
    presentedValue: number | null
  }>[]
  workers?: readonly Readonly<{
    worker: string
    connected: boolean
    capabilityProven: boolean
    eligiblePendingJobCount: number | null
    presentationState: string
  }>[]
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
