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
  buildSellerOsDeterministicFactoryPlanV1,
  buildSellerOsRadarDecisionPackageBindingV1,
  isGenericSmartStockingListingIntakeV1,
  isSellerOsDeterministicFactoryPackageV1,
  lunaQuickPickOwnerCertifiedConditionAuthorityV1,
  rematerializeSellerOsDeterministicPackageDataV1,
  resolveSellerOsExactProductTruthV1,
  SELLER_OS_DETERMINISTIC_FACTORY,
} = await import("./ebay-smart-stocking-durable-factory-v1.ts")
const { evaluateEbayListingWorkspaceEligibility } = await import(
  "./ebay-first-luna-opportunity-queue.ts")
const { buildOwnerSupplierPolicyApplicationV1,
  lunaNewMerchandisePolicyDigestV1 } = await import(
  "./ebay-owner-supplier-merchandise-policy-v1.ts")

const PRODUCT_ID = "9000000000111"
const VARIANT_ID = "9000000000222"
const SKU = "GENERIC-CANARY-001"
const CANDIDATE_KEY = `luna-portex:${PRODUCT_ID}:${VARIANT_ID}`
const TRUTH_DIGEST = `sha256:${"a".repeat(64)}`
const RADAR_CANDIDATE_ID = `sha256:${"1".repeat(64)}`
const FAMILY_ID = `market-family-v1:sha256:${"2".repeat(64)}`
const OPPORTUNITY_CASE_ID = `opportunity-case-v1:sha256:${"3".repeat(64)}`

function opportunity(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    candidate_key: CANDIDATE_KEY,
    supplier_product_id: PRODUCT_ID,
    supplier_variant_id: VARIANT_ID,
    supplier_sku: SKU,
    gtin: "740000000011",
    product_title: "Generic deterministic factory canary",
    supplier_price: 5,
    supplier_available: true,
    supplier_inventory_quantity: null,
    supplier_snapshot_at: "2026-08-28T20:00:00.000Z",
    median_total_buyer_price: 24.99,
    hard_gates: [],
    evidence_guards: [],
    queue_status: "review",
    opportunity_score: 60,
    identity_score: 60,
    assessment: {
      productTruth: {
        authorityClass: "SELLER_OS_LUNA_EXACT_PRODUCT_TRUTH_V1",
        evidenceDigest: TRUTH_DIGEST,
        candidateKey: CANDIDATE_KEY,
        lunaProductId: PRODUCT_ID,
        lunaVariantId: VARIANT_ID,
        supplierSku: SKU,
        gtin: "740000000011",
        stock: {
          state: "IN_STOCK_SUPPLIER_STATED",
          freshness: "FRESH",
          exactIdentityVerified: true,
        },
      },
      identity: { exactIdentityConfirmed: true },
      economics: { ready: true },
      scores: { potentialScore: 60, confidenceScore: 60 },
      candidate: {
        description: "Exact supplier product.",
        imageUrls: ["https://cdn.example.test/canary.webp"],
      },
      listingIntelligencePackage: {
        recommendedTitle: "Generic Deterministic Factory Product",
        categoryRecommendation: { categoryId: "123456", categoryName: "Test" },
        itemSpecifics: { supplierConfirmed: { Brand: "Unbranded" } },
      },
      canonicalReadiness: { blockers: [] },
    },
    ...overrides,
  }
}

function frontier(overrides = {}) {
  return {
    frontier_id: `profitability-frontier-v1:sha256:${"b".repeat(64)}`,
    frontier_digest: `sha256:${"c".repeat(64)}`,
    snapshot_digest: `sha256:${"d".repeat(64)}`,
    luna_product_id: PRODUCT_ID,
    luna_variant_id: VARIANT_ID,
    luna_sku: SKU,
    frontier_payload: { familyDemandStatus: "FAMILY_DEMAND_SUPPORTED" },
    economic_classification: "ECONOMICALLY_PROMISING",
    shipping_status: "SHIPPING_DURABLY_PERSISTED",
    next_best_evidence: "NONE",
    contribution_profit_median: 6,
    contribution_margin_median: 24,
    luna_cost: 5,
    shipping_value: 6.99,
    market_price_median: 24.99,
    ebay_fee_estimate_at_median: 4.22,
    hard_blockers: [],
    ...overrides,
  }
}

