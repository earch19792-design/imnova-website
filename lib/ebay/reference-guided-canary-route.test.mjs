import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL("../../app/api/admin/ebay/images/reference-guided-canary/route.ts", import.meta.url), "utf8")

test("canary route is hard-bound to staging attempt, position one and service role", () => {
  assert.match(route, /f166b395-8d3a-4921-b273-1a62a6032707/)
  assert.match(route, /MATERIAL_AND_FINISH_DETAIL/)
  assert.match(route, /AUTHORIZED_POSITION = 1/)
  assert.match(route, /authenticationMode !== "service_role"/)
  assert.match(route, /VERCEL_ENV !== "preview"/)
  assert.match(route, /vsfthqydfrdzulldbfbe/)
  assert.match(route, /feature\/centralize-ebay-mobile-command-center/)
})

test("canary route reserves once before one exact Images Edit request", () => {
  const reserve = route.indexOf("reserve_ebay_reference_guided_canary_call")
  const request = route.lastIndexOf("runReferenceGuidedGenerationCanary({")
  assert.ok(reserve > -1 && request > reserve)
  assert.match(route, /providerFetches \+= 1/)
  assert.match(route, /providerFetches !== 1/)
  assert.match(route, /https:\/\/api\.openai\.com\/v1\/images\/edits/)
  assert.doesNotMatch(route, /Retry-After|setTimeout|for \(let attempt/)
})

test("canary output remains private and cannot auto-approve or publish", () => {
  assert.match(route, /stagingBucket\.public !== false/)
  assert.match(route, /EBAY_IMAGE_STAGING_BUCKET/)
  assert.match(route, /status: "QA_PENDING"/)
  assert.match(route, /humanApprovalRequired: true/)
  assert.match(route, /autoApproved: false/)
  assert.match(route, /publicationAuthorized: false/)
  assert.match(route, /automaticRetryOccurred: false/)
  assert.match(route, /ebayWrites: 0/)
  assert.match(route, /productionChanged: false/)
})

test("semantic identity QA is fail-closed for human visual confirmation", () => {
  for (const check of ["sameWhiteColor", "sameHandles", "sameRim",
    "samePerforations", "sameBaseAndProportions", "noAddedTextOrLogos",
    "noAccessoriesPresentedAsIncluded"]) {
    assert.match(route, new RegExp(`${check}: "REQUIRES_HUMAN_CONFIRMATION"`))
  }
  assert.match(route, /automaticStatus: "PARTIAL"/)
})
