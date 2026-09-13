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

const TERMINAL_COMMERCIAL_SLOT_STATUSES = new Set([
  "PARKED", "PARKED_ECONOMICS", "EXCLUDED_ALREADY_LIVE",
])

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
  let outcome: JsonRecord | null = waiting[0] ?? null
  if (Object.keys(existing).length) {
    const existingCanonical = deriveCurrentCommercialCandidateIdentityV1({
      accountKey: input.accountKey,
      productId: text(existing.productId),
      variantId: text(existing.variantId),
      supplierSku: text(existing.supplierSku),
    })
    if (existingCanonical.canonicalCandidateId !==
        existing.canonicalCandidateId) {
      throw new Error(
        "AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION")
    }
    const sameCandidate = waiting.find((candidate) =>
      candidate.candidateId === existing.canonicalCandidateId) ?? null
    if (sameCandidate && (sameCandidate.opportunityId !==
        existing.opportunityId || sameCandidate.listingPackageId !==
        existing.listingPackageId || sameCandidate.lunaProductId !==
        existing.productId || sameCandidate.lunaVariantId !==
        existing.variantId || sameCandidate.supplierSku !==
        existing.supplierSku)) {
      throw new Error(
        "AUTONOMOUS_STOCKING_SHIPPING_SLOT_BINDING_CONTRADICTION")
    }
    // Once exact Shipping is durable the candidate normally leaves the
    // WAITING_BROWSER_WORKER set. Absence from that set is progression, not a
    // request to switch the already durable batch slot to another candidate.
    outcome = sameCandidate
  }
  if (!outcome) {
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

export function currentBatchShippingSlotRolloverV1(input: Readonly<{
  accountKey: string
  factoryOutcomes: readonly unknown[]
  readySlotReadback: unknown
}>) {
  const readback = record(input.readySlotReadback)
  if (readback.shippingReady !== true) return null
  const priorCandidateId = text(readback.canonicalCandidateId)
  const prior = input.factoryOutcomes.map(record).find((outcome) =>
    outcome.candidateId === priorCandidateId) ?? null
  if (!prior || !TERMINAL_COMMERCIAL_SLOT_STATUSES.has(
      text(prior.status)) || prior.listingReady === true ||
      !text(prior.reasonCode) ||
      text(prior.reasonCode) === "WAITING_BROWSER_WORKER") return null
  const next = currentBatchShippingSlotBindingV1({
    accountKey: input.accountKey,
    factoryOutcomes: input.factoryOutcomes,
  })
  if (!next || next.canonicalCandidateId === priorCandidateId) return null
  return Object.freeze({
    priorCandidateId,
    retirementStatus: text(prior.status),
    retirementReason: text(prior.reasonCode),
    next,
  })
}

export function hydrateCurrentBatchShippingWaitingPackagesV1(
  input: Readonly<{
    accountKey: string
    factoryOutcomes: readonly unknown[]
    packageRows: readonly unknown[]
  }>,
) {
  const packages = input.packageRows.map(record).filter((row) =>
    text(row.id) && text(row.opportunity_id) &&
    row.account_key === input.accountKey)
  return Object.freeze(input.factoryOutcomes.map((value) => {
    const outcome = record(value)
    if (outcome.reasonCode !== "WAITING_BROWSER_WORKER" ||
        outcome.shippingJobIdentityMatch !== true ||
        !text(outcome.opportunityId)) return outcome
    const exact = packages.filter((row) =>
      row.opportunity_id === outcome.opportunityId)
    if (exact.length !== 1) {
      throw new Error(exact.length
        ? "AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS"
        : "AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_NOT_FOUND")
    }
    const existing = text(outcome.listingPackageId)
    if (existing && existing !== exact[0].id) {
      throw new Error("AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_DRIFT")
    }
    return Object.freeze({ ...outcome, listingPackageId: text(exact[0].id) })
  }))
}