test("an exact durable Quick Pick inherits New only with a durable owner policy application", () => {
  const base = opportunity()
  const policyApplication = buildOwnerSupplierPolicyApplicationV1({
    policy: { id: "44444444-4444-4444-8444-444444444444",
      marketplaceAccountKey: "test-account",
      evidenceDigest: lunaNewMerchandisePolicyDigestV1(),
      certifiedAt: "2026-08-28T19:00:00.000Z",
      authorizationReferenceDigest: `sha256:${"9".repeat(64)}` },
    lunaProductId: PRODUCT_ID, lunaVariantId: VARIANT_ID,
    supplierSku: SKU, exactSupplierLineageCertified: true,
    productIdentityExact: true, appliedAt: "2026-08-28T20:00:00.000Z",
  })
  const quickPick = { ...base, assessment: { ...base.assessment,
    lunaQuickPickOperationV1: {
      contractVersion: "QUICK_PICK_DURABLE_OPERATION_REHYDRATION_V1",
      candidateKey: CANDIDATE_KEY,
      lunaProductId: PRODUCT_ID,
      lunaVariantId: VARIANT_ID,
      supplierSku: SKU,
    },
    ownerSupplierMerchandisePolicyApplicationV1: policyApplication,
  } }
  const authority = lunaQuickPickOwnerCertifiedConditionAuthorityV1(
    quickPick, frontier())
  assert.equal(authority?.conditionId, "1000")
  assert.equal(authority?.conditionLabel, "New")
  assert.equal(authority?.factInvented, false)
  assert.equal(lunaQuickPickOwnerCertifiedConditionAuthorityV1({
    ...quickPick, assessment: { ...quickPick.assessment,
      ownerSupplierMerchandisePolicyApplicationV1: undefined },
  }, frontier()), null)
  assert.equal(lunaQuickPickOwnerCertifiedConditionAuthorityV1({
    ...quickPick, supplier_variant_id: "DIFFERENT",
  }, frontier()), null)
})

test("the systemic policy accepts certified continued Quick Pick lineage and its canonical category", () => {
  const base = opportunity()
  const policyApplication = buildOwnerSupplierPolicyApplicationV1({
    policy: { id: "55555555-5555-4555-8555-555555555555",
      marketplaceAccountKey: "test-account",
      evidenceDigest: lunaNewMerchandisePolicyDigestV1(),
      certifiedAt: "2026-09-03T00:00:00.000Z",
      authorizationReferenceDigest: `sha256:${"8".repeat(64)}` },
    lunaProductId: PRODUCT_ID, lunaVariantId: VARIANT_ID,
    supplierSku: SKU, exactSupplierLineageCertified: true,
    productIdentityExact: true, appliedAt: "2026-09-03T00:01:00.000Z",
  })
  const continued = { ...base, assessment: { ...base.assessment,
    quickPickRequiredSpecificsContinuationV1: {
      contractVersion: "QUICK_PICK_REQUIRED_SPECIFICS_CONTINUATION_V1",
      factInvented: false, marketplaceWrites: 0,
    },
    quickPickExactSoldMarketEnrichmentV1: {
      contractVersion: "QUICK_PICK_EXACT_SOLD_MARKET_ENRICHMENT_V2",
      completedAt: "2026-09-03T00:00:30.000Z",
      factInvented: false, marketplaceWrites: 0,
    },
    canonicalMarketplaceReadinessV1: {
      categoryReady: true, categoryId: "654321",
      queueCandidateKey: CANDIDATE_KEY,
      supplierProductId: PRODUCT_ID, supplierVariantId: VARIANT_ID,
      supplierSku: SKU,
    },
    ownerSupplierMerchandisePolicyApplicationV1: policyApplication,
  } }
  delete continued.assessment.lunaQuickPickOperationV1
  const authority = lunaQuickPickOwnerCertifiedConditionAuthorityV1(
    continued, frontier())
  assert.equal(authority?.conditionLabel, "New")
  assert.equal(authority?.categoryId, "654321")
  assert.equal(lunaQuickPickOwnerCertifiedConditionAuthorityV1({
    ...continued, assessment: { ...continued.assessment,
      quickPickExactSoldMarketEnrichmentV1: undefined },
  }, frontier()), null)
})

