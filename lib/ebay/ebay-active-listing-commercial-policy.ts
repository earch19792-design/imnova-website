export const EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION =
  "SELLER_OS_ACTIVE_LISTING_COMMERCIAL_POLICY_V1" as const

export const EBAY_CONFIRMED_SOLD_EVIDENCE_MAX_AGE_DAYS = 90

export type EbayActiveListingCommercialEvidenceClass =
  | "ACTIVE_ONLY"
  | "ESTIMATED_ACTIVITY"
  | "CONFIRMED_SOLD_HISTORY"
  | "NO_COMPARABLE_EVIDENCE"
  | "LUNA_COST_CHANGED"
  | "MARGIN_RISK"
  | "LUNA_OUT_OF_STOCK"
  | "UNKNOWN"

export type EbayActiveListingCommercialDecision =
  | "HOLD_PRICE_NO_PROMOTION"
  | "EVALUATE_CONFIRMED_SOLD_PRICE"
  | "EVALUATE_PROTECTIVE_PRICE_INCREASE"
  | "END_LISTING_OUT_OF_STOCK"

export type EbayActiveListingCommercialCapability =
  | "enabled"
  | "blocked"
  | "preview_only"
  | "web_only"

export type EbayActiveListingCommercialPolicyInput = {
  evidenceClass?: unknown
  evidenceObservedAt?: string | null
  evaluatedAt?: string | Date | null
  confirmedSoldQuantity?: unknown
  confirmedSoldSource?: string | null
  identityExact?: boolean
  samePresentation?: boolean
  sameCondition?: boolean
  samePack?: boolean
  landedPriceComplete?: boolean
  supplierEvidenceFresh?: boolean
  supplierAvailable?: boolean | null
  proposalCurrent?: boolean
  economicsApproved?: boolean
  proposedPriceAtOrAboveFloor?: boolean
  officialCurrentPriceUnchanged?: boolean
  promotionEvidenceApproved?: boolean
  exactLunaIdentity?: boolean
  exactLunaStock?: number | null
  protectiveEvidenceVerified?: boolean
  humanConfirmation?: boolean
  idempotencyReady?: boolean
  readbackReady?: boolean
}

export type EbayActiveListingCommercialPolicyResult = {
  decision: EbayActiveListingCommercialDecision
  capability: EbayActiveListingCommercialCapability
  canPreparePriceDecrease: boolean
  canPreparePromotion: boolean
  canPrepareProtectivePriceIncrease: boolean
  canEndForOutOfStock: boolean
  blockerCodes: string[]
  policyVersion: typeof EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION
  evidenceClass: EbayActiveListingCommercialEvidenceClass
  evidenceObservedAt: string | null
  evidenceExpiresAt: string | null
}

const CONFIRMED_SOLD_SOURCES = new Set([
  "EBAY_PRODUCT_RESEARCH_CONFIRMED_SOLD",
  "EBAY_SELL_FULFILLMENT_COMPLETED_CHECKOUT_ORDERS",
])

function evidenceClass(value: unknown): EbayActiveListingCommercialEvidenceClass {
  return [
    "ACTIVE_ONLY",
    "ESTIMATED_ACTIVITY",
    "CONFIRMED_SOLD_HISTORY",
    "NO_COMPARABLE_EVIDENCE",
    "LUNA_COST_CHANGED",
    "MARGIN_RISK",
    "LUNA_OUT_OF_STOCK",
  ].includes(String(value))
    ? value as EbayActiveListingCommercialEvidenceClass
    : "UNKNOWN"
}

function timestamp(value: string | Date | null | undefined) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : null
}

function isoTimestamp(value: string | null | undefined) {
  const parsed = timestamp(value)
  return parsed === null ? null : new Date(parsed).toISOString()
}

function confirmedQuantity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0
}

