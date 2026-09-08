export const SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_BRIDGE_V1 =
  "SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_BRIDGE_V1" as const

export const SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_LOAD_BUDGET_V1 =
  Object.freeze({
    rpcPerManualRecoveryMax: 1,
    jobsPerManualRecoveryMax: 1,
    chromeDispatchPerRecoveryMax: 1,
    additionalPollers: 0,
  } as const)

export const SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_RECEIPTS_V1 =
  Object.freeze([
    "RECOVERY_CONTROL_INVOKED",
    "RECOVERY_JOB_RETURNED",
    "RECOVERY_JOB_DISPATCHED_TO_CHROME",
    "RECOVERY_CHROME_ACK",
    "RECOVERY_FAILURE_ROUTED",
    "RECOVERY_FINISH_ROUTED",
  ] as const)

export type SellerOsLegacyShippingRecoveryClientReceiptEventV1 =
  typeof SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_RECEIPTS_V1[number]

export type SellerOsLegacyShippingRecoveryClientReceiptV1 = Readonly<{
  contractVersion:
    typeof SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_BRIDGE_V1
  event: SellerOsLegacyShippingRecoveryClientReceiptEventV1
  jobId: string
  recoveryGeneration: string | null
  observedAt: string
}>

export type SellerOsLegacyShippingRecoveryClientGateV1 = Readonly<{
  ownerAdminAuthenticated: boolean
  browserLeader: boolean
  serverLeaderLeaseActive: boolean
  heartbeatV2Fresh: boolean
  shippingCapabilityFresh: boolean
  chromePortConnected: boolean
  recoveryDispatchInFlight: boolean
}>

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const FRESHNESS =
  /^economic-shipping-refresh-v1:sha256:[0-9a-f]{64}$/
const RECOVERY =
  /^economic-shipping-legacy-recovery-v1:sha256:[0-9a-f]{64}$/
const CANDIDATE = /^sha256:[0-9a-f]{64}$/

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function certifySellerOsLegacyShippingRecoveryClientGateV1(
  gate: SellerOsLegacyShippingRecoveryClientGateV1,
) {
  if (!gate.ownerAdminAuthenticated) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_OWNER_ADMIN_REQUIRED")
  }
  if (!gate.browserLeader || !gate.serverLeaderLeaseActive) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_LEADER_REQUIRED")
  }
  if (!gate.heartbeatV2Fresh || !gate.shippingCapabilityFresh) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_CAPABILITY_STALE")
  }
  if (!gate.chromePortConnected) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_CHROME_PORT_REQUIRED")
  }
  if (gate.recoveryDispatchInFlight) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_ALREADY_IN_FLIGHT")
  }
  return Object.freeze({ ...gate, certified: true as const })
}

export type SellerOsLegacyShippingRecoveryJobBindingV1 = Readonly<{
  jobId: string
  candidateId: string
  freshnessGeneration: string
  recoveryGeneration: string
}>

export function sellerOsLegacyShippingRecoveryJobBindingV1(
  job: unknown,
  requestedJobId: string,
  responseRecoveryGeneration: unknown,
): SellerOsLegacyShippingRecoveryJobBindingV1 {
  const value = record(job)
  const identity = record(value.identity)
  const economic = record(value.economicRefresh)
  const jobId = String(economic.jobId ?? "")
  const candidateId = String(identity.candidateId ?? "")
  const freshnessGeneration = String(economic.freshnessGeneration ?? "")
  const recoveryGeneration = String(
    economic.legacyRecoveryGeneration ?? "")
  if (value.contractVersion !== "LUNA_SHIPPING_QUOTE_CAPTURE_V1" ||
      !UUID.test(requestedJobId) || jobId !== requestedJobId ||
      !CANDIDATE.test(candidateId) || !FRESHNESS.test(freshnessGeneration) ||
      !RECOVERY.test(recoveryGeneration) ||
      recoveryGeneration !== String(responseRecoveryGeneration ?? "") ||
      economic.recoveryGeneration !== recoveryGeneration) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_JOB_BINDING_INVALID")
  }
  return Object.freeze({ jobId, candidateId, freshnessGeneration,
    recoveryGeneration })
}

export function sellerOsLegacyShippingRecoveryResultJobV1(
  payload: unknown,
  requestedJobId: string,
) {
  const result = record(record(payload).result)
  const jobs = Array.isArray(result.jobs) ? result.jobs : []
  if (jobs.length >
      SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_LOAD_BUDGET_V1
        .jobsPerManualRecoveryMax) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_MULTIPLE_JOBS_FORBIDDEN")
  }
  if (jobs.length === 0) return Object.freeze({ job: null, binding: null,
    recoveryGeneration: typeof result.recoveryGeneration === "string"
      ? result.recoveryGeneration : null })
  const binding = sellerOsLegacyShippingRecoveryJobBindingV1(
    jobs[0], requestedJobId, result.recoveryGeneration)
  return Object.freeze({ job: jobs[0], binding,
    recoveryGeneration: binding.recoveryGeneration })
}

export function sellerOsLegacyShippingRecoveryClientReceiptV1(input:
  Readonly<{ event: SellerOsLegacyShippingRecoveryClientReceiptEventV1;
    jobId: string; recoveryGeneration?: string | null; now?: number }>) {
  if (!SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_RECEIPTS_V1.includes(
      input.event) || !UUID.test(input.jobId) ||
      (input.recoveryGeneration != null &&
        !RECOVERY.test(input.recoveryGeneration))) {
    throw new Error("SELLER_OS_LEGACY_RECOVERY_RECEIPT_INVALID")
  }
  return Object.freeze({
    contractVersion: SELLER_OS_LEGACY_SHIPPING_RECOVERY_CLIENT_BRIDGE_V1,
    event: input.event,
    jobId: input.jobId,
    recoveryGeneration: input.recoveryGeneration ?? null,
    observedAt: new Date(input.now ?? Date.now()).toISOString(),
  })
}

export function publishSellerOsLegacyShippingRecoveryClientReceiptV1(
  receipt: SellerOsLegacyShippingRecoveryClientReceiptV1,
) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(
    "seller-os-legacy-shipping-recovery-client-receipt-v1",
    { detail: receipt }))
}
