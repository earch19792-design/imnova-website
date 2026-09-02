import type { JsonRecord } from "./ebay-draft-only-readiness"

export const EBAY_COMPENSATED_OFFER_FRESH_READ_VERSION =
  "ITEM3525_COMPENSATED_OFFER_FRESH_READ_GATE_V1" as const

export const EBAY_COMPENSATED_PUBLICATION_RECOVERY_ERROR_CODES =
  Object.freeze([
    "EBAY_FINAL_PUBLICATION_MONITOR_PERSIST_FAILED",
    "EBAY_FINAL_PUBLICATION_LUNA_LINEAGE_HANDOFF_FAILED",
  ] as const)

export function isCompensatedPublicationRecoveryErrorCodeV1(
  value: unknown,
) {
  return EBAY_COMPENSATED_PUBLICATION_RECOVERY_ERROR_CODES.includes(
    text(value) as typeof EBAY_COMPENSATED_PUBLICATION_RECOVERY_ERROR_CODES[number],
  )
}

export type CompensatedOfferFreshReadEligibilityV1 = Readonly<{
  eligible: boolean
  reasonCode: string
  verifierExecuted: boolean
}>

export type CompensatedOfferFreshReadResultV1 = Readonly<{
  CONTRACT_VERSION: typeof EBAY_COMPENSATED_OFFER_FRESH_READ_VERSION
  OFFER_DISCOVERY_COUNT: number | null
  OFFER_ID: string | null
  OFFER_STATUS: string
  OFFER_HAS_LISTING: boolean | null
  ASSOCIATED_LISTING_ID: string | null
  INVENTORY_ITEM_READBACK_STATUS: "PASS_EXACT_MATCH" | "BLOCKED"
  HISTORICAL_ITEM_STATUS: "NOT_ACTIVE" | "ACTIVE" | "BLOCKED"
  ACTIVE_DUPLICATE_COUNT: number | null
  RECOVERY_SAFETY_CLASSIFICATION:
    | "SAFE_TO_REARM_EXISTING_GOLDEN_PATH"
    | "BLOCKED"
  BLOCKER: string | null
  OBSERVED_AT: string
  MARKETPLACE_WRITES: 0
  DATABASE_MUTATIONS: 0
  REARM_CALLS: 0
  NEW_OFFERS: 0
  PUBLISH_CALLS: 0
  WITHDRAW_CALLS: 0
}>

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function nonnegativeInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

function listingId(value: unknown) {
  const parsed = text(value)
  return /^\d{9,20}$/.test(parsed) ? parsed : null
}

function offerIdentifier(value: unknown) {
  const parsed = text(value)
  return /^[A-Za-z0-9_-]{1,80}$/.test(parsed) ? parsed : null
}

export function classifyCompensatedOfferFreshReadEligibilityV1(input: {
  approval: unknown
  execution: unknown
  publication: unknown
}): CompensatedOfferFreshReadEligibilityV1 {
  const approval = record(input.approval)
  const execution = record(input.execution)
  const publication = record(input.publication)
  const sanitized = record(publication.sanitized_result)
  const approvalId = text(approval.id)
  const executionId = text(execution.id)
  let reasonCode = "COMPENSATED_OFFER_FRESH_READ_REQUIRED"

  if (text(approval.status).toLowerCase() !== "consumed") {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_APPROVAL_NOT_CONSUMED"
  } else if (text(approval.revoked_at)) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_APPROVAL_REVOKED"
  } else if (
    !approvalId
    || text(execution.approval_id) !== approvalId
    || text(publication.draft_approval_id) !== approvalId
  ) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_APPROVAL_IDENTITY_MISMATCH"
  } else if (text(execution.phase).toLowerCase() !== "completed") {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_EXECUTION_NOT_COMPLETED"
  } else if (
    !executionId
    || text(publication.draft_execution_id) !== executionId
  ) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_EXECUTION_IDENTITY_MISMATCH"
  } else if (!offerIdentifier(execution.offer_id)) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_OFFER_ID_REQUIRED"
  } else if (text(publication.phase).toLowerCase() !== "terminal_failure") {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_NOT_TERMINAL_FAILURE"
  } else if (!isCompensatedPublicationRecoveryErrorCodeV1(
    publication.last_error_code,
  )) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_ERROR_CODE_NOT_ELIGIBLE"
  } else if (!listingId(publication.listing_id)) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_HISTORICAL_ITEM_ID_REQUIRED"
  } else if (text(publication.offer_id) !== text(execution.offer_id)) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_OFFER_ID_MISMATCH"
  } else if (
    !text(execution.sku)
    || text(publication.sku) !== text(execution.sku)
  ) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_SKU_MISMATCH"
  } else if (Number(publication.publish_attempt_count) !== 1) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_PUBLISH_ATTEMPT_INVALID"
  } else if (
    !text(approval.payload_hash)
    || text(approval.payload_hash) !== text(execution.request_hash)
  ) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_AUTHORIZED_HASH_MISMATCH"
  } else if (sanitized.compensatingEndVerified !== true) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_COMPENSATION_NOT_VERIFIED"
  } else if (sanitized.officialReadbackNotCurrentLive !== true) {
    reasonCode = "COMPENSATED_OFFER_FRESH_READ_HISTORICAL_ITEM_NOT_INACTIVE"
  }

  return Object.freeze({
    eligible: reasonCode === "COMPENSATED_OFFER_FRESH_READ_REQUIRED",
    reasonCode,
    verifierExecuted: false,
  })
}

