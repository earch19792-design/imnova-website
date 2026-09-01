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
  buildQuickPickCanonicalPublishHandoffV1,
  QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_V1,
  QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1,
} = await import("./ebay-quick-pick-canonical-publish-handoff-v1.ts")

const actor = "11111111-1111-4111-8111-111111111111"
const accountKey = "seller-os-dedicated-preprod"
const packageId = "22222222-2222-4222-8222-222222222222"
const opportunityId = "33333333-3333-4333-8333-333333333333"
const candidateKey = `sha256:${"c".repeat(64)}`
const productTruthDigest = `sha256:${"d".repeat(64)}`
const packageDigest = `sha256:${"e".repeat(64)}`
const observedAt = "2026-09-01T16:00:00.000Z"

function fixture() {
  const opportunity = {
    id: opportunityId,
    candidate_key: candidateKey,
    supplier_product_id: "9220000000001",
    supplier_variant_id: "48800000000001",
    supplier_sku: "QP-CANONICAL-1",
    supplier_price: 24.35,
    supplier_available: false,
    supplier_inventory_quantity: null,
    queue_status: "parked",
    opportunity_score: 10,
    identity_score: 10,
    hard_gates: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN"],
    evidence_guards: [],
    decision: "MARKET_TEST_READY",
    assessment: {
      identity: { exactIdentityConfirmed: false },
      economics: { ready: false },
      scores: { potentialScore: 10, confidenceScore: 10 },
      productTruth: {
        evidenceDigest: productTruthDigest,
        candidateKey,
        lunaProductId: "9220000000001",
        lunaVariantId: "48800000000001",
        supplierSku: "QP-CANONICAL-1",
        gtin: null,
        stock: {
          state: "IN_STOCK_SUPPLIER_STATED",
          freshness: "FRESH",
          exactIdentityVerified: true,
          supplierStatedQuantity: 7,
          observedAt,
        },
      },
      canonicalMarketplaceReadinessV1: {
        ready: true,
        requiredItemSpecificsReady: true,
      },
    },
  }
  const listingReview = {
    finalListingPackageReady: true,
    listingPackageId: packageId,
    packageDigest,
    title: "Canonical Quick Pick product",
    ownerReview: {
      ownerReviewConfirmed: true,
      confirmedPackageId: packageId,
      currentListingPackageId: packageId,
      packageMatch: true,
    },
    publishAuthorizationHandoff: {
      finalListingPackageMatch: true,
      marketTestReadiness: "PASS",
      publishableAsMarketTest: true,
      demandProven: false,
      demandUnprovenDoesNotBlockMarketTest: true,
    },
    dollarCheck: {
      ready: true,
      targetPrice: 56.99,
      supplierCost: 24.35,
      shipping: 6.99,
      ebayFees: 9.12,
      expectedContribution: 11.40,
      expectedMargin: 20.01,
      expectedRoi: 46.82,
    },
    shipping: { value: 6.99, currency: "USD" },
  }
  const listingPackage = {
    id: packageId,
    opportunity_id: opportunityId,
    candidate_key: candidateKey,
    account_key: accountKey,
    created_by: actor,
    status: "ready_for_review",
    package_data: {
      title: listingReview.title,
      pricing: {
        targetPrice: 56.99,
        supplierCost: 24.35,
        estimatedOutboundShipping: 6.99,
        estimatedEbayFees: 9.12,
        estimatedNetProfit: 11.40,
        estimatedNetMarginPercent: 20.01,
        estimatedRoiPercent: 46.82,
      },
      factoryPreparationAuthority: {
        supplierProductId: "9220000000001",
        supplierVariantId: "48800000000001",
        supplierSku: "QP-CANONICAL-1",
        stageStatuses: {
          ECONOMICS_READY: "READY",
          LISTING_PACKAGE_READY: "READY",
        },
      },
      quickPickOwnerReviewV1: {
        contractVersion: "QUICK_PICK_REMOTE_OWNER_REVIEW_V1",
        status: "CONFIRMED",
        readyForOwnerPublishAuthorization: true,
        reviewedPackageDigest: packageDigest,
      },
    },
  }
  const card = {
    sourceUrl: "https://www.lunaportex.com/products/canonical-product",
    canonicalUrl: "https://www.lunaportex.com/products/canonical-product",
    sourceSku: "QP-CANONICAL-1",
    lunaProductId: "9220000000001",
    lunaVariantId: "48800000000001",
    candidateId: candidateKey,
    opportunityId,
    candidateKey,
    listingPackageId: packageId,
    title: listingReview.title,
    state: "READY",
    lastStage: "MARKET_TEST_READY",
    disposition: "MARKET_TEST_READY",
    exactBlocker: null,
    exactBlockers: [],
    variantSelectionRequired: false,
    variants: [],
    alreadyLive: false,
    linkedLiveItemIds: [],
    durableFamilyHit: false,
    onDemandDemandDiscoveryRequired: true,
    onDemandDemandDiscoveryExecuted: true,
    soldComparableCount: 0,
    familyDemandStatus: "DEMAND_DISCOVERY_UNAVAILABLE",
    familyBindingCreatedOrReused: false,
    demandEvidenceClass: "UNPROVEN_INSUFFICIENT_MARKET_EVIDENCE",
    demandNegativeEvidencePresent: false,
    marketTestPathEligible: true,
    marketTestReady: true,
    marketTestReview: {},
    requiredItemSpecificsCount: 2,
    requiredItemSpecificsSatisfied: 2,
    requiredItemSpecificsReady: true,
    unresolvedRequiredAspects: [],
    deterministicResolvedCount: 1,
    marketplaceFallbackResolvedCount: 1,
    aiCallCount: 0,
    aiAspectsResolvedCount: 0,
    factInvented: false,
    automaticResolutionExhausted: true,
    automaticResolutionContractCurrent: true,
    exactUnresolvedFields: [],
    ownerResidualActions: [],
    nextOwnerAction: null,
    marketplaceReadinessReady: true,
    conditionReady: true,
    shippingUsd: 6.99,
    rehydrated: true,
    updatedAt: observedAt,
    stages: { STOCK: "PASS", ECONOMICS: "PASS" },
    dollarCheck: listingReview.dollarCheck,
    listingReview,
    overnightEnrichmentPending: false,
    overnightEnrichmentStatus: null,
    overnightEnrichmentLastRunAt: null,
    elapsedMs: 0,
  }
  return { opportunity, listingPackage, card }
}

