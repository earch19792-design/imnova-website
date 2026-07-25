import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  inspectRejectedCategoryRepair,
} from "./ebay-rejected-category-repair.ts"

const eligiblePublication = {
  phase: "terminal_failure",
  publish_http_status: 400,
  last_error_code: "EBAY_PUBLISH_WRITE_REJECTED",
  listing_id: null,
  publish_attempt_count: 1,
  publish_recovery_count: 0,
  preview: { offerPayload: { categoryId: "177702" } },
  sanitized_result: {
    details: {
      errors: [{ errorId: "25005", domain: "API_INVENTORY" }],
    },
  },
}

test("only the exact rejected invalid-category incident is repairable", () => {
  assert.deepEqual(inspectRejectedCategoryRepair(eligiblePublication), {
    eligible: true,
    errorId: "25005",
    oldCategoryId: "177702",
    reason: null,
  })
  assert.equal(inspectRejectedCategoryRepair({
    ...eligiblePublication,
    listing_id: "123456789012",
  }).eligible, false)
  assert.equal(inspectRejectedCategoryRepair({
    ...eligiblePublication,
    sanitized_result: { details: { errors: [{ errorId: "99999" }] } },
  }).eligible, false)
  assert.equal(inspectRejectedCategoryRepair({
    ...eligiblePublication,
    publish_recovery_count: 1,
  }).eligible, true)
  assert.equal(inspectRejectedCategoryRepair({
    ...eligiblePublication,
    publish_recovery_count: 2,
  }).eligible, false)
})

test("gateway permits one category-only offer PUT and still forbids publish", () => {
  const gateway = readFileSync(
    "lib/ebay/ebay-draft-only-gateway.ts",
    "utf8",
  )
  assert.match(
    gateway,
    /updateEbayRejectedCategoryOnUnpublishedOfferOnce/,
  )
  assert.match(gateway, /categoryOnlyOfferReplacement/)
  assert.match(gateway, /method === "PUT"[\s\S]*inventory\/v1\/offer/)
  assert.match(gateway, /publishRequestSent: false/)
  assert.match(gateway, /EBAY_DRAFT_ONLY_PUBLISH_FORBIDDEN/)
  assert.doesNotMatch(
    gateway.slice(
      gateway.indexOf(
        "export async function updateEbayRejectedCategoryOnUnpublishedOfferOnce",
      ),
      gateway.indexOf(
        "export async function discoverEbayUnpublishedOfferBySku",
      ),
    ),
    /\/publish[`"]/,
  )
})

test("taxonomy application token prefers the complete dedicated pair", () => {
  const gateway = readFileSync(
    "lib/ebay/ebay-seller-keyword-demand-gateway.ts",
    "utf8",
  )
  assert.match(
    gateway,
    /const clientId = dedicatedComplete \? dedicatedClientId : genericClientId/,
  )
  assert.match(
    gateway,
    /const clientSecret = dedicatedComplete[\s\S]*genericClientSecret/,
  )
  assert.match(gateway, /Never combine one value from each family/)
})
