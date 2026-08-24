import { createHash } from "node:crypto"

import {
  assertSanitizedLunaBrowserCaptureV1,
  canonicalLunaProductUrlV1,
  LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
  type LunaAuthenticatedCaptureV1,
} from "./ebay-luna-supplier-stock-watcher-v1"
import type { SellerOsLunaSupplierLinkageStatusV1 } from
  "./ebay-luna-supplier-linkage-certification-v1"
import {
  buildSellerOsCorrelationEnvelopeV1,
  buildSellerOsWorkflowStepExecutionV1,
  type SellerOsWorkflowStepStateV1,
} from "./ebay-seller-os-workflow-foundation-v1"
import {
  P2_I02A_STORAGE_READINESS_V1,
  assessSellerOsLunaProtectedSessionV1,
  buildSellerOsLunaAutomationPrerequisitesStatusV1,
} from "./ebay-luna-automation-prerequisites-v1"

export const SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION =
  "SELLER_OS_LUNA_STOCK_OBSERVATION_V1" as const
export const SELLER_OS_LUNA_STOCK_OBSERVATION_STATUS_VERSION =
  "SELLER_OS_LUNA_STOCK_OBSERVATION_STATUS_V1" as const
export const SELLER_OS_LUNA_STOCK_OBSERVATION_RESOURCE_V1 = Object.freeze({
  id: "seller-os://phase-2/luna-stock-observation",
  title: "Seller OS automatic Luna stock observation",
  description: "Read the bounded production activation, scheduler, dependency, observation, retry and safety status for exact certified Luna mappings. Reading this resource never polls Luna or changes eBay.",
})

export const P2_I01_GATE_PASS_REQUIRED_FOR_LIVE_POLLING = true as const
export const P2_I02_PREBUILD_LIVE_ACTIVATION_LOCKED = false as const
export const SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_LINKAGES = 50
export const SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_COMPONENTS = 150

export const SELLER_OS_LUNA_STOCK_OBSERVATION_STATES_V1 = Object.freeze([
  "OBSERVED_IN_STOCK",
  "OBSERVED_OUT_OF_STOCK",
  "OBSERVED_QUANTITY",
  "SOURCE_UNAVAILABLE",
  "OBSERVATION_FAILED",
  "UNKNOWN",
] as const)
export type SellerOsLunaStockObservationStateV1 =
  typeof SELLER_OS_LUNA_STOCK_OBSERVATION_STATES_V1[number]

export const SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1 = Object.freeze([
  "LUNA_SOURCE_UNAVAILABLE",
  "LUNA_AUTH_REQUIRED",
  "LUNA_SESSION_EXPIRED",
  "LUNA_PRODUCT_NOT_FOUND",
  "LUNA_VARIANT_NOT_FOUND",
  "LUNA_PARSE_CONTRACT_CHANGED",
  "LUNA_TIMEOUT",
  "LUNA_RATE_LIMITED",
  "LUNA_NETWORK_ERROR",
  "LINKAGE_NOT_CERTIFIED",
  "P2_I01_GATE_NOT_CERTIFIED",
] as const)
export type SellerOsLunaStockFailureCategoryV1 =
  typeof SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1[number]

export type SellerOsLunaStockAcquisitionMethodV1 =
  | "CANONICAL_SERVER_READ"
  | "CANONICAL_BROWSER_AUTOMATION"

export type SellerOsLunaStockLinkageComponentV1 = Readonly<{
  componentIdentityId: string
  productId: string
  variantId: string | null
  variantSemantics: "EXACT_VARIANT_REQUIRED" | "PRODUCT_HAS_NO_VARIANTS"
  sku: string
  canonicalSourceUrl: string
  supplierQuantityRequired: number
}>

export type SellerOsLunaStockLinkageV1 = Readonly<{
  linkageId: string | null
  status: SellerOsLunaSupplierLinkageStatusV1
  ebayItemId: string
  ebaySku: string | null
  components: readonly SellerOsLunaStockLinkageComponentV1[]
  bundleMode:
    | "NOT_APPLICABLE"
    | "SINGLE_COMPONENT_MULTIPLIER"
    | "MULTI_COMPONENT_BOM"
    | "UNPROVEN"
}>

export type SellerOsLunaStockObservationWindowV1 = Readonly<{
  start: string
  end: string
  intervalSeconds: number
}>

export type SellerOsLunaStockCheckJobV1 = Readonly<{
  contractVersion: typeof SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION
  stockCheckJobId: string
  linkageId: string
  ebayItemId: string
  ebaySku: string | null
  linkageStatus: "CERTIFIED"
  bundleMode: SellerOsLunaStockLinkageV1["bundleMode"]
  observationWindow: SellerOsLunaStockObservationWindowV1
  components: readonly SellerOsLunaStockLinkageComponentV1[]
  acquisitionMethod: SellerOsLunaStockAcquisitionMethodV1
  productionDispatchAllowed: false
}>

export type SellerOsLunaStockJobLeaseV1 = Readonly<{
  stockCheckJobId: string
  leaseId: string
  workerFingerprint: string
  claimedAt: string
  expiresAt: string
  status: "ACTIVE"
}>

export type SellerOsLunaStockSuccessReceiptV1 = Readonly<{
  stockCheckJobId: string
  status: "SUCCEEDED"
  observationPackageDigest: string
  completedAt: string
}>

type JsonRecord = Record<string, unknown>

const CREDENTIAL_KEY = /(?:password|cookie|authorization|credential|secret|(?:access|refresh|bearer|auth).?token|session.?value)/i
const SAFE_ID = /^[A-Za-z0-9_:.\/-]{1,240}$/

function safeText(value: unknown, maximum = 240) {
  if (typeof value !== "string") return null
  const result = value.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, maximum)
  return result || null
}

function safeIso(value: unknown) {
  const text = safeText(value, 50)
  return text && Number.isFinite(Date.parse(text))
    ? new Date(text).toISOString() : null
}

function stableId(prefix: string, parts: readonly unknown[]) {
  return `${prefix}:sha256:${createHash("sha256")
    .update(JSON.stringify(parts)).digest("hex")}`
}

function positiveInteger(value: unknown, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && Number(value) > 0 &&
      Number(value) <= maximum ? Number(value) : null
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value) : null
}

function uniqueCodes(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string =>
    Boolean(value && /^[A-Z0-9_]{3,160}$/.test(value))))].sort().slice(0, 40)
}

function assertNoCallerCredential(value: unknown) {
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (CREDENTIAL_KEY.test(key)) {
      throw new Error("LUNA_STOCK_OBSERVATION_CALLER_CREDENTIAL_REJECTED")
    }
    assertNoCallerCredential(child)
  }
}

