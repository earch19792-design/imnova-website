export const EBAY_CORRECTED_PACKAGE_SAFE_RETRY_VERSION =
  "EBAY_CORRECTED_PACKAGE_SAFE_RETRY_V1" as const

export type CorrectedPackageRetryCurrentV1 = Readonly<{
  listingPackageId: string
  packageDigest: string
  ownerReviewConfirmed: boolean
  ownerReviewedPackageDigest: string
  publishAuthorizationReady: boolean
  target: string
  accountFingerprintPresent: boolean
  sku: string
  categoryId: string
  upcs: readonly string[]
  price: number | null
  quantity: number | null
  categoryPolicySafe: boolean
  missingRequiredIdentifiers: readonly string[]
}>

export type CorrectedPackageRetryHistoricalV1 = Readonly<{
  approvalId: string
  approvedPayloadHash: string
  listingPackageId: string
  packageDigest: string
  upcs: readonly string[]
  executionId: string
  executionPhase: string
  executionMarkedResolved: boolean
  offerId: string
  sku: string
  categoryId: string
  target: string
  accountFingerprintPresent: boolean
  publicationId: string
  publicationPhase: string
  publishHttpStatus: number | null
  publishAttemptCount: number
  lastErrorCode: string
  listingId: string | null
  ebayErrorId: string
  ebayErrorDomain: string
  ebayErrorCategory: string
}>

export type CorrectedPackageRetryOfficialV1 = Readonly<{
  readbackComplete: boolean
  inventoryItemExists: boolean
  currentInventoryMatches: boolean
  offerExists: boolean
  offerStatus: string
  offerUnpublished: boolean
  offerCount: number | null
  listingIdPresent: boolean
  listingActive: boolean
  exactActiveDuplicateCount: number | null
  exactActiveLookupComplete: boolean
}>

export type CorrectedPackageSafeRetryV1 = Readonly<{
  version: typeof EBAY_CORRECTED_PACKAGE_SAFE_RETRY_VERSION
  eligibleHistoricalFailure: boolean
  oldAttemptStatus: "FAILED_RESOLVED" | "FAILED_CURRENT" | "NOT_APPLICABLE"
  oldAttemptReason: "CATEGORY_94861_REQUIRED_UPC_MISSING" | null
  oldAttemptResolved: boolean
  oldAttemptBlocksCurrentCorrectedPackage: boolean
  currentFailureProjectedAsBlocker: boolean
  currentPackageMatch: boolean
  currentAuthorizationPackageMatch: boolean
  correctedInventoryItemUpdateRequired: boolean
  sameReservedSkuReused: boolean
  sameOfferReused: boolean
  upcWillBePresentBeforePublish: boolean
  offerRemainsUnpublishedBeforePublish: boolean
  publishClaimOneShot: true
  unknownExternalResultAutoRetry: false
  safeRetryReady: boolean
  publishCtaEnabled: boolean
  exactCurrentBlocker: string | null
}>

function validDigest(value: string) {
  return /^sha256:[0-9a-f]{64}$/.test(value)
}

function exactSingleUpc(values: readonly string[]) {
  return values.length === 1 && /^\d{12}$/.test(values[0] ?? "")
}

function exactHistoricalUpcFailure(
  current: Pick<CorrectedPackageRetryCurrentV1,
    | "listingPackageId"
    | "packageDigest"
    | "target"
    | "accountFingerprintPresent"
    | "sku"
    | "categoryId">,
  historical: CorrectedPackageRetryHistoricalV1 | null,
) {
  return Boolean(historical
    && historical.listingPackageId === current.listingPackageId
    && historical.sku === current.sku
    && historical.categoryId === "94861"
    && current.categoryId === historical.categoryId
    && historical.target === current.target
    && historical.accountFingerprintPresent
    && current.accountFingerprintPresent
    && (historical.executionPhase === "completed"
      || (historical.executionPhase === "terminal_failure"
        && historical.executionMarkedResolved))
    && historical.publicationPhase === "terminal_failure"
    && historical.publishHttpStatus === 400
    && historical.publishAttemptCount === 1
    && historical.lastErrorCode === "EBAY_PUBLISH_WRITE_REJECTED"
    && historical.listingId === null
    && historical.ebayErrorId === "25002"
    && historical.ebayErrorDomain === "API_INVENTORY"
    && historical.ebayErrorCategory === "Request"
    && historical.upcs.length === 0
    && validDigest(historical.packageDigest)
    && historical.packageDigest !== current.packageDigest
    && /^[A-Za-z0-9_-]{1,80}$/.test(historical.offerId))
}

/**
 * The generic SKU-collision guard must ignore the prior ledger only for the
 * exact, already-certified UPC correction lineage. This merely permits the
 * route to reach its full official readback and retry classifier; it does not
 * authorize a claim or any marketplace write.
 */
