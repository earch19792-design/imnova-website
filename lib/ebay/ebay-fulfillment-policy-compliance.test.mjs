import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateEbayFulfillmentWrittenConsent,
  evaluateEbayProductApprovalFulfillmentBasis,
  normalizeEbayCompliantFulfillmentBasis,
} from "./ebay-fulfillment-policy-compliance.ts"

test("product approval accepts only owned inventory or an authorized wholesale agreement", () => {
  assert.equal(
    normalizeEbayCompliantFulfillmentBasis("OWNED_INVENTORY"),
    "OWNED_INVENTORY",
  )
  assert.equal(
    normalizeEbayCompliantFulfillmentBasis(
      "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT",
    ),
    "AUTHORIZED_WHOLESALE_FULFILLMENT_AGREEMENT",
  )
  assert.equal(
    normalizeEbayCompliantFulfillmentBasis("BUY_AFTER_SALE_FROM_RETAILER"),
    null,
  )
})

test("REJECT needs no fulfillment basis while APPROVE is blocked without one", () => {
  assert.deepEqual(
    evaluateEbayProductApprovalFulfillmentBasis("REJECT", null),
    { allowed: true, basis: null },
  )
  assert.deepEqual(
    evaluateEbayProductApprovalFulfillmentBasis("APPROVE", null),
    { allowed: false, basis: null },
  )
  assert.deepEqual(
    evaluateEbayProductApprovalFulfillmentBasis(
      "APPROVE",
      "OWNED_INVENTORY",
    ),
    { allowed: true, basis: "OWNED_INVENTORY" },
  )
})

test("tracking stays manual unless a server flag and a canonical reference hash are both present", () => {
  const absent = evaluateEbayFulfillmentWrittenConsent({})
  assert.equal(absent.ready, false)
  assert.equal(absent.readiness, "MANUAL_SELLER_HUB_TRACKING_REQUIRED")

  const flagOnly = evaluateEbayFulfillmentWrittenConsent({
    EBAY_FULFILLMENT_WRITTEN_CONSENT_ENABLED: "true",
  })
  assert.equal(flagOnly.ready, false)
  assert.equal(flagOnly.readiness, "MANUAL_SELLER_HUB_TRACKING_REQUIRED")

  const ready = evaluateEbayFulfillmentWrittenConsent({
    EBAY_FULFILLMENT_WRITTEN_CONSENT_ENABLED: "true",
    EBAY_FULFILLMENT_WRITTEN_CONSENT_REFERENCE_HASH:
      `sha256:${"a".repeat(64)}`,
  })
  assert.equal(ready.ready, true)
  assert.equal(ready.readiness, "WRITTEN_CONSENT_REFERENCE_RECORDED")
  assert.equal(ready.documentsStored, false)
  assert.equal(ready.piiStored, false)
})