function normalizedComponent(value: SellerOsLunaStockLinkageComponentV1) {
  assertNoCallerCredential(value)
  const componentIdentityId = safeText(value.componentIdentityId)
  const productId = safeText(value.productId, 100)
  const variantId = safeText(value.variantId, 100)
  const sku = safeText(value.sku, 120)
  const canonicalSourceUrl = canonicalLunaProductUrlV1(value.canonicalSourceUrl)
  const supplierQuantityRequired = positiveInteger(
    value.supplierQuantityRequired,
  )
  if (!componentIdentityId || !SAFE_ID.test(componentIdentityId) ||
      !productId || !sku || !canonicalSourceUrl ||
      !supplierQuantityRequired ||
      !["EXACT_VARIANT_REQUIRED", "PRODUCT_HAS_NO_VARIANTS"]
        .includes(value.variantSemantics) ||
      (value.variantSemantics === "EXACT_VARIANT_REQUIRED" && !variantId) ||
      (value.variantSemantics === "PRODUCT_HAS_NO_VARIANTS" && variantId)) {
    if (!canonicalSourceUrl) {
      throw new Error("LUNA_STOCK_OBSERVATION_ARBITRARY_URL_REJECTED")
    }
    throw new Error("LUNA_STOCK_OBSERVATION_COMPONENT_IDENTITY_INVALID")
  }
  return Object.freeze({
    componentIdentityId,
    productId,
    variantId,
    variantSemantics: value.variantSemantics,
    sku,
    canonicalSourceUrl,
    supplierQuantityRequired,
  })
}

export function classifyLunaStockObservationEligibilityV1(
  linkage: SellerOsLunaStockLinkageV1,
) {
  assertNoCallerCredential(linkage)
  if (linkage.status !== "CERTIFIED") {
    return Object.freeze({ eligible: false as const,
      failureCategory: "LINKAGE_NOT_CERTIFIED" as const,
      linkageStatus: linkage.status })
  }
  const linkageId = safeText(linkage.linkageId)
  const ebayItemId = safeText(linkage.ebayItemId, 20)
  if (!linkageId || !SAFE_ID.test(linkageId) ||
      !ebayItemId || !/^\d{9,19}$/.test(ebayItemId) ||
      linkage.components.length === 0 ||
      linkage.components.length > SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_COMPONENTS ||
      linkage.bundleMode === "UNPROVEN") {
    return Object.freeze({ eligible: false as const,
      failureCategory: "LINKAGE_NOT_CERTIFIED" as const,
      linkageStatus: linkage.status })
  }
  let components: readonly ReturnType<typeof normalizedComponent>[]
  try {
    components = Object.freeze(linkage.components.map(normalizedComponent))
  } catch (error) {
    if (error instanceof Error &&
        error.message === "LUNA_STOCK_OBSERVATION_ARBITRARY_URL_REJECTED") {
      throw error
    }
    return Object.freeze({ eligible: false as const,
      failureCategory: "LINKAGE_NOT_CERTIFIED" as const,
      linkageStatus: linkage.status })
  }
  const uniqueIdentities = new Set(components.map((component) =>
    component.componentIdentityId))
  if (uniqueIdentities.size !== components.length ||
      (linkage.bundleMode === "MULTI_COMPONENT_BOM" && components.length < 2) ||
      (linkage.bundleMode !== "MULTI_COMPONENT_BOM" && components.length !== 1)) {
    return Object.freeze({ eligible: false as const,
      failureCategory: "LINKAGE_NOT_CERTIFIED" as const,
      linkageStatus: linkage.status })
  }
  return Object.freeze({ eligible: true as const,
    failureCategory: null,
    linkageStatus: "CERTIFIED" as const,
    linkageId,
    ebayItemId,
    components })
}

export function buildLunaStockObservationWindowV1(input: Readonly<{
  now: string
  intervalSeconds?: number
}>) : SellerOsLunaStockObservationWindowV1 {
  const now = safeIso(input.now)
  const intervalSeconds = positiveInteger(input.intervalSeconds ?? 3_600, 86_400)
  if (!now || !intervalSeconds || intervalSeconds < 300) {
    throw new Error("LUNA_STOCK_OBSERVATION_WINDOW_INVALID")
  }
  const intervalMs = intervalSeconds * 1_000
  const startMs = Math.floor(Date.parse(now) / intervalMs) * intervalMs
  return Object.freeze({
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + intervalMs).toISOString(),
    intervalSeconds,
  })
}

export function buildLunaStockCheckJobV1(input: Readonly<{
  linkage: SellerOsLunaStockLinkageV1
  observationWindow: SellerOsLunaStockObservationWindowV1
  acquisitionMethod?: SellerOsLunaStockAcquisitionMethodV1
}>) : SellerOsLunaStockCheckJobV1 {
  const eligibility = classifyLunaStockObservationEligibilityV1(input.linkage)
  if (!eligibility.eligible) throw new Error("LINKAGE_NOT_CERTIFIED")
  const window = buildLunaStockObservationWindowV1({
    now: input.observationWindow.start,
    intervalSeconds: input.observationWindow.intervalSeconds,
  })
  if (window.start !== input.observationWindow.start ||
      window.end !== input.observationWindow.end) {
    throw new Error("LUNA_STOCK_OBSERVATION_WINDOW_INVALID")
  }
  const acquisitionMethod = input.acquisitionMethod ?? "CANONICAL_SERVER_READ"
  const stockCheckJobId = stableId("luna-stock-check-v1", [
    eligibility.linkageId,
    window.start,
    window.end,
    SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
  ])
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
    stockCheckJobId,
    linkageId: eligibility.linkageId,
    ebayItemId: eligibility.ebayItemId,
    ebaySku: safeText(input.linkage.ebaySku, 120),
    linkageStatus: "CERTIFIED" as const,
    bundleMode: input.linkage.bundleMode,
    observationWindow: window,
    components: eligibility.components,
    acquisitionMethod,
    productionDispatchAllowed: false as const,
  })
}

