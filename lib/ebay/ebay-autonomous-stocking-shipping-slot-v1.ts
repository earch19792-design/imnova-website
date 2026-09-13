import { CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION,
  deriveCurrentCommercialCandidateIdentityV1 } from
  "./ebay-current-commercial-candidate-identity-v1"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export type AutonomousStockingShippingSlotBindingV1 = Readonly<{
  contractVersion: "AUTONOMOUS_STOCKING_CURRENT_SHIPPING_SLOT_V1"
  accountKey: string
  canonicalCandidateId: string
  opportunityId: string
  listingPackageId: string
  productId: string
  variantId: string
  supplierSku: string
  foreignReceiptAdopted: false
  manualIdentityRebind: false
  codexRuntimeDependency: false
}>

export function currentBatchShippingSlotBindingV1(input: Readonly<{
  accountKey: string
  factoryOutcomes: readonly unknown[]
  existingBinding?: unknown
}>): AutonomousStockingShippingSlotBindingV1 | null {
  const existing = record(input.existingBinding)
  const waiting = input.factoryOutcomes.map(record).filter((outcome) =>
    outcome.reasonCode === "WAITING_BROWSER_WORKER" &&
    outcome.shippingJobIdentityMatch === true &&
    text(outcome.opportunityId) && text(outcome.listingPackageId) &&
    text(outcome.lunaProductId) && text(outcome.lunaVariantId) &&
    text(outcome.supplierSku))
  const outcome = Object.keys(existing).length
    ? waiting.find((candidate) =>
      candidate.candidateId === existing.canonicalCandidateId &&
      candidate.opportunityId === existing.opportunityId &&
      candidate.listingPackageId === existing.listingPackageId &&
      candidate.lunaProductId === existing.productId &&
      candidate.lunaVariantId === existing.variantId &&
      candidate.supplierSku === existing.supplierSku) ?? null
    : waiting[0] ?? null
  if (!outcome) {
    if (Object.keys(existing).length) {
      throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION")
    }
    return null
  }
  const canonical = deriveCurrentCommercialCandidateIdentityV1({
    accountKey: input.accountKey,
    productId: text(outcome.lunaProductId),
    variantId: text(outcome.lunaVariantId),
    supplierSku: text(outcome.supplierSku),
  })
  if (outcome.candidateId !== canonical.canonicalCandidateId ||
      canonical.contractVersion !==
        CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION) {
    throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_CANONICAL_MISMATCH")
  }
  return Object.freeze({
    contractVersion: "AUTONOMOUS_STOCKING_CURRENT_SHIPPING_SLOT_V1",
    accountKey: input.accountKey,
    canonicalCandidateId: canonical.canonicalCandidateId,
    opportunityId: text(outcome.opportunityId),
    listingPackageId: text(outcome.listingPackageId),
    productId: text(outcome.lunaProductId),
    variantId: text(outcome.lunaVariantId),
    supplierSku: text(outcome.supplierSku),
    foreignReceiptAdopted: false,
    manualIdentityRebind: false,
    codexRuntimeDependency: false,
  })
}

export function certifyCurrentBatchShippingSlotReadbackV1(
  value: unknown,
) {
  const readback = record(value)
  if (readback.slotPresent !== true) return Object.freeze({
    slotPresent: false as const,
    shippingReady: false as const,
    priorityCandidateId: null,
  })
  const candidateId = text(readback.canonicalCandidateId)
  if (!/^sha256:[0-9a-f]{64}$/.test(candidateId) ||
      readback.foreignReceiptAdopted !== false ||
      readback.manualIdentityRebind !== false ||
      readback.codexRuntimeDependency !== false ||
      !Number.isInteger(Number(readback.targetActiveCaptureCount)) ||
      Number(readback.targetActiveCaptureCount) > 1 ||
      Number(readback.shippingDuplicateCaptureCount ?? 0) !== 0) {
    throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_READBACK_INVALID")
  }
  const ready = readback.shippingReady === true
  if (ready && (readback.currentExactBoundQuote !== true ||
      readback.captureResultDurable !== true ||
      readback.durableReadbackMatch !== true ||
      readback.shippingReceiptCommercialIdentityMatch !== true ||
      readback.targetCurrentShippingCaptureExecuted !== true ||
      Number(readback.exactDurableResultCount) !== 1)) {
    throw new Error("AUTONOMOUS_STOCKING_SHIPPING_SLOT_READBACK_INVALID")
  }
  return Object.freeze({
    slotPresent: true as const,
    shippingReady: ready,
    priorityCandidateId: ready ? null : candidateId,
    readback: Object.freeze({ ...readback }),
  })
}