function decisionPackage(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    status: "GENERATED",
    package_payload: {
      supplierSku: SKU,
      supplierVariantId: VARIANT_ID,
      productIdentity: { identity: { gtin: "740000000011" } },
    },
    smart_stocking_learning_profile: {
      profileVersion: "SELLER_OS_SMART_STOCKING_LEARNING_PROFILE_V1",
      entrySnapshotHash: `sha256:${"e".repeat(64)}`,
      decisionSnapshotHash: `sha256:${"f".repeat(64)}`,
      entrySnapshot: { entryPotentialScore: 72 },
      decisionSnapshot: {
        launchTier: "DETERMINISTIC_FACTORY",
        finalEconomics: {
          status: "PASS", thresholdResult: "PASS", roiPercent: 120,
        },
      },
    },
    ...overrides,
  }
}

function radarBindingInputs() {
  const base = opportunity()
  const radarOpportunity = opportunity({
    candidate_key: `luna-portex:${PRODUCT_ID}:${VARIANT_ID}`,
    assessment: {
      ...base.assessment,
      radarFactoryCandidateV1: {
        contractVersion: "NIGHT_RADAR_AUTOMATIC_GOLDEN_PATH_HANDOFF_V1",
        authority: "SELLER_OS_DETERMINISTIC_FACTORY",
        candidateId: RADAR_CANDIDATE_ID,
        familyId: FAMILY_ID,
        demandEvidenceGrain: "FAMILY",
        exactProductDemandClaimed: false,
      },
      productTruth: {
        ...base.assessment.productTruth,
        candidateKey: RADAR_CANDIDATE_ID,
      },
      candidate: {
        ...base.assessment.candidate,
        candidateKey: RADAR_CANDIDATE_ID,
        supplierProductId: PRODUCT_ID,
        supplierVariantId: VARIANT_ID,
        sku: SKU,
        gtin: "740000000011",
      },
    },
  })
  const radarFrontier = frontier({
    opportunity_case_id: OPPORTUNITY_CASE_ID,
    market_price_evidence_reference: `radar-family-demand:${FAMILY_ID}`,
    market_price_evidence_digest: `sha256:${"4".repeat(64)}`,
    economic_policy_digest: `sha256:${"5".repeat(64)}`,
    frontier_payload: {
      familyId: FAMILY_ID,
      familyDemandStatus: "FAMILY_DEMAND_SUPPORTED",
      radarAutomaticPriceDistributionContinuationV1: {
        evidenceDigest: `sha256:${"6".repeat(64)}`,
      },
    },
    economic_classification: "ECONOMICALLY_RECOVERABLE",
    radar_price_distribution_target: {
      economicsReady: true,
      targetPrice: 52.58,
      profit: 25.89,
      margin: 49.25,
      roi: 397.13,
      estimatedEbayFees: 8.44,
    },
  })
  return { opportunity: radarOpportunity, frontier: radarFrontier }
}

function plan(overrides = {}) {
  return buildSellerOsDeterministicFactoryPlanV1({
    opportunity: opportunity(overrides.opportunity),
    frontier: frontier(overrides.frontier),
    activeDuplicateCount: overrides.activeDuplicateCount ?? 0,
    decisionPackage: overrides.decisionPackage === undefined
      ? decisionPackage() : overrides.decisionPackage,
  })
}

test("GENERIC_CANDIDATE_NOT_IN_ALLOWLIST -> deterministic Golden Path", () => {
  const result = plan()
  assert.equal(result.targetSpecificAllowlistUsed, false)
  assert.equal(result.authority, SELLER_OS_DETERMINISTIC_FACTORY)
  assert.equal(result.humanSessionRequired, false)
  assert.equal(result.listingReady, true)
  assert.deepEqual(result.stageStatuses, {
    SMART_STOCKING: "READY",
    PRODUCT_TRUTH_READY: "READY",
    DEMAND_READY: "READY",
    ECONOMICS_READY: "READY",
    LISTING_PACKAGE_READY: "READY",
    LISTING_READY: "READY",
  })
  const assessment = {
    ...opportunity().assessment,
    smartStockingListingIntakeV1: result.smartStockingListingIntakeV1,
  }
  assert.equal(isGenericSmartStockingListingIntakeV1(assessment), true)
  assert.equal(evaluateEbayListingWorkspaceEligibility({
    ...opportunity(), assessment,
  }).allowed, true)
})

test("FAMILY_DEMAND_SUPPORTED is sufficient; Exact Sold and SAFE_REFERENCE are not gates", () => {
  const result = plan()
  assert.equal(result.stageStatuses.DEMAND_READY, "READY")
  assert.equal("exactSold" in result.factoryPreparationAuthority, false)
  assert.equal("safeReference" in result.factoryPreparationAuthority, false)
})

