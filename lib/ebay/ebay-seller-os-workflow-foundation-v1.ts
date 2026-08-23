// @ts-expect-error Node's direct TypeScript test runner requires the explicit extension.
import { stableCommercialKey } from "../marketplace/commercial-monitor-domain.ts"

export const SELLER_OS_WORKFLOW_STEP_EXECUTION_VERSION =
  "SELLER_OS_WORKFLOW_STEP_EXECUTION_V1" as const
export const SELLER_OS_CORRELATION_ENVELOPE_VERSION =
  "SELLER_OS_CORRELATION_ENVELOPE_V1" as const

export const SELLER_OS_WORKFLOW_STEP_STATES_V1 = Object.freeze([
  "NOT_STARTED",
  "IN_PROGRESS",
  "SUCCEEDED",
  "RETRYABLE_FAILURE",
  "TERMINAL_FAILURE",
  "BLOCKED",
  "SKIPPED",
  "NOT_APPLICABLE",
] as const)

export type SellerOsWorkflowStepStateV1 =
  typeof SELLER_OS_WORKFLOW_STEP_STATES_V1[number]

/**
 * Minimal W0 correlation implementation. Domain identities remain the roots;
 * this helper only derives stable child/correlation identities and never
 * replaces a certified business fact or event ID.
 */
export function buildSellerOsCorrelationEnvelopeV1(input: Readonly<{
  businessFactId: string
  eventId: string
  stepType: string
  stepVersion: string
  sideEffectReceiptId?: string | null
}>) {
  const correlationId = stableCommercialKey(
    input.businessFactId,
    "CORRELATION",
    SELLER_OS_CORRELATION_ENVELOPE_VERSION,
  )
  const stepExecutionId = stableCommercialKey(
    input.eventId,
    input.stepType,
    input.stepVersion,
    SELLER_OS_WORKFLOW_STEP_EXECUTION_VERSION,
  )
  return Object.freeze({
    contractVersion: SELLER_OS_CORRELATION_ENVELOPE_VERSION,
    businessFactId: input.businessFactId,
    eventId: input.eventId,
    correlationId,
    causationId: input.eventId,
    stepExecutionId,
    sideEffectReceiptId: input.sideEffectReceiptId ?? null,
  })
}

/**
 * The first runtime consumer is deliberately small: it models one isolated
 * step without introducing a workflow engine, retry worker, lease, or write.
 * Later write-capable consumers can persist this contract behind adapters.
 */
export function buildSellerOsWorkflowStepExecutionV1(input: Readonly<{
  stepExecutionId: string
  stepType: string
  state: SellerOsWorkflowStepStateV1
  observedAt: string | null
  sideEffectClass: "OBSERVABILITY_READ" |
    "INTERNAL_IDEMPOTENT_MAINTENANCE_WRITE" |
    "INTERNAL_BUSINESS_STATE_WRITE" |
    "WHATSAPP_SEND" |
    "BUYER_MESSAGE_SEND"
  sideEffectReceiptId?: string | null
  attemptCount?: number
  lease?: Readonly<{ status: string; expiresAt: string | null }> | null
  persistenceStatus?: string
}>) {
  return Object.freeze({
    contractVersion: SELLER_OS_WORKFLOW_STEP_EXECUTION_VERSION,
    stepExecutionId: input.stepExecutionId,
    stepType: input.stepType,
    state: input.state,
    attemptCount: typeof input.attemptCount === "number" &&
        Number.isSafeInteger(input.attemptCount) && input.attemptCount >= 0
      ? Math.min(input.attemptCount, 1_000)
      : input.state === "NOT_STARTED" ? 0 : 1,
    observedAt: input.observedAt,
    retryPolicy: Object.freeze({
      retryMayReplaySucceededSibling: false as const,
      successReceiptRequiredBeforeExternalRetry: true as const,
    }),
    lease: input.lease ?? null,
    sideEffectClass: input.sideEffectClass,
    sideEffectReceiptId: input.sideEffectReceiptId ?? null,
    persistenceStatus: input.persistenceStatus ??
      "NOT_PERSISTED_DETERMINISTIC_PROJECTION",
  })
}
