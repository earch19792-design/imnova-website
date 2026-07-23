import assert from "node:assert/strict"
import test from "node:test"

import {
  resolveCommandCenterCommercialFreshness,
} from "./ebay-command-center-commercial-freshness.ts"

test("final V3 workspace hydration suppresses the legacy same-day source recheck gate", () => {
  const resolution = resolveCommandCenterCommercialFreshness({
    errorCode: "SAME_DAY_PUBLICATION_PACKAGE_NOT_READY",
    finalListingReviewAllowed: true,
    sourceRecheckAvailable: true,
  })
  assert.equal(resolution.finalListingReviewReady, true)
  assert.equal(resolution.sourceRecheckRequired, false)
})

test("legacy commercial freshness still requires source recheck when final V3 is not ready", () => {
  const resolution = resolveCommandCenterCommercialFreshness({
    errorCode: "SAME_DAY_PUBLICATION_LUNA_RECHECK_REQUIRED",
    finalListingReviewAllowed: false,
    sourceRecheckAvailable: true,
  })
  assert.equal(resolution.finalListingReviewReady, false)
  assert.equal(resolution.sourceRecheckRequired, true)
})