test("market-test readiness remains distinct from LISTING_READY and requires owner review", () => {
  const result = plan({ frontier: {
    frontier_payload: { familyDemandStatus: "FAMILY_DEMAND_UNPROVEN" },
    economic_classification: "ECONOMICALLY_PROMISING",
    contribution_profit_median: null,
    contribution_margin_median: null,
    quick_pick_market_test_target: { economicsReady: true,
      targetPrice: 32.5, profit: 6.2, margin: 20.1, roi: 45,
      estimatedEbayFees: 5.1 },
  }, decisionPackage: null })
  assert.equal(result.listingReady, false)
  assert.equal(result.marketTestReady, true)
  assert.equal(result.stageStatuses.DEMAND_READY, "READY")
  assert.equal(result.stageStatuses.MARKET_TEST_READY, "READY")
  assert.equal(result.marketTestReviewV1.finalDecision, "MARKET_TEST_READY")
  assert.equal(result.marketTestReviewV1.marketPriceSupport, "UNPROVEN")
  assert.equal(result.marketTestReviewV1.ownerAuthorizationRequired, true)
})

test("server-owned package authority never fabricates human review", () => {
  const result = plan()
  assert.equal(result.packageSeed.factoryPreparationAuthority.serverOwned, true)
  assert.equal(result.packageSeed.factoryPreparationAuthority.humanApproved, false)
  assert.equal(result.packageSeed.factoryPreparationAuthority.reviewerUserId, null)
  assert.equal(isSellerOsDeterministicFactoryPackageV1(result.packageSeed), true)
})

test("runtime rematerializes owner-claimed deterministic packages without losing authorized edits", () => {
  const seed = plan().packageSeed
  const durable = {
    ...seed,
    title: "Owner title",
    description: "Owner description",
    quickPickMarketTestPackageV1: null,
    quickPickOwnerReviewV1: {
      status: "INVALIDATED_CATEGORY_CHANGE",
      authorizedEdits: { title: "Owner title",
        description: "Owner description" },
    },
    categoryDerivedStateInvalidationV1: {
      contractVersion: "SELLER_OS_CATEGORY_DERIVED_STATE_INVALIDATION_V1",
      packageReadinessInvalidated: true,
      packageRematerializedByRuntime: false,
      marketplaceWrites: 0,
    },
  }
  const result = rematerializeSellerOsDeterministicPackageDataV1(seed, durable)
  assert.equal(result.title, "Owner title")
  assert.equal(result.description, "Owner description")
  assert.equal(result.categoryDerivedStateInvalidationV1
    .packageRematerializedByRuntime, true)
  assert.equal(result.categoryDerivedStateInvalidationV1.marketplaceWrites, 0)
})

test("null supplier quantity remains eligible and independent of listing quantity", () => {
  const result = plan({ opportunity: { supplier_inventory_quantity: null } })
  assert.equal(result.blockers.includes("CANONICAL_STOCK_NOT_READY"), false)
  assert.equal("quantity" in result.packageSeed, false)
})

test("an authentic economics failure parks only that candidate", () => {
  const result = plan({ frontier: {
    economic_classification: "ECONOMICALLY_RECOVERABLE",
    contribution_profit_median: -3.1,
    contribution_margin_median: -21.77,
    hard_blockers: ["EXACT_PRODUCT_DEMAND_UNPROVEN"],
  } })
  assert.equal(result.listingReady, false)
  assert.equal(result.stageStatuses.SMART_STOCKING, "READY")
  assert.equal(result.stageStatuses.ECONOMICS_READY, "BLOCKED")
  assert.equal(result.firstBlocker, "EXACT_PRODUCT_DEMAND_UNPROVEN")
  assert.equal(isSellerOsDeterministicFactoryPackageV1(result.packageSeed), true)
})

test("a proven family distribution target unlocks economics without relabeling the median", () => {
  const result = plan({ frontier: {
    economic_classification: "ECONOMICALLY_RECOVERABLE",
    next_best_evidence: "NONE",
    contribution_profit_median: 0.47,
    contribution_margin_median: 2.45,
    market_price_median: 18.99,
    radar_price_distribution_target: {
      economicsReady: true,
      targetPrice: 52.58,
      profit: 25.89,
      margin: 49.24,
      roi: 397.07,
      estimatedEbayFees: 8.44,
    },
  } })
  assert.equal(result.stageStatuses.ECONOMICS_READY, "READY")
  assert.equal(result.packageSeed.pricing.targetPrice, 52.58)
  assert.equal(result.smartStockingListingIntakeV1.finalPriceUsd, 52.58)
  assert.equal(result.smartStockingListingIntakeV1.contributionProfitUsd, 25.89)
  assert.equal(result.smartStockingListingIntakeV1.roiPercent, 397.07)
})