export function getSellerOsLunaStockObservationActivationPolicyV1(input: {
  p2I01GateCertified?: boolean
  schedulerRequested?: boolean
  intervalSeconds?: number
  maximumAttempts?: number
  maximumConcurrency?: number
  leaseSeconds?: number
} = {}) {
  const p2I01GateCertified = input.p2I01GateCertified === true
  const productionSchedulerEnabled = p2I01GateCertified &&
    input.schedulerRequested === true
  const intervalSeconds = Math.max(300, Math.min(86_400,
    positiveInteger(input.intervalSeconds ?? 3_600, 86_400) ?? 3_600))
  const maximumAttempts = Math.max(1, Math.min(5,
    positiveInteger(input.maximumAttempts ?? 3, 5) ?? 3))
  const maximumConcurrency = Math.max(1, Math.min(4,
    positiveInteger(input.maximumConcurrency ?? 4, 4) ?? 4))
  const leaseSeconds = Math.max(60, Math.min(600,
    positiveInteger(input.leaseSeconds ?? 180, 600) ?? 180))
  return Object.freeze({
    activationStatus: productionSchedulerEnabled
      ? "ACTIVATED" as const
      : p2I01GateCertified ? "PREBUILD_NOT_ACTIVATED" as const
      : "BLOCKED_BY_P2_I01_GATE" as const,
    p2I01GatePassRequiredForLivePolling:
      P2_I01_GATE_PASS_REQUIRED_FOR_LIVE_POLLING,
    p2I01GateCertified,
    schedulerRequested: input.schedulerRequested === true,
    productionSchedulerEnabled,
    prebuildLiveActivationLocked: P2_I02_PREBUILD_LIVE_ACTIVATION_LOCKED,
    policy: Object.freeze({
      intervalSeconds,
      intervalFinal: false as const,
      dynamicFrequencyReady: true as const,
      maximumAttempts,
      baseBackoffSeconds: 30 as const,
      maximumBackoffSeconds: 900 as const,
      maximumConcurrency,
      leaseSeconds,
      oneEffectiveActiveWorkerPerLogicalWindow: true as const,
    }),
  })
}

export function buildLunaStockObservationSchedulerPlanV1(input: Readonly<{
  linkages: readonly SellerOsLunaStockLinkageV1[]
  now: string
  p2I01GateCertified: boolean
  intervalSeconds?: number
}>) {
  const activation = getSellerOsLunaStockObservationActivationPolicyV1({
    p2I01GateCertified: input.p2I01GateCertified,
    intervalSeconds: input.intervalSeconds,
  })
  const window = buildLunaStockObservationWindowV1({
    now: input.now,
    intervalSeconds: activation.policy.intervalSeconds,
  })
  const bounded = input.linkages.slice(
    0, SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_LINKAGES)
  const jobs: SellerOsLunaStockCheckJobV1[] = []
  const ineligible: Array<Readonly<{
    ebayItemId: string | null
    linkageStatus: SellerOsLunaSupplierLinkageStatusV1
    failureCategory: "LINKAGE_NOT_CERTIFIED"
  }>> = []
  for (const linkage of bounded) {
    const eligibility = classifyLunaStockObservationEligibilityV1(linkage)
    if (!eligibility.eligible) {
      ineligible.push(Object.freeze({
        ebayItemId: /^\d{9,19}$/.test(linkage.ebayItemId)
          ? linkage.ebayItemId : null,
        linkageStatus: linkage.status,
        failureCategory: "LINKAGE_NOT_CERTIFIED",
      }))
      continue
    }
    jobs.push(buildLunaStockCheckJobV1({ linkage,
      observationWindow: window }))
  }
  return Object.freeze({
    schedulerVersion: "SELLER_OS_LUNA_STOCK_SCHEDULER_PREBUILD_V1" as const,
    activationStatus: activation.activationStatus,
    schedulerStatus: "DISABLED" as const,
    productionSchedulerEnabled: false as const,
    preparedJobCount: jobs.length,
    dispatchableJobCount: 0 as const,
    eligibleCertifiedLinkageCount: jobs.length,
    ineligibleLinkageCount: ineligible.length,
    preparedJobs: Object.freeze(jobs),
    dispatchableJobs: Object.freeze([] as SellerOsLunaStockCheckJobV1[]),
    ineligible: Object.freeze(ineligible),
    observationWindow: window,
    controls: activation.policy,
    truncated: input.linkages.length > bounded.length,
    limitations: Object.freeze(uniqueCodes([
      ...(!input.p2I01GateCertified
        ? ["P2_I01_GATE_NOT_CERTIFIED"] : []),
      "P2_I02_PREBUILD_PRODUCTION_SCHEDULER_DISABLED",
    ])),
  })
}

export function claimLunaStockCheckJobV1(input: Readonly<{
  job: SellerOsLunaStockCheckJobV1
  workerId: string
  now: string
  leaseSeconds?: number
  existingLease?: SellerOsLunaStockJobLeaseV1 | null
  successReceipt?: SellerOsLunaStockSuccessReceiptV1 | null
}>) {
  const workerId = safeText(input.workerId, 120)
  const now = safeIso(input.now)
  const leaseSeconds = Math.max(60, Math.min(600,
    positiveInteger(input.leaseSeconds ?? 180, 600) ?? 180))
  if (!workerId || !now || input.job.productionDispatchAllowed !== false) {
    throw new Error("LUNA_STOCK_JOB_CLAIM_INVALID")
  }
  const correlation = buildSellerOsCorrelationEnvelopeV1({
    businessFactId: input.job.linkageId,
    eventId: input.job.stockCheckJobId,
    stepType: "CHECK_LUNA_STOCK",
    stepVersion: SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
  })
  if (input.successReceipt?.status === "SUCCEEDED" &&
      input.successReceipt.stockCheckJobId === input.job.stockCheckJobId) {
    return Object.freeze({
      claimStatus: "ALREADY_SUCCEEDED" as const,
      lease: null,
      workflow: buildSellerOsWorkflowStepExecutionV1({
        stepExecutionId: correlation.stepExecutionId,
        stepType: "CHECK_LUNA_STOCK",
        state: "SUCCEEDED",
        observedAt: input.successReceipt.completedAt,
        sideEffectClass: "OBSERVABILITY_READ",
        sideEffectReceiptId: input.successReceipt.observationPackageDigest,
        persistenceStatus: "DURABLE_SUCCESS_RECEIPT",
      }),
    })
  }
  const existingExpires = Date.parse(input.existingLease?.expiresAt ?? "")
  if (input.existingLease?.stockCheckJobId === input.job.stockCheckJobId &&
      Number.isFinite(existingExpires) && existingExpires > Date.parse(now)) {
    return Object.freeze({
      claimStatus: "ALREADY_CLAIMED" as const,
      lease: input.existingLease,
      workflow: buildSellerOsWorkflowStepExecutionV1({
        stepExecutionId: correlation.stepExecutionId,
        stepType: "CHECK_LUNA_STOCK",
        state: "BLOCKED",
        observedAt: now,
        sideEffectClass: "OBSERVABILITY_READ",
        lease: { status: "ACTIVE_OTHER_WORKER",
          expiresAt: input.existingLease.expiresAt },
      }),
    })
  }
  const workerFingerprint = stableId("worker", [workerId]).slice(0, 32 + 14)
  const expiresAt = new Date(Date.parse(now) + leaseSeconds * 1_000).toISOString()
  const lease = Object.freeze({
    stockCheckJobId: input.job.stockCheckJobId,
    leaseId: stableId("luna-stock-lease-v1", [
      input.job.stockCheckJobId, workerFingerprint, now,
    ]),
    workerFingerprint,
    claimedAt: now,
    expiresAt,
    status: "ACTIVE" as const,
  })
  return Object.freeze({
    claimStatus: "CLAIMED" as const,
    lease,
    workflow: buildSellerOsWorkflowStepExecutionV1({
      stepExecutionId: correlation.stepExecutionId,
      stepType: "CHECK_LUNA_STOCK",
      state: "IN_PROGRESS",
      observedAt: now,
      sideEffectClass: "OBSERVABILITY_READ",
      lease: { status: "ACTIVE", expiresAt },
    }),
  })
}