export async function executeCompensatedOfferFreshReadGateV1<T>(input: {
  approval: unknown
  execution: unknown
  publication: unknown
  verifier: () => Promise<T>
}): Promise<Readonly<{
  eligibility: CompensatedOfferFreshReadEligibilityV1
  compensatedOfferFreshRead: T | null
}>> {
  const eligibility = classifyCompensatedOfferFreshReadEligibilityV1(input)
  if (!eligibility.eligible) {
    return Object.freeze({
      eligibility,
      compensatedOfferFreshRead: null,
    })
  }
  const compensatedOfferFreshRead = await input.verifier()
  return Object.freeze({
    eligibility: Object.freeze({
      ...eligibility,
      verifierExecuted: true,
    }),
    compensatedOfferFreshRead,
  })
}

export function classifyCompensatedOfferFreshReadV1(input: {
  expectedOfferId: string
  expectedSku: string
  expectedHistoricalItemId: string
  offerVerification: unknown
  inventoryVerification: unknown
  historicalItemReadback: unknown
  activeDuplicateCount: unknown
  observedAt?: Date
}): CompensatedOfferFreshReadResultV1 {
  const offer = record(input.offerVerification)
  const inventory = record(input.inventoryVerification)
  const historical = record(input.historicalItemReadback)
  const expectedOfferId = offerIdentifier(input.expectedOfferId)
  const expectedHistoricalItemId = listingId(input.expectedHistoricalItemId)
  const expectedSku = text(input.expectedSku)
  const offerDiscoveryCount = nonnegativeInteger(offer.offerDiscoveryCount)
  const returnedOfferId = offerIdentifier(offer.offerId)
  const offerStatus = text(offer.status).toUpperCase() || "UNKNOWN"
  const offerHasListing = typeof offer.offerHasListing === "boolean"
    ? offer.offerHasListing
    : null
  const associatedListingId = listingId(offer.associatedListingId)
  const activeDuplicateCount = nonnegativeInteger(input.activeDuplicateCount)
  const inventoryExact = inventory.safe === true
  const historicalStatus = text(historical.listingStatus).toUpperCase()
  const historicalExactInactive = historical.ownership === "inactive"
    && listingId(historical.itemId) === expectedHistoricalItemId
    && text(historical.ebaySku) === expectedSku
    && historicalStatus !== "ACTIVE"
  const offerAssociationCompatible =
    (offerHasListing === false && associatedListingId === null)
    || (offerHasListing === true
      && associatedListingId === expectedHistoricalItemId)

  let blocker: string | null = null
  if (!expectedOfferId || !expectedHistoricalItemId || !expectedSku) {
    blocker = "EBAY_COMPENSATED_PUBLICATION_RECOVERY_IDENTITY_INVALID"
  } else if (!Object.keys(offer).length) {
    blocker = "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_READ_FAILED"
  } else if (
    offer.safe !== true
    || offerDiscoveryCount !== 1
    || returnedOfferId !== expectedOfferId
    || offerStatus !== "UNPUBLISHED"
    || !offerAssociationCompatible
  ) {
    blocker = text(offer.blocker)
      || "EBAY_COMPENSATED_PUBLICATION_RECOVERY_OFFER_NOT_UNPUBLISHED"
  } else if (!inventoryExact) {
    blocker = text(inventory.blocker)
      || "EBAY_FINAL_PUBLICATION_INVENTORY_EXACT_READBACK_MISMATCH"
  } else if (!historicalExactInactive) {
    blocker = historicalStatus === "ACTIVE"
      ? "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_LISTING_STILL_ACTIVE"
      : "EBAY_COMPENSATED_PUBLICATION_ORIGINAL_IDENTITY_MISMATCH"
  } else if (activeDuplicateCount === null) {
    blocker = "EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE_READ_FAILED"
  } else if (activeDuplicateCount !== 0) {
    blocker = "EBAY_COMPENSATED_PUBLICATION_ACTIVE_DUPLICATE"
  }

  return Object.freeze({
    CONTRACT_VERSION: EBAY_COMPENSATED_OFFER_FRESH_READ_VERSION,
    OFFER_DISCOVERY_COUNT: offerDiscoveryCount,
    OFFER_ID: returnedOfferId ?? expectedOfferId,
    OFFER_STATUS: offerStatus,
    OFFER_HAS_LISTING: offerHasListing,
    ASSOCIATED_LISTING_ID: associatedListingId,
    INVENTORY_ITEM_READBACK_STATUS: inventoryExact
      ? "PASS_EXACT_MATCH" : "BLOCKED",
    HISTORICAL_ITEM_STATUS: historicalExactInactive
      ? "NOT_ACTIVE"
      : historicalStatus === "ACTIVE" ? "ACTIVE" : "BLOCKED",
    ACTIVE_DUPLICATE_COUNT: activeDuplicateCount,
    RECOVERY_SAFETY_CLASSIFICATION: blocker
      ? "BLOCKED"
      : "SAFE_TO_REARM_EXISTING_GOLDEN_PATH",
    BLOCKER: blocker,
    OBSERVED_AT: (input.observedAt ?? new Date()).toISOString(),
    MARKETPLACE_WRITES: 0,
    DATABASE_MUTATIONS: 0,
    REARM_CALLS: 0,
    NEW_OFFERS: 0,
    PUBLISH_CALLS: 0,
    WITHDRAW_CALLS: 0,
  })
}
