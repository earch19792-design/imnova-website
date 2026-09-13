import { createHash } from "node:crypto"
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

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
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

const NON_AUTHORITATIVE_CURRENT_MARKER_STATUSES = new Set([
  "HISTORICAL", "RETIRED", "SUPERSEDED",
])

function currentPackageMarker(row: JsonRecord) {
  return record(record(row.package_data).currentPublicationFactoryV1)
}

function markerIsExplicitlyNonAuthoritative(marker: JsonRecord) {
  return NON_AUTHORITATIVE_CURRENT_MARKER_STATUSES.has(
    text(marker.status).toUpperCase()) || text(marker.supersededByPackageId) !== ""
}

function markerIsCurrentAuthority(input: Readonly<{
  row: JsonRecord
  marker: JsonRecord
  accountKey: string
  opportunityId: string
  productId: string
  variantId: string
  supplierSku: string
}>) {
  return input.marker.version === "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1" &&
    input.marker.authorityPolicy === "CURRENT_ONLY" &&
    input.marker.reuseLegacyPreparation === false &&
    input.marker.packageId === input.row.id &&
    input.marker.accountKey === input.accountKey &&
    input.marker.productId === input.productId &&
    input.marker.variantId === input.variantId &&
    input.marker.supplierSku === input.supplierSku &&
    text(input.marker.generation) !== "" &&
    input.row.account_key === input.accountKey &&
    input.row.opportunity_id === input.opportunityId &&
    !markerIsExplicitlyNonAuthoritative(input.marker)
}

/**
 * Resolves a package from the durable CURRENT batch-slot binding. Opportunity
 * siblings remain visible for collision classification, but they never compete
 * with the exact slot package unless they independently satisfy the complete
 * CURRENT authority marker for the same commercial identity.
 */
