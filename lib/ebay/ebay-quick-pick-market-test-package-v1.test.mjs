import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({ resolve(specifier, context, nextResolve) {
  const value = String(specifier ?? "")
  if (value.startsWith(".") && !/\.(?:ts|tsx|mjs|js|json)$/.test(value)) {
    try { return nextResolve(`${value}.ts`, context) } catch {
      return nextResolve(specifier, context)
    }
  }
  return nextResolve(specifier, context)
} })

const {
  buildQuickPickMarketTestListingReviewV1,
  buildQuickPickOwnerReviewPackageDataV1,
  QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1,
  QUICK_PICK_REMOTE_OWNER_REVIEW_V1,
} = await import("./ebay-quick-pick-market-test-package-v1.ts")

const actor = "11111111-1111-4111-8111-111111111111"
const candidateKey = `sha256:${"a".repeat(64)}`
const opportunity = {
  id: "22222222-2222-4222-8222-222222222222",
  candidate_key: candidateKey,
  supplier_product_id: "9220000000001",
  supplier_variant_id: "48800000000001",
  supplier_sku: "GENERIC-MARKET-TEST",
  product_title: "Adjustable Black ABS Windshield Car Phone Holder Mount",
  active_comparables: 0,
  decision: "MARKET_TEST_READY",
  assessment: {
    productTruth: { exact: true, title:
      "Adjustable Black ABS Windshield Car Phone Holder Mount",
    lunaProductId: "9220000000001",
    lunaVariantId: "48800000000001",
    supplierSku: "GENERIC-MARKET-TEST" },
    market: { familyDemandStatus: "FAMILY_DEMAND_UNAVAILABLE",
      soldComparableCount: 0 },
    listingIntelligencePackage: {
      recommendedTitle:
        "Adjustable Black ABS Windshield Car Phone Holder Mount",
      titleStrategy: { primarySearchPhrase: "car phone holder",
        secondarySearchTerms: ["windshield mount", "adjustable phone mount"] },
    },
    canonicalMarketplaceReadinessV1: {
      ready: true, categoryId: "35190", categoryName: "Cell Phone Mounts",
      categorySource: "EBAY_TAXONOMY_OFFICIAL_READONLY",
      conditionId: "1000", conditionLabel: "New",
      conditionSource: "LUNA_OWNER_CERTIFIED_NEW_MERCHANDISE_V1",
      requiredItemSpecificsReady: true,
      requiredItemSpecificsTruth: { resolutions: {
        Type: { value: "Phone Holder", source: "EXACT_PRODUCT_TITLE",
          exactProductSupported: true },
        Brand: { value: "Unbranded",
          source: "MARKETPLACE_ALLOWED_FALLBACK",
          exactProductSupported: false },
      } },
    },
    marketplaceRequiredSpecificsBatchResolutionV1: { resolutions: [
      { aspectName: "Type", resolvedValue: "Phone Holder",
        resolutionClass: "DETERMINISTIC_DERIVATION",
        humanReviewRequired: false, factInvented: false },
      { aspectName: "Brand", resolvedValue: "Unbranded",
        resolutionClass: "MARKETPLACE_ALLOWED_FALLBACK",
        humanReviewRequired: false, factInvented: false },
    ] },
    quickPickMarketTestReviewV1: {
      finalDecision: "MARKET_TEST_READY", testPrice: 29.99,
      supplierCost: 5.50, shipping: 6.99, ebayFees: 5.21,
      profit: 8.29, margin: 27.64, roi: 150.73,
    },
  },
}
const listingPackage = {
  id: "33333333-3333-4333-8333-333333333333",
  opportunity_id: opportunity.id,
  candidate_key: candidateKey,
  package_data: { title: opportunity.product_title, description: "",
    categoryId: "35190", categoryName: "Cell Phone Mounts",
    conditionId: "1000", conditionLabel: "New",
    aspects: {}, pricing: { supplierCost: 5.50, targetPrice: 29.99 } },
}
const frontier = { shippingValue: 6.99, breakEvenSellingPrice: 18.42,
  marketPriceMin: null, marketPriceMedian: null, marketPriceMax: null }
const catalogRow = { title: opportunity.product_title,
  variant_title: "Black", product_type: "Phone Holder",
  tags: ["car", "windshield", "adjustable"] }
const catalogProduct = { body_html:
  "<p>Adjustable car phone holder for windshield use. ABS and PVC.</p>" }

test("market test projection reuses durable authorities without claiming demand", () => {
  const review = buildQuickPickMarketTestListingReviewV1({ opportunity,
    listingPackage, frontier, catalogRow, catalogProduct })
  assert.equal(review.contractVersion,
    QUICK_PICK_MARKET_TEST_PACKAGE_AND_REMOTE_OWNER_REVIEW_V1)
  assert.equal(review.finalListingPackageReady, true)
  assert.equal(review.titleReady, true)
  assert.equal(review.rawSupplierTitleCopiedWithoutOptimization, false)
  assert.match(review.title, /^car phone holder/i)
  assert.ok(review.keywords.length >= 2)
  assert.ok(review.keywords.every((keyword) =>
    keyword.exactProductDemandClaimed === false))
  assert.equal(review.demand.status,
    "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE")
  assert.equal(review.supportedPriceBand.status, "UNPROVEN")
  assert.equal(review.dollarCheck.breakEvenPrice, 18.42)
  assert.equal(review.dollarCheck.minimumProfitablePrice, 23.63)
  assert.equal(review.dollarCheck.ready, true)
  assert.deepEqual(review.itemSpecifics,
    { Type: "Phone Holder", Brand: "Unbranded" })
  assert.equal(review.reuseAudit.demandIntelligenceReused, true)
  assert.equal(review.reuseAudit.soldEvidenceReused, true)
  assert.equal(review.reuseAudit.intelligentTitleFactoryReused, true)
  assert.equal(review.reuseAudit.listingPackageReused, true)
  assert.equal(review.reuseAudit.dollarCheckReused, true)
  assert.equal(review.reuseAudit.ownerAuthorizationPathReused, true)
  assert.equal(review.reuseAudit.publishPathReused, true)
  assert.equal(review.reuseAudit.liveReadbackPathReused, true)
  assert.equal(review.factInvented, false)
  assert.equal(review.marketplaceWrites, 0)
  assert.equal(review.publishAuthorizationHandoff.publishableAsMarketTest,
    true)
  assert.equal(review.publishAuthorizationHandoff.demandProven, false)
  assert.equal(review.publishAuthorizationHandoff.listingReady, false)
  assert.equal(review.publishAuthorizationHandoff
    .readyForOwnerPublishAuthorization, false)
  assert.equal(review.publishAuthorizationHandoff
    .falseListingReadyRequirement, false)
})