function captureFailureCategory(capture: LunaAuthenticatedCaptureV1,
  component: SellerOsLunaStockLinkageComponentV1):
SellerOsLunaStockFailureCategoryV1 | null {
  if (capture.sessionState === "REAUTH_REQUIRED") return "LUNA_SESSION_EXPIRED"
  if (["MFA_REQUIRED", "CAPTCHA_BLOCKED", "AUTHORIZATION_DENIED"]
    .includes(capture.sessionState)) return "LUNA_AUTH_REQUIRED"
  if (capture.sessionState === "SOURCE_CHANGED") {
    return "LUNA_PARSE_CONTRACT_CHANGED"
  }
  if (capture.sessionState === "SOURCE_UNAVAILABLE") {
    const limitation = capture.limitationCode ?? ""
    if (/429|RATE_LIMIT/i.test(limitation)) return "LUNA_RATE_LIMITED"
    if (/TIMEOUT|408/i.test(limitation)) return "LUNA_TIMEOUT"
    if (/NETWORK/i.test(limitation)) return "LUNA_NETWORK_ERROR"
    return "LUNA_SOURCE_UNAVAILABLE"
  }
  if (capture.sessionState === "VARIANT_UNPROVEN") {
    return "LUNA_VARIANT_NOT_FOUND"
  }
  if (capture.sessionState !== "SESSION_OK") return "LUNA_SOURCE_UNAVAILABLE"
  if (!capture.productId || capture.productId !== component.productId) {
    return "LUNA_PRODUCT_NOT_FOUND"
  }
  if (component.variantSemantics === "EXACT_VARIANT_REQUIRED" &&
      (!capture.variantId || capture.variantId !== component.variantId)) {
    return "LUNA_VARIANT_NOT_FOUND"
  }
  if (capture.supplierSku !== component.sku) return "LUNA_VARIANT_NOT_FOUND"
  return null
}

export function classifyLunaStockObservationFailureV1(error: unknown):
SellerOsLunaStockFailureCategoryV1 {
  const code = error instanceof Error ? error.message
    : typeof error === "string" ? error : ""
  if ((SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1 as readonly string[])
    .includes(code)) return code as SellerOsLunaStockFailureCategoryV1
  if (/TIMEOUT|ABORT/i.test(code)) return "LUNA_TIMEOUT"
  if (/429|RATE_LIMIT/i.test(code)) return "LUNA_RATE_LIMITED"
  if (/NETWORK|FETCH_FAILED|ECONN|ENOTFOUND/i.test(code)) {
    return "LUNA_NETWORK_ERROR"
  }
  if (/AUTH|MFA|CAPTCHA/i.test(code)) return "LUNA_AUTH_REQUIRED"
  if (/SESSION|REAUTH/i.test(code)) return "LUNA_SESSION_EXPIRED"
  if (/PRODUCT.*(?:404|NOT_FOUND|MISSING)/i.test(code)) {
    return "LUNA_PRODUCT_NOT_FOUND"
  }
  if (/VARIANT.*(?:404|NOT_FOUND|MISSING|MISMATCH)/i.test(code)) {
    return "LUNA_VARIANT_NOT_FOUND"
  }
  if (/PARSE|CONTRACT|MARKUP|SOURCE_CHANGED/i.test(code)) {
    return "LUNA_PARSE_CONTRACT_CHANGED"
  }
  return "LUNA_SOURCE_UNAVAILABLE"
}

function retryableFailure(category: SellerOsLunaStockFailureCategoryV1) {
  return ["LUNA_SOURCE_UNAVAILABLE", "LUNA_TIMEOUT", "LUNA_RATE_LIMITED",
    "LUNA_NETWORK_ERROR"].includes(category)
}

export function buildLunaStockRetryDecisionV1(input: Readonly<{
  failureCategory: SellerOsLunaStockFailureCategoryV1 | null
  attemptNumber: number
  observedAt: string
  maximumAttempts?: number
  baseBackoffSeconds?: number
  maximumBackoffSeconds?: number
}>) {
  const observedAt = safeIso(input.observedAt)
  const attemptNumber = positiveInteger(input.attemptNumber, 100)
  const maximumAttempts = Math.max(1, Math.min(5,
    positiveInteger(input.maximumAttempts ?? 3, 5) ?? 3))
  const baseBackoffSeconds = Math.max(1, Math.min(300,
    positiveInteger(input.baseBackoffSeconds ?? 30, 300) ?? 30))
  const maximumBackoffSeconds = Math.max(baseBackoffSeconds, Math.min(3_600,
    positiveInteger(input.maximumBackoffSeconds ?? 900, 3_600) ?? 900))
  if (!observedAt || !attemptNumber) {
    throw new Error("LUNA_STOCK_RETRY_INPUT_INVALID")
  }
  if (!input.failureCategory) return Object.freeze({
    state: "SUCCEEDED" as SellerOsWorkflowStepStateV1,
    retryAllowed: false,
    nextAttemptAt: null,
    backoffSeconds: null,
    attemptNumber,
    maximumAttempts,
  })
  if (["LINKAGE_NOT_CERTIFIED", "P2_I01_GATE_NOT_CERTIFIED",
    "LUNA_AUTH_REQUIRED", "LUNA_SESSION_EXPIRED"]
    .includes(input.failureCategory)) return Object.freeze({
      state: "BLOCKED" as SellerOsWorkflowStepStateV1,
      retryAllowed: false,
      nextAttemptAt: null,
      backoffSeconds: null,
      attemptNumber,
      maximumAttempts,
    })
  const retryAllowed = retryableFailure(input.failureCategory) &&
    attemptNumber < maximumAttempts
  const backoffSeconds = retryAllowed
    ? Math.min(maximumBackoffSeconds,
        baseBackoffSeconds * (2 ** (attemptNumber - 1))) : null
  return Object.freeze({
    state: retryAllowed
      ? "RETRYABLE_FAILURE" as SellerOsWorkflowStepStateV1
      : "TERMINAL_FAILURE" as SellerOsWorkflowStepStateV1,
    retryAllowed,
    nextAttemptAt: retryAllowed && backoffSeconds !== null
      ? new Date(Date.parse(observedAt) + backoffSeconds * 1_000).toISOString()
      : null,
    backoffSeconds,
    attemptNumber,
    maximumAttempts,
  })
}