export function resolveCurrentBatchSlotExactPackageV1(input: Readonly<{
  accountKey: string
  slotBinding: unknown
  opportunity: unknown
  packageRows: readonly unknown[]
  priorResolution?: unknown
}>) {
  const slot = record(input.slotBinding)
  const opportunity = record(input.opportunity)
  const assessment = record(opportunity.assessment)
  const productTruth = record(assessment.productTruth)
  const productTruthStock = record(productTruth.stock)
  const commercialIdentity = record(
    assessment.currentCommercialCandidateIdentityV1)
  const productTruthDigest = text(productTruth.evidenceDigest)
  const opportunityId = text(slot.opportunityId)
  const listingPackageId = text(slot.listingPackageId)
  const productId = text(slot.productId)
  const variantId = text(slot.variantId)
  const supplierSku = text(slot.supplierSku)
  const canonicalCandidateId = text(slot.canonicalCandidateId)
  const canonical = deriveCurrentCommercialCandidateIdentityV1({
    accountKey: input.accountKey, productId, variantId, supplierSku,
  })
  if (!opportunityId || !listingPackageId || !productId || !variantId ||
      !supplierSku || canonical.canonicalCandidateId !== canonicalCandidateId ||
      opportunity.id !== opportunityId ||
      opportunity.supplier_product_id !== productId ||
      opportunity.supplier_variant_id !== variantId ||
      opportunity.supplier_sku !== supplierSku ||
      commercialIdentity.contractVersion !==
        CURRENT_COMMERCIAL_CANDIDATE_IDENTITY_VERSION ||
      commercialIdentity.canonicalCandidateId !== canonicalCandidateId ||
      commercialIdentity.accountKey !== input.accountKey ||
      commercialIdentity.productId !== productId ||
      commercialIdentity.variantId !== variantId ||
      commercialIdentity.supplierSku !== supplierSku ||
      commercialIdentity.storageCandidateKey !== opportunity.candidate_key ||
      productTruth.canonicalCandidateId !== canonicalCandidateId ||
      productTruth.lunaProductId !== productId ||
      productTruth.lunaVariantId !== variantId ||
      productTruth.supplierSku !== supplierSku ||
      !/^sha256:[0-9a-f]{64}$/.test(productTruthDigest)) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_IDENTITY_MISMATCH")
  }
  const packages = input.packageRows.map(record).filter((row) =>
    row.account_key === input.accountKey && row.opportunity_id === opportunityId)
  const exactRows = packages.filter((row) => row.id === listingPackageId)
  if (exactRows.length !== 1) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_SLOT_PACKAGE_NOT_FOUND")
  }
  const exact = exactRows[0]
  if (exact.candidate_key !== opportunity.candidate_key) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_IDENTITY_MISMATCH")
  }
  const exactMarker = currentPackageMarker(exact)
  const currentAuthorities: JsonRecord[] = []
  const siblings: Readonly<{ packageId: string; classification: string }>[] = []
  const historicalReferences = Array.isArray(exactMarker.historicalReferences)
    ? exactMarker.historicalReferences.map(record) : []
  for (const row of packages) {
    const marker = currentPackageMarker(row)
    const currentVersion = marker.version ===
      "SELLER_OS_CURRENT_PUBLICATION_FACTORY_V1"
    const authoritative = markerIsCurrentAuthority({ row, marker,
      accountKey: input.accountKey, opportunityId, productId, variantId,
      supplierSku })
    if (authoritative) currentAuthorities.push(row)
    if (row.id === listingPackageId) continue
    const lineageOnly = historicalReferences.some((reference) =>
      reference.packageId === row.id &&
      reference.use === "AUDIT_LINEAGE_DEDUP_ONLY")
    siblings.push(Object.freeze({ packageId: text(row.id),
      classification: markerIsExplicitlyNonAuthoritative(marker)
        ? "SUPERSEDED_NON_AUTHORITATIVE"
        : authoritative ? "CURRENT_AUTHORITATIVE"
          : lineageOnly ? "HISTORICAL_LINEAGE_ONLY"
            : currentVersion ? "CURRENT_MARKER_CONTRADICTION"
              : "HISTORICAL_NON_AUTHORITATIVE" }))
    if (currentVersion && !authoritative &&
        !markerIsExplicitlyNonAuthoritative(marker)) {
      throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_MATERIAL_MISMATCH")
    }
  }
  if (!markerIsCurrentAuthority({ row: exact, marker: exactMarker,
    accountKey: input.accountKey, opportunityId, productId, variantId,
    supplierSku })) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_MATERIAL_MISMATCH")
  }
  if (currentAuthorities.length !== 1) {
    throw new Error("AUTONOMOUS_STOCKING_SHIPPING_PACKAGE_AMBIGUOUS")
  }
  // Freshness clocks and source-receipt digests are deliberately excluded.
  // Commercial facts that would change the package decision remain bound.
  const productTruthMaterialDigest = digest({
    authorityClass: productTruth.authorityClass,
    canonicalCandidateId: productTruth.canonicalCandidateId,
    productId: productTruth.lunaProductId,
    variantId: productTruth.lunaVariantId,
    supplierSku: productTruth.supplierSku,
    title: productTruth.title,
    gtin: productTruth.gtin ?? null,
    supplierPriceUsd: productTruth.supplierPriceUsd,
    imageCount: productTruth.imageCount,
    stockState: productTruthStock.state,
    stockQuantity: productTruthStock.supplierStatedQuantity ?? null,
    stockSafeCapacity: productTruthStock.safeCapacity ?? null,
  })
  const materialBindingDigest = digest({
    accountKey: input.accountKey, canonicalCandidateId, opportunityId,
    listingPackageId, candidateKey: opportunity.candidate_key, productId,
    variantId, supplierSku, productTruthMaterialDigest,
    packageGeneration: exactMarker.generation,
  })
  const prior = record(input.priorResolution)
  if (Object.keys(prior).length && (prior.listingPackageId !== listingPackageId ||
      prior.materialBindingDigest !== materialBindingDigest)) {
    throw new Error("AUTONOMOUS_STOCKING_EXACT_PACKAGE_MATERIAL_MISMATCH")
  }
  return Object.freeze({
    contractVersion: "AUTONOMOUS_STOCKING_EXACT_SLOT_PACKAGE_RESOLUTION_V1",
    listingPackageId,
    canonicalCandidateId,
    productTruthDigest,
    productTruthMaterialDigest,
    packageGeneration: text(exactMarker.generation),
    materialBindingDigest,
    siblingClassifications: Object.freeze(siblings),
    exactSlotPackageResolution: true as const,
    currentAuthoritativePackageCount: 1 as const,
    historicalPackageReusedAsAuthority: false as const,
    manualPackageSelection: false as const,
    codexRuntimeDependency: false as const,
  })
}

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
