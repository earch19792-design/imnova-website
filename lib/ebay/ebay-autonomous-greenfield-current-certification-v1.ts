type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : {}
}

const READY_FACTORY_STAGES = Object.freeze([
  "PRODUCT_TRUTH_READY",
  "ECONOMICS_READY",
  "LISTING_PACKAGE_READY",
  "LISTING_READY",
])

/**
 * The durable factory deliberately stops an already-created CURRENT package at
 * CURRENT_PUBLICATION_CERTIFICATION_REQUIRED. That is a continuation boundary,
 * not a failed commercial gate. The autonomous lane may cross it only when all
 * upstream factory, Product Truth and marketplace authorities are already
 * CURRENT-ready. No product identity or commercial fact is synthesized here.
 */
export function autonomousGreenfieldCurrentCertificationReadyV1(
  value: unknown,
) {
  const candidate = record(value)
  if (candidate.listingReady === true) return true
  const blocker = candidate.reasonCode ?? candidate.firstBlocker
  const stages = record(candidate.stages ?? candidate.stageStatuses)
  return blocker === "CURRENT_PUBLICATION_CERTIFICATION_REQUIRED"
    && READY_FACTORY_STAGES.every((stage) => stages[stage] === "READY")
    && candidate.productTruthExactIdentityMatch === true
    && candidate.productTruthDurable === true
    && candidate.productTruthReadbackMatch === true
    && candidate.canonicalMarketplaceReadinessReady === true
    && candidate.requiredItemSpecificsReady === true
    && candidate.listingPolicyReady === true
    && candidate.locationOrInventoryContextReady === true
    && candidate.sellerAccountBindingReady === true
    && candidate.marketplaceIdentityReady === true
}