function observationState(input: {
  capture: LunaAuthenticatedCaptureV1 | null
  failureCategory: SellerOsLunaStockFailureCategoryV1 | null
}) : SellerOsLunaStockObservationStateV1 {
  if (input.failureCategory) {
    return retryableFailure(input.failureCategory) ||
      ["LUNA_AUTH_REQUIRED", "LUNA_SESSION_EXPIRED"]
        .includes(input.failureCategory)
      ? "SOURCE_UNAVAILABLE" : "OBSERVATION_FAILED"
  }
  if (!input.capture) return "UNKNOWN"
  const quantity = input.capture.quantityExplicit
    ? nonNegativeInteger(input.capture.quantity) : null
  if (input.capture.availability === false) return "OBSERVED_OUT_OF_STOCK"
  if (quantity !== null) return "OBSERVED_QUANTITY"
  if (input.capture.availability === true) return "OBSERVED_IN_STOCK"
  return "UNKNOWN"
}

export function buildSellerOsLunaStockObservationV1(input: Readonly<{
  job: SellerOsLunaStockCheckJobV1
  componentIdentityId: string
  attemptNumber: number
  observedAt: string
  capture?: LunaAuthenticatedCaptureV1 | null
  failure?: unknown
  maximumAgeSeconds?: number
}>) {
  const component = input.job.components.find((candidate) =>
    candidate.componentIdentityId === input.componentIdentityId)
  const attemptNumber = positiveInteger(input.attemptNumber, 100)
  const attemptObservedAt = safeIso(input.observedAt)
  const maximumAgeSeconds = Math.max(60, Math.min(604_800,
    positiveInteger(input.maximumAgeSeconds ?? 21_600, 604_800) ?? 21_600))
  if (!component || !attemptNumber || !attemptObservedAt ||
      input.job.linkageStatus !== "CERTIFIED") {
    throw new Error("LINKAGE_NOT_CERTIFIED")
  }
  let capture = input.capture ?? null
  let failureCategory: SellerOsLunaStockFailureCategoryV1 | null = input.failure
    ? classifyLunaStockObservationFailureV1(input.failure) : null
  if (capture) {
    try {
      assertSanitizedLunaBrowserCaptureV1(capture)
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      if (/CREDENTIAL|RAW_PAGE_FIELD|PAYLOAD_TOO_LARGE/.test(code)) {
        throw new Error("LUNA_STOCK_OBSERVATION_UNSAFE_CAPTURE_REJECTED")
      }
      failureCategory = "LUNA_PARSE_CONTRACT_CHANGED"
      capture = null
    }
  }
  if (!failureCategory && capture) {
    failureCategory = captureFailureCategory(capture, component)
  }
  if (!capture && !failureCategory) failureCategory = "LUNA_SOURCE_UNAVAILABLE"
  const state = observationState({ capture, failureCategory })
  const evidenceObservedAt = !failureCategory && capture
    ? safeIso(capture.observedAt) : null
  const ageSeconds = evidenceObservedAt
    ? Math.max(0, Math.floor((Date.parse(attemptObservedAt) -
        Date.parse(evidenceObservedAt)) / 1_000)) : null
  const quantity = !failureCategory && capture?.quantityExplicit
    ? nonNegativeInteger(capture.quantity) : null
  const observedAvailability = !failureCategory && capture
    ? capture.availability : null
  const retry = buildLunaStockRetryDecisionV1({
    failureCategory,
    attemptNumber,
    observedAt: attemptObservedAt,
  })
  const observationId = stableId("luna-stock-observation-v1", [
    input.job.stockCheckJobId,
    component.componentIdentityId,
    attemptNumber,
    SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
  ])
  const attemptId = stableId("luna-stock-attempt-v1", [
    input.job.stockCheckJobId,
    component.componentIdentityId,
    attemptNumber,
  ])
  const evidenceDigest = stableId("luna-stock-evidence-v1", [
    observationId,
    capture?.sourceEvidenceFingerprint ?? null,
    state,
    observedAvailability,
    quantity,
    failureCategory,
  ])
  const correlation = buildSellerOsCorrelationEnvelopeV1({
    businessFactId: input.job.linkageId,
    eventId: input.job.stockCheckJobId,
    stepType: "CHECK_LUNA_STOCK",
    stepVersion: SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
  })
  const workflow = buildSellerOsWorkflowStepExecutionV1({
    stepExecutionId: correlation.stepExecutionId,
    stepType: "CHECK_LUNA_STOCK",
    state: retry.state,
    observedAt: attemptObservedAt,
    sideEffectClass: "OBSERVABILITY_READ",
    attemptCount: attemptNumber,
    sideEffectReceiptId: retry.state === "SUCCEEDED" ? evidenceDigest : null,
    persistenceStatus: "PREBUILD_NOT_PERSISTED",
  })
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_STOCK_OBSERVATION_VERSION,
    observationId,
    stockCheckJobId: input.job.stockCheckJobId,
    linkageId: input.job.linkageId,
    canonicalEbayItemId: input.job.ebayItemId,
    ebaySku: input.job.ebaySku,
    lunaProductIdentity: component.productId,
    lunaVariantIdentity: component.variantId,
    lunaSku: component.sku,
    componentIdentityId: component.componentIdentityId,
    supplierQuantityRequired: component.supplierQuantityRequired,
    observedAt: evidenceObservedAt ?? attemptObservedAt,
    source: "LUNA_PORTEX" as const,
    sourceStatus: failureCategory
      ? ["LUNA_AUTH_REQUIRED", "LUNA_SESSION_EXPIRED"]
          .includes(failureCategory)
        ? "AUTH_REQUIRED" as const
        : retryableFailure(failureCategory)
          ? "UNAVAILABLE" as const : "FAILED" as const
      : "AVAILABLE" as const,
    observationState: state,
    observedAvailability,
    observedSupplierQuantity: quantity,
    evidenceClass: failureCategory ? "UNAVAILABLE" as const
      : "SUPPLIER_STATED" as const,
    evidenceReference: failureCategory ? null
      : `luna-sanitized-capture:${evidenceDigest.split(":").at(-1)}`,
    evidenceDigest,
    acquisitionMethod: input.job.acquisitionMethod,
    attemptCorrelation: Object.freeze({
      attemptId,
      attemptNumber,
      correlationId: correlation.correlationId,
      stepExecutionId: correlation.stepExecutionId,
      workflowState: workflow.state,
      retryAllowed: retry.retryAllowed,
      nextAttemptAt: retry.nextAttemptAt,
    }),
    freshnessInput: Object.freeze({
      observedAt: evidenceObservedAt,
      evaluatedAt: attemptObservedAt,
      ageSeconds,
      maximumAgeSeconds,
      finalFreshnessDecisionOwner: "P2_I03" as const,
    }),
    failureCategory,
    limitations: Object.freeze(uniqueCodes([
      failureCategory,
      ...(state === "UNKNOWN" ? ["NO_EVIDENCE_DOES_NOT_PROVE_ZERO"] : []),
      ...(state === "OBSERVED_OUT_OF_STOCK"
        ? ["OBSERVED_OUT_OF_STOCK_IS_NOT_CERTIFIED_OOS"] : []),
      "LUNA_PORTEX_STOCK_IS_SUPPLIER_STATED_EVIDENCE",
      "P2_I03_OWNS_FINAL_FRESHNESS_AND_CAPACITY",
      "P2_I04_OWNS_CERTIFIED_OOS",
    ])),
    downstreamDecision: Object.freeze({
      certifiedOos: false as const,
      safeSalesCapacity: null,
      automaticPauseAllowed: false as const,
      owner: "P2_I04" as const,
    }),
    workflow,
    safety: Object.freeze({
      readOnlyObservation: true as const,
      buyerPiiIncluded: false as const,
      credentialsIncluded: false as const,
      cookiesIncluded: false as const,
      rawSessionMaterialIncluded: false as const,
      rawSupplierPayloadIncluded: false as const,
      environmentValuesIncluded: false as const,
      arbitraryUrlAllowed: false as const,
      arbitraryCredentialAllowed: false as const,
      marketplaceWrites: 0 as const,
      ebayPauseWrites: 0 as const,
      ebayReviseWrites: 0 as const,
      inventoryWrites: 0 as const,
      lunaMutations: 0 as const,
      productCaseMutations: 0 as const,
      whatsappSends: 0 as const,
      buyerMessageSends: 0 as const,
      paymentTransactions: 0 as const,
    }),
  })
}