test("duplicate guard stays fail-closed", () => {
  assert.equal(plan({ activeDuplicateCount: 1 }).blockers.includes(
    "ACTIVE_DUPLICATE"), true)
  const unavailable = buildSellerOsDeterministicFactoryPlanV1({
    opportunity: opportunity(), frontier: frontier(), activeDuplicateCount: null,
    decisionPackage: decisionPackage(),
  })
  assert.equal(unavailable.blockers.includes(
    "ACTIVE_DUPLICATE_GUARD_UNAVAILABLE"), true)
})

test("factory preserves the exact marketplace-specific blocker", () => {
  const base = opportunity()
  const result = buildSellerOsDeterministicFactoryPlanV1({
    opportunity: {
      ...base,
      assessment: {
        ...base.assessment,
        canonicalReadiness: {
          blockers: ["MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand"],
        },
      },
    },
    frontier: frontier(),
    activeDuplicateCount: 0,
    decisionPackage: decisionPackage(),
  })
  assert.equal(result.listingReady, false)
  assert.equal(result.blockers.includes(
    "MARKETPLACE_REQUIRED_ITEM_SPECIFICS_UNPROVEN:Brand"), true)
  assert.equal(result.blockers.includes(
    "CANONICAL_MARKETPLACE_READINESS_REQUIRED"), false)
})

test("an arbitrary decision-package id cannot manufacture Golden Path authority", () => {
  const missing = plan({ decisionPackage: null })
  assert.equal(missing.listingReady, false)
  assert.equal(missing.blockers.includes("DECISION_PACKAGE_NOT_BOUND"), true)
  const mismatched = plan({ decisionPackage: decisionPackage({
    package_payload: {
      supplierSku: "OTHER-SKU",
      supplierVariantId: VARIANT_ID,
      productIdentity: { identity: { gtin: "740000000011" } },
    },
  }) })
  assert.equal(mismatched.listingReady, false)
  assert.equal(mismatched.smartStockingListingIntakeV1, null)
})

test("factory authority is deterministic across re-runs", () => {
  const first = plan()
  const second = plan()
  assert.equal(first.factoryPreparationAuthority.evidenceDigest,
    second.factoryPreparationAuthority.evidenceDigest)
  assert.deepEqual(first.packageSeed, second.packageSeed)
})

test("Radar decision package binds exact candidate, family, demand, price and frontier evidence deterministically", () => {
  const input = radarBindingInputs()
  const first = buildSellerOsRadarDecisionPackageBindingV1(input)
  const second = buildSellerOsRadarDecisionPackageBindingV1(input)
  assert.equal(first.packageHash, second.packageHash)
  assert.deepEqual(first.payload, second.payload)
  assert.equal(first.payload.radarCandidateId, RADAR_CANDIDATE_ID)
  assert.equal(first.payload.identityBinding.familyId, FAMILY_ID)
  assert.equal(first.payload.identityBinding.opportunityCaseId,
    OPPORTUNITY_CASE_ID)
  assert.equal(first.payload.identityBinding.demandEvidenceGrain, "FAMILY")
  assert.equal(first.payload.identityBinding.exactProductDemandClaimed, false)
  assert.equal(first.payload.identityBinding.priceEvidenceScope, "FAMILY")
  assert.equal(first.finalEconomics.contributionProfitUsd, 25.89)
  assert.equal(first.finalEconomics.contributionMarginPercent, 49.25)

  const result = buildSellerOsDeterministicFactoryPlanV1({
    ...input,
    activeDuplicateCount: 0,
    decisionPackage: {
      id: "33333333-3333-4333-8333-333333333333",
      status: "GENERATED",
      package_hash: first.packageHash,
      package_payload: first.payload,
      smart_stocking_learning_profile: first.profile,
    },
  })
  assert.equal(result.blockers.includes("DECISION_PACKAGE_NOT_BOUND"), false)
  assert.equal(result.blockers.includes("PRODUCT_TRUTH_NOT_READY"), false)
  assert.equal(result.stageStatuses.PRODUCT_TRUTH_READY, "READY")
  assert.equal(result.stageStatuses.ECONOMICS_READY, "READY")
  assert.equal(result.listingReady, true)
})

