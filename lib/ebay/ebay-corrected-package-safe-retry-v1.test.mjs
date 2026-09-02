import assert from "node:assert/strict"
import test from "node:test"

import {
  classifyCorrectedPackageSafeRetryV1,
} from "./ebay-corrected-package-safe-retry-v1.ts"

const digest = (character) => `sha256:${character.repeat(64)}`

function fixture() {
  return {
    current: {
      listingPackageId: "6beea08c-95b1-48ff-95ac-7634db288048",
      packageDigest: digest("a"),
      ownerReviewConfirmed: true,
      ownerReviewedPackageDigest: digest("a"),
      publishAuthorizationReady: true,
      target: "PRODUCTION",
      accountFingerprintPresent: true,
      sku: "IMNOVA6BEEA08C95B148FF95AC7634DB288048",
      categoryId: "94861",
      upcs: ["740134033771"],
      price: 56.99,
      quantity: 1,
      categoryPolicySafe: true,
      missingRequiredIdentifiers: [],
    },
    historical: {
      approvalId: "3a279cba-5e56-49b1-b1c6-b19cc3d5456b",
      approvedPayloadHash: "e".repeat(64),
      listingPackageId: "6beea08c-95b1-48ff-95ac-7634db288048",
      packageDigest: digest("b"),
      upcs: [],
      executionId: "66465229-5852-4f11-9b8c-c2654aa2db8a",
      executionPhase: "completed",
      executionMarkedResolved: false,
      offerId: "252493879011",
      sku: "IMNOVA6BEEA08C95B148FF95AC7634DB288048",
      categoryId: "94861",
      target: "PRODUCTION",
      accountFingerprintPresent: true,
      publicationId: "ccf78e88-3178-455f-85d6-05cd4340142d",
      publicationPhase: "terminal_failure",
      publishHttpStatus: 400,
      publishAttemptCount: 1,
      lastErrorCode: "EBAY_PUBLISH_WRITE_REJECTED",
      listingId: null,
      ebayErrorId: "25002",
      ebayErrorDomain: "API_INVENTORY",
      ebayErrorCategory: "Request",
    },
    official: {
      readbackComplete: true,
      inventoryItemExists: true,
      currentInventoryMatches: false,
      offerExists: true,
      offerStatus: "UNPUBLISHED",
      offerUnpublished: true,
      offerCount: 1,
      listingIdPresent: false,
      listingActive: false,
      exactActiveDuplicateCount: 0,
      exactActiveLookupComplete: true,
    },
  }
}

test("corrected UPC package may safely reuse the exact unpublished Offer", () => {
  const result = classifyCorrectedPackageSafeRetryV1(fixture())
  assert.equal(result.oldAttemptStatus, "FAILED_RESOLVED")
  assert.equal(result.oldAttemptResolved, true)
  assert.equal(result.oldAttemptBlocksCurrentCorrectedPackage, false)
  assert.equal(result.currentFailureProjectedAsBlocker, false)
  assert.equal(result.currentPackageMatch, true)
  assert.equal(result.currentAuthorizationPackageMatch, true)
  assert.equal(result.correctedInventoryItemUpdateRequired, true)
  assert.equal(result.sameReservedSkuReused, true)
  assert.equal(result.sameOfferReused, true)
  assert.equal(result.upcWillBePresentBeforePublish, true)
  assert.equal(result.safeRetryReady, true)
  assert.equal(result.publishCtaEnabled, true)
  assert.equal(result.exactCurrentBlocker, null)
})

test("official readback remains mandatory and fail closed", () => {
  const input = fixture()
  const result = classifyCorrectedPackageSafeRetryV1({
    ...input,
    official: null,
  })
  assert.equal(result.oldAttemptResolved, false)
  assert.equal(result.safeRetryReady, false)
  assert.equal(
    result.exactCurrentBlocker,
    "EBAY_CORRECTED_PACKAGE_OFFICIAL_READBACK_REQUIRED",
  )
})

test("an active exact listing can never be rearmed", () => {
  const input = fixture()
  const result = classifyCorrectedPackageSafeRetryV1({
    ...input,
    official: {
      ...input.official,
      listingIdPresent: true,
      listingActive: true,
      exactActiveDuplicateCount: 1,
    },
  })
  assert.equal(result.safeRetryReady, false)
  assert.equal(result.publishCtaEnabled, false)
  assert.equal(
    result.exactCurrentBlocker,
    "EBAY_CORRECTED_PACKAGE_UNPUBLISHED_OFFER_READBACK_MISMATCH",
  )
})

test("a historical failure other than the exact UPC 25002 remains terminal", () => {
  const input = fixture()
  const result = classifyCorrectedPackageSafeRetryV1({
    ...input,
    historical: { ...input.historical, ebayErrorId: "25001" },
  })
  assert.equal(result.eligibleHistoricalFailure, false)
  assert.equal(result.safeRetryReady, false)
  assert.equal(result.oldAttemptStatus, "NOT_APPLICABLE")
})