export type SellerOsLunaStockObservationV1 = ReturnType<
  typeof buildSellerOsLunaStockObservationV1
>

export function deriveLunaStockObservationAgeInputV1(input: Readonly<{
  observation: SellerOsLunaStockObservationV1
  asOf: string
}>) {
  const asOf = safeIso(input.asOf)
  const observedAt = input.observation.freshnessInput.observedAt
  if (!asOf || !observedAt) return Object.freeze({
    ageSeconds: null,
    maximumAgeSeconds: input.observation.freshnessInput.maximumAgeSeconds,
    ageExceedsMaximum: null,
    observationState: input.observation.observationState,
    outOfStockInferredFromAge: false as const,
    finalFreshnessDecisionOwner: "P2_I03" as const,
  })
  const ageSeconds = Math.max(0, Math.floor(
    (Date.parse(asOf) - Date.parse(observedAt)) / 1_000,
  ))
  return Object.freeze({
    ageSeconds,
    maximumAgeSeconds: input.observation.freshnessInput.maximumAgeSeconds,
    ageExceedsMaximum:
      ageSeconds > input.observation.freshnessInput.maximumAgeSeconds,
    observationState: input.observation.observationState,
    outOfStockInferredFromAge: false as const,
    finalFreshnessDecisionOwner: "P2_I03" as const,
  })
}

export function buildLunaStockObservationPackageV1(input: Readonly<{
  job: SellerOsLunaStockCheckJobV1
  observations: readonly SellerOsLunaStockObservationV1[]
}>) {
  const byIdentity = new Map<string, SellerOsLunaStockObservationV1>()
  for (const observation of input.observations) {
    if (observation.stockCheckJobId !== input.job.stockCheckJobId ||
        !input.job.components.some((component) =>
          component.componentIdentityId === observation.componentIdentityId)) {
      throw new Error("LUNA_STOCK_OBSERVATION_PACKAGE_IDENTITY_MISMATCH")
    }
    const previous = byIdentity.get(observation.observationId)
    if (previous && (previous.evidenceDigest !== observation.evidenceDigest ||
        previous.observationState !== observation.observationState)) {
      throw new Error("LUNA_STOCK_OBSERVATION_REPLAY_CONFLICT")
    }
    byIdentity.set(observation.observationId, observation)
  }
  const deduplicated = [...byIdentity.values()]
  const latestByComponent = input.job.components.flatMap((component) => {
    const matches = deduplicated.filter((observation) =>
      observation.componentIdentityId === component.componentIdentityId)
      .sort((left, right) =>
        right.attemptCorrelation.attemptNumber -
          left.attemptCorrelation.attemptNumber ||
        right.observationId.localeCompare(left.observationId))
    return matches.length ? [matches[0]] : []
  })
  const succeededCount = latestByComponent.filter((observation) =>
    observation.attemptCorrelation.workflowState === "SUCCEEDED").length
  const failedCount = latestByComponent.length - succeededCount
  const missingCount = input.job.components.length - latestByComponent.length
  const packageDigest = stableId("luna-stock-package-v1", [
    input.job.stockCheckJobId,
    latestByComponent.map((observation) => observation.evidenceDigest).sort(),
  ])
  return Object.freeze({
    contractVersion: "SELLER_OS_LUNA_STOCK_OBSERVATION_PACKAGE_V1" as const,
    stockCheckJobId: input.job.stockCheckJobId,
    linkageId: input.job.linkageId,
    canonicalEbayItemId: input.job.ebayItemId,
    bundleMode: input.job.bundleMode,
    componentCount: input.job.components.length,
    succeededComponentCount: succeededCount,
    failedComponentCount: failedCount,
    missingComponentCount: missingCount,
    status: succeededCount === input.job.components.length
      ? "COMPLETE" as const
      : succeededCount > 0 ? "PARTIAL" as const : "FAILED" as const,
    latestComponentObservations: Object.freeze(latestByComponent),
    duplicateReplayCount: Math.max(0,
      input.observations.length - deduplicated.length),
    packageDigest,
    bundleOutOfStockDecision: null,
    certifiedOos: false as const,
    safeSalesCapacity: null,
    decisionOwners: Object.freeze({
      freshnessAndCapacity: "P2_I03" as const,
      certifiedOosAndMarketplaceAction: "P2_I04" as const,
    }),
  })
}