function build(overrides = {}) {
  const data = fixture()
  return buildQuickPickCanonicalPublishHandoffV1({
    accountKey,
    actorUserId: actor,
    ...data,
    policyProfile: {
      account_key: accountKey,
      marketplace_id: "EBAY_US",
      fulfillment_policy_id: "fulfillment-1",
      payment_policy_id: "payment-1",
      return_policy_id: "return-1",
      merchant_location_key: "seller-location-1",
      verified_at: "2026-08-31T16:00:00.000Z",
      expires_at: "2026-09-15T16:00:00.000Z",
    },
    canonicalLunaUrl:
      "https://www.lunaportex.com/products/canonical-product",
    now: new Date("2026-09-01T17:00:00.000Z"),
    ...overrides,
  })
}

test("canonical Quick Pick package supersedes only the four stale legacy gates", () => {
  const result = build()
  assert.equal(result.contractVersion,
    QUICK_PICK_CANONICAL_PUBLISH_HANDOFF_V1)
  assert.equal(result.authorization.version,
    QUICK_PICK_CANONICAL_PUBLICATION_AUTHORIZATION_V1)
  assert.equal(result.publishAuthorizationReady, true)
  assert.equal(result.authorization.validated, true)
  assert.equal(result.canonicalPackageIsPublishAuthority, true)
  assert.equal(result.legacyGuardEvaluatorUsedForAuthorization, false)
  assert.equal(result.legacyFalseGuardCountBefore, 4)
  assert.equal(result.legacyFalseGuardCount, 0)
  assert.equal(result.policiesBound, true)
  assert.equal(result.publishWithStockguardContract.publishAllowed, true)
  assert.deepEqual(result.blockers, [])
  assert.deepEqual(result.guardReconciliation.map((entry) => [
    entry.legacyGuard, entry.canonicalCurrentState,
    entry.staleOrApplicable,
  ]), [
    ["UNIT_ECONOMICS_REQUIRED", "PASS", "STALE"],
    ["LUNA_STOCK_UNAVAILABLE", "PASS", "STALE"],
    ["POTENTIAL_SCORE_BELOW_70", "NOT_APPLICABLE", "STALE"],
    ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN", "PASS", "STALE"],
  ])
})

test("canonical handoff remains fail-closed for a real package or policy mismatch", () => {
  const packageMismatch = fixture()
  packageMismatch.card.listingReview.ownerReview.packageMatch = false
  const mismatched = build({ listingPackage: packageMismatch.listingPackage,
    opportunity: packageMismatch.opportunity, card: packageMismatch.card })
  assert.equal(mismatched.publishAuthorizationReady, false)
  assert.ok(mismatched.blockers.includes("QUICK_PICK_PUBLISH_PACKAGE_CHANGED"))

  const expiredPolicy = build({ policyProfile: {
    account_key: accountKey, marketplace_id: "EBAY_US",
    fulfillment_policy_id: "fulfillment-1",
    payment_policy_id: "payment-1", return_policy_id: "return-1",
    merchant_location_key: "seller-location-1",
    verified_at: "2026-08-01T00:00:00.000Z",
    expires_at: "2026-08-02T00:00:00.000Z",
  } })
  assert.equal(expiredPolicy.publishAuthorizationReady, false)
  assert.ok(expiredPolicy.blockers.includes(
    "QUICK_PICK_PUBLISH_ACCOUNT_POLICIES_NOT_BOUND"))
})

test("the existing publisher consumes the canonical handoff without Command Center", () => {
  const dashboard = readFileSync(
    "app/admin/seller-os-operational-dashboard.tsx", "utf8")
  const quickPickRoute = readFileSync(
    "app/api/admin/ebay/luna-quick-pick/route.ts", "utf8")
  const workspace = readFileSync(
    "app/admin/ebay/listing-workspace/page.tsx", "utf8")
  const publisher = readFileSync(
    "app/api/admin/ebay/draft-only/route.ts", "utf8")
  assert.match(dashboard, /action: "PUBLISH_HANDOFF"/)
  assert.match(dashboard, /source=quick-pick-canonical/)
  assert.match(dashboard, /PUBLICAR EN EBAY/)
  assert.doesNotMatch(dashboard,
    /data-quick-pick-publish-authorization-cta[^]*command-center/)
  assert.match(quickPickRoute, /body\.action === "PUBLISH_HANDOFF"/)
  assert.match(workspace, /params\.get\("source"\) === "quick-pick-canonical"/)
  assert.match(workspace, /quickPickHandoffRequest/)
  assert.match(publisher, /quickPickPublicationAuthorization/)
  assert.match(publisher, /EBAY_FINAL_PUBLICATION_QUICK_PICK_BINDING_CHANGED/)
  assert.match(publisher, /publishEbayOfferOnce/)
})