test("Product Truth enrichment rebinds the same durable decision identity without mutating its entry snapshot", () => {
  const input = radarBindingInputs()
  const first = buildSellerOsRadarDecisionPackageBindingV1(input)
  const enrichedTruth = {
    ...input.opportunity.assessment.productTruth,
    evidenceDigest: `sha256:${"9".repeat(64)}`,
    provenProductValues: { Style: "Layered", Type: "Necklace" },
  }
  const rebound = buildSellerOsRadarDecisionPackageBindingV1({
    ...input,
    opportunity: {
      ...input.opportunity,
      assessment: {
        ...input.opportunity.assessment,
        productTruth: enrichedTruth,
      },
    },
    existingLearningProfile: first.profile,
  })
  assert.equal(rebound.profile.entrySnapshotHash,
    first.profile.entrySnapshotHash)
  assert.deepEqual(rebound.profile.entrySnapshot,
    first.profile.entrySnapshot)
  assert.notEqual(rebound.packageHash, first.packageHash)
  assert.equal(rebound.payload.identityBinding.productTruthDigest,
    enrichedTruth.evidenceDigest)
})

test("Radar Product Truth reuses the exact candidate namespace without promoting family demand to product attributes", () => {
  const input = radarBindingInputs()
  const result = resolveSellerOsExactProductTruthV1(input.opportunity)
  assert.equal(result.exact, true)
  assert.equal(result.bindingClass, "RADAR_CANDIDATE_ID")
  assert.equal(result.acquisitionRequired, false)
  assert.equal(result.reused, true)
  assert.equal(result.durable, true)
  assert.equal(result.unsupportedAttributeCount, 0)
  assert.equal(result.unsupportedAttributesPersisted, 0)
  assert.equal(input.opportunity.assessment.radarFactoryCandidateV1
    .demandEvidenceGrain, "FAMILY")
  assert.equal(input.opportunity.assessment.radarFactoryCandidateV1
    .exactProductDemandClaimed, false)
})

test("Radar Product Truth remains fail-closed when the candidate namespace or exact supplier identity conflicts", () => {
  const input = radarBindingInputs()
  const candidate = input.opportunity.assessment.candidate
  const mismatch = resolveSellerOsExactProductTruthV1({
    ...input.opportunity,
    assessment: { ...input.opportunity.assessment,
      candidate: { ...candidate, supplierVariantId: "OTHER-VARIANT" } },
  })
  assert.equal(mismatch.exact, false)
  assert.equal(mismatch.bindingClass, "UNRESOLVED")
  assert.equal(mismatch.acquisitionRequired, true)
})

test("Radar package binding fails closed when family lineage conflicts", () => {
  const input = radarBindingInputs()
  assert.throws(() => buildSellerOsRadarDecisionPackageBindingV1({
    ...input,
    frontier: { ...input.frontier,
      frontier_payload: { ...input.frontier.frontier_payload,
        familyId: `market-family-v1:sha256:${"9".repeat(64)}` } },
  }), /RADAR_DECISION_PACKAGE_BINDING_INPUT_UNPROVEN/)
})

test("existing contracts are reused with no scheduler, table, pipeline or eBay write", () => {
  const source = readFileSync(
    new URL("./ebay-smart-stocking-durable-factory-v1.ts", import.meta.url),
    "utf8",
  )
  assert.match(source, /from\("ebay_luna_opportunity_queue"\)/)
  assert.match(source, /from\("ebay_listing_packages"\)/)
  assert.match(source, /created_by: null/)
  assert.match(source, /get_seller_os_latest_profitability_frontiers_v1/)
  assert.doesNotMatch(source, /create table|scheduler|publishOffer|withdrawOffer/i)
  assert.equal(plan().marketplaceWrites, 0)
  assert.equal(plan().publishCalls, 0)
})

test("command-center action has a generic factory fallback instead of an allowlist veto", () => {
  const route = readFileSync(new URL(
    "../../app/api/admin/ebay/command-center/route.ts", import.meta.url), "utf8")
  assert.match(route, /materializeSellerOsDeterministicFactoryCandidateV1/)
  assert.doesNotMatch(route, /COMMAND_CENTER_SMART_STOCKING_CANDIDATE_MISMATCH/)
})