export const P2_I02_SCHEMA_DELTA_REQUIRED = Object.freeze({
  required: false as const,
  migrationCreated: true as const,
  migrationApplied: true as const,
  schemaArtifactStatus: P2_I02A_STORAGE_READINESS_V1.schemaArtifactStatus,
  schemaAppliedStatus: P2_I02A_STORAGE_READINESS_V1.schemaAppliedStatus,
  storageReadiness: P2_I02A_STORAGE_READINESS_V1.storageReadiness,
  migrationArtifact: P2_I02A_STORAGE_READINESS_V1.migrationArtifact,
  dataGateStatus: P2_I02A_STORAGE_READINESS_V1.dataGateStatus,
  databaseMutationAuthorized:
    P2_I02A_STORAGE_READINESS_V1.databaseMutationAuthorized,
  reason: "EXISTING_MARKET_RADAR_SNAPSHOTS_LACK_ATOMIC_LOGICAL_OBSERVATION_AND_PER_WINDOW_LEASE_UNIQUENESS" as const,
  proposedTables: Object.freeze([
    Object.freeze({
      name: "seller_os_luna_stock_check_jobs",
      primaryKey: "stock_check_job_id",
      uniqueGrain: "linkage_id+observation_window_start+contract_version",
      requiredFields: Object.freeze(["stock_check_job_id", "linkage_id",
        "account_key", "ebay_item_id", "observation_window_start",
        "observation_window_end", "workflow_state", "attempt_count",
        "due_at", "lease_owner", "lease_expires_at", "success_receipt_digest"]),
    }),
    Object.freeze({
      name: "seller_os_luna_stock_observations",
      primaryKey: "observation_id",
      uniqueGrain: "stock_check_job_id+component_identity_id+attempt_number",
      requiredFields: Object.freeze(["observation_id", "stock_check_job_id",
        "linkage_id", "account_key", "ebay_item_id",
        "component_identity_id", "luna_product_id", "luna_variant_id",
        "luna_sku", "supplier_quantity_required", "observation_state",
        "source_status", "observed_availability",
        "observed_supplier_quantity", "evidence_class", "evidence_digest",
        "acquisition_method", "attempt_number", "observed_at",
        "maximum_age_seconds", "limitations"]),
    }),
  ]),
  security: Object.freeze({
    rlsRequired: true as const,
    serviceRoleOnly: true as const,
    anonAccess: false as const,
    authenticatedAccess: false as const,
    credentialsOrCookiesAllowed: false as const,
    rawHtmlAllowed: false as const,
    buyerPiiAllowed: false as const,
  }),
})

export function getLunaStockAcquisitionCapabilityV1(input: Readonly<{
  protectedSessionConfigured: boolean
  protectedSessionServerOnly: boolean
}>) {
  const ready = input.protectedSessionConfigured &&
    input.protectedSessionServerOnly
  return Object.freeze({
    classification: ready
      ? "CANONICAL_SERVER_READ" as const
      : "MANUAL_CAPTURE_ONLY" as const,
    supportedApiAssumed: false as const,
    authenticatedServerHttpImplemented: true as const,
    authenticatedServerHttpConfigurationStatus: ready
      ? "READY_FOR_GATED_ACTIVATION" as const
      : "PROTECTED_SESSION_REQUIRED" as const,
    canonicalBrowserAutomationContractImplemented: true as const,
    canonicalBrowserAutomationActivated: false as const,
    protectedSessionOwnership: "SERVER_OWNED" as const,
    protectedSessionStorage: "SUPABASE_VAULT" as const,
    humanBootstrapRequired: !ready,
    arbitraryWebsiteAllowed: false as const,
    arbitraryNavigationAllowed: false as const,
    callerProvidedUrlAllowed: false as const,
    callerProvidedCredentialAllowed: false as const,
    fixedHosts: Object.freeze(["lunaportex.com", "www.lunaportex.com"]),
    sourceContractVersion: LUNA_SUPPLIER_STOCK_WATCHER_VERSION,
  })
}

const STATUS_SAFETY = Object.freeze({
  readOnlySurface: true as const,
  productionLunaPolling: 0 as const,
  lunaMutations: 0 as const,
  marketplaceWrites: 0 as const,
  ebayPauseWrites: 0 as const,
  ebayReviseWrites: 0 as const,
  inventoryWrites: 0 as const,
  productCaseMutations: 0 as const,
  whatsappSends: 0 as const,
  buyerMessageSends: 0 as const,
  paymentTransactions: 0 as const,
  buyerPiiIncluded: false as const,
  lunaCredentialsIncluded: false as const,
  cookiesIncluded: false as const,
  environmentValuesIncluded: false as const,
  arbitraryUrlAllowed: false as const,
  arbitraryCredentialAllowed: false as const,
  certifiedOosProduced: false as const,
})

