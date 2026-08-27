import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  V3_FINAL_ASSET_ROLES,
  canonicalWorkspacePreparationBlockers,
  v3FinalListingReviewCanonicalReady,
  v3PublicationAllowed,
  v3VisualReviewAccessible,
  visibleWorkspaceBlockers,
} from "./reference-guided-visual-review-access.ts"

test("ITEM3525 opportunity validation stays passed while the separate image gate remains explicit", () => {
  assert.deepEqual(canonicalWorkspacePreparationBlockers({
    title: "11 in Revolving Plastic Cake Turntable Non-Slip Base Decorating Stand",
    categoryId: "183335",
    description: "Single 11-inch revolving plastic cake turntable.",
    imageUrls: [],
    targetPrice: 25.99,
    hardGates: [
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ],
    evidenceGuards: [],
    resolvedHardGates: new Set([
      "NEED_EBAY_TAXONOMY_CATEGORY",
      "NEED_REQUIRED_EBAY_ITEM_ASPECTS",
    ]),
  }), ["NEED_AUTHORIZED_PRODUCT_IMAGES"])
})

test("workspace preparation uses canonical field codes and preserves real guards", () => {
  assert.deepEqual(canonicalWorkspacePreparationBlockers({
    title: "",
    categoryId: "",
    description: "",
    imageUrls: [],
    targetPrice: null,
    hardGates: ["REAL_COMMERCIAL_GATE"],
    evidenceGuards: ["REAL_EVIDENCE_GUARD"],
    resolvedHardGates: new Set(),
  }), [
    "TITLE_REQUIRED",
    "CATEGORY_REQUIRED",
    "DESCRIPTION_REQUIRED",
    "IMAGE_REQUIRED",
    "PRICE_REQUIRED",
    "REAL_COMMERCIAL_GATE",
    "REAL_EVIDENCE_GUARD",
  ])
})

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
  const revisionId = "3a4a233e-d4bc-4a65-825f-c4882bceb9d1"
  const attemptId = "f166b395-8d3a-4921-b273-1a62a6032707"
  const signedImages = V3_FINAL_ASSET_ROLES.map((assetRole, position) => ({
    position,
    assetRole,
    status: "PASSED",
    sha256: String(position + 1).repeat(64),
    storagePath: `selected/${position}.png`,
  }))
  assert.equal(v3FinalListingReviewCanonicalReady({
    activeRevisionId: revisionId,
    revisionId,
    activeAttemptId: attemptId,
    attemptId,
    visualPhase: "COMPLETED",
    finalVisualSetLocked: true,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: true,
    providerCalls: 8,
    blockers: [],
    gates: { allSevenPassed: true, primaryMainFirst: true },
    signedImages,
  }), true)
  assert.equal(v3FinalListingReviewCanonicalReady({
    activeRevisionId: revisionId,
    revisionId,
    activeAttemptId: attemptId,
    attemptId,
    visualPhase: "COMPLETED",
    finalVisualSetLocked: true,
    generationControlsHidden: true,
    readyForUnpublishedOfferAuthorization: true,
    providerCalls: 8,
    blockers: [],
    gates: { allSevenPassed: true, primaryMainFirst: true },
    signedImages: signedImages.slice(0, 6),
  }), false)
  assert.deepEqual(visibleWorkspaceBlockers({
    canonicalV3FinalReview: true,
    blockers: [
      "IMAGE_REQUIRED",
      "NEED_AUTHORIZED_PRODUCT_IMAGES",
      "HARD_GATE:NEED_AUTHORIZED_PRODUCT_IMAGES",
      "EVIDENCE_GUARD:NEED_AUTHORIZED_PRODUCT_IMAGES",
      "AUTHORIZED_IMAGE_REQUIRED",
      "VERIFIED_BUSINESS_POLICIES_REQUIRED",
    ],
  }), ["VERIFIED_BUSINESS_POLICIES_REQUIRED"])
  assert.deepEqual(visibleWorkspaceBlockers({
    canonicalV3FinalReview: true,
    source: "draft_readiness",
    blockers: [
      "HTTPS_IMAGES_REQUIRED",
      "IMAGE_AUTHORIZATION_REQUIRED",
      "IMAGE_AUTHORIZATION_WITHOUT_SOURCE_IMAGE",
      "IMAGE_NOT_AUTHORIZED",
      "IMAGE_RIGHTS_BASIS_INVALID",
      "IMAGE_SOURCE_INVALID",
      "LUNA_STOCK_UNAVAILABLE",
    ],
  }), ["LUNA_STOCK_UNAVAILABLE"])
  assert.deepEqual(visibleWorkspaceBlockers({
    canonicalV3FinalReview: true,
    source: "workspace",
    blockers: [
      "APPROVED_IMAGE_SET_CHANGED_REVIEW_REQUIRED",
      "FINAL_LISTING_REVIEW_IMAGE_SET_INVALID",
      "EBAY_V3_PUBLICATION_IMAGE_ROUNDTRIP_INVALID",
      "SAME_DAY_IMAGE_SET_QA_NOT_PASSED",
      "EBAY_IMAGE_RIGHTS_BASIS_INVALID",
    ],
  }), [
    "APPROVED_IMAGE_SET_CHANGED_REVIEW_REQUIRED",
    "FINAL_LISTING_REVIEW_IMAGE_SET_INVALID",
    "EBAY_V3_PUBLICATION_IMAGE_ROUNDTRIP_INVALID",
    "SAME_DAY_IMAGE_SET_QA_NOT_PASSED",
    "EBAY_IMAGE_RIGHTS_BASIS_INVALID",
  ])
  assert.deepEqual(visibleWorkspaceBlockers({
    canonicalV3FinalReview: false,
    blockers: ["IMAGE_REQUIRED", "NEED_AUTHORIZED_PRODUCT_IMAGES"],
  }), ["IMAGE_REQUIRED", "NEED_AUTHORIZED_PRODUCT_IMAGES"])
})

test("the direct V3 review route and UI do not call commercial preparation", () => {
  const ui = readFileSync("app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const route = readFileSync("app/api/admin/ebay/images/route.ts", "utf8")
  assert.match(ui, /visualReviewRevisionId/)
  assert.match(ui, /v3VisualReviewAccessible/)
  assert.match(ui, /Revisión visual V3 · independiente de Luna/)
  assert.match(ui, /visibleWorkspaceGateBlockers/)
  assert.match(ui, /publicationGateAllowed && !finalReviewCompleted/)
  assert.match(ui, /visibleDraftReadinessBlockers/)
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