function baseResult(input: {
  evidenceClass: EbayActiveListingCommercialEvidenceClass
  evidenceObservedAt: string | null
  evidenceExpiresAt?: string | null
  blockerCodes?: string[]
}): EbayActiveListingCommercialPolicyResult {
  return {
    decision: "HOLD_PRICE_NO_PROMOTION",
    capability: "blocked",
    canPreparePriceDecrease: false,
    canPreparePromotion: false,
    canPrepareProtectivePriceIncrease: false,
    canEndForOutOfStock: false,
    blockerCodes: input.blockerCodes ?? [
      "CONFIRMED_SOLD_EVIDENCE_REQUIRED",
    ],
    policyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    evidenceClass: input.evidenceClass,
    evidenceObservedAt: input.evidenceObservedAt,
    evidenceExpiresAt: input.evidenceExpiresAt ?? null,
  }
}

function executionBlockers(input: EbayActiveListingCommercialPolicyInput) {
  return [
    input.officialCurrentPriceUnchanged === true
      ? null : "OFFICIAL_CURRENT_PRICE_REVALIDATION_REQUIRED",
    input.humanConfirmation === true ? null : "HUMAN_CONFIRMATION_REQUIRED",
    input.idempotencyReady === true ? null : "IDEMPOTENCY_REQUIRED",
    input.readbackReady === true ? null : "READBACK_REQUIRED",
  ].filter((code): code is string => code !== null)
}