export function buildSellerOsLunaStockObservationStatusV1(input: Readonly<{
  observedAt: string
  p2I01DependencyStatus: "BLOCKED" | "CERTIFIED"
  p2I01Limitations?: readonly string[]
  acquisition: ReturnType<typeof getLunaStockAcquisitionCapabilityV1>
  plan?: ReturnType<typeof buildLunaStockObservationSchedulerPlanV1> | null
  observations?: readonly SellerOsLunaStockObservationV1[]
  prerequisites?: ReturnType<
    typeof buildSellerOsLunaAutomationPrerequisitesStatusV1
  >
  productionSchedulerEnabled?: boolean
}>) {
  const observedAt = safeIso(input.observedAt) ?? new Date(0).toISOString()
  const observations = [...(input.observations ?? [])]
    .slice(0, SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_COMPONENTS)
  const plan = input.plan ?? null
  const failureCounts = Object.fromEntries(
    SELLER_OS_LUNA_STOCK_FAILURE_CATEGORIES_V1.map((category) => [
      category,
      observations.filter((observation) =>
        observation.failureCategory === category).length,
    ]),
  ) as Record<SellerOsLunaStockFailureCategoryV1, number>
  const latestByLinkage = [...new Map([...observations]
    .sort((left, right) => Date.parse(left.observedAt) -
      Date.parse(right.observedAt))
    .map((observation) => [observation.linkageId, observation])).values()]
  const dependencyCertified = input.p2I01DependencyStatus === "CERTIFIED"
  const productionSchedulerEnabled = dependencyCertified &&
    input.productionSchedulerEnabled === true
  const prerequisites = input.prerequisites ??
    buildSellerOsLunaAutomationPrerequisitesStatusV1({
      session: assessSellerOsLunaProtectedSessionV1({
        now: observedAt,
        secretPresent: false,
        storage: "NONE",
        serverOwned: true,
        clientExposed: false,
        validation: "AUTH_REQUIRED",
      }),
    })
  return Object.freeze({
    contractVersion: SELLER_OS_LUNA_STOCK_OBSERVATION_STATUS_VERSION,
    status: productionSchedulerEnabled ? "ACTIVE" as const
      : dependencyCertified ? "PREBUILD_READY" as const
      : "BLOCKED" as const,
    observedAt,
    bounded: true as const,
    maximumEntries: SELLER_OS_LUNA_STOCK_OBSERVATION_MAXIMUM_COMPONENTS,
    truncated: (input.observations?.length ?? 0) > observations.length ||
      Boolean(plan?.truncated),
    activationStatus: productionSchedulerEnabled
      ? "ACTIVATED" as const
      : dependencyCertified
      ? "PREBUILD_NOT_ACTIVATED" as const
      : "BLOCKED_BY_P2_I01_GATE" as const,
    p2I01Dependency: Object.freeze({
      status: input.p2I01DependencyStatus,
      gatePassRequiredForLivePolling: true as const,
      limitations: Object.freeze(uniqueCodes([
        ...(input.p2I01Limitations ?? []),
        ...(!dependencyCertified ? ["P2_I01_GATE_NOT_CERTIFIED"] : []),
      ])),
    }),
    storageReadiness: prerequisites.storageReadiness,
    schemaArtifactStatus: prerequisites.schemaArtifactStatus,
    schemaAppliedStatus: prerequisites.schemaAppliedStatus,
    lunaProtectedSessionStatus: prerequisites.lunaProtectedSessionStatus,
    canonicalServerReadReadiness:
      prerequisites.canonicalServerReadReadiness,
    humanBootstrapRequired: prerequisites.humanBootstrapRequired,
    humanBootstrapPath: prerequisites.humanBootstrapPath,
    acquisition: input.acquisition,
    scheduler: Object.freeze({
      status: productionSchedulerEnabled ? "ENABLED" as const : "DISABLED" as const,
      productionSchedulerEnabled,
      preparedJobCount: plan?.preparedJobCount ?? null,
      dispatchableJobCount: 0 as const,
      policy: plan?.controls ??
        getSellerOsLunaStockObservationActivationPolicyV1({
          p2I01GateCertified: dependencyCertified,
          schedulerRequested: productionSchedulerEnabled,
          intervalSeconds: productionSchedulerEnabled ? 900 : 3_600,
        }).policy,
    }),
    counts: Object.freeze({
      eligibleCertifiedLinkages: plan?.eligibleCertifiedLinkageCount ?? null,
      ineligibleLinkages: plan?.ineligibleLinkageCount ?? null,
      observations: observations.length,
    }),
    latestObservationPerLinkage: Object.freeze(latestByLinkage),
    failureCounts: Object.freeze(failureCounts),
    evidenceCompleteness: observations.length
      ? "PARTIAL" as const : "UNAVAILABLE" as const,
    storage: P2_I02_SCHEMA_DELTA_REQUIRED,
    prerequisites,
    limitations: Object.freeze(uniqueCodes([
      ...(input.p2I01Limitations ?? []),
      ...(!dependencyCertified ? ["P2_I01_GATE_NOT_CERTIFIED"] : []),
      ...(!productionSchedulerEnabled
        ? ["P2_I02_PREBUILD_PRODUCTION_SCHEDULER_DISABLED"] : []),
      ...(prerequisites.humanBootstrapRequired
        ? ["LUNA_PROTECTED_SESSION_HUMAN_BOOTSTRAP_REQUIRED"] : []),
      ...(observations.length === 0
        ? ["NO_STOCK_OBSERVATION_EVIDENCE_DOES_NOT_PROVE_ZERO"] : []),
      "OBSERVED_OUT_OF_STOCK_IS_NOT_CERTIFIED_OOS",
      "P2_I03_OWNS_FINAL_FRESHNESS_AND_CAPACITY",
      "P2_I04_OWNS_CERTIFIED_OOS",
    ])),
    safety: STATUS_SAFETY,
  })
}

export function createSellerOsLunaStockObservationPrebuildStatusV1(input: {
  observedAt?: string
  protectedSessionConfigured?: boolean
  protectedSessionServerOnly?: boolean
  sessionAssessment?: ReturnType<typeof assessSellerOsLunaProtectedSessionV1>
  activationCertified?: boolean
} = {}) {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const session = input.sessionAssessment ??
    assessSellerOsLunaProtectedSessionV1({
      now: observedAt,
      secretPresent: input.protectedSessionConfigured === true,
      storage: input.protectedSessionConfigured === true
        ? "SERVER_ENV_LEGACY" : "NONE",
      serverOwned: input.protectedSessionServerOnly === true,
      clientExposed: input.protectedSessionConfigured === true &&
        input.protectedSessionServerOnly !== true,
      validation: input.protectedSessionConfigured === true &&
        input.protectedSessionServerOnly === true ? "VALID" : "AUTH_REQUIRED",
    })
  const activationCertified = input.activationCertified === true &&
    session.status === "SESSION_READY"
  const prerequisites = buildSellerOsLunaAutomationPrerequisitesStatusV1({
    session, productionSchedulerEnabled: activationCertified,
  })
  return buildSellerOsLunaStockObservationStatusV1({
    observedAt,
    p2I01DependencyStatus: activationCertified ? "CERTIFIED" : "BLOCKED",
    p2I01Limitations: activationCertified ? [] : ["P2_I01_GATE_NOT_CERTIFIED",
      "EXTERNAL_EBAY_QUOTA_BLOCKER"],
    acquisition: getLunaStockAcquisitionCapabilityV1({
      protectedSessionConfigured: session.status === "SESSION_READY",
      protectedSessionServerOnly: session.backendOnly,
    }),
    prerequisites,
    productionSchedulerEnabled: activationCertified,
    observations: [],
  })
}

export type SellerOsLunaStockObservationStatusReadV1 = ReturnType<
  typeof buildSellerOsLunaStockObservationStatusV1
>
