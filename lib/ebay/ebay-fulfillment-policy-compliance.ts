export const EBAY_COMPLIANT_FULFILLMENT_BASES = [
  "OWNED_INVENTORY",
  "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT",
] as const

export type EbayCompliantFulfillmentBasis =
  typeof EBAY_COMPLIANT_FULFILLMENT_BASES[number]

const compliantFulfillmentBases = new Set<string>(
  EBAY_COMPLIANT_FULFILLMENT_BASES,
)

export function normalizeEbayCompliantFulfillmentBasis(
  value: unknown,
): EbayCompliantFulfillmentBasis | null {
  const normalized = typeof value === "string" ? value.trim() : ""
  return compliantFulfillmentBases.has(normalized)
    ? normalized as EbayCompliantFulfillmentBasis
    : null
}

export function evaluateEbayProductApprovalFulfillmentBasis(
  decision: unknown,
  value: unknown,
) {
  if (decision === "REJECT") {
    return { allowed: true as const, basis: null }
  }
  const basis = normalizeEbayCompliantFulfillmentBasis(value)
  return basis
    ? { allowed: true as const, basis }
    : { allowed: false as const, basis: null }
}

export const EBAY_FULFILLMENT_WRITTEN_CONSENT_FLAG =
  "EBAY_FULFILLMENT_WRITTEN_CONSENT_ENABLED" as const

export const EBAY_FULFILLMENT_WRITTEN_CONSENT_REFERENCE_VARIABLE =
  "EBAY_FULFILLMENT_WRITTEN_CONSENT_REFERENCE_HASH" as const

export function evaluateEbayFulfillmentWrittenConsent(
  environment: NodeJS.ProcessEnv,
) {
  const enabled = environment[EBAY_FULFILLMENT_WRITTEN_CONSENT_FLAG]
    ?.trim().toLowerCase() === "true"
  const submitted = environment[
    EBAY_FULFILLMENT_WRITTEN_CONSENT_REFERENCE_VARIABLE
  ]?.trim().toLowerCase() ?? ""
  const referenceHash = /^sha256:[a-f0-9]{64}$/.test(submitted)
    ? submitted
    : null

  return {
    enabled,
    referenceHash,
    referenceHashPresent: Boolean(referenceHash),
    ready: enabled && Boolean(referenceHash),
    readiness: enabled && referenceHash
      ? "WRITTEN_CONSENT_REFERENCE_RECORDED" as const
      : "MANUAL_SELLER_HUB_TRACKING_REQUIRED" as const,
    documentsStored: false as const,
    piiStored: false as const,
  }
}