export function evaluateEbayActiveListingCommercialPolicy(
  input: EbayActiveListingCommercialPolicyInput,
): EbayActiveListingCommercialPolicyResult {
  const normalizedEvidenceClass = evidenceClass(input.evidenceClass)
  const observedAt = isoTimestamp(input.evidenceObservedAt)
  const evaluatedAt = timestamp(input.evaluatedAt ?? new Date())

  if ([
    "LUNA_COST_CHANGED",
    "MARGIN_RISK",
    "LUNA_OUT_OF_STOCK",
  ].includes(normalizedEvidenceClass)) {
    const evidenceBlockers = [
      input.protectiveEvidenceVerified === true
        ? null : "PROTECTIVE_LUNA_EVIDENCE_REQUIRED",
      input.exactLunaIdentity === true ? null : "EXACT_LUNA_IDENTITY_REQUIRED",
      input.supplierEvidenceFresh === true
        ? null : "FRESH_LUNA_EVIDENCE_REQUIRED",
    ].filter((code): code is string => code !== null)
    const finalExecutionBlockers = [
      input.humanConfirmation === true ? null : "HUMAN_CONFIRMATION_REQUIRED",
      input.idempotencyReady === true ? null : "IDEMPOTENCY_REQUIRED",
      input.readbackReady === true ? null : "READBACK_REQUIRED",
    ].filter((code): code is string => code !== null)

    if (normalizedEvidenceClass === "LUNA_OUT_OF_STOCK") {
      const blockers = [
        ...evidenceBlockers,
        input.exactLunaStock === 0 ? null : "EXACT_LUNA_ZERO_STOCK_REQUIRED",
        ...finalExecutionBlockers,
      ].filter((code): code is string => code !== null)
      return {
        ...baseResult({
          evidenceClass: normalizedEvidenceClass,
          evidenceObservedAt: observedAt,
          blockerCodes: blockers,
        }),
        decision: evidenceBlockers.length === 0 && input.exactLunaStock === 0
          ? "END_LISTING_OUT_OF_STOCK"
          : "HOLD_PRICE_NO_PROMOTION",
        capability: blockers.length === 0 ? "enabled"
          : evidenceBlockers.length === 0 && input.exactLunaStock === 0
            ? "preview_only" : "blocked",
        canEndForOutOfStock: blockers.length === 0,
      }
    }

    const blockers = [
      ...evidenceBlockers,
      input.supplierAvailable === true ? null : "LUNA_AVAILABILITY_REQUIRED",
      input.economicsApproved === true ? null : "ECONOMICS_APPROVAL_REQUIRED",
      input.proposedPriceAtOrAboveFloor === true
        ? null : "SAFE_PRICE_FLOOR_REQUIRED",
      ...executionBlockers(input),
    ].filter((code): code is string => code !== null)
    const protectiveEvidenceReady = evidenceBlockers.length === 0 &&
      input.supplierAvailable === true &&
      input.economicsApproved === true &&
      input.proposedPriceAtOrAboveFloor === true
    return {
      ...baseResult({
        evidenceClass: normalizedEvidenceClass,
        evidenceObservedAt: observedAt,
        blockerCodes: blockers,
      }),
      decision: protectiveEvidenceReady
        ? "EVALUATE_PROTECTIVE_PRICE_INCREASE"
        : "HOLD_PRICE_NO_PROMOTION",
      capability: blockers.length === 0 ? "enabled"
        : protectiveEvidenceReady ? "preview_only" : "blocked",
      canPrepareProtectivePriceIncrease: blockers.length === 0,
    }
  }

  const soldQuantity = confirmedQuantity(input.confirmedSoldQuantity)
  if (normalizedEvidenceClass !== "CONFIRMED_SOLD_HISTORY" ||
    soldQuantity === 0) {
    return baseResult({
      evidenceClass: normalizedEvidenceClass,
      evidenceObservedAt: observedAt,
    })
  }

  const soldObservedAt = timestamp(observedAt)
  const evidenceExpiresAtMs = soldObservedAt === null ? null
    : soldObservedAt +
      EBAY_CONFIRMED_SOLD_EVIDENCE_MAX_AGE_DAYS * 86_400_000
  const evidenceExpiresAt = evidenceExpiresAtMs === null ? null
    : new Date(evidenceExpiresAtMs).toISOString()
  const evidenceCurrent = soldObservedAt !== null &&
    evaluatedAt !== null &&
    soldObservedAt <= evaluatedAt &&
    evidenceExpiresAtMs !== null &&
    evaluatedAt <= evidenceExpiresAtMs
  const evidenceBlockers = [
    CONFIRMED_SOLD_SOURCES.has(input.confirmedSoldSource ?? "")
      ? null : "CONFIRMED_SOLD_SOURCE_NOT_ALLOWED",
    input.identityExact === true ? null : "EXACT_IDENTITY_REQUIRED",
    input.samePresentation === true ? null : "SAME_PRESENTATION_REQUIRED",
    input.sameCondition === true ? null : "SAME_CONDITION_REQUIRED",
    input.samePack === true ? null : "SAME_PACK_REQUIRED",
    input.landedPriceComplete === true ? null : "LANDED_PRICE_REQUIRED",
    evidenceCurrent ? null : "CONFIRMED_SOLD_EVIDENCE_STALE",
  ].filter((code): code is string => code !== null)
  const businessBlockers = [
    input.supplierEvidenceFresh === true
      ? null : "FRESH_LUNA_EVIDENCE_REQUIRED",
    input.supplierAvailable === true ? null : "LUNA_AVAILABILITY_REQUIRED",
    input.proposalCurrent === true ? null : "PROPOSAL_EXPIRED",
    input.economicsApproved === true ? null : "ECONOMICS_APPROVAL_REQUIRED",
    input.proposedPriceAtOrAboveFloor === true
      ? null : "SAFE_PRICE_FLOOR_REQUIRED",
  ].filter((code): code is string => code !== null)
  const priceBlockers = [
    ...evidenceBlockers,
    ...businessBlockers,
    ...executionBlockers(input),
  ]
  const evidenceAndBusinessReady =
    evidenceBlockers.length === 0 && businessBlockers.length === 0
  const priceReady = priceBlockers.length === 0
  const promotionReady = priceReady && input.promotionEvidenceApproved === true
  return {
    decision: evidenceAndBusinessReady
      ? "EVALUATE_CONFIRMED_SOLD_PRICE"
      : "HOLD_PRICE_NO_PROMOTION",
    capability: priceReady ? "enabled"
      : evidenceAndBusinessReady ? "preview_only" : "blocked",
    canPreparePriceDecrease: priceReady,
    canPreparePromotion: promotionReady,
    canPrepareProtectivePriceIncrease: false,
    canEndForOutOfStock: false,
    blockerCodes: priceBlockers,
    policyVersion: EBAY_ACTIVE_LISTING_COMMERCIAL_POLICY_VERSION,
    evidenceClass: normalizedEvidenceClass,
    evidenceObservedAt: observedAt,
    evidenceExpiresAt,
  }
}
