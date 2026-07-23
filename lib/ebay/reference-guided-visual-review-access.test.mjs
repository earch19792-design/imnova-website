import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  v3FinalListingReviewCanonicalReady,
  v3PublicationAllowed,
  v3VisualReviewAccessible,
} from "./reference-guided-visual-review-access.ts"

test("V3 QA_PENDING remains reviewable with stale Luna cost while publication stays blocked", () => {
  const attemptId = "f166b395-8d3a-4921-b273-1a62a6032707"
  assert.equal(v3VisualReviewAccessible({
    strategyVersion: "VISUAL_STRATEGY_V3",
    revisionContract: "REFERENCE_GUIDED_PRODUCT_GENERATION_V1",
    attemptId,
  }), true)
  assert.equal(v3PublicationAllowed({
    visualReviewComplete: false,
    staleCostOrStock: true,
    commercialAuthorizationComplete: false,
  }), false)
})

test("canonical V3 final review hides legacy image blockers and enables a single resume state", () => {
  assert.equal(v3FinalListingReviewCanonicalReady({
    visualPhase: "COMPLETED",
    finalVisualSetLocked: true,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: true,
    signedImageCount: 7,
    primaryMainFirst: true,
  }), true)
  assert.equal(v3FinalListingReviewCanonicalReady({
    visualPhase: "COMPLETED",
    finalVisualSetLocked: true,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: true,
    signedImageCount: 6,
    primaryMainFirst: true,
  }), false)
})

test("the direct V3 review route and UI do not call commercial preparation", () => {
  const ui = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const route = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  assert.match(ui, /visualReviewRevisionId/)
  assert.match(ui, /v3VisualReviewAccessible/)
  assert.match(ui, /Revisión visual V3 · independiente de Luna/)
  assert.match(route, /visualReviewRevisionId/)
  assert.doesNotMatch(route, /visualReviewRevisionId[\s\S]{0,1200}prepare_package/)
  const visualReviewAction = route.slice(
    route.indexOf('action === "review_reference_guided_asset"'),
    route.indexOf('action === "prepare_visual_review"'),
  )
  assert.match(visualReviewAction, /commercialFieldsUpdated: false/)
  assert.doesNotMatch(visualReviewAction,
    /supplier_(?:price|cost|inventory)|confirmed_(?:price|quantity)|reconfirm/i)
})