export function correctedPackageRetryLedgerExclusionApprovalIdV1(input:
  Readonly<{
    current: Pick<CorrectedPackageRetryCurrentV1,
      | "listingPackageId"
      | "packageDigest"
      | "target"
      | "accountFingerprintPresent"
      | "sku"
      | "categoryId"
      | "upcs">
    historical: CorrectedPackageRetryHistoricalV1 | null
    historicalSelfLineageExact: boolean
  }>) {
  if (
    !input.historicalSelfLineageExact
    || input.current.target !== "PRODUCTION"
    || !validDigest(input.current.packageDigest)
    || !exactSingleUpc(input.current.upcs)
    || !exactHistoricalUpcFailure(input.current, input.historical)
  ) return null
  return input.historical?.approvalId ?? null
}

export function classifyCorrectedPackageSafeRetryV1(input: Readonly<{
  current: CorrectedPackageRetryCurrentV1
  historical: CorrectedPackageRetryHistoricalV1 | null
  official: CorrectedPackageRetryOfficialV1 | null
}>): CorrectedPackageSafeRetryV1 {
  const current = input.current
  const historical = input.historical
  const official = input.official
  const currentPackageMatch = Boolean(
    current.ownerReviewConfirmed
    && validDigest(current.packageDigest)
    && current.ownerReviewedPackageDigest === current.packageDigest,
  )
  const currentAuthorizationPackageMatch = Boolean(
    currentPackageMatch && current.publishAuthorizationReady,
  )
  const eligibleHistoricalFailure = exactHistoricalUpcFailure(
    current,
    historical,
  )
  const currentUpcReady = exactSingleUpc(current.upcs)
    && current.categoryPolicySafe
    && current.missingRequiredIdentifiers.length === 0
  const officialSafe = Boolean(official
    && official.readbackComplete
    && official.inventoryItemExists
    && official.offerExists
    && official.offerUnpublished
    && official.offerStatus === "UNPUBLISHED"
    && official.offerCount === 1
    && !official.listingIdPresent
    && !official.listingActive
    && official.exactActiveLookupComplete
    && official.exactActiveDuplicateCount === 0)
  const sameReservedSkuReused = Boolean(eligibleHistoricalFailure
    && historical?.sku === current.sku)
  const sameOfferReused = Boolean(officialSafe && historical?.offerId)
  const safeRetryReady = Boolean(
    eligibleHistoricalFailure
    && currentAuthorizationPackageMatch
    && current.target === "PRODUCTION"
    && currentUpcReady
    && Number.isFinite(current.price)
    && Number(current.price) > 0
    && current.quantity === 1
    && officialSafe
    && sameReservedSkuReused
    && sameOfferReused,
  )

  let exactCurrentBlocker: string | null = null
  if (!eligibleHistoricalFailure) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_PRIOR_UPC_FAILURE_NOT_PROVEN"
  } else if (!currentPackageMatch) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_OWNER_CONFIRMATION_MISMATCH"
  } else if (!currentAuthorizationPackageMatch) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_PUBLISH_AUTHORIZATION_REQUIRED"
  } else if (!currentUpcReady) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_UPC_PREFLIGHT_NOT_READY"
  } else if (!Number.isFinite(current.price)
    || Number(current.price) <= 0 || current.quantity !== 1) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_COMMERCIAL_INTENT_CHANGED"
  } else if (!official) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_OFFICIAL_READBACK_REQUIRED"
  } else if (!officialSafe) {
    exactCurrentBlocker = "EBAY_CORRECTED_PACKAGE_UNPUBLISHED_OFFER_READBACK_MISMATCH"
  }

  return Object.freeze({
    version: EBAY_CORRECTED_PACKAGE_SAFE_RETRY_VERSION,
    eligibleHistoricalFailure,
    oldAttemptStatus: !eligibleHistoricalFailure
      ? "NOT_APPLICABLE"
      : safeRetryReady ? "FAILED_RESOLVED" : "FAILED_CURRENT",
    oldAttemptReason: eligibleHistoricalFailure
      ? "CATEGORY_94861_REQUIRED_UPC_MISSING" : null,
    oldAttemptResolved: safeRetryReady,
    oldAttemptBlocksCurrentCorrectedPackage:
      eligibleHistoricalFailure && !safeRetryReady,
    currentFailureProjectedAsBlocker:
      eligibleHistoricalFailure && !safeRetryReady,
    currentPackageMatch,
    currentAuthorizationPackageMatch,
    correctedInventoryItemUpdateRequired:
      Boolean(official?.inventoryItemExists && !official.currentInventoryMatches),
    sameReservedSkuReused,
    sameOfferReused,
    upcWillBePresentBeforePublish: safeRetryReady,
    offerRemainsUnpublishedBeforePublish: officialSafe,
    publishClaimOneShot: true,
    unknownExternalResultAutoRetry: false,
    safeRetryReady,
    publishCtaEnabled: safeRetryReady,
    exactCurrentBlocker,
  })
}
