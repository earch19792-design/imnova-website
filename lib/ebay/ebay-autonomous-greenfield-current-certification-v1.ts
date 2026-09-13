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

export const CURRENT_PREPUBLICATION_CONTINUATION_REQUIRED =
  "CURRENT_PREPUBLICATION_CONTINUATION_REQUIRED" as const

/**
 * The durable factory deliberately stops an already-created CURRENT package at
 * CURRENT_PREPUBLICATION_CONTINUATION_REQUIRED. That is preparation
 * eligibility, not publication certification and not a failed commercial
 * gate. The autonomous lane may cross it only when all upstream factory,
 * Product Truth and marketplace authorities are already CURRENT-ready. No
 * product identity or commercial fact is synthesized here.
 */
export function autonomousGreenfieldCurrentPreparationReadyV1(
  value: unknown,
) {
  const candidate = record(value)
  if (candidate.listingReady === true) return true
  const blocker = candidate.reasonCode ?? candidate.firstBlocker
  const stages = record(candidate.stages ?? candidate.stageStatuses)
  return blocker === CURRENT_PREPUBLICATION_CONTINUATION_REQUIRED
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


/** Compatibility export for callers outside the autonomous stocking lane.
 * This is preparation eligibility, never the durable publication
 * certification. The latter is produced by certifyCurrentPrepublicationV1. */
export const autonomousGreenfieldCurrentCertificationReadyV1 =
  autonomousGreenfieldCurrentPreparationReadyV1
