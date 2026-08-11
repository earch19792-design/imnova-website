import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    const value = String(specifier)
    if (value.startsWith(".") && !/\.(?:ts|mjs|js|json)$/.test(value)) {
      return nextResolve(`${value}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const {
  buildEbayRegistryRepairDryRun,
  buildUnprovenEbayRegistryRepairDryRun,
} = await import("./ebay-registry-repair-dry-run.ts")

const ACCOUNT_KEY = "seller-certified:fixture-fingerprint"
const OBSERVED_AT = "2026-08-11T16:00:00.000Z"

function liveListing(index) {
  return {
    itemId: String(400000000000 + index),
    sku: `LIVE-SKU-${index + 1}`,
    customLabel: `LIVE-SKU-${index + 1}`,
    variationKey: null,
    title: `Protected listing ${index + 1}`,
    listingState: "ACTIVE",
    listingFormat: "FixedPriceItem",
    startTime: "2026-07-01T00:00:00.000Z",
    availableQuantity: 5,
    price: 19.99,
    currency: "USD",
    marketplaceSite: "US",
    marketplaceCertification: {
      status: "US_CERTIFIED",
      source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
      observedAt: OBSERVED_AT,
    },
    identityAmbiguous: false,
    source: "EBAY_TRADING_GET_MY_EBAY_SELLING",
    observedAt: OBSERVED_AT,
  }
}

function registryRow({ id, itemId, sku }) {
  return {
    id,
    account_key: ACCOUNT_KEY,
    source: "EBAY_INVENTORY_API",
    ebay_item_id: itemId,
    ebay_sku: sku,
    ebay_variation_key: null,
    listing_status: "active",
    title: "Registry title not returned",
    ebay_quantity: null,
    ebay_price: null,
    currency: "USD",
    market_radar_product_id: null,
    supplier_variant_id: null,
    supplier_sku: null,
    supplier_cost_at_linking: null,
    last_ebay_sync_at: "2026-08-10T12:00:00.000Z",
    raw_payload: { marker: "RAW_MARKER_MUST_NOT_ESCAPE" },
    sync_generation: 7,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-08-10T12:00:00.000Z",
  }
}

function certifiedFixture() {
  const liveListings = Array.from({ length: 26 }, (_, index) =>
    liveListing(index))
  const registryRows = [
    registryRow({
      id: "registry-repair",
      itemId: liveListings[0].itemId,
      sku: "STALE-REGISTRY-SKU",
    }),
    registryRow({
      id: "registry-review-1",
      itemId: "910000000001",
      sku: liveListings[1].sku,
    }),
    registryRow({
      id: "registry-review-2",
      itemId: "910000000002",
      sku: liveListings[2].sku,
    }),
    ...Array.from({ length: 4 }, (_, index) => registryRow({
      id: `registry-stale-${index + 1}`,
      itemId: String(920000000001 + index),
      sku: `OLD-REGISTRY-SKU-${index + 1}`,
    })),
  ]
  return { liveListings, registryRows }
}

function build(fixture = certifiedFixture(), options = {}) {
  return buildEbayRegistryRepairDryRun({
    accountKey: ACCOUNT_KEY,
    accountVerified: "YES",
    marketplaceId: "EBAY_US",
    observedAt: OBSERVED_AT,
    liveListings: fixture.liveListings,
    registryRows: fixture.registryRows,
    reviewedEvidenceFingerprint: options.reviewedEvidenceFingerprint,
  })
}

test("certified 26-to-7 evidence produces only the safe dry-run tranche", () => {
  const result = build()
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.CREATE_NEW_COUNT, 23)
  assert.equal(result.MARK_STALE_COUNT, 4)
  assert.equal(result.HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.STALE_PRECONDITION_STATUS, "PASS")
  assert.deepEqual([
    result.LIVE_ALREADY_MATCHED_COUNT,
    result.LIVE_REPAIR_EXISTING_COUNT,
    result.LIVE_CREATE_NEW_COUNT,
    result.LIVE_HUMAN_REVIEW_COUNT,
    result.LIVE_UNPROVEN_COUNT,
  ], [0, 1, 23, 2, 0])
  assert.deepEqual([
    result.REGISTRY_KEEP_CURRENT_COUNT,
    result.REGISTRY_REPAIR_EXISTING_COUNT,
    result.REGISTRY_MARK_STALE_COUNT,
    result.REGISTRY_MARK_HISTORICAL_COUNT,
    result.REGISTRY_HUMAN_REVIEW_COUNT,
    result.REGISTRY_UNPROVEN_COUNT,
  ], [0, 1, 4, 0, 2, 0])
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
  assert.equal(result.CURRENT_LIVE_COUNT, 26)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 7)
  assert.match(result.CURRENT_EVIDENCE_FINGERPRINT,
    /^rr_evidence_[a-f0-9]{24}$/)
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(result.DRY_RUN_STALE_LABEL,
    "DRY RUN CURRENT — LIVE RECHECK REQUIRED BEFORE WRITE")
  assert.equal(result.DRY_RUN_STATE_BOUND, "YES")
  assert.equal(result.DRY_RUN_STATE_FINGERPRINT_PRESENT, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE, "YES")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 24)
  assert.equal(result.EXPECTED_LIVE_COUNT, 26)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92.31)
  assert.deepEqual(result.REPAIR_FIELDS_TO_CHANGE, ["ebay_sku"])
  assert.deepEqual(result.STALE_FIELDS_TO_CHANGE, ["listing_status"])
  assert.ok(!result.CREATE_FIELDS_TO_POPULATE.includes("market_radar_product_id"))
  assert.equal(result.STALE_STATE_GUARD_SUPPORTED, "YES")
})

test("SKU equality is human review only and never relink or create authority", () => {
  const result = build()
  assert.equal(result.HUMAN_REVIEW_CANDIDATES.length, 2)
  for (const candidate of result.HUMAN_REVIEW_CANDIDATES) {
    assert.equal(candidate.RELATIONSHIP_TYPE, "SKU_ONLY")
    assert.equal(candidate.REGISTRY_ITEM_ID_CURRENTLY_LIVE, "NO")
    assert.equal(candidate.SKU_UNIQUE_BOTH_SIDES, "YES")
    assert.equal(candidate.COMPETING_REGISTRY_RELATION, "NO")
    assert.equal(candidate.RECOMMENDED_ACTION, "REVIEW_REQUIRED")
    assert.match(candidate.CANDIDATE_HANDLE, /^rr_review_[a-f0-9]{24}$/)
  }
  assert.equal(result.REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.CREATE_NEW_COUNT, 23)
})

test("new identity ambiguity makes the package unproven and not approvable", () => {
  const fixture = certifiedFixture()
  fixture.liveListings[0] = {
    ...fixture.liveListings[0],
    identityAmbiguous: true,
  }
  const result = build(fixture)
  assert.equal(result.REPAIR_EXISTING_COUNT, 0)
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "UNPROVEN")
  assert.equal(result.LIVE_UNPROVEN_COUNT, 1)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 1)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("current counts and safe-tranche expectations are recomputed dynamically", () => {
  const fixture = certifiedFixture()
  fixture.liveListings.pop()
  const result = build(fixture)
  assert.equal(result.CURRENT_LIVE_COUNT, 25)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 7)
  assert.equal(result.CREATE_NEW_COUNT, 22)
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 23)
  assert.equal(result.EXPECTED_LIVE_COUNT, 25)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("current 27-to-7 evidence derives the refreshed mutually exclusive plan", () => {
  const fixture = certifiedFixture()
  fixture.liveListings.push({
    ...fixture.liveListings[25],
    itemId: "500000000027",
    sku: "LIVE-NEW-024",
    customLabel: "LIVE-NEW-024",
  })
  const result = build(fixture)
  assert.equal(result.CURRENT_LIVE_COUNT, 27)
  assert.equal(result.CURRENT_REGISTRY_COUNT, 7)
  assert.equal(result.LIVE_ALREADY_MATCHED_COUNT, 0)
  assert.equal(result.LIVE_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.LIVE_CREATE_NEW_COUNT, 24)
  assert.equal(result.LIVE_HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.LIVE_UNPROVEN_COUNT, 0)
  assert.equal(result.LIVE_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REGISTRY_KEEP_CURRENT_COUNT, 0)
  assert.equal(result.REGISTRY_REPAIR_EXISTING_COUNT, 1)
  assert.equal(result.REGISTRY_MARK_STALE_COUNT, 4)
  assert.equal(result.REGISTRY_MARK_HISTORICAL_COUNT, 0)
  assert.equal(result.REGISTRY_HUMAN_REVIEW_COUNT, 2)
  assert.equal(result.REGISTRY_UNPROVEN_COUNT, 0)
  assert.equal(result.REGISTRY_DRY_RUN_PARTITION_VALID, "YES")
  assert.equal(result.REPAIR_PRECONDITION_STATUS, "PASS")
  assert.equal(result.CREATE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.STALE_PRECONDITION_STATUS, "PASS")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, 25)
  assert.equal(result.EXPECTED_LIVE_COUNT, 27)
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, 2)
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, 92.59)
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "YES")
})

test("reviewed fingerprint mismatch invalidates the package until refreshed", () => {
  const fixture = certifiedFixture()
  const reviewed = build(fixture)
  const unchanged = build(fixture, {
    reviewedEvidenceFingerprint: reviewed.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(unchanged.DRY_RUN_FRESHNESS_STATUS, "CURRENT")
  assert.equal(unchanged.DRY_RUN_READY_FOR_APPROVAL, "YES")

  fixture.liveListings[25] = {
    ...fixture.liveListings[25],
    itemId: "499999999999",
    sku: "LIVE-SKU-CHANGED",
    customLabel: "LIVE-SKU-CHANGED",
  }
  const stale = build(fixture, {
    reviewedEvidenceFingerprint: reviewed.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.notEqual(stale.CURRENT_EVIDENCE_FINGERPRINT,
    reviewed.CURRENT_EVIDENCE_FINGERPRINT)
  assert.notEqual(stale.DRY_RUN_PACKAGE_HANDLE,
    reviewed.DRY_RUN_PACKAGE_HANDLE)
  assert.equal(stale.DRY_RUN_FRESHNESS_STATUS, "STALE")
  assert.equal(stale.DRY_RUN_STALE_LABEL,
    "DRY RUN STALE — REFRESH REQUIRED")
  assert.equal(stale.REPAIR_PRECONDITION_STATUS, "FAIL")
  assert.equal(stale.CREATE_PRECONDITION_STATUS, "FAIL")
  assert.equal(stale.STALE_PRECONDITION_STATUS, "FAIL")
  assert.equal(stale.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("evidence fingerprint is order independent and exact-state bound", () => {
  const fixture = certifiedFixture()
  const first = build(fixture)
  const reordered = build({
    liveListings: [...fixture.liveListings].reverse(),
    registryRows: [...fixture.registryRows].reverse(),
  })
  assert.equal(first.CURRENT_EVIDENCE_FINGERPRINT,
    reordered.CURRENT_EVIDENCE_FINGERPRINT)
  assert.equal(first.DRY_RUN_PACKAGE_HANDLE, reordered.DRY_RUN_PACKAGE_HANDLE)

  const changedGuard = certifiedFixture()
  changedGuard.registryRows[0] = {
    ...changedGuard.registryRows[0],
    sync_generation: 8,
  }
  const changed = build(changedGuard)
  assert.notEqual(first.CURRENT_EVIDENCE_FINGERPRINT,
    changed.CURRENT_EVIDENCE_FINGERPRINT)
  const staleRegistry = build(changedGuard, {
    reviewedEvidenceFingerprint: first.CURRENT_EVIDENCE_FINGERPRINT,
  })
  assert.equal(staleRegistry.DRY_RUN_FRESHNESS_STATUS, "STALE")
  assert.equal(staleRegistry.DRY_RUN_READY_FOR_APPROVAL, "NO")
})

test("unavailable runtime evidence remains UNPROVEN instead of synthetic zero", () => {
  const result = buildUnprovenEbayRegistryRepairDryRun()
  for (const key of [
    "CURRENT_LIVE_COUNT",
    "CURRENT_REGISTRY_COUNT",
    "REPAIR_EXISTING_COUNT",
    "CREATE_NEW_COUNT",
    "MARK_STALE_COUNT",
    "HUMAN_REVIEW_COUNT",
    "LIVE_UNPROVEN_COUNT",
    "REGISTRY_UNPROVEN_COUNT",
  ]) {
    assert.equal(result[key], "UNPROVEN")
  }
  assert.equal(result.DRY_RUN_READY_FOR_APPROVAL, "NO")
  assert.equal(result.CURRENT_EVIDENCE_FINGERPRINT, "UNPROVEN")
  assert.equal(result.DRY_RUN_FRESHNESS_STATUS, "UNPROVEN")
  assert.equal(result.DRY_RUN_STALE_LABEL, "UNPROVEN")
  assert.equal(result.DRY_RUN_STATE_BOUND, "UNPROVEN")
  assert.equal(result.DRY_RUN_STATE_FINGERPRINT_PRESENT, "UNPROVEN")
  assert.equal(result.APPROVAL_INVALIDATES_ON_EBAY_STATE_CHANGE, "YES")
  assert.equal(result.APPROVAL_INVALIDATES_ON_REGISTRY_STATE_CHANGE, "YES")
  assert.equal(result.EXPECTED_MATCHED_AFTER_SAFE_TRANCHE, "UNPROVEN")
  assert.equal(result.EXPECTED_LIVE_COUNT, "UNPROVEN")
  assert.equal(result.EXPECTED_PENDING_HUMAN_REVIEW, "UNPROVEN")
  assert.equal(result.EXPECTED_COVERAGE_PERCENT, "UNPROVEN")
})

test("package is deterministic, opaque, input-preserving, and zero-write", () => {
  const fixture = certifiedFixture()
  const before = structuredClone(fixture)
  const first = build(fixture)
  const second = build(fixture)
  assert.deepEqual(fixture, before)
  assert.equal(first.DRY_RUN_PACKAGE_HANDLE, second.DRY_RUN_PACKAGE_HANDLE)
  assert.match(first.DRY_RUN_PACKAGE_HANDLE, /^rr_package_[a-f0-9]{24}$/)
  const serialized = JSON.stringify(first)
  assert.doesNotMatch(serialized, /400000000000|LIVE-SKU-1|STALE-REGISTRY-SKU/)
  assert.doesNotMatch(serialized, /RAW_MARKER_MUST_NOT_ESCAPE|Protected listing/)
  assert.doesNotMatch(serialized, /buyer|token|authorization|cookie/i)
  assert.equal(first.REGISTRY_MUTATIONS, 0)
  assert.equal(first.EBAY_WRITES, 0)
  assert.equal(first.PRODUCT_CASE_MUTATIONS, 0)
  assert.equal(first.INVENTORY_WRITES, 0)
  assert.equal(first.FULFILLMENT_WRITES, 0)
  assert.equal(first.OAUTH_CHANGES, 0)
  assert.equal(first.VERCEL_ENV_CHANGES, 0)
})
