import assert from "node:assert/strict"
import test from "node:test"

import {
  draftOnlyPrewriteFailureResolvedV1,
  parseDraftOnlyPrewriteAuthorizationCorrelationV1,
  parseDraftOnlyPrewriteFailureV1,
} from "./ebay-draft-only-prewrite-correlation-v1.ts"

const packageId = "6beea08c-95b1-48ff-95ac-7634db288048"
const authorizationId = "d099d3da-59c6-44c0-833c-daf3728ae5c8"
const digest = `sha256:${"a".repeat(64)}`

function failure() {
  return parseDraftOnlyPrewriteFailureV1({
    version: "EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_V1",
    requestId: `one-click:${packageId}:failed`,
    observedAt: "2026-09-02T05:00:46.758Z",
    listingPackageId: packageId,
    packageDigest: digest,
    authorizationId,
    priorAuthorizationId: authorizationId,
    attemptId: null,
    httpStatus: 409,
    errorCode: "EBAY_DRAFT_ONLY_BLOCKED",
    blockers: ["SKU_COLLISION"],
  })
}

test("current 409 is not historical merely because GET readiness is ready", () => {
  assert.ok(failure())
  assert.equal(draftOnlyPrewriteFailureResolvedV1({
    failure: failure(),
    success: parseDraftOnlyPrewriteAuthorizationCorrelationV1({
      version: "EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_V1",
      requestId: `one-click:${packageId}:same-request`,
      observedAt: "2026-09-02T05:00:45.000Z",
      listingPackageId: packageId,
      packageDigest: digest,
      authorizationId,
      priorAuthorizationId: authorizationId,
      attemptId: null,
    }),
  }), false)
})

test("a later correlated authorization archives the resolved 409", () => {
  const resolved = parseDraftOnlyPrewriteAuthorizationCorrelationV1({
    version: "EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_V1",
    requestId: `one-click:${packageId}:success`,
    observedAt: "2026-09-02T05:02:00.000Z",
    listingPackageId: packageId,
    packageDigest: digest,
    authorizationId,
    priorAuthorizationId: authorizationId,
    attemptId: null,
  })
  assert.ok(resolved)
  assert.equal(draftOnlyPrewriteFailureResolvedV1({
    failure: failure(),
    success: resolved,
  }), true)
})

test("different digest or authorization remains a current failure", () => {
  const resolved = parseDraftOnlyPrewriteAuthorizationCorrelationV1({
    version: "EBAY_DRAFT_ONLY_PREWRITE_CORRELATION_V1",
    requestId: `one-click:${packageId}:success`,
    observedAt: "2026-09-02T05:02:00.000Z",
    listingPackageId: packageId,
    packageDigest: `sha256:${"b".repeat(64)}`,
    authorizationId: "11111111-1111-4111-8111-111111111111",
    priorAuthorizationId: "11111111-1111-4111-8111-111111111111",
    attemptId: null,
  })
  assert.ok(resolved)
  assert.equal(draftOnlyPrewriteFailureResolvedV1({
    failure: failure(),
    success: resolved,
  }), false)
})
