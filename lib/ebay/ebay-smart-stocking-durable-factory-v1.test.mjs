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
  isGenericSmartStockingListingIntakeV1,
  isSellerOsDeterministicFactoryPackageV1,
  SELLER_OS_DETERMINISTIC_FACTORY,
} = await import("./ebay-smart-stocking-durable-factory-v1.ts")
const { evaluateEbayListingWorkspaceEligibility } = await import(
  "./ebay-first-luna-opportunity-queue.ts")

const PRODUCT_ID = "9000000000111"
const VARIANT_ID = "9000000000222"
const SKU = "GENERIC-CANARY-001"
const CANDIDATE_KEY = `luna-portex:${PRODUCT_ID}:${VARIANT_ID}`
const TRUTH_DIGEST = `sha256:${"a".repeat(64)}`

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

test("server-owned package authority never fabricates human review", () => {
  const result = plan()
  assert.equal(result.packageSeed.factoryPreparationAuthority.serverOwned, true)
  assert.equal(result.packageSeed.factoryPreparationAuthority.humanApproved, false)
  assert.equal(result.packageSeed.factoryPreparationAuthority.reviewerUserId, null)
  assert.equal(isSellerOsDeterministicFactoryPackageV1(result.packageSeed), true)
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