test("owner edit and confirmation remain durable review decisions, not publish writes", () => {
  const review = buildQuickPickMarketTestListingReviewV1({ opportunity,
    listingPackage, frontier, catalogRow, catalogProduct })
  const edited = buildQuickPickOwnerReviewPackageDataV1({
    currentPackageData: listingPackage.package_data, review,
    actorUserId: actor, action: "EDIT",
    edits: { title: "Car Phone Holder Adjustable Windshield Mount Black",
      description: "Owner-approved exact product description." },
    now: "2026-08-31T18:00:00.000Z",
  })
  assert.equal(edited.title,
    "Car Phone Holder Adjustable Windshield Mount Black")
  assert.equal(edited.quickPickOwnerReviewV1.contractVersion,
    QUICK_PICK_REMOTE_OWNER_REVIEW_V1)
  assert.equal(edited.quickPickOwnerReviewV1.status,
    "EDITED_PENDING_CONFIRMATION")
  assert.equal(edited.quickPickOwnerReviewV1.readyForOwnerPublishAuthorization,
    false)
  assert.equal(edited.quickPickOwnerReviewV1.marketplaceWrites, 0)
  assert.equal(edited.pricing.contributionBreakEvenPrice, 18.42)
  assert.equal(edited.pricing.minimumProfitablePrice, 23.63)
  const editedReview = buildQuickPickMarketTestListingReviewV1({ opportunity,
    listingPackage: { ...listingPackage, package_data: edited }, frontier,
    catalogRow, catalogProduct })
  const confirmed = buildQuickPickOwnerReviewPackageDataV1({
    currentPackageData: edited, review: editedReview, actorUserId: actor,
    action: "CONFIRM", now: "2026-08-31T18:01:00.000Z",
  })
  assert.equal(confirmed.quickPickOwnerReviewV1.status, "CONFIRMED")
  assert.equal(confirmed.quickPickOwnerReviewV1
    .readyForOwnerPublishAuthorization, true)
  assert.equal(confirmed.quickPickOwnerReviewV1.marketplaceWriteAuthorized,
    false)
  assert.equal(confirmed.title,
    "Car Phone Holder Adjustable Windshield Mount Black")
  const confirmedReview = buildQuickPickMarketTestListingReviewV1({
    opportunity, listingPackage: { ...listingPackage,
      package_data: confirmed }, frontier, catalogRow, catalogProduct,
  })
  assert.equal(confirmedReview.ownerReview.ownerReviewConfirmed, true)
  assert.equal(confirmedReview.ownerReview.confirmedPackageId,
    listingPackage.id)
  assert.equal(confirmedReview.ownerReview.currentListingPackageId,
    listingPackage.id)
  assert.equal(confirmedReview.ownerReview.packageMatch, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .marketTestReadiness, "PASS")
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .publishableAsMarketTest, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .readyForOwnerPublishAuthorization, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .publishCtaVisible, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .publishCtaEnabled, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .demandUnprovenDoesNotBlockMarketTest, true)
  assert.equal(confirmedReview.publishAuthorizationHandoff
    .goldenPathRestarted, false)
})

test("dashboard and route reuse the existing inline cockpit and publication stack", () => {
  const dashboard = readFileSync(
    "app/admin/seller-os-operational-dashboard.tsx", "utf8")
  const route = readFileSync(
    "app/api/admin/ebay/luna-quick-pick/route.ts", "utf8")
  const reference = readFileSync(
    "app/admin/ebay/opportunity-queue/research/page.tsx", "utf8")
  const publication = readFileSync(
    "lib/ebay/ebay-one-click-controlled-publication-v1.ts", "utf8")
  assert.match(dashboard, /data-quick-pick-owner-review-inline/)
  assert.match(dashboard, /EDITAR/)
  assert.match(dashboard, /CONFIRMAR/)
  assert.match(dashboard, /AUTORIZAR PUBLICACIÓN/)
  assert.match(dashboard, /data-quick-pick-publish-authorization-cta/)
  assert.match(dashboard, /action: "PUBLISH_HANDOFF"/)
  assert.match(dashboard, /source=quick-pick-canonical/)
  assert.match(dashboard, /PUBLICAR EN EBAY/)
  assert.match(dashboard, /ningún cambio se publica desde aquí/)
  assert.match(route, /body\.action === "OWNER_REVIEW"/)
  assert.match(route, /body\.action === "PUBLISH_HANDOFF"/)
  assert.match(route, /marketplaceWrites: 0, listingPublications: 0/)
  assert.match(reference, /Use as Reference \/ Sell One Like This/)
  assert.match(publication, /SELLER_OS_ONE_CLICK_CONTROLLED_PUBLICATION_V1/)
  assert.doesNotMatch(route, /publishOffer|createOffer|bulkCreateOffer/)
})
